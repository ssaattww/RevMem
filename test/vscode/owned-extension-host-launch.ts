import { mkdir, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join, relative } from "node:path";

/** One private worker launch that the parent runner can bound and terminate as a process tree. */
export interface OwnedExtensionHostLaunchInput {
  readonly phase: string;
  readonly workerPath: string;
  readonly configurationPath: string;
  readonly timeoutMs: number;
  readonly diagnosticDirectory: string;
  readonly redactPaths: readonly string[];
}

/** Privacy-safe outcome recorded for every owned Extension Host launch. */
export interface OwnedExtensionHostLaunchResult {
  readonly phase: string;
  readonly status: "succeeded" | "failed" | "timed-out";
  readonly pid: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly termination: "not-needed" | "requested" | "already-exited";
  readonly diagnosticPath: string;
}

interface WorkerMessage {
  readonly kind: "succeeded" | "failed";
  readonly error?: string;
}

const MAX_DIAGNOSTIC_OUTPUT = 16_384;
const TERMINATION_GRACE_MS = 2_000;

const requireTimeout = (timeoutMs: number): number => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100) {
    throw new RangeError("Extension Host launch timeout must be an integer of at least 100ms.");
  }
  return timeoutMs;
};

const redact = (value: string, paths: readonly string[]): string => {
  let result = value;
  for (const path of paths) {
    if (path.length === 0) continue;
    for (const candidate of new Set([path, path.replaceAll("\\", "/")])) {
      result = result.replaceAll(candidate, "<redacted-path>");
    }
  }
  return result.length <= MAX_DIAGNOSTIC_OUTPUT
    ? result
    : `${result.slice(0, MAX_DIAGNOSTIC_OUTPUT)}\n<truncated>`;
};

const diagnosticDisplayPath = (diagnosticPath: string): string => {
  const value = relative(process.cwd(), diagnosticPath);
  return value.startsWith("..") || value.includes(":") ? "<external-diagnostic>" : value;
};

const closeOf = (child: ChildProcess): Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }> =>
  new Promise((resolveClose) => {
    child.once("close", (exitCode, signal) => resolveClose({ exitCode, signal }));
  });

const delay = (milliseconds: number): Promise<void> => new Promise((resolveDelay) => {
  setTimeout(resolveDelay, milliseconds);
});

/** Terminates only the process tree rooted at the known worker PID. */
const terminateOwnedTree = async (child: ChildProcess, closed: Promise<unknown>): Promise<"requested" | "already-exited"> => {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return "already-exited";
  }
  if (process.platform === "win32") {
    const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    await Promise.race([
      closeOf(taskkill),
      delay(TERMINATION_GRACE_MS)
    ]);
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      return "already-exited";
    }
    if (await Promise.race([closed.then(() => true), delay(TERMINATION_GRACE_MS).then(() => false)])) {
      return "requested";
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      return "already-exited";
    }
  }
  return "requested";
};

/** Runs one worker under a finite deadline and records redacted stdout, stderr, phase, and termination evidence. */
export const runOwnedExtensionHostLaunch = async (
  input: OwnedExtensionHostLaunchInput
): Promise<OwnedExtensionHostLaunchResult> => {
  const timeoutMs = requireTimeout(input.timeoutMs);
  const child = spawn(process.execPath, [input.workerPath], {
    cwd: dirname(input.workerPath),
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      REVIEW_RANGE_EXTENSION_HOST_LAUNCH_CONFIG: input.configurationPath
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true
  });
  if (child.pid === undefined) throw new Error("Extension Host worker did not provide an owned PID.");

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const closed = closeOf(child);
  const message = new Promise<WorkerMessage>((resolveMessage) => {
    child.on("message", (value: unknown) => {
      if (typeof value !== "object" || value === null) return;
      const candidate = value as { readonly kind?: unknown; readonly error?: unknown };
      if (candidate.kind !== "succeeded" && candidate.kind !== "failed") return;
      resolveMessage({
        kind: candidate.kind,
        ...(typeof candidate.error === "string" ? { error: candidate.error } : {})
      });
    });
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ readonly kind: "timed-out" }>((resolveTimeout) => {
    timeoutHandle = setTimeout(() => resolveTimeout({ kind: "timed-out" }), timeoutMs);
  });
  const exited = closed.then(() => ({ kind: "exited" as const }));
  const observed = await Promise.race([
    message,
    timeout,
    exited
  ]);
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

  let status: OwnedExtensionHostLaunchResult["status"];
  let workerError: string | undefined;
  let termination: OwnedExtensionHostLaunchResult["termination"] = "not-needed";
  if (observed.kind === "succeeded") {
    status = "succeeded";
  } else {
    status = observed.kind === "timed-out" ? "timed-out" : "failed";
    workerError = observed.kind === "failed" ? observed.error : undefined;
    termination = await terminateOwnedTree(child, closed);
  }
  const closedResult = await closed;
  if (status === "succeeded" && closedResult.exitCode !== 0) status = "failed";

  await mkdir(input.diagnosticDirectory, { recursive: true });
  const diagnosticPath = join(input.diagnosticDirectory, `${input.phase}-${Date.now()}.json`);
  const diagnostic = {
    phase: input.phase,
    status,
    timeoutMs,
    pid: child.pid,
    exitCode: closedResult.exitCode,
    signal: closedResult.signal,
    termination,
    ...(workerError === undefined ? {} : { workerError: redact(workerError, input.redactPaths) }),
    stdout: redact(stdout, input.redactPaths),
    stderr: redact(stderr, input.redactPaths)
  };
  await writeFile(diagnosticPath, `${JSON.stringify(diagnostic, undefined, 2)}\n`, "utf8");
  const result: OwnedExtensionHostLaunchResult = {
    phase: input.phase,
    status,
    pid: child.pid,
    exitCode: closedResult.exitCode,
    signal: closedResult.signal,
    termination,
    diagnosticPath: diagnosticDisplayPath(diagnosticPath)
  };
  console.log(JSON.stringify({ extensionHostLaunch: result }));
  if (status !== "succeeded") {
    throw new Error(`Extension Host launch ${input.phase} ${status}; diagnostic: ${result.diagnosticPath}`);
  }
  return result;
};

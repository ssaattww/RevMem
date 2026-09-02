import { mkdir, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join, relative } from "node:path";

/** One private worker launch that the parent runner can bound and terminate as a process tree. */
export interface OwnedExtensionHostLaunchInput {
  readonly phase: string;
  readonly workerPath: string;
  readonly configurationPath?: string;
  /** Optional arguments passed only to this owned worker. */
  readonly workerArguments?: readonly string[];
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

const closeWithin = async <Result>(
  closed: Promise<Result>,
  timeoutMs: number
): Promise<Result | undefined> => Promise.race([
  closed,
  delay(timeoutMs).then(() => undefined)
]);

/** Extracts only Extension Host PIDs which the owned launch worker reported for this phase. */
const observedExtensionHostPids = (stdout: string): readonly number[] => [...stdout.matchAll(/Started local extension host with pid (\d+)\./gu)]
  .map((match) => Number(match[1]))
  .filter((pid) => Number.isSafeInteger(pid) && pid > 0);

/** Terminates only the process tree rooted at the known task-owned worker PID. */
const terminateOwnedWorkerTree = async (child: ChildProcess, closed: Promise<unknown>): Promise<"requested" | "already-exited"> => {
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
  const launchedAt = Date.now();
  const child = spawn(process.execPath, [input.workerPath, ...(input.workerArguments ?? [])], {
    cwd: dirname(input.workerPath),
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...(input.configurationPath === undefined
        ? {}
        : { REVIEW_RANGE_EXTENSION_HOST_LAUNCH_CONFIG: input.configurationPath })
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true
  });
  if (child.pid === undefined) throw new Error("Extension Host worker did not provide an owned PID.");

  let stdout = "";
  let stderr = "";
  const logT609Timing = (text: string): void => {
    if (input.phase !== "t609-single-root") return;
    for (const line of text.split(/\r?\n/u)) {
      if (line.includes("[T609 timing]")) console.log(redact(line, input.redactPaths));
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    logT609Timing(text);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderr += text;
    logT609Timing(text);
  });
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
    timeoutHandle = setTimeout(
      () => resolveTimeout({ kind: "timed-out" }),
      Math.max(0, timeoutMs - (Date.now() - launchedAt))
    );
  });
  const exited = closed.then(() => ({ kind: "exited" as const }));
  const observed = await Promise.race([
    message,
    timeout,
    exited
  ]);

  let status: OwnedExtensionHostLaunchResult["status"];
  let workerError: string | undefined;
  let termination: OwnedExtensionHostLaunchResult["termination"] = "not-needed";
  let closedResult: { readonly exitCode: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  if (observed.kind === "succeeded") {
    const afterSuccess = await Promise.race([
      closed.then((result) => ({ kind: "exited" as const, result })),
      timeout
    ]);
    if (afterSuccess.kind === "exited") {
      closedResult = afterSuccess.result;
      status = closedResult.exitCode === 0 ? "succeeded" : "failed";
      if (status === "failed") {
        workerError = "Worker reported success but exited unsuccessfully.";
      }
    } else {
      status = "failed";
      workerError = "Worker reported success but did not close before the launch deadline.";
      termination = await terminateOwnedWorkerTree(child, closed);
      closedResult = await closeWithin(closed, TERMINATION_GRACE_MS);
    }
  } else {
    status = observed.kind === "timed-out" ? "timed-out" : "failed";
    workerError = observed.kind === "failed" ? observed.error : undefined;
    if (observed.kind === "exited") {
      closedResult = await closed;
    } else {
      termination = await terminateOwnedWorkerTree(child, closed);
      closedResult = await closeWithin(closed, TERMINATION_GRACE_MS);
    }
  }
  if (closedResult === undefined) {
    workerError ??= "Owned worker did not close after process-tree termination.";
  }
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

  await mkdir(input.diagnosticDirectory, { recursive: true });
  const diagnosticPath = join(input.diagnosticDirectory, `${input.phase}-${Date.now()}.json`);
  const diagnostic = {
    phase: input.phase,
    status,
    timeoutMs,
    pid: child.pid,
    ownedWorkerPid: child.pid,
    ownedExtensionHostPids: observedExtensionHostPids(stdout),
    exitCode: closedResult?.exitCode ?? null,
    signal: closedResult?.signal ?? null,
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
    exitCode: closedResult?.exitCode ?? null,
    signal: closedResult?.signal ?? null,
    termination,
    diagnosticPath: diagnosticDisplayPath(diagnosticPath)
  };
  console.log(JSON.stringify({ extensionHostLaunch: result }));
  if (status !== "succeeded") {
    throw new Error(`Extension Host launch ${input.phase} ${status}; diagnostic: ${result.diagnosticPath}`);
  }
  return result;
};

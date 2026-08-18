import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import {
  GitCommandFailedError,
  GitExecutableNotFoundError,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult
} from "./contracts";

/** Runtime options for direct Git process execution. */
export interface NodeGitCommandExecutorOptions {
  /** Git executable name or absolute path. Defaults to `git`. */
  readonly executable?: string;
  /** Maximum execution time in milliseconds. Defaults to 30 seconds. */
  readonly timeoutMs?: number;
  /**
   * Soft per-stream diagnostic threshold. Output remains fully captured after
   * this threshold is exceeded. Defaults to 4 MiB.
   */
  readonly maxBufferBytes?: number;
  /** Receives lifecycle diagnostics without command output contents. */
  readonly onDiagnostic?: (message: string) => void;
}

const requirePositiveSafeInteger = (
  value: number,
  name: string
): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }

  return value;
};

const appendDiagnostic = (stderr: string, diagnostic: string): string =>
  stderr.length === 0 ? diagnostic : `${stderr.trimEnd()}\n${diagnostic}`;

const decoded = (chunks: readonly Buffer[]): string =>
  Buffer.concat(chunks).toString("utf8");

/**
 * Node Extension Host command executor that invokes Git directly with `spawn`.
 *
 * The executor never enables a shell and never joins arguments into a command
 * string. Non-zero Git exits are returned as data so the adapter can distinguish
 * normal states such as detached HEAD and a missing object. Git output is forced
 * to the C locale because the adapter classifies stable diagnostic text. Process
 * output is streamed instead of using `execFile.maxBuffer`, so complete repository
 * diffs are not rejected at a fixed byte boundary. Process timeouts reject with
 * `GitCommandFailedError`, preserving invocation, partial output, and deterministic
 * timeout diagnostics.
 */
export class NodeGitCommandExecutor implements GitCommandExecutor {
  /** Configured Git executable name or path. */
  public readonly executable: string;
  private readonly timeoutMs: number;
  private readonly maxBufferBytes: number;
  private readonly onDiagnostic: ((message: string) => void) | undefined;

  /** Creates a direct Git process executor. */
  public constructor(options: NodeGitCommandExecutorOptions = {}) {
    const executable = options.executable ?? "git";
    if (executable.trim().length === 0 || executable.includes("\0")) {
      throw new TypeError("executable must be a non-empty string without null characters");
    }

    this.executable = executable;
    this.timeoutMs = requirePositiveSafeInteger(
      options.timeoutMs ?? 30_000,
      "timeoutMs"
    );
    this.maxBufferBytes = requirePositiveSafeInteger(
      options.maxBufferBytes ?? 4 * 1024 * 1024,
      "maxBufferBytes"
    );
    this.onDiagnostic = options.onDiagnostic;
  }

  /** Executes Git directly and captures complete UTF-8 output. */
  public async execute(invocation: GitCommandInvocation): Promise<GitCommandResult> {
    const normalizedInvocation: GitCommandInvocation = {
      cwd: invocation.cwd,
      argumentsList: [...invocation.argumentsList]
    };
    for (const [index, argument] of normalizedInvocation.argumentsList.entries()) {
      if (argument.includes("\0")) {
        throw new TypeError(`argumentsList[${index}] must not contain null characters`);
      }
    }

    if (normalizedInvocation.cwd !== undefined) {
      const details = await stat(normalizedInvocation.cwd);
      if (!details.isDirectory()) {
        throw new TypeError("Git command cwd must identify a directory.");
      }
    }

    const operation = normalizedInvocation.argumentsList[0] ?? "<no-arguments>";
    const startedAt = Date.now();
    this.reportDiagnostic(
      `Git ${operation} started (arguments=${normalizedInvocation.argumentsList.length}).`
    );

    return new Promise<GitCommandResult>((resolve, reject) => {
      const child = spawn(
        this.executable,
        [...normalizedInvocation.argumentsList],
        {
          cwd: normalizedInvocation.cwd,
          env: {
            ...process.env,
            LANG: "C",
            LC_ALL: "C"
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true
        }
      );
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutThresholdReported = false;
      let stderrThresholdReported = false;
      let settled = false;
      let timedOut = false;

      const finishDiagnostic = (
        outcome: string,
        exitCode: number
      ): void => {
        this.reportDiagnostic(
          `Git ${operation} ${outcome} ` +
          `(exitCode=${exitCode}, durationMs=${Date.now() - startedAt}, ` +
          `stdoutBytes=${stdoutBytes}, stderrBytes=${stderrBytes}).`
        );
      };

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        child.kill("SIGTERM");
      }, this.timeoutMs);

      const clearTimer = (): void => {
        clearTimeout(timeout);
      };

      const capture = (
        streamName: "stdout" | "stderr",
        chunk: Buffer | Uint8Array
      ): void => {
        const bytes = Buffer.from(chunk);
        if (streamName === "stdout") {
          stdoutChunks.push(bytes);
          stdoutBytes += bytes.byteLength;
          if (!stdoutThresholdReported && stdoutBytes > this.maxBufferBytes) {
            stdoutThresholdReported = true;
            this.reportDiagnostic(
              `Git ${operation} stdout exceeded the ${this.maxBufferBytes}-byte ` +
              "stream threshold; capture continues without truncation."
            );
          }
          return;
        }

        stderrChunks.push(bytes);
        stderrBytes += bytes.byteLength;
        if (!stderrThresholdReported && stderrBytes > this.maxBufferBytes) {
          stderrThresholdReported = true;
          this.reportDiagnostic(
            `Git ${operation} stderr exceeded the ${this.maxBufferBytes}-byte ` +
            "stream threshold; capture continues without truncation."
          );
        }
      };

      child.stdout.on("data", (chunk: Buffer | Uint8Array) => {
        capture("stdout", chunk);
      });
      child.stderr.on("data", (chunk: Buffer | Uint8Array) => {
        capture("stderr", chunk);
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimer();
        finishDiagnostic("failed to start", -1);
        if (error.code === "ENOENT") {
          reject(new GitExecutableNotFoundError(this.executable, { cause: error }));
          return;
        }
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimer();
        const stdout = decoded(stdoutChunks);
        const stderr = decoded(stderrChunks);

        if (timedOut) {
          const result = {
            exitCode: -1,
            stdout,
            stderr: appendDiagnostic(
              stderr,
              `Git command timed out after ${this.timeoutMs} ms`
            )
          };
          finishDiagnostic("timed out", -1);
          reject(new GitCommandFailedError(normalizedInvocation, result));
          return;
        }

        const exitCode = code ?? -1;
        const result: GitCommandResult = {
          exitCode,
          stdout,
          stderr:
            code === null && signal !== null
              ? appendDiagnostic(stderr, `Git process terminated by ${signal}`)
              : stderr
        };
        finishDiagnostic(exitCode === 0 ? "completed" : "exited", exitCode);
        resolve(result);
      });
    });
  }

  private reportDiagnostic(message: string): void {
    try {
      this.onDiagnostic?.(message);
    } catch {
      // Diagnostics must never change Git command behavior.
    }
  }
}

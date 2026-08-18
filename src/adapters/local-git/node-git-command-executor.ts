import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

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
   * @deprecated Git output is streamed and no longer constrained by an
   * `execFile.maxBuffer` limit. The option is retained for source compatibility.
   */
  readonly maxBufferBytes?: number;
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

/**
 * Node Extension Host command executor that invokes Git directly with `spawn`.
 *
 * The executor never enables a shell and never joins arguments into a command
 * string. stdout and stderr are consumed incrementally so complete repository
 * diffs are not constrained by Node's `execFile.maxBuffer` limit. Non-zero Git
 * exits are returned as data so the adapter can distinguish normal states such
 * as detached HEAD and a missing object. Git output is forced to the C locale
 * because the adapter classifies stable diagnostic text. Process timeouts reject
 * with `GitCommandFailedError` while preserving invocation and partial output.
 */
export class NodeGitCommandExecutor implements GitCommandExecutor {
  /** Configured Git executable name or path. */
  public readonly executable: string;
  private readonly timeoutMs: number;

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
    if (options.maxBufferBytes !== undefined) {
      requirePositiveSafeInteger(options.maxBufferBytes, "maxBufferBytes");
    }
  }

  /** Executes Git directly and captures streamed UTF-8 output. */
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
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      let settled = false;
      let timedOut = false;
      let terminationTimer: NodeJS.Timeout | undefined;

      const currentOutput = (): Pick<GitCommandResult, "stdout" | "stderr"> => ({
        stdout: [...stdoutChunks, stdoutDecoder.end()].join(""),
        stderr: [...stderrChunks, stderrDecoder.end()].join("")
      });
      const clearTimers = (): void => {
        clearTimeout(timeoutTimer);
        if (terminationTimer !== undefined) clearTimeout(terminationTimer);
      };
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(error);
      };
      const resolveOnce = (result: GitCommandResult): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        resolve(result);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(stdoutDecoder.write(chunk));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(stderrDecoder.write(chunk));
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          rejectOnce(new GitExecutableNotFoundError(this.executable, { cause: error }));
          return;
        }
        rejectOnce(error);
      });
      child.on("close", (exitCode, signal) => {
        if (settled) return;
        const output = currentOutput();
        if (timedOut) {
          rejectOnce(
            new GitCommandFailedError(normalizedInvocation, {
              exitCode: -1,
              stdout: output.stdout,
              stderr: appendDiagnostic(
                output.stderr,
                `Git command timed out after ${this.timeoutMs} ms`
              )
            })
          );
          return;
        }
        if (exitCode !== null) {
          resolveOnce({ exitCode, ...output });
          return;
        }
        rejectOnce(
          new GitCommandFailedError(normalizedInvocation, {
            exitCode: -1,
            stdout: output.stdout,
            stderr: appendDiagnostic(
              output.stderr,
              `Git command terminated by signal ${signal ?? "unknown"}`
            )
          })
        );
      });

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        terminationTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, 1_000);
        terminationTimer.unref();
      }, this.timeoutMs);
      timeoutTimer.unref();
    });
  }
}

import { execFile } from "node:child_process";

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
  /** Maximum bytes captured independently for stdout/stderr. Defaults to 4 MiB. */
  readonly maxBufferBytes?: number;
}

interface ExecFileProcessError extends Error {
  readonly code?: string | number | null;
  readonly killed?: boolean;
  readonly signal?: NodeJS.Signals | null;
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
 * Node Extension Host command executor that invokes Git directly with `execFile`.
 *
 * The executor never enables a shell and never joins arguments into a command
 * string. Non-zero Git exits are returned as data so the adapter can distinguish
 * normal states such as detached HEAD and a missing object. Process timeouts reject
 * with `GitCommandFailedError`, matching raw blob reads and preserving invocation,
 * partial output, and deterministic timeout diagnostics.
 */
export class NodeGitCommandExecutor implements GitCommandExecutor {
  /** Configured Git executable name or path. */
  public readonly executable: string;
  private readonly timeoutMs: number;
  private readonly maxBufferBytes: number;

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
  }

  /** Executes Git directly and captures UTF-8 output. */
  public execute(invocation: GitCommandInvocation): Promise<GitCommandResult> {
    const normalizedInvocation: GitCommandInvocation = {
      cwd: invocation.cwd,
      argumentsList: [...invocation.argumentsList]
    };
    for (const [index, argument] of normalizedInvocation.argumentsList.entries()) {
      if (argument.includes("\0")) {
        throw new TypeError(`argumentsList[${index}] must not contain null characters`);
      }
    }

    return new Promise<GitCommandResult>((resolve, reject) => {
      execFile(
        this.executable,
        [...normalizedInvocation.argumentsList],
        {
          cwd: normalizedInvocation.cwd,
          encoding: "utf8",
          maxBuffer: this.maxBufferBytes,
          shell: false,
          timeout: this.timeoutMs,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ exitCode: 0, stdout, stderr });
            return;
          }

          const processError = error as ExecFileProcessError;
          if (processError.code === "ENOENT") {
            reject(
              new GitExecutableNotFoundError(this.executable, { cause: error })
            );
            return;
          }

          if (
            processError.killed === true &&
            processError.signal !== undefined &&
            processError.signal !== null
          ) {
            reject(
              new GitCommandFailedError(normalizedInvocation, {
                exitCode: -1,
                stdout,
                stderr: appendDiagnostic(
                  stderr,
                  `Git command timed out after ${this.timeoutMs} ms`
                )
              })
            );
            return;
          }

          if (typeof processError.code === "number") {
            resolve({
              exitCode: processError.code,
              stdout,
              stderr
            });
            return;
          }

          reject(error);
        }
      );
    });
  }
}

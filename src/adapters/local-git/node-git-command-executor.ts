import { execFile } from "node:child_process";

import {
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

const requirePositiveSafeInteger = (
  value: number,
  name: string
): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }

  return value;
};

/**
 * Node Extension Host command executor that invokes Git directly with `execFile`.
 *
 * The executor never enables a shell and never joins arguments into a command
 * string. Non-zero Git exits are returned as data so the adapter can distinguish
 * normal states such as detached HEAD and a missing object. Git output is forced
 * to the C locale because the adapter classifies stable diagnostic text.
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
    const argumentsList = [...invocation.argumentsList];
    for (const [index, argument] of argumentsList.entries()) {
      if (argument.includes("\0")) {
        throw new TypeError(`argumentsList[${index}] must not contain null characters`);
      }
    }

    return new Promise<GitCommandResult>((resolve, reject) => {
      execFile(
        this.executable,
        argumentsList,
        {
          cwd: invocation.cwd,
          encoding: "utf8",
          env: {
            ...process.env,
            LANG: "C",
            LC_ALL: "C"
          },
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

          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            reject(
              new GitExecutableNotFoundError(this.executable, { cause: error })
            );
            return;
          }

          if (typeof error.code === "number") {
            resolve({
              exitCode: error.code,
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

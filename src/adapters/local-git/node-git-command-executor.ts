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

/** Minimal readable process stream used by the Git command executor. */
export interface NodeGitCommandProcessStream {
  on(event: "data", listener: (chunk: Buffer | Uint8Array) => void): this;
  destroy(): this;
}

/** Minimal child-process boundary used by production spawn and timeout edge tests. */
export interface NodeGitCommandChildProcess {
  readonly stdout: NodeGitCommandProcessStream;
  readonly stderr: NodeGitCommandProcessStream;
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
  on(
    event: "close",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void
  ): this;
  kill(signal?: NodeJS.Signals | number): boolean;
  unref(): void;
}

/** Process options intentionally narrower than Node's spawn overload surface. */
export interface NodeGitCommandProcessOptions {
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Injectable process factory used to verify bounded termination edge cases. */
export type NodeGitCommandProcessFactory = (
  executable: string,
  argumentsList: readonly string[],
  options: NodeGitCommandProcessOptions
) => NodeGitCommandChildProcess;

/** Runtime options for direct Git process execution. */
export interface NodeGitCommandExecutorOptions {
  /** Git executable name or absolute path. Defaults to `git`. */
  readonly executable?: string;
  /** Maximum execution time in milliseconds. Defaults to 30 seconds. */
  readonly timeoutMs?: number;
  /** Grace period between SIGTERM/SIGKILL and the final bounded failure. Defaults to 250 ms. */
  readonly terminationGraceMs?: number;
  /** Injectable process boundary for timeout lifecycle tests. */
  readonly processFactory?: NodeGitCommandProcessFactory;
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

const joinDiagnostics = (parts: readonly string[]): string =>
  parts.filter((part) => part.length > 0).join("\n");

const defaultProcessFactory: NodeGitCommandProcessFactory = (
  executable,
  argumentsList,
  options
) => spawn(
  executable,
  [...argumentsList],
  {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }
) as unknown as NodeGitCommandChildProcess;

/**
 * Node Extension Host command executor that invokes Git directly with `spawn`.
 *
 * The executor never enables a shell and never joins arguments into a command
 * string. stdout and stderr are consumed incrementally so complete repository
 * diffs are not constrained by Node's `execFile.maxBuffer` limit. Non-zero Git
 * exits are returned as data so the adapter can distinguish normal states such
 * as detached HEAD and a missing object. Git output is forced to the C locale.
 * Timeout failures retain partial diagnostics and have a bounded
 * SIGTERM -> SIGKILL -> forced-failure lifecycle.
 */
export class NodeGitCommandExecutor implements GitCommandExecutor {
  /** Configured Git executable name or path. */
  public readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly processFactory: NodeGitCommandProcessFactory;

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
    this.terminationGraceMs = requirePositiveSafeInteger(
      options.terminationGraceMs ?? 250,
      "terminationGraceMs"
    );
    this.processFactory = options.processFactory ?? defaultProcessFactory;
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
      const child = this.processFactory(
        this.executable,
        normalizedInvocation.argumentsList,
        {
          cwd: normalizedInvocation.cwd,
          env: {
            ...process.env,
            LANG: "C",
            LC_ALL: "C"
          }
        }
      );
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const lifecycleDiagnostics: string[] = [];
      let settled = false;
      let timedOut = false;
      let timeoutDiagnostic = "";
      let timeoutTimer: NodeJS.Timeout | undefined;
      let terminationTimer: NodeJS.Timeout | undefined;
      let forceCloseTimer: NodeJS.Timeout | undefined;

      const clearTimers = (): void => {
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        if (terminationTimer !== undefined) clearTimeout(terminationTimer);
        if (forceCloseTimer !== undefined) clearTimeout(forceCloseTimer);
      };
      const capturedResult = (
        exitCode: number,
        signal: NodeJS.Signals | null = null
      ): GitCommandResult => ({
        exitCode,
        stdout: [...stdoutChunks, stdoutDecoder.end()].join(""),
        stderr: joinDiagnostics([
          [...stderrChunks, stderrDecoder.end()].join(""),
          timeoutDiagnostic,
          ...lifecycleDiagnostics,
          signal === null ? "" : `Git process terminated by ${signal}`
        ])
      });
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(error);
      };
      const finishFailure = (
        exitCode: number,
        signal: NodeJS.Signals | null = null
      ): void => rejectOnce(
        new GitCommandFailedError(
          normalizedInvocation,
          capturedResult(exitCode, signal)
        )
      );
      const resolveOnce = (result: GitCommandResult): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        resolve(result);
      };
      const forceBoundedFailure = (): void => {
        if (settled) return;
        lifecycleDiagnostics.push(
          "Git process did not emit close after SIGKILL within the termination grace period."
        );
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finishFailure(-1);
      };
      const escalateTermination = (): void => {
        if (settled) return;
        const sent = child.kill("SIGKILL");
        lifecycleDiagnostics.push(
          sent
            ? "Git process did not close after SIGTERM; sent SIGKILL."
            : "Git process did not close after SIGTERM; SIGKILL could not be sent."
        );
        forceCloseTimer = setTimeout(
          forceBoundedFailure,
          this.terminationGraceMs
        );
      };

      child.stdout.on("data", (chunk: Buffer | Uint8Array) => {
        stdoutChunks.push(stdoutDecoder.write(Buffer.from(chunk)));
      });
      child.stderr.on("data", (chunk: Buffer | Uint8Array) => {
        stderrChunks.push(stderrDecoder.write(Buffer.from(chunk)));
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (timedOut) {
          lifecycleDiagnostics.push(`Git process error after timeout: ${error.message}`);
          return;
        }
        if (error.code === "ENOENT") {
          rejectOnce(new GitExecutableNotFoundError(this.executable, { cause: error }));
          return;
        }
        rejectOnce(error);
      });
      child.on("close", (exitCode, signal) => {
        if (settled) return;
        if (timedOut) {
          finishFailure(-1, signal);
          return;
        }
        if (exitCode !== null) {
          const result = capturedResult(exitCode);
          resolveOnce(result);
          return;
        }
        finishFailure(-1, signal);
      });

      timeoutTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        timeoutDiagnostic = `Git command timed out after ${this.timeoutMs} ms`;
        const sent = child.kill("SIGTERM");
        if (!sent) {
          lifecycleDiagnostics.push(
            "SIGTERM could not be sent; waiting for process close before escalation."
          );
        }
        terminationTimer = setTimeout(
          escalateTermination,
          this.terminationGraceMs
        );
      }, this.timeoutMs);
    });
  }
}

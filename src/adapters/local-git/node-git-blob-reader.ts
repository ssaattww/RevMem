import { spawn } from "node:child_process";

import {
  GitCommandFailedError,
  GitExecutableNotFoundError,
  type GitCommandInvocation,
  type GitCommandResult
} from "./contracts";
import type { GitBlobReader } from "./git-blob-reader";

const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** Runtime options for raw Git blob streaming. */
export interface NodeGitBlobReaderOptions {
  /** Git executable name or absolute path. Defaults to `git`. */
  readonly executable?: string;
  /** Maximum execution time in milliseconds. Defaults to 30 seconds. */
  readonly timeoutMs?: number;
  /** Grace period between SIGTERM and SIGKILL, and after SIGKILL. Defaults to 250 ms. */
  readonly terminationGraceMs?: number;
}

const requirePositiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
};

const requirePath = (value: string, name: string): string => {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty path without null characters`);
  }
  return value;
};

const requireObjectId = (value: string): string => {
  if (!OBJECT_ID_PATTERN.test(value)) {
    throw new TypeError(
      "blobObjectId must be a lowercase full SHA-1 or SHA-256 object ID"
    );
  }
  return value;
};

const diagnosticText = (bytes: Buffer): string => bytes.toString("utf8");

const joinDiagnostics = (parts: readonly string[]): string =>
  parts.filter((part) => part.length > 0).join("\n");

/**
 * Streams exact blob bytes from `git cat-file blob` without `execFile.maxBuffer`.
 *
 * The caller performs fatal UTF-8 decoding after the complete byte sequence is
 * available. Process failures retain the invocation and captured diagnostics.
 */
export class NodeGitBlobReader implements GitBlobReader {
  /** Git executable name or absolute path used for every raw `cat-file blob` process. */
  public readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;

  public constructor(options: NodeGitBlobReaderOptions = {}) {
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
  }

  public readBlob(
    repositoryRoot: string,
    blobObjectId: string,
    _feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (signal?.aborted === true) return Promise.reject(new DOMException("Git blob read was superseded.", "AbortError"));
    const rootPath = requirePath(repositoryRoot, "repositoryRoot");
    const objectId = requireObjectId(blobObjectId);
    const invocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["cat-file", "blob", objectId]
    };

    return new Promise<Uint8Array>((resolve, reject) => {
      const child = spawn(this.executable, [...invocation.argumentsList], {
        cwd: rootPath,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const lifecycleDiagnostics: string[] = [];
      let settled = false;
      let timedOut = false;
      let timeoutDiagnostic = "";
      let terminationTimer: NodeJS.Timeout | undefined;
      let forceCloseTimer: NodeJS.Timeout | undefined;

      const clearTimers = (): void => {
        clearTimeout(timeout);
        if (terminationTimer !== undefined) {
          clearTimeout(terminationTimer);
        }
        if (forceCloseTimer !== undefined) {
          clearTimeout(forceCloseTimer);
        }
        signal?.removeEventListener("abort", onAbort);
      };

      const onAbort = (): void => {
        if (settled) return;
        child.kill("SIGTERM");
        settled = true;
        clearTimers();
        reject(new DOMException("Git blob read was superseded.", "AbortError"));
      };

      const capturedResult = (
        exitCode: number,
        signal: NodeJS.Signals | null = null
      ): GitCommandResult => {
        const stderr = diagnosticText(Buffer.concat(stderrChunks));
        return {
          exitCode,
          stdout: diagnosticText(Buffer.concat(stdoutChunks)),
          stderr: joinDiagnostics([
            stderr,
            timeoutDiagnostic,
            ...lifecycleDiagnostics,
            signal === null ? "" : `Git process terminated by ${signal}`
          ])
        };
      };

      const finishFailure = (result: GitCommandResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        reject(new GitCommandFailedError(invocation, result));
      };

      const finishProcessError = (error: NodeJS.ErrnoException): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        if (error.code === "ENOENT") {
          reject(new GitExecutableNotFoundError(this.executable, { cause: error }));
          return;
        }
        reject(error);
      };

      const forceBoundedFailure = (): void => {
        if (settled) {
          return;
        }
        lifecycleDiagnostics.push(
          "Git process did not emit close after SIGKILL within the termination grace period."
        );
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finishFailure(capturedResult(-1));
      };

      const escalateTermination = (): void => {
        if (settled) {
          return;
        }
        const sent = child.kill("SIGKILL");
        lifecycleDiagnostics.push(
          sent
            ? "Git process did not close after SIGTERM; sent SIGKILL."
            : "Git process did not close after SIGTERM; SIGKILL could not be sent."
        );
        forceCloseTimer = setTimeout(forceBoundedFailure, this.terminationGraceMs);
      };

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        timeoutDiagnostic = `Git blob read timed out after ${this.timeoutMs} ms`;
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
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk: Buffer | Uint8Array) => {
        stdoutChunks.push(Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk: Buffer | Uint8Array) => {
        stderrChunks.push(Buffer.from(chunk));
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (timedOut) {
          lifecycleDiagnostics.push(`Git process error after timeout: ${error.message}`);
          return;
        }
        finishProcessError(error);
      });
      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        if (timedOut) {
          finishFailure(capturedResult(-1, signal));
          return;
        }

        const stdout = Buffer.concat(stdoutChunks);
        const stderr = Buffer.concat(stderrChunks);
        if (code === 0) {
          settled = true;
          clearTimers();
          resolve(new Uint8Array(stdout));
          return;
        }
        finishFailure({
          exitCode: code ?? -1,
          stdout: diagnosticText(stdout),
          stderr:
            diagnosticText(stderr) ||
            (signal === null ? "" : `Git process terminated by ${signal}`)
        });
      });
    });
  }
}

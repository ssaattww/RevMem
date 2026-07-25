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

/**
 * Streams exact blob bytes from `git cat-file blob` without `execFile.maxBuffer`.
 *
 * The caller performs fatal UTF-8 decoding after the complete byte sequence is
 * available. Process failures retain the invocation and captured diagnostics.
 */
export class NodeGitBlobReader implements GitBlobReader {
  public readonly executable: string;
  private readonly timeoutMs: number;

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
  }

  public readBlob(repositoryRoot: string, blobObjectId: string): Promise<Uint8Array> {
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
      let settled = false;

      const finishFailure = (result: GitCommandResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(new GitCommandFailedError(invocation, result));
      };

      const timeout = setTimeout(() => {
        child.kill();
        finishFailure({
          exitCode: -1,
          stdout: "",
          stderr: `Git blob read timed out after ${this.timeoutMs} ms`
        });
      }, this.timeoutMs);

      child.stdout.on("data", (chunk: Buffer | Uint8Array) => {
        stdoutChunks.push(Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk: Buffer | Uint8Array) => {
        stderrChunks.push(Buffer.from(chunk));
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
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
        const stdout = Buffer.concat(stdoutChunks);
        const stderr = Buffer.concat(stderrChunks);
        if (code === 0) {
          settled = true;
          clearTimeout(timeout);
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

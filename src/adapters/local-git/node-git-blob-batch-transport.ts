import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import type { Readable } from "node:stream";

import {
  CatFileBatchResponseParser,
  MAX_GIT_BLOB_BATCH_OBJECTS,
  type CatFileBatchFrame,
} from "./cat-file-batch-parser.js";

const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;
const DEFAULT_TERMINATION_GRACE_MS = 250;

type TimerHandle = ReturnType<typeof setTimeout>;
type SpawnProcess = (
  executable: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

export interface NodeGitBlobBatchTransportOptions {
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly eofTimeoutMs?: number;
  readonly closeTimeoutMs?: number;
  readonly terminationGraceMs?: number;
  readonly maxBlobBytes?: number;
  readonly spawnProcess?: SpawnProcess;
  readonly setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimer?: (timer: TimerHandle) => void;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

interface CloseInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Identifies the one transport outcome eligible for a later single-object fallback. */
export class GitBlobBatchObjectTooLargeError extends Error {
  public constructor(
    public readonly objectId: string,
    public readonly objectSize: number,
    public readonly limitBytes: number,
  ) {
    super(`Git cat-file batch object ${objectId} is ${objectSize} bytes; batch limit is ${limitBytes} bytes`);
    this.name = "GitBlobBatchObjectTooLargeError";
  }
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

const requirePositiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
};

const requirePath = (value: string): string => {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError("repositoryRoot must be a non-empty path without null characters");
  }
  return value;
};

const readSignalAborted = (signal: AbortSignal): boolean => signal.aborted;

const requireObjectIds = (objectIds: readonly string[]): readonly string[] => {
  if (objectIds.length > MAX_GIT_BLOB_BATCH_OBJECTS) {
    throw new RangeError(`A cat-file batch can contain at most ${MAX_GIT_BLOB_BATCH_OBJECTS} object IDs`);
  }
  for (const [index, objectId] of objectIds.entries()) {
    if (!OBJECT_ID_PATTERN.test(objectId)) {
      throw new TypeError(`objectIds[${index}] must be a lowercase full SHA-1 or SHA-256 object ID`);
    }
  }
  return [...objectIds];
};

/** Runs a sequential, bounded `git cat-file --batch` request for immutable blob bytes. */
export class NodeGitBlobBatchTransport {
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly eofTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly maxBlobBytes: number;
  private readonly spawnProcess: SpawnProcess;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimer: (timer: TimerHandle) => void;

  public constructor(options: NodeGitBlobBatchTransportOptions = {}) {
    this.executable = options.executable ?? "git";
    if (this.executable.trim().length === 0 || this.executable.includes("\0")) {
      throw new TypeError("executable must be a non-empty string without null characters");
    }
    this.timeoutMs = requirePositiveSafeInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.eofTimeoutMs = requirePositiveSafeInteger(options.eofTimeoutMs ?? DEFAULT_TIMEOUT_MS, "eofTimeoutMs");
    this.closeTimeoutMs = requirePositiveSafeInteger(options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS, "closeTimeoutMs");
    this.terminationGraceMs = requirePositiveSafeInteger(
      options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
      "terminationGraceMs",
    );
    this.maxBlobBytes = options.maxBlobBytes ?? 64 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxBlobBytes) || this.maxBlobBytes < 0) {
      throw new RangeError("maxBlobBytes must be a non-negative safe integer");
    }
    this.spawnProcess = options.spawnProcess ?? ((executable, args, spawnOptions) =>
      spawn(executable, args, spawnOptions) as ChildProcessWithoutNullStreams);
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  /**
   * Sends each OID only after the prior frame callback has completed.
   * An already-running callback cannot be cancelled; stage its results and expose them only after this promise resolves.
   */
  public async readBlobs(
    repositoryRoot: string,
    inputObjectIds: readonly string[],
    onBlob: (objectId: string, bytes: Uint8Array) => void | Promise<void>,
    signal?: AbortSignal,
    feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
  ): Promise<void> {
    void feedbackContext;
    const root = requirePath(repositoryRoot);
    const objectIds = requireObjectIds(inputObjectIds);
    if (objectIds.length === 0) return;
    if (signal?.aborted === true) throw new DOMException("Git blob batch was superseded.", "AbortError");

    const child = this.spawnProcess(this.executable, ["cat-file", "--batch"], {
      cwd: root,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const close = deferred<CloseInfo>();
    const fatal = deferred<Error>();
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let closeInfo: CloseInfo | undefined;
    let stdinEnded = false;
    let processFailed = false;
    let failureReason: Error | undefined;
    let methodSettled = false;

    const fail = (error: Error): void => {
      if (processFailed) return;
      processFailed = true;
      failureReason = error;
      fatal.resolve(error);
    };
    const onAbort = (): void => fail(new DOMException("Git blob batch was superseded.", "AbortError"));
    const onProcessError = (error: Error): void => fail(error);
    const onInputError = (error: Error): void => fail(error);
    const onOutputError = (error: Error): void => fail(error);
    const onStderrError = (error: Error): void => fail(error);
    const removeErrorListeners = (): void => {
      child.removeListener("error", onProcessError);
      child.stdin.removeListener("error", onInputError);
      child.stdout.removeListener("error", onOutputError);
      child.stderr.removeListener("error", onStderrError);
    };
    const onClose = (code: number | null, childSignal: NodeJS.Signals | null): void => {
      closeInfo = { code, signal: childSignal };
      close.resolve(closeInfo);
      if (!stdinEnded) {
        fail(new Error(`Git cat-file batch process closed before protocol completion (exit ${code ?? "signal"})`));
      }
      if (methodSettled) {
        removeErrorListeners();
        child.removeListener("close", onClose);
      }
    };
    const onStderr = (chunk: Buffer | Uint8Array): void => {
      const remaining = 64 * 1024 - stderrBytes;
      if (remaining <= 0) return;
      const captured = Buffer.from(chunk).subarray(0, remaining);
      stderr.push(captured);
      stderrBytes += captured.byteLength;
    };

    child.on("error", onProcessError);
    child.on("close", onClose);
    child.stdin.on("error", onInputError);
    child.stdout.on("error", onOutputError);
    child.stderr.on("error", onStderrError);
    child.stderr.on("data", onStderr);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal !== undefined && readSignalAborted(signal)) onAbort();

    const output: AsyncIterator<Buffer | string> = (child.stdout as Readable)[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;
    const withControl = async <T>(operation: Promise<T>, timeoutMs: number | undefined, timeoutMessage: string): Promise<T> => {
      let timer: TimerHandle | undefined;
      const timeout = timeoutMs === undefined ? undefined : new Promise<never>((_resolve, reject) => {
        timer = this.setTimer(() => reject(new Error(timeoutMessage)), timeoutMs);
      });
      try {
        return await Promise.race([
          operation,
          fatal.promise.then((error) => Promise.reject(error)),
          ...(timeout === undefined ? [] : [timeout]),
        ]);
      } finally {
        if (timer !== undefined) this.clearTimer(timer);
      }
    };

    const waitForClose = async (timeoutMs: number): Promise<boolean> => {
      if (closeInfo !== undefined) return true;
      let timer: TimerHandle | undefined;
      const timeout = new Promise<false>((resolve) => {
        timer = this.setTimer(() => resolve(false), timeoutMs);
      });
      try {
        await Promise.race([close.promise, timeout]);
        return closeInfo !== undefined;
      } finally {
        if (timer !== undefined) this.clearTimer(timer);
      }
    };

    const assertActive = (): void => {
      if (failureReason !== undefined) throw failureReason;
      if (signal?.aborted === true) {
        const error = new DOMException("Git blob batch was superseded.", "AbortError");
        fail(error);
        throw error;
      }
    };

    const writeObjectId = (objectId: string): Promise<void> => {
      assertActive();
      return new Promise((resolve, reject) => {
      let writeFinished = false;
      let writeReturned = false;
      let needsDrain = false;
      let drained = false;
      let settled = false;
      const cleanup = (): void => { child.stdin.removeListener("drain", onDrain); };
      const completeIfReady = (): void => {
        if (!settled && writeReturned && writeFinished && (!needsDrain || drained)) {
          settled = true;
          cleanup();
          resolve();
        }
      };
      const finish = (error?: Error | null): void => {
        if (settled) return;
        if (error != null) {
          settled = true;
          cleanup();
          reject(error);
          return;
        }
        writeFinished = true;
        completeIfReady();
      };
      const onDrain = (): void => {
        drained = true;
        completeIfReady();
      };
      child.stdin.once("drain", onDrain);
      try {
        assertActive();
        needsDrain = !child.stdin.write(`${objectId}\n`, finish);
        writeReturned = true;
        completeIfReady();
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
      });
    };

    const terminateAndReap = async (): Promise<void> => {
      if (closeInfo === undefined) {
        try { child.kill("SIGTERM"); } catch { /* Continue bounded cleanup after a kill error. */ }
        if (!(await waitForClose(this.terminationGraceMs))) {
          try { child.kill("SIGKILL"); } catch { /* Stream destruction below remains the final bound. */ }
          if (!(await waitForClose(this.terminationGraceMs))) {
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            return;
          }
        }
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    };

    try {
      for (const objectId of objectIds) {
        assertActive();
        const parser = new CatFileBatchResponseParser([objectId], this.maxBlobBytes);
        const frame = await withControl((async (): Promise<CatFileBatchFrame> => {
          await writeObjectId(objectId);
          assertActive();
          while (true) {
            const next = await output.next();
            assertActive();
            if (next.done) {
              parser.finish();
              throw new Error("Git cat-file batch ended before returning the requested object");
            }
            const frames = parser.push(typeof next.value === "string" ? Buffer.from(next.value) : next.value);
            if (frames.length > 0) return frames[0]!;
          }
        })(), this.timeoutMs, `Git cat-file batch request timed out after ${this.timeoutMs} ms`);

        if (frame.kind !== "blob") {
          if (frame.kind === "missing") throw new Error(`Git cat-file batch object ${objectId} is missing`);
          if (frame.kind === "wrong-type") throw new Error(`Git cat-file batch object ${objectId} has type ${frame.type}, not blob`);
          throw new GitBlobBatchObjectTooLargeError(objectId, frame.size, this.maxBlobBytes);
        }
        assertActive();
        await withControl(Promise.resolve().then(() => {
          assertActive();
          return onBlob(objectId, frame.bytes);
        }), undefined, "");
        assertActive();
      }

      stdinEnded = true;
      child.stdin.end();
      while (true) {
        const next = await withControl(output.next(), this.eofTimeoutMs,
          `Git cat-file batch timed out waiting for stdout EOF after ${this.eofTimeoutMs} ms`);
        assertActive();
        if (next.done) break;
        throw new Error("Git cat-file batch produced extra output after all requested objects");
      }

      const closed = await withControl(close.promise, this.closeTimeoutMs,
        `Git cat-file batch process close timed out after ${this.closeTimeoutMs} ms`);
      assertActive();
      if (closed.code !== 0 || closed.signal !== null) {
        const diagnostics = Buffer.concat(stderr).toString("utf8");
        throw new Error(`Git cat-file batch failed with exit ${closed.code ?? "signal"}${diagnostics.length === 0 ? "" : `: ${diagnostics}`}`);
      }
    } catch (error) {
      await terminateAndReap();
      throw error;
    } finally {
      methodSettled = true;
      signal?.removeEventListener("abort", onAbort);
      child.stderr.removeListener("data", onStderr);
      if (closeInfo !== undefined) {
        removeErrorListeners();
        child.removeListener("close", onClose);
      }
    }
  }
}

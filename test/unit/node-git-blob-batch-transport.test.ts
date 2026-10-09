import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

import {
  GitBlobBatchObjectTooLargeError,
  NodeGitBlobBatchTransport,
  raceWithFailureNotification,
  type NodeGitBlobBatchTransportOptions,
} from "../../src/adapters/local-git/node-git-blob-batch-transport.js";

const firstOid = "a".repeat(40);
const secondOid = "b".repeat(40);
const WAIT_TIMEOUT_MS = 5_000;
const TEST_BODY_TIMEOUT_MS = 30_000;

interface TransportTestScope {
  active: boolean;
  readonly gates: Set<() => void>;
  readonly children: Set<FakeChild>;
  readonly reads: Set<Promise<void>>;
}

const testScopes = new AsyncLocalStorage<TransportTestScope>();

const createTestScope = (): TransportTestScope => ({
  active: true,
  gates: new Set(),
  children: new Set(),
  reads: new Set(),
});

const requireActiveTestScope = (resource: string): TransportTestScope => {
  const scope = testScopes.getStore();
  if (scope === undefined || !scope.active) {
    throw new Error(`Cannot register ${resource} outside an active transport test scope`);
  }
  return scope;
};

const waitForCondition = async (
  condition: () => boolean,
  description: string,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}`);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(remainingMs, 5)));
  }
};

const waitForEventLoopTurn = async (description: string): Promise<void> => {
  let completed = false;
  setImmediate(() => { completed = true; });
  await waitForCondition(() => completed, description);
};

const createCallbackGate = (): {
  readonly promise: Promise<void>;
  readonly markStarted: () => void;
  readonly hasStarted: () => boolean;
  readonly release: () => void;
} => {
  const scope = requireActiveTestScope("callback gate");
  let resolvePromise!: () => void;
  let started = false;
  let released = false;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  const release = (): void => {
    if (released) return;
    released = true;
    scope.gates.delete(release);
    resolvePromise();
  };
  scope.gates.add(release);
  return {
    promise,
    markStarted: () => { started = true; },
    hasStarted: () => started,
    release,
  };
};

class ManualClock {
  private nextId = 0;
  private readonly timers = new Map<number, () => void>();

  public setTimeout(callback: () => void): ReturnType<typeof setTimeout> {
    const id = ++this.nextId;
    this.timers.set(id, callback);
    return id as unknown as ReturnType<typeof setTimeout>;
  }

  public clearTimeout(handle: ReturnType<typeof setTimeout>): void {
    this.timers.delete(handle as unknown as number);
  }

  public fireNext(): void {
    const entry = this.timers.entries().next().value as [number, () => void] | undefined;
    assert.ok(entry, "expected a pending timer");
    this.timers.delete(entry[0]);
    entry[1]();
  }

  public get size(): number {
    return this.timers.size;
  }
}

interface FakeChildOptions {
  readonly onObject: (objectId: string, child: FakeChild) => void;
  readonly closeOnStdinEnd?: boolean;
  readonly endStdoutOnStdinEnd?: boolean;
  readonly closeOnTerm?: boolean;
  readonly closeOnKill?: boolean;
  readonly exitCode?: number | null;
  readonly syncWriteReturnsFalse?: boolean;
  readonly deferWriteCallback?: boolean;
  readonly onClosing?: () => void;
}

class FakeChild extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly signals: string[] = [];
  public readonly objectIds: string[] = [];
  public readonly stdin: Writable;
  public unrefCalled = false;
  private lineBuffer = "";
  private pendingWriteCallback: ((error?: Error | null) => void) | undefined;
  private closed = false;

  public constructor(private readonly options: FakeChildOptions) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.consumeInput(chunk.toString("ascii"));
        callback();
      },
      final: (callback) => {
        if (this.options.endStdoutOnStdinEnd === true || this.options.closeOnStdinEnd === true) this.stdout.end();
        if (this.options.closeOnStdinEnd === true) {
          queueMicrotask(() => this.close(this.options.exitCode ?? 0, null));
        }
        callback();
      },
    });
    if (options.syncWriteReturnsFalse === true) {
      this.stdin.write = ((chunk: Uint8Array | string, callback?: (error?: Error | null) => void): boolean => {
        this.consumeInput(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("ascii"));
        callback?.();
        return false;
      }) as typeof this.stdin.write;
    } else if (options.deferWriteCallback === true) {
      this.stdin.write = ((chunk: Uint8Array | string, callback?: (error?: Error | null) => void): boolean => {
        this.consumeInput(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("ascii"));
        this.pendingWriteCallback = callback;
        return true;
      }) as typeof this.stdin.write;
    }
  }

  private consumeInput(input: string): void {
    this.lineBuffer += input;
    while (this.lineBuffer.includes("\n")) {
      const newline = this.lineBuffer.indexOf("\n");
      const objectId = this.lineBuffer.slice(0, newline);
      this.lineBuffer = this.lineBuffer.slice(newline + 1);
      if (objectId.length > 0) {
        this.objectIds.push(objectId);
        this.options.onObject(objectId, this);
      }
    }
  }

  public kill(signal = "SIGTERM"): boolean {
    this.signals.push(signal);
    if ((signal === "SIGTERM" && this.options.closeOnTerm === true) ||
        (signal === "SIGKILL" && this.options.closeOnKill === true)) {
      queueMicrotask(() => this.close(null, signal));
    }
    return true;
  }

  public unref(): this {
    this.unrefCalled = true;
    return this;
  }

  public sendBlob(objectId: string, bytes: Uint8Array): void {
    this.sendRaw(Buffer.concat([
      Buffer.from(`${objectId} blob ${bytes.byteLength}\n`, "ascii"),
      Buffer.from(bytes),
      Buffer.from("\n", "ascii"),
    ]));
  }

  public sendRaw(bytes: Uint8Array): void {
    this.stdout.write(bytes);
  }

  public failInput(error: Error): void {
    this.stdin.emit("error", error);
  }

  public releaseWriteCallback(error?: Error | null): void {
    const callback = this.pendingWriteCallback;
    this.pendingWriteCallback = undefined;
    callback?.(error);
  }

  public close(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    if (!this.stdout.readableEnded) {
      try {
        this.stdout.end();
      } catch (error) {
        errors.push(error);
      }
    }
    if (!this.stderr.readableEnded) {
      try {
        this.stderr.end();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.options.onClosing?.();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.emit("close", code, signal);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, "Fake child close reported failures");
  }

  public cleanup(): void {
    const errors: unknown[] = [];
    try {
      this.releaseWriteCallback();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (!this.closed) this.close(null, null);
    } catch (error) {
      errors.push(error);
    }
    for (const stream of [this.stdin, this.stdout, this.stderr]) {
      try {
        stream.destroy();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Fake child cleanup reported failures");
  }
}

const cleanupTestScope = async (scope: TransportTestScope): Promise<unknown[]> => {
  const errors: unknown[] = [];
  scope.active = false;
  for (const release of [...scope.gates]) {
    try {
      release();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const child of scope.children) {
    try {
      child.cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await waitForCondition(() => scope.reads.size === 0, "all scoped fake transport reads to settle");
  } catch (error) {
    errors.push(error);
  }
  return errors;
};

const runWithDeadline = async (
  run: () => void | Promise<void>,
  testName: string,
  timeoutMs = TEST_BODY_TIMEOUT_MS,
): Promise<void> => {
  const task = Promise.resolve().then(run);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Test body "${testName}" exceeded ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([task, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const runInTestScope = async (
  testName: string,
  run: () => void | Promise<void>,
  timeoutMs = TEST_BODY_TIMEOUT_MS,
): Promise<void> => {
  const scope = createTestScope();
  let bodyFailed = false;
  let bodyError: unknown;
  let cleanupErrors: unknown[];
  try {
    await testScopes.run(scope, () => runWithDeadline(run, testName, timeoutMs));
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  } finally {
    cleanupErrors = await cleanupTestScope(scope);
  }

  if (bodyFailed) {
    if (cleanupErrors.length > 0 && bodyError instanceof Error) {
      try {
        Object.defineProperty(bodyError, "cleanupErrors", { value: cleanupErrors, configurable: true });
      } catch {
        // Keep the original test failure authoritative if diagnostic attachment is not possible.
      }
    } else if (cleanupErrors.length > 0) {
      throw new AggregateError([bodyError, ...cleanupErrors], `Test and cleanup failed: ${testName}`);
    }
    throw bodyError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Test cleanup failed: ${testName}`);
  }
};

const testWithCleanup = (name: string, run: () => void | Promise<void>): void => {
  test(name, () => runInTestScope(name, run));
};

const createFailureNotifications = (): {
  readonly subscribe: (listener: (error: Error) => void) => () => void;
  readonly fail: (error: Error) => void;
  readonly subscriberCount: () => number;
} => {
  const listeners = new Set<(error: Error) => void>();
  let failureReason: Error | undefined;
  return {
    subscribe: (listener) => {
      if (failureReason !== undefined) {
        listener(failureReason);
        return () => {};
      }
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    fail: (error) => {
      if (failureReason !== undefined) return;
      failureReason = error;
      const pending = [...listeners];
      listeners.clear();
      for (const listener of pending) listener(error);
    },
    subscriberCount: () => listeners.size,
  };
};

test("failure notification race unsubscribes after successful operation settlement", async () => {
  const failure = createFailureNotifications();

  assert.equal(await raceWithFailureNotification(Promise.resolve("complete"), failure.subscribe), "complete");
  assert.equal(failure.subscriberCount(), 0);
  failure.fail(new Error("late failure"));
  assert.equal(failure.subscriberCount(), 0);
});

test("failure notification race unsubscribes when the operation rejects", async () => {
  const failure = createFailureNotifications();
  const expected = new Error("operation rejected");

  await assert.rejects(
    raceWithFailureNotification(Promise.reject(expected), failure.subscribe),
    (error: unknown) => error === expected,
  );
  assert.equal(failure.subscriberCount(), 0);
});

test("failure notification race unsubscribes after failure wins", async () => {
  const failure = createFailureNotifications();
  const expected = new Error("operation failed");
  const running = raceWithFailureNotification(new Promise<never>(() => {}), failure.subscribe);

  assert.equal(failure.subscriberCount(), 1);
  failure.fail(expected);
  await assert.rejects(running, (error: unknown) => error === expected);
  assert.equal(failure.subscriberCount(), 0);
});

test("failure notification race immediately observes an already-recorded failure", async () => {
  const failure = createFailureNotifications();
  const expected = new Error("failure recorded before subscription");
  failure.fail(expected);

  await assert.rejects(
    raceWithFailureNotification(new Promise<never>(() => {}), failure.subscribe),
    (error: unknown) => error === expected,
  );
  assert.equal(failure.subscriberCount(), 0);
});

test("failure notification race unsubscribes when a timeout wins", async () => {
  const failure = createFailureNotifications();
  const timeout = Promise.reject<never>(new Error("controlled timeout"));

  await assert.rejects(
    raceWithFailureNotification(new Promise<never>(() => {}), failure.subscribe, timeout),
    /controlled timeout/u,
  );
  assert.equal(failure.subscriberCount(), 0);
});

const setup = (
  configure: (clock: ManualClock) => FakeChild,
  options: Omit<NodeGitBlobBatchTransportOptions, "spawnProcess" | "setTimer" | "clearTimer"> = {},
): { readonly transport: NodeGitBlobBatchTransport; readonly child: FakeChild; readonly clock: ManualClock } => {
  const scope = requireActiveTestScope("fake transport setup");
  const clock = new ManualClock();
  const child = configure(clock);
  scope.children.add(child);
  const transport = new NodeGitBlobBatchTransport({
    ...options,
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    setTimer: (callback) => clock.setTimeout(callback),
    clearTimer: (handle) => clock.clearTimeout(handle),
  });
  const readBlobs = transport.readBlobs.bind(transport);
  transport.readBlobs = (...args: Parameters<NodeGitBlobBatchTransport["readBlobs"]>): Promise<void> => {
    if (!scope.active) {
      child.cleanup();
      return Promise.reject(new Error("Cannot start a transport read after its test scope has ended"));
    }
    const operation = readBlobs(...args);
    scope.reads.add(operation);
    void operation.then(
      () => scope.reads.delete(operation),
      () => scope.reads.delete(operation),
    );
    return operation;
  };
  return { transport, child, clock };
};

testWithCleanup("batch transport waits for each callback before writing the next OID", async () => {
  const { transport, child } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from(objectId === firstOid ? "one" : "two")),
    closeOnStdinEnd: true,
  }));
  const firstCallback = createCallbackGate();
  const callbacks: string[] = [];
  const running = transport.readBlobs("/repo", [firstOid, secondOid], async (objectId, bytes) => {
    callbacks.push(`${objectId}:${Buffer.from(bytes).toString("ascii")}`);
    if (objectId === firstOid) {
      firstCallback.markStarted();
      await firstCallback.promise;
    }
  });

  await waitForCondition(firstCallback.hasStarted, "first blob callback to start");
  assert.deepEqual(child.objectIds, [firstOid]);
  firstCallback.release();
  await running;

  assert.deepEqual(child.objectIds, [firstOid, secondOid]);
  assert.deepEqual(callbacks, [`${firstOid}:one`, `${secondOid}:two`]);
});

testWithCleanup("batch transport stops the request deadline while awaiting a blob callback", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnStdinEnd: true,
  }), { timeoutMs: 30_000 });
  const callback = createCallbackGate();
  const running = transport.readBlobs("/repo", [firstOid], async () => {
    callback.markStarted();
    await callback.promise;
  });

  await waitForCondition(callback.hasStarted, "blob callback to start");
  assert.equal(clock.size, 0);
  callback.release();
  await running;
  assert.deepEqual(child.objectIds, [firstOid]);
});

testWithCleanup("batch transport reaps a callback failure with bounded TERM then KILL", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnKill: true,
  }), { terminationGraceMs: 250 });
  const running = transport.readBlobs("/repo", [firstOid], () => {
    throw new Error("callback failed");
  });

  await waitForCondition(() => child.signals.length > 0, "TERM signal after callback failure");
  assert.deepEqual(child.signals, ["SIGTERM"]);
  clock.fireNext();
  await assert.rejects(running, /callback failed/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

testWithCleanup("batch transport applies a separate deadline waiting for process close after stdout EOF", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    endStdoutOnStdinEnd: true,
    closeOnKill: true,
  }), { closeTimeoutMs: 5_000 });
  const running = transport.readBlobs("/repo", [firstOid], async () => undefined);

  await waitForCondition(() => child.stdin.writableEnded, "stdin to end after all object requests");
  await waitForCondition(() => clock.size > 0, "process-close deadline to be scheduled");
  clock.fireNext();
  await waitForCondition(() => child.signals.length > 0, "TERM signal after close deadline");
  clock.fireNext();
  await assert.rejects(running, /close timed out/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

testWithCleanup("batch transport abort reaps once and does not invoke a delayed callback twice", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnKill: true,
  }));
  const controller = new AbortController();
  let callbackCount = 0;
  const callback = createCallbackGate();
  const running = transport.readBlobs("/repo", [firstOid, secondOid], async () => {
    callbackCount += 1;
    callback.markStarted();
    await callback.promise;
  }, controller.signal);

  await waitForCondition(callback.hasStarted, "delayed blob callback to start");
  controller.abort();
  await waitForCondition(() => child.signals.length > 0, "TERM signal after abort");
  clock.fireNext();
  await assert.rejects(running, { name: "AbortError" });
  callback.release();
  await waitForEventLoopTurn("delayed callback continuation after release");
  assert.equal(callbackCount, 1);
  assert.deepEqual(child.objectIds, [firstOid]);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

testWithCleanup("batch transport request deadline triggers bounded cleanup before any callback", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: () => undefined,
    closeOnKill: true,
  }), { timeoutMs: 30_000 });
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; });

  await waitForCondition(() => child.objectIds.length > 0, "first object request to be written");
  clock.fireNext();
  await waitForCondition(() => child.signals.length > 0, "TERM signal after request timeout");
  clock.fireNext();

  await assert.rejects(running, /request timed out after 30000 ms/u);
  assert.equal(callbackCount, 0);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

testWithCleanup("batch transport rejects a malformed frame and reaps the process", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (_objectId, fake) => fake.sendRaw(Buffer.from(`${secondOid} blob 0\n\n`, "ascii")),
    closeOnKill: true,
  }));
  const running = transport.readBlobs("/repo", [firstOid], async () => undefined);

  await waitForCondition(() => child.signals.length > 0, "TERM signal after malformed frame");
  clock.fireNext();
  await assert.rejects(running, /object ID mismatch/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

testWithCleanup("batch transport rejects missing, non-blob, and oversized frames", async () => {
  const cases = [
    { frame: (fake: FakeChild) => fake.sendRaw(Buffer.from(`${firstOid} missing\n`, "ascii")), expected: /is missing/u },
    { frame: (fake: FakeChild) => fake.sendRaw(Buffer.from(`${firstOid} tree 0\n\n`, "ascii")), expected: /has type tree/u },
    { frame: (fake: FakeChild) => fake.sendBlob(firstOid, Buffer.from("large")), expected: /5 bytes; batch limit is 2 bytes/u, maxBlobBytes: 2 },
  ];

  for (const item of cases) {
    const { transport, child } = setup(() => new FakeChild({
      onObject: (_objectId, fake) => item.frame(fake),
      closeOnTerm: true,
    }), { maxBlobBytes: item.maxBlobBytes ?? 16 });
    await assert.rejects(transport.readBlobs("/repo", [firstOid], async () => undefined), (error: unknown) => {
      assert.match(String(error), item.expected);
      if (item.maxBlobBytes !== undefined) {
        assert.ok(error instanceof GitBlobBatchObjectTooLargeError);
        assert.equal(error.objectId, firstOid);
        assert.equal(error.limitBytes, 2);
        assert.equal(error.objectSize, 5);
      }
      return true;
    });
    assert.deepEqual(child.signals, ["SIGTERM"]);
  }
});

testWithCleanup("batch transport completes blob frames exactly at the limit and with a zero-byte limit", async () => {
  const cases = [
    { payload: Buffer.from("abc", "ascii"), maxBlobBytes: 3 },
    { payload: Buffer.alloc(0), maxBlobBytes: 0 },
  ] as const;

  for (const item of cases) {
    const { transport, child } = setup(() => new FakeChild({
      onObject: (objectId, fake) => fake.sendBlob(objectId, item.payload),
      closeOnStdinEnd: true,
    }), { maxBlobBytes: item.maxBlobBytes });
    const received: Buffer[] = [];

    await transport.readBlobs("/repo", [firstOid], (_objectId, bytes) => {
      received.push(Buffer.from(bytes));
    });

    assert.deepEqual(received, [item.payload]);
    assert.deepEqual(child.signals, []);
  }
});

testWithCleanup("batch transport rejects a normal or abnormal process close before the first response", async () => {
  for (const exitCode of [0, 7]) {
    const { transport, child } = setup(() => new FakeChild({
      onObject: (_objectId, fake) => fake.close(exitCode, null),
    }));
    let callbackCount = 0;

    await assert.rejects(
      transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; }),
      new RegExp(`closed before protocol completion \\(exit ${exitCode}\\)`),
    );
    assert.equal(callbackCount, 0);
    assert.deepEqual(child.signals, []);
    assert.equal(child.unrefCalled, true);
  }
});

test("batch transport rejects invalid blob limits", () => {
  for (const maxBlobBytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new NodeGitBlobBatchTransport({ maxBlobBytes }), /non-negative safe integer/u);
  }
});

testWithCleanup("batch transport input errors reject after bounded cleanup", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (_objectId, fake) => fake.failInput(new Error("input stream failed")),
    closeOnKill: true,
  }));
  const running = transport.readBlobs("/repo", [firstOid], async () => undefined);

  await waitForCondition(() => child.signals.length > 0, "TERM signal after input error");
  clock.fireNext();
  await assert.rejects(running, /input stream failed/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

testWithCleanup("batch transport rejects a nonzero exit even after all response frames", async () => {
  const { transport, child } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnStdinEnd: true,
    exitCode: 7,
  }));
  let callbackCount = 0;

  await assert.rejects(
    transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; }),
    /failed with exit 7/u,
  );

  assert.equal(callbackCount, 1);
  assert.deepEqual(child.signals, []);
});

testWithCleanup("batch transport observes abort racing with successful process close", async () => {
  const controller = new AbortController();
  const { transport, child } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnStdinEnd: true,
    onClosing: () => controller.abort(),
  }));
  let callbackCount = 0;

  await assert.rejects(
    transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; }, controller.signal),
    { name: "AbortError" },
  );
  assert.equal(callbackCount, 1);
  assert.deepEqual(child.signals, []);
});

testWithCleanup("batch transport has a separate bound while waiting for stdout EOF", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnKill: true,
  }), { eofTimeoutMs: 10_000 });
  const running = transport.readBlobs("/repo", [firstOid], async () => undefined);

  await waitForCondition(() => child.stdin.writableEnded, "stdin to end before stdout EOF timeout");
  await waitForCondition(() => clock.size > 0, "stdout EOF deadline to be scheduled");
  clock.fireNext();
  await waitForCondition(() => child.signals.length > 0, "TERM signal after stdout EOF timeout");
  clock.fireNext();

  await assert.rejects(running, /waiting for stdout EOF after 10000 ms/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

testWithCleanup("batch transport aborts an outstanding object request and reaps the process", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: () => undefined,
    closeOnKill: true,
  }));
  const controller = new AbortController();
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; }, controller.signal);

  await waitForCondition(() => child.objectIds.length > 0, "outstanding object request to be written");
  controller.abort();
  await waitForCondition(() => child.signals.length > 0, "TERM signal after abort");
  clock.fireNext();

  await assert.rejects(running, { name: "AbortError" });
  child.sendBlob(firstOid, Buffer.from("late"));
  await waitForEventLoopTurn("late blob response after abort");
  assert.equal(callbackCount, 0);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

testWithCleanup("batch transport coalesces input-error and abort races into one cleanup", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: () => undefined,
    closeOnKill: true,
  }));
  const controller = new AbortController();
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; }, controller.signal);

  await waitForCondition(() => child.objectIds.length > 0, "object request before input-error race");
  child.failInput(new Error("input won the race"));
  controller.abort();
  await waitForCondition(() => child.signals.length > 0, "TERM signal after input-error race");
  clock.fireNext();

  await assert.rejects(running, /input won the race/u);
  assert.equal(callbackCount, 0);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

testWithCleanup("batch transport rechecks abort after callback before sending the next OID", async () => {
  const { transport, child } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnTerm: true,
  }));
  const controller = new AbortController();

  await assert.rejects(
    transport.readBlobs("/repo", [firstOid, secondOid], () => { controller.abort(); }, controller.signal),
    { name: "AbortError" },
  );

  assert.deepEqual(child.objectIds, [firstOid]);
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

testWithCleanup("batch transport keeps late process and stream errors handled after bounded destroy", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
  }));
  const running = transport.readBlobs("/repo", [firstOid], () => { throw new Error("callback failed"); });

  await waitForCondition(() => child.signals.length > 0, "TERM signal after callback failure");
  clock.fireNext();
  await waitForCondition(() => child.signals.length >= 2, "KILL signal after TERM grace period");
  clock.fireNext();
  await assert.rejects(running, /callback failed/u);

  assert.doesNotThrow(() => child.emit("error", new Error("late child error")));
  assert.doesNotThrow(() => child.stdin.emit("error", new Error("late stdin error")));
  assert.doesNotThrow(() => child.stdout.emit("error", new Error("late stdout error")));
  assert.doesNotThrow(() => child.stderr.emit("error", new Error("late stderr error")));
});

testWithCleanup("batch transport waits for drain when write callback fires synchronously before a false return", async () => {
  const { transport, child } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnStdinEnd: true,
    syncWriteReturnsFalse: true,
  }));
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; });

  await waitForCondition(() => child.objectIds.length > 0, "object request before drain");
  assert.equal(callbackCount, 0);
  child.stdin.emit("drain");
  await running;
  assert.equal(callbackCount, 1);
});

testWithCleanup("batch transport does not resume after a write callback arrives after timeout cleanup", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: () => undefined,
    closeOnKill: true,
    deferWriteCallback: true,
  }));
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid, secondOid], () => { callbackCount += 1; });

  await waitForCondition(() => child.objectIds.length > 0, "object request before write timeout");
  clock.fireNext();
  await waitForCondition(() => child.signals.length > 0, "TERM signal after write timeout");
  clock.fireNext();
  await assert.rejects(running, /request timed out/u);

  child.releaseWriteCallback();
  await waitForEventLoopTurn("late write callback after timeout cleanup");
  assert.deepEqual(child.objectIds, [firstOid]);
  assert.equal(callbackCount, 0);
});

testWithCleanup("batch transport ignores stdout that completes after abort has already won", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({ onObject: () => undefined }));
  const controller = new AbortController();
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; }, controller.signal);

  await waitForCondition(() => child.objectIds.length > 0, "object request before abort");
  controller.abort();
  await waitForCondition(() => child.signals.length > 0, "TERM signal after abort");
  clock.fireNext();
  await waitForCondition(() => clock.size > 0, "second termination grace timer");
  child.sendBlob(firstOid, Buffer.from("late response"));
  await waitForEventLoopTurn("late stdout response after abort");
  clock.fireNext();

  await assert.rejects(running, { name: "AbortError" });
  assert.equal(callbackCount, 0);
  assert.deepEqual(child.objectIds, [firstOid]);
});

testWithCleanup("batch transport destroys streams and unreferences after bounded reap expires", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
  }));
  const running = transport.readBlobs("/repo", [firstOid], () => { throw new Error("callback failed"); });

  await waitForCondition(() => child.signals.length > 0, "TERM signal after callback failure");
  clock.fireNext();
  await waitForCondition(() => child.signals.length >= 2, "KILL signal after TERM grace period");
  clock.fireNext();

  await assert.rejects(running, /callback failed/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.stdin.destroyed, true);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal(child.unrefCalled, true);
});

test("transport test harness fails finitely when a wait condition never occurs", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    waitForCondition(() => false, "deliberately absent event", 25),
    /Timed out after 25 ms waiting for deliberately absent event/u,
  );
  assert.ok(Date.now() - startedAt < 1_000, "a missing event must not leave a polling loop running");
});

test("transport test harness preserves body failure and attempts every cleanup", async () => {
  const bodyFailure = new Error("original body failure");
  const cleanupFailure = new Error("first fake child cleanup failure");
  const cleanupOrder: string[] = [];

  await assert.rejects(
    runInTestScope("body failure cleanup", () => {
      const scope = requireActiveTestScope("cleanup fixture");
      scope.children.add({
        cleanup: () => { cleanupOrder.push("first"); throw cleanupFailure; },
      } as unknown as FakeChild);
      scope.children.add({
        cleanup: () => { cleanupOrder.push("second"); },
      } as unknown as FakeChild);
      throw bodyFailure;
    }, 100),
    (error: unknown) => {
      assert.equal(error, bodyFailure, "cleanup must not replace the original test failure");
      assert.deepEqual((error as Error & { cleanupErrors?: unknown[] }).cleanupErrors, [cleanupFailure]);
      return true;
    },
  );
  assert.deepEqual(cleanupOrder, ["first", "second"], "all children must get a cleanup attempt");
});

test("transport test scope isolates late work from the next test", async () => {
  let releaseLateWork!: () => void;
  const lateWorkGate = new Promise<void>((resolve) => { releaseLateWork = resolve; });
  let lateGateError: unknown;
  let lateReadError: unknown;
  let lateSetupError: unknown;
  let lateSetupCalls = 0;
  const lateRun = runInTestScope("deadline late work", async () => {
    const { transport } = setup(() => new FakeChild({ onObject: () => undefined }));
    await lateWorkGate;
    try {
      createCallbackGate();
    } catch (error) {
      lateGateError = error;
    }
    try {
      await transport.readBlobs("/repo", [firstOid], async () => undefined);
    } catch (error) {
      lateReadError = error;
    }
    try {
      setup(() => {
        lateSetupCalls += 1;
        return new FakeChild({ onObject: () => undefined });
      });
    } catch (error) {
      lateSetupError = error;
    }
  }, 25);

  await assert.rejects(lateRun, /Test body "deadline late work" exceeded 25 ms/u);
  releaseLateWork();
  await waitForCondition(
    () => lateGateError !== undefined && lateReadError !== undefined && lateSetupError !== undefined,
    "late gate/read/setup registrations to be rejected",
    1_000,
  );
  assert.match(String(lateGateError), /outside an active transport test scope/u);
  assert.match(String(lateReadError), /after its test scope has ended/u);
  assert.match(String(lateSetupError), /outside an active transport test scope/u);
  assert.equal(lateSetupCalls, 0, "late setup must fail before creating a fake child");

  let nextScopeWasIndependent = false;
  await runInTestScope("next scope", () => {
    const gate = createCallbackGate();
    gate.release();
    setup(() => new FakeChild({ onObject: () => undefined }));
    nextScopeWasIndependent = true;
  }, 1_000);
  assert.equal(nextScopeWasIndependent, true);
});

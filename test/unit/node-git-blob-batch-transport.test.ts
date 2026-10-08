import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

import {
  GitBlobBatchObjectTooLargeError,
  NodeGitBlobBatchTransport,
  type NodeGitBlobBatchTransportOptions,
} from "../../src/adapters/local-git/node-git-blob-batch-transport.js";

const firstOid = "a".repeat(40);
const secondOid = "b".repeat(40);

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
    if (!this.stdout.readableEnded) this.stdout.end();
    if (!this.stderr.readableEnded) this.stderr.end();
    this.emit("close", code, signal);
  }
}

const setup = (
  configure: (clock: ManualClock) => FakeChild,
  options: Omit<NodeGitBlobBatchTransportOptions, "spawnProcess" | "setTimer" | "clearTimer"> = {},
): { readonly transport: NodeGitBlobBatchTransport; readonly child: FakeChild; readonly clock: ManualClock } => {
  const clock = new ManualClock();
  const child = configure(clock);
  const transport = new NodeGitBlobBatchTransport({
    ...options,
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    setTimer: (callback) => clock.setTimeout(callback),
    clearTimer: (handle) => clock.clearTimeout(handle),
  });
  return { transport, child, clock };
};

test("batch transport waits for each callback before writing the next OID", async () => {
  const { transport, child } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from(objectId === firstOid ? "one" : "two")),
    closeOnStdinEnd: true,
  }));
  let releaseFirst: (() => void) | undefined;
  const callbacks: string[] = [];
  const running = transport.readBlobs("/repo", [firstOid, secondOid], async (objectId, bytes) => {
    callbacks.push(`${objectId}:${Buffer.from(bytes).toString("ascii")}`);
    if (objectId === firstOid) await new Promise<void>((resolve) => { releaseFirst = resolve; });
  });

  while (releaseFirst === undefined) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(child.objectIds, [firstOid]);
  releaseFirst();
  await running;

  assert.deepEqual(child.objectIds, [firstOid, secondOid]);
  assert.deepEqual(callbacks, [`${firstOid}:one`, `${secondOid}:two`]);
});

test("batch transport stops the request deadline while awaiting a blob callback", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnStdinEnd: true,
  }), { timeoutMs: 30_000 });
  let release: (() => void) | undefined;
  const running = transport.readBlobs("/repo", [firstOid], async () => {
    await new Promise<void>((resolve) => { release = resolve; });
  });

  while (release === undefined) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clock.size, 0);
  release();
  await running;
  assert.deepEqual(child.objectIds, [firstOid]);
});

test("batch transport reaps a callback failure with bounded TERM then KILL", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnKill: true,
  }), { terminationGraceMs: 250 });
  const running = transport.readBlobs("/repo", [firstOid], () => {
    throw new Error("callback failed");
  });

  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(child.signals, ["SIGTERM"]);
  clock.fireNext();
  await assert.rejects(running, /callback failed/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("batch transport applies a separate deadline waiting for process close after stdout EOF", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    endStdoutOnStdinEnd: true,
    closeOnKill: true,
  }), { closeTimeoutMs: 5_000 });
  const running = transport.readBlobs("/repo", [firstOid], async () => undefined);

  while (child.stdin.writableEnded !== true) await new Promise((resolve) => setImmediate(resolve));
  while (clock.size === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  await assert.rejects(running, /close timed out/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("batch transport abort reaps once and does not invoke a delayed callback twice", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnKill: true,
  }));
  const controller = new AbortController();
  let callbackCount = 0;
  let release: (() => void) | undefined;
  const running = transport.readBlobs("/repo", [firstOid, secondOid], async () => {
    callbackCount += 1;
    await new Promise<void>((resolve) => { release = resolve; });
  }, controller.signal);

  while (release === undefined) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  await assert.rejects(running, { name: "AbortError" });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callbackCount, 1);
  assert.deepEqual(child.objectIds, [firstOid]);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("batch transport request deadline triggers bounded cleanup before any callback", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: () => undefined,
    closeOnKill: true,
  }), { timeoutMs: 30_000 });
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; });

  while (child.objectIds.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();

  await assert.rejects(running, /request timed out after 30000 ms/u);
  assert.equal(callbackCount, 0);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("batch transport rejects a malformed frame and reaps the process", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (_objectId, fake) => fake.sendRaw(Buffer.from(`${secondOid} blob 0\n\n`, "ascii")),
    closeOnKill: true,
  }));
  const running = transport.readBlobs("/repo", [firstOid], async () => undefined);

  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  await assert.rejects(running, /object ID mismatch/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("batch transport rejects missing, non-blob, and oversized frames", async () => {
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

test("batch transport input errors reject after bounded cleanup", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (_objectId, fake) => fake.failInput(new Error("input stream failed")),
    closeOnKill: true,
  }));
  const running = transport.readBlobs("/repo", [firstOid], async () => undefined);

  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  await assert.rejects(running, /input stream failed/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("batch transport rejects a nonzero exit even after all response frames", async () => {
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

test("batch transport has a separate bound while waiting for stdout EOF", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnKill: true,
  }), { eofTimeoutMs: 10_000 });
  const running = transport.readBlobs("/repo", [firstOid], async () => undefined);

  while (child.stdin.writableEnded !== true) await new Promise((resolve) => setImmediate(resolve));
  while (clock.size === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();

  await assert.rejects(running, /waiting for stdout EOF after 10000 ms/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("batch transport aborts an outstanding object request and reaps the process", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: () => undefined,
    closeOnKill: true,
  }));
  const controller = new AbortController();
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; }, controller.signal);

  while (child.objectIds.length === 0) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();

  await assert.rejects(running, { name: "AbortError" });
  child.sendBlob(firstOid, Buffer.from("late"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callbackCount, 0);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("batch transport coalesces input-error and abort races into one cleanup", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: () => undefined,
    closeOnKill: true,
  }));
  const controller = new AbortController();
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; }, controller.signal);

  while (child.objectIds.length === 0) await new Promise((resolve) => setImmediate(resolve));
  child.failInput(new Error("input won the race"));
  controller.abort();
  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();

  await assert.rejects(running, /input won the race/u);
  assert.equal(callbackCount, 0);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("batch transport rechecks abort after callback before sending the next OID", async () => {
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

test("batch transport keeps late process and stream errors handled after bounded destroy", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
  }));
  const running = transport.readBlobs("/repo", [firstOid], () => { throw new Error("callback failed"); });

  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  while (child.signals.length < 2) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  await assert.rejects(running, /callback failed/u);

  assert.doesNotThrow(() => child.emit("error", new Error("late child error")));
  assert.doesNotThrow(() => child.stdin.emit("error", new Error("late stdin error")));
  assert.doesNotThrow(() => child.stdout.emit("error", new Error("late stdout error")));
  assert.doesNotThrow(() => child.stderr.emit("error", new Error("late stderr error")));
});

test("batch transport waits for drain when write callback fires synchronously before a false return", async () => {
  const { transport, child } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
    closeOnStdinEnd: true,
    syncWriteReturnsFalse: true,
  }));
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; });

  while (child.objectIds.length === 0) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callbackCount, 0);
  child.stdin.emit("drain");
  await running;
  assert.equal(callbackCount, 1);
});

test("batch transport does not resume after a write callback arrives after timeout cleanup", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: () => undefined,
    closeOnKill: true,
    deferWriteCallback: true,
  }));
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid, secondOid], () => { callbackCount += 1; });

  while (child.objectIds.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  await assert.rejects(running, /request timed out/u);

  child.releaseWriteCallback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(child.objectIds, [firstOid]);
  assert.equal(callbackCount, 0);
});

test("batch transport ignores stdout that completes after abort has already won", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({ onObject: () => undefined }));
  const controller = new AbortController();
  let callbackCount = 0;
  const running = transport.readBlobs("/repo", [firstOid], () => { callbackCount += 1; }, controller.signal);

  while (child.objectIds.length === 0) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  while (clock.size === 0) await new Promise((resolve) => setImmediate(resolve));
  child.sendBlob(firstOid, Buffer.from("late response"));
  await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();

  await assert.rejects(running, { name: "AbortError" });
  assert.equal(callbackCount, 0);
  assert.deepEqual(child.objectIds, [firstOid]);
});

test("batch transport destroys streams and unreferences after bounded reap expires", async () => {
  const { transport, child, clock } = setup(() => new FakeChild({
    onObject: (objectId, fake) => fake.sendBlob(objectId, Buffer.from("payload")),
  }));
  const running = transport.readBlobs("/repo", [firstOid], () => { throw new Error("callback failed"); });

  while (child.signals.length === 0) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();
  while (child.signals.length < 2) await new Promise((resolve) => setImmediate(resolve));
  clock.fireNext();

  await assert.rejects(running, /callback failed/u);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.stdin.destroyed, true);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal(child.unrefCalled, true);
});

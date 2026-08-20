import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

import { createTrustedPersistencePathGuard } from "./persistence-schema-recovery";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";

export type StorageRootLockDiagnosticKind = "timeout" | "failure" | "stale-recovered";

/** Privacy-safe lock observation that intentionally excludes filesystem paths and owner tokens. */
export interface StorageRootLockDiagnostic {
  readonly kind: StorageRootLockDiagnosticKind;
  /** Opaque per-acquisition scope used only to collapse repeated lifecycle ticks. */
  readonly operationId: string;
}

/** Raised when another live Extension Host retains the storage-root lease. */
export class StorageRootLockTimeoutError extends Error {
  public constructor() {
    super("Review storage is busy; the operation did not acquire its bounded lock.");
    this.name = "StorageRootLockTimeoutError";
  }
}

/** Raised before publication when this operation no longer owns its lease generation. */
export class StorageRootLeaseLostError extends Error {
  public constructor() {
    super("Review storage lease was lost before publication.");
    this.name = "StorageRootLeaseLostError";
  }
}

/** Owner-fenced lease passed to a root-lock operation. It contains no path or token. */
export interface StorageRootLease {
  /** Fails closed when stale recovery has detached this owner's descriptor. */
  assertOwned(): Promise<void>;
}

export interface StorageRootLockOptions {
  readonly rootPath: string;
  readonly lockPath?: string;
  readonly timeoutMs?: number;
  readonly leaseMs?: number;
  readonly retryDelayMs?: number;
  readonly now?: () => number;
  /** Monotonic elapsed-time source used only for acquisition bounds. */
  readonly monotonicNow?: () => number;
  readonly createOwnerToken?: () => string;
  /** Process liveness probe used before recovering an expired valid descriptor. */
  readonly isProcessAlive?: (processId: number) => Promise<boolean>;
  /** Test-only fault seams for proving bounded cleanup of a partially published lease. */
  readonly writeLease?: (handle: FileHandle, content: string) => Promise<void>;
  readonly syncLease?: (handle: FileHandle) => Promise<void>;
  readonly closeLease?: (handle: FileHandle) => Promise<void>;
  readonly notifyDiagnostic?: (diagnostic: StorageRootLockDiagnostic) => void | Promise<void>;
}

/** Lock owner that may share an alternate AtomicTextFileStore namespace instead of host paths. */
export interface StorageRootLockCoordinator {
  run<T>(rootPath: string, operation: (lease: StorageRootLease) => Promise<T>): Promise<T>;
}

const inProcessTails = new Map<string, Promise<void>>();

/** Deterministic lock coordinator for injected non-Node atomic stores. */
export class InProcessStorageRootLockCoordinator implements StorageRootLockCoordinator {
  public async run<T>(rootPath: string, operation: (lease: StorageRootLease) => Promise<T>): Promise<T> {
    const key = path.resolve(rootPath);
    const previous = inProcessTails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const tail = new Promise<void>((resolve) => { release = resolve; });
    inProcessTails.set(key, tail);
    await previous;
    try {
      return await operation({ assertOwned: async () => undefined });
    } finally {
      release();
      if (inProcessTails.get(key) === tail) inProcessTails.delete(key);
    }
  }
}

interface PersistedLock {
  readonly ownerToken: string;
  readonly expiresAt: number;
  readonly processId: number;
}

const isExists = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const parseLock = (raw: string): PersistedLock | undefined => {
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      value === null || typeof value !== "object" || Array.isArray(value) ||
      !("ownerToken" in value) || !("expiresAt" in value) || !("processId" in value) ||
      typeof value.ownerToken !== "string" || value.ownerToken.length === 0 ||
      typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) ||
      typeof value.processId !== "number" || !Number.isSafeInteger(value.processId) || value.processId <= 0
    ) return undefined;
    return { ownerToken: value.ownerToken, expiresAt: value.expiresAt, processId: value.processId };
  } catch {
    return undefined;
  }
};

/** Atomic, leased, storage-root-local exclusion for independent Extension Host processes. */
export class NodeStorageRootLock {
  private readonly rootPath: string;
  private readonly lockPath: string;
  private readonly timeoutMs: number;
  private readonly leaseMs: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly createOwnerToken: () => string;
  private readonly isProcessAlive: (processId: number) => Promise<boolean>;
  private readonly operationId = randomUUID();

  public constructor(private readonly options: StorageRootLockOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.lockPath = path.resolve(options.lockPath ?? path.join(this.rootPath, "lock"));
    if (path.dirname(this.lockPath) !== this.rootPath) {
      throw new Error("Storage lock must be directly inside its configured storage root.");
    }
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 10;
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.createOwnerToken = options.createOwnerToken ?? randomUUID;
    this.isProcessAlive = options.isProcessAlive ?? (async (processId) => {
      try {
        process.kill(processId, 0);
        return true;
      } catch (error) {
        return !(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ESRCH");
      }
    });
    if (this.timeoutMs < 0 || this.leaseMs <= 0 || this.retryDelayMs < 0) {
      throw new RangeError("Storage lock timings must be non-negative and leaseMs must be positive.");
    }
  }

  /** Acquires the root lock and returns an idempotent owner-checked release callback. */
  public async acquire(): Promise<(() => Promise<void>) & StorageRootLease> {
    const guard = createTrustedPersistencePathGuard(this.rootPath, new NodeAtomicTextFileStore());
    await guard(this.lockPath);
    const ownerToken = this.createOwnerToken();
    const deadline = this.monotonicNow() + this.timeoutMs;
    let staleReported = false;
    try {
      for (;;) {
        await guard(this.lockPath);
        let pendingPath: string | undefined;
        try {
          await mkdir(this.rootPath, { recursive: true });
          pendingPath = path.join(this.rootPath, `.lock-pending-${randomUUID()}`);
          const handle = await open(pendingPath, "wx", 0o600);
          try {
            await (this.options.writeLease ?? ((file, content) => file.writeFile(content, "utf8")))(
              handle,
              JSON.stringify({ ownerToken, expiresAt: this.now() + this.leaseMs, processId: process.pid })
            );
            await (this.options.syncLease ?? ((file) => file.sync()))(handle);
            if (this.options.closeLease !== undefined) await this.options.closeLease(handle);
            await link(pendingPath, this.lockPath);
            await rm(pendingPath, { force: true });
            pendingPath = undefined;
          } catch (error) {
            await handle.close().catch(() => undefined);
            throw error;
          }
          if (staleReported) await this.notify("stale-recovered");
          let leaseLost = false;
          const assertOwned = async (): Promise<void> => {
            if (leaseLost) throw new StorageRootLeaseLostError();
            const current = await readFile(this.lockPath, "utf8").catch(() => undefined);
            if (current === undefined || parseLock(current)?.ownerToken !== ownerToken) {
              leaseLost = true;
              throw new StorageRootLeaseLostError();
            }
            const descriptor = await handle.stat();
            // Recovery removes the moved inode only after comparing its original bytes.
            // A zero-link descriptor is therefore a definitive, successor-safe fence.
            if (process.platform !== "win32" && descriptor.nlink === 0) {
              leaseLost = true;
              throw new StorageRootLeaseLostError();
            }
          };
          const renewTimer = setInterval(() => {
            void this.renew(handle, ownerToken).catch(async () => {
              leaseLost = true;
              await this.notify("failure");
            });
          }, Math.max(1, Math.floor(this.leaseMs / 3)));
          renewTimer.unref();
          const release = this.releaseFor(handle, ownerToken, renewTimer, () => { leaseLost = true; });
          return Object.assign(release, { assertOwned });
        } catch (error) {
          if (pendingPath !== undefined) await rm(pendingPath, { force: true }).catch(() => undefined);
          if (!isExists(error)) {
            throw error;
          }
        }

        const raw = await readFile(this.lockPath, "utf8").catch((error: unknown) => {
          if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        });
        if (raw !== undefined) {
          const existing = parseLock(raw);
          const metadata = await stat(this.lockPath).catch(() => undefined);
          const partialIsAged = metadata !== undefined && metadata.mtimeMs + this.leaseMs <= this.now();
          const futureInvalid = existing !== undefined && existing.expiresAt > this.now() + this.leaseMs * 2;
          // Cooperative live Extension Hosts are never recovered solely because a
          // wall-clock lease elapsed: a stalled owner remains the owner while live.
          // A confirmed-dead cooperative owner cannot renew or publish, so its
          // descriptor is recoverable even before its wall-clock lease elapses.
          // A live or indeterminate owner remains fail-closed; liveness probe
          // failures intentionally propagate instead of being treated as dead.
          const recoverable = existing === undefined || futureInvalid
            ? partialIsAged
            : !await this.isProcessAlive(existing.processId);
          if (recoverable) {
            const recoveryPath = path.join(this.rootPath, `.lock-recovery-${randomUUID()}`);
            await guard(recoveryPath);
            try {
              await rename(this.lockPath, recoveryPath);
              const recovered = await readFile(recoveryPath, "utf8");
              if (recovered === raw) {
                await rm(recoveryPath, { force: true });
                staleReported = true;
                continue;
              }
              // A writer may have renewed through an already-open descriptor while
              // recovery moved the old inode. Never rename this recovery inode back:
              // doing so could overwrite a successor that has acquired lockPath.
              await rm(recoveryPath, { force: true }).catch(() => undefined);
            } catch (error) {
              if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
            }
          }
        }
        if (this.monotonicNow() >= deadline) {
          await this.notify("timeout");
          throw new StorageRootLockTimeoutError();
        }
        await delay(this.retryDelayMs);
      }
    } catch (error) {
      if (!(error instanceof StorageRootLockTimeoutError)) await this.notify("failure");
      throw error;
    }
  }

  private releaseFor(
    handle: FileHandle,
    ownerToken: string,
    renewTimer: NodeJS.Timeout,
    markLost: () => void
  ): () => Promise<void> {
    let released = false;
    return async (): Promise<void> => {
      if (released) return;
      released = true;
      clearInterval(renewTimer);
      try {
        await this.renew(handle, ownerToken, true);
        const current = await readFile(this.lockPath, "utf8").catch(() => undefined);
        if (current !== undefined && parseLock(current)?.ownerToken === ownerToken) {
          await rm(this.lockPath, { force: true });
        }
      } catch {
        markLost();
        throw new StorageRootLeaseLostError();
      } finally {
        await handle.close().catch(() => undefined);
      }
    };
  }

  private async renew(handle: FileHandle, ownerToken: string, release = false): Promise<void> {
    const raw = await readFile(this.lockPath, "utf8").catch(() => undefined);
    if (raw === undefined || parseLock(raw)?.ownerToken !== ownerToken) return;
    await handle.truncate(0);
    // The descriptor remains bound to the owner inode. If stale recovery has already
    // renamed it, this update cannot affect a successor at lockPath.
    await handle.write(
      JSON.stringify({ ownerToken, expiresAt: release ? 0 : this.now() + this.leaseMs, processId: process.pid }),
      0,
      "utf8"
    );
    await handle.sync();
  }

  private async notify(kind: StorageRootLockDiagnosticKind): Promise<void> {
    await Promise.resolve(this.options.notifyDiagnostic?.({ kind, operationId: this.operationId })).catch(() => undefined);
  }
}

/** Runs one operation under a storage-root-local exclusive lease. */
export const withStorageRootLock = async <T>(
  options: StorageRootLockOptions,
  operation: (lease: StorageRootLease) => Promise<T>
): Promise<T> => {
  const release = await new NodeStorageRootLock(options).acquire();
  try {
    await release.assertOwned();
    const result = await operation(release);
    await release.assertOwned();
    return result;
  } finally {
    await release();
  }
};

/** Uses the injected store's coordinator when supplied, otherwise the Node filesystem lease. */
export const withStorageRootLockCoordinator = async <T>(
  coordinator: StorageRootLockCoordinator | undefined,
  options: StorageRootLockOptions,
  operation: (lease: StorageRootLease) => Promise<T>
): Promise<T> => coordinator === undefined
  ? withStorageRootLock(options, operation)
  : coordinator.run(options.rootPath, operation);

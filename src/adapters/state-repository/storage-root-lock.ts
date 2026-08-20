import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { createTrustedPersistencePathGuard } from "./persistence-schema-recovery";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";

export type StorageRootLockDiagnosticKind = "timeout" | "failure" | "stale-recovered";

/** Privacy-safe lock observation that intentionally excludes filesystem paths and owner tokens. */
export interface StorageRootLockDiagnostic {
  readonly kind: StorageRootLockDiagnosticKind;
}

/** Raised when another live Extension Host retains the storage-root lease. */
export class StorageRootLockTimeoutError extends Error {
  public constructor() {
    super("Review storage is busy; the operation did not acquire its bounded lock.");
    this.name = "StorageRootLockTimeoutError";
  }
}

export interface StorageRootLockOptions {
  readonly rootPath: string;
  readonly lockPath?: string;
  readonly timeoutMs?: number;
  readonly leaseMs?: number;
  readonly retryDelayMs?: number;
  readonly now?: () => number;
  readonly createOwnerToken?: () => string;
  readonly notifyDiagnostic?: (diagnostic: StorageRootLockDiagnostic) => void | Promise<void>;
}

interface PersistedLock {
  readonly ownerToken: string;
  readonly expiresAt: number;
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
      !("ownerToken" in value) || !("expiresAt" in value) ||
      typeof value.ownerToken !== "string" || value.ownerToken.length === 0 ||
      typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt)
    ) return undefined;
    return { ownerToken: value.ownerToken, expiresAt: value.expiresAt };
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
  private readonly createOwnerToken: () => string;

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
    this.createOwnerToken = options.createOwnerToken ?? randomUUID;
    if (this.timeoutMs < 0 || this.leaseMs <= 0 || this.retryDelayMs < 0) {
      throw new RangeError("Storage lock timings must be non-negative and leaseMs must be positive.");
    }
  }

  /** Acquires the root lock and returns an idempotent owner-checked release callback. */
  public async acquire(): Promise<() => Promise<void>> {
    const guard = createTrustedPersistencePathGuard(this.rootPath, new NodeAtomicTextFileStore());
    await guard(this.lockPath);
    const ownerToken = this.createOwnerToken();
    const deadline = this.now() + this.timeoutMs;
    let staleReported = false;
    try {
      for (;;) {
        await guard(this.lockPath);
        try {
          await mkdir(this.rootPath, { recursive: true });
          const handle = await open(this.lockPath, "wx", 0o600);
          try {
            await handle.writeFile(JSON.stringify({ ownerToken, expiresAt: this.now() + this.leaseMs }), "utf8");
            await handle.sync();
          } finally {
            await handle.close();
          }
          if (staleReported) await this.notify("stale-recovered");
          const renewTimer = setInterval(() => {
            void this.renew(ownerToken).catch(() => this.notify("failure"));
          }, Math.max(1, Math.floor(this.leaseMs / 3)));
          renewTimer.unref();
          return this.releaseFor(ownerToken, renewTimer);
        } catch (error) {
          if (!isExists(error)) throw error;
        }

        const raw = await readFile(this.lockPath, "utf8").catch((error: unknown) => {
          if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        });
        if (raw !== undefined) {
          const existing = parseLock(raw);
          if (existing !== undefined && existing.expiresAt < this.now()) {
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
              await rename(recoveryPath, this.lockPath).catch(() => undefined);
            } catch (error) {
              if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
            }
          }
        }
        if (this.now() >= deadline) {
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

  private releaseFor(ownerToken: string, renewTimer: NodeJS.Timeout): () => Promise<void> {
    let released = false;
    return async (): Promise<void> => {
      if (released) return;
      released = true;
      clearInterval(renewTimer);
      const raw = await readFile(this.lockPath, "utf8").catch((error: unknown) => {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      });
      if (raw !== undefined && parseLock(raw)?.ownerToken === ownerToken) {
        await rm(this.lockPath, { force: true });
      }
    };
  }

  private async renew(ownerToken: string): Promise<void> {
    const raw = await readFile(this.lockPath, "utf8").catch((error: unknown) => {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (raw === undefined || parseLock(raw)?.ownerToken !== ownerToken) return;
    const handle = await open(this.lockPath, "r+");
    try {
      await handle.truncate(0);
      await handle.writeFile(JSON.stringify({ ownerToken, expiresAt: this.now() + this.leaseMs }), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async notify(kind: StorageRootLockDiagnosticKind): Promise<void> {
    await Promise.resolve(this.options.notifyDiagnostic?.({ kind })).catch(() => undefined);
  }
}

/** Runs one operation under a storage-root-local exclusive lease. */
export const withStorageRootLock = async <T>(
  options: StorageRootLockOptions,
  operation: () => Promise<T>
): Promise<T> => {
  const release = await new NodeStorageRootLock(options).acquire();
  try {
    return await operation();
  } finally {
    await release();
  }
};

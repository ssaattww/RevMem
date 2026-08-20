import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import type {
  NonGitSnapshotCodec,
  NonGitSnapshotStorage,
  NonGitSnapshotStoredValue,
} from "../../application/non-git-snapshots/index";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../core/contracts/index";
import { NodeAtomicTextFileStore, withStorageRootLock } from "../state-repository/index";
import type { AtomicTextFileStore } from "../state-repository/index";
import {
  createTrustedPersistencePathGuard,
  publishSchemaMigration,
  quarantinePersistedText,
  runSchemaMigrationChain,
  UnsupportedPersistedSchemaVersionError
} from "../state-repository/persistence-schema-recovery";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

interface PersistedSnapshot { readonly schemaVersion: number; readonly createdAt: number; readonly bytes: string; }
interface PersistedLatest { readonly schemaVersion: number; readonly snapshotId: string; }

const SNAPSHOT_MIGRATION_STEPS = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: (value: Record<string, unknown>): Record<string, unknown> => ({
      ...value,
      schemaVersion: 1
    })
  }
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseMigratedRecord = (
  text: string,
  documentName: string
): ReturnType<typeof runSchemaMigrationChain> => {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new TypeError(`${documentName} must be an object`);
  }
  return runSchemaMigrationChain(
    parsed,
    documentName,
    SNAPSHOT_MIGRATION_STEPS,
    0
  );
};

const decodeBase64 = (value: string): Uint8Array => {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("Invalid persisted snapshot bytes");
  }
  return Uint8Array.from(decoded);
};

/** Node Extension Host codec for the application-level snapshot port. */
export class NodeNonGitSnapshotCodec implements NonGitSnapshotCodec {
  public async compress(plainText: string): Promise<Uint8Array> {
    return Uint8Array.from(await gzipAsync(Buffer.from(plainText, "utf8"), { level: 9 }));
  }
  public async decompress(bytes: Uint8Array): Promise<string> {
    return (await gunzipAsync(Buffer.from(bytes))).toString("utf8");
  }
  public sha256(plainText: string): string {
    return createHash("sha256").update(plainText, "utf8").digest("hex");
  }
}

/** Atomic local-extension-storage adapter for compressed snapshots and their generation pointers. */
export class NodeNonGitSnapshotStorage implements NonGitSnapshotStorage {
  private readonly snapshotsDirectory: string;
  private readonly latestDirectory: string;
  private readonly rootPath: string;
  private readonly maxEntries: number;
  private readonly retentionMs: number;

  public constructor(options: { readonly snapshotDirectory: string; readonly atomicFileStore?: AtomicTextFileStore; readonly maxEntries?: number; readonly retentionMs?: number; readonly notifyStorageLockDiagnostic?: (diagnostic: import("../state-repository/index").StorageRootLockDiagnostic) => void | Promise<void> }) {
    const snapshotDirectory = path.resolve(options.snapshotDirectory);
    this.rootPath = path.dirname(snapshotDirectory);
    this.snapshotsDirectory = path.join(snapshotDirectory, "entries");
    this.latestDirectory = path.join(snapshotDirectory, "latest");
    this.atomicFileStore = options.atomicFileStore ?? new NodeAtomicTextFileStore(this.rootPath);
    this.notifyStorageLockDiagnostic = options.notifyStorageLockDiagnostic;
    this.maxEntries = options.maxEntries ?? 128;
    this.retentionMs = options.retentionMs ?? 30 * 24 * 60 * 60 * 1_000;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1 || !Number.isSafeInteger(this.retentionMs) || this.retentionMs < 0) {
      throw new RangeError("Snapshot cleanup bounds must be safe non-negative integers.");
    }
  }
  private readonly atomicFileStore: AtomicTextFileStore;
  private readonly notifyStorageLockDiagnostic: ((diagnostic: import("../state-repository/index").StorageRootLockDiagnostic) => void | Promise<void>) | undefined;

  public async put(snapshotId: string, bytes: Uint8Array, createdAt: number): Promise<void> {
    await withStorageRootLock({ rootPath: this.rootPath, notifyDiagnostic: this.notifyStorageLockDiagnostic }, async (lease) => {
      const filePath = this.snapshotPath(snapshotId);
      await this.guard(filePath);
      await lease.assertOwned();
      await this.atomicFileStore.writeTextAtomically(filePath, JSON.stringify({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, createdAt, bytes: Buffer.from(bytes).toString("base64") } satisfies PersistedSnapshot));
    });
  }

  public async get(snapshotId: string): Promise<NonGitSnapshotStoredValue | undefined> {
    const filePath = this.snapshotPath(snapshotId);
    const text = await this.atomicFileStore.readText(filePath);
    if (text === undefined) return undefined;

    let migration: ReturnType<typeof runSchemaMigrationChain>;
    let createdAt: unknown;
    let bytes: unknown;
    try {
      migration = parseMigratedRecord(text, "Persisted snapshot");
      createdAt = migration.value.createdAt;
      bytes = migration.value.bytes;
      if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0 || typeof bytes !== "string") {
        throw new Error("Invalid persisted snapshot");
      }
      const decoded = decodeBase64(bytes);
      if (migration.migrated) {
        const guard = createTrustedPersistencePathGuard(this.rootPath, this.atomicFileStore);
        await publishSchemaMigration(this.atomicFileStore, [{
          filePath,
          original: text,
          migrated: JSON.stringify(migration.value)
        }], guard);
      }
      return { createdAt, bytes: decoded };
    } catch (error) {
      if (error instanceof UnsupportedPersistedSchemaVersionError) throw error;
      await this.quarantine(snapshotId);
      return undefined;
    }
  }

  public async delete(snapshotId: string): Promise<void> {
    await withStorageRootLock({ rootPath: this.rootPath, notifyDiagnostic: this.notifyStorageLockDiagnostic }, async (lease) => {
      for (const name of await this.readDirectoryNames(this.latestDirectory)) {
        if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
        if (await this.readLatestPointer(path.join(this.latestDirectory, name)) === snapshotId) return;
      }
      await lease.assertOwned();
      await this.deletePersistedText(this.snapshotPath(snapshotId));
    });
  }

  /** Publishes a generation then reads pointers, plans, and deletes under one root fence. */
  public async putAndCleanup(
    snapshotId: string,
    bytes: Uint8Array,
    createdAt: number,
    limits: { readonly maxSnapshots: number; readonly maxTotalCompressedBytes: number; readonly retentionMs: number }
  ): Promise<void> {
    await withStorageRootLock({ rootPath: this.rootPath, notifyDiagnostic: this.notifyStorageLockDiagnostic }, async (lease) => {
      const filePath = this.snapshotPath(snapshotId);
      await this.guard(filePath);
      await lease.assertOwned();
      await this.atomicFileStore.writeTextAtomically(filePath, JSON.stringify({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, createdAt, bytes: Buffer.from(bytes).toString("base64") } satisfies PersistedSnapshot));
      await this.cleanupUnreferencedSnapshots(Date.now(), snapshotId, limits, lease);
    });
  }

  /** Quarantines one corrupt snapshot wrapper and every valid latest pointer that names it. */
  public async quarantine(snapshotId: string): Promise<void> {
    await withStorageRootLock({ rootPath: this.rootPath, notifyDiagnostic: this.notifyStorageLockDiagnostic }, async (lease) => {
      const guard = createTrustedPersistencePathGuard(this.rootPath, this.atomicFileStore);
      const filePath = this.snapshotPath(snapshotId);
      const text = await this.atomicFileStore.readText(filePath);
      if (text !== undefined) {
        await lease.assertOwned();
        await quarantinePersistedText(this.atomicFileStore, filePath, text, true, guard);
      }
      for (const name of await this.readDirectoryNames(this.latestDirectory)) {
        if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
        const pointerPath = path.join(this.latestDirectory, name);
        const pointerText = await this.atomicFileStore.readText(pointerPath);
        if (pointerText === undefined) continue;
        try {
          const migration = parseMigratedRecord(pointerText, "Snapshot generation pointer");
          if (migration.value.snapshotId === snapshotId) {
            await lease.assertOwned();
            await quarantinePersistedText(this.atomicFileStore, pointerPath, pointerText, true, guard);
          }
        } catch (error) {
          if (error instanceof UnsupportedPersistedSchemaVersionError) throw error;
          // Unrelated malformed pointers are handled by their own get/startup migration boundary.
        }
      }
    });
  }

  public async entries(): Promise<readonly (readonly [string, NonGitSnapshotStoredValue])[]> {
    const names = await this.readDirectoryNames(this.snapshotsDirectory);
    const values = await Promise.all(names.filter((name) => /^[0-9a-f]{64}\.json$/u.test(name)).map(async (name) => {
      const id = name.slice(0, -5); const value = await this.get(id); return value === undefined ? undefined : [id, value] as const;
    }));
    return values.filter((value): value is readonly [string, NonGitSnapshotStoredValue] => value !== undefined);
  }

  public async getLatest(workspaceContextId: string, fileId: string): Promise<string | undefined> {
    const filePath = this.latestPath(workspaceContextId, fileId);
    return this.readLatestPointer(filePath);
  }

  public async setLatest(workspaceContextId: string, fileId: string, snapshotId: string | undefined): Promise<void> {
    const pointerPath = this.latestPath(workspaceContextId, fileId);
    await withStorageRootLock({ rootPath: this.rootPath, notifyDiagnostic: this.notifyStorageLockDiagnostic }, async (lease) => {
      if (snapshotId === undefined) {
        await this.guard(pointerPath);
        await lease.assertOwned();
        await this.deletePersistedText(pointerPath);
      } else {
        await this.guard(pointerPath);
        await lease.assertOwned();
        await this.atomicFileStore.writeTextAtomically(pointerPath, JSON.stringify({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, snapshotId } satisfies PersistedLatest));
      }
      await this.cleanupUnreferencedSnapshots(Date.now(), undefined, undefined, lease);
    });
  }

  /** Removes only unreferenced old or surplus immutable snapshots; current generation pointers are always retained. */
  public async cleanup(now = Date.now()): Promise<void> {
    await withStorageRootLock({ rootPath: this.rootPath, notifyDiagnostic: this.notifyStorageLockDiagnostic }, (lease) => this.cleanupUnreferencedSnapshots(now, undefined, undefined, lease));
  }

  /** Eagerly migrates every persisted wrapper under this snapshot root, including hashed latest pointers. */
  public async migratePersistedMetadata(): Promise<void> {
    for (const name of await this.readDirectoryNames(this.snapshotsDirectory)) {
      if (/^[0-9a-f]{64}\.json$/u.test(name)) {
        await this.get(name.slice(0, -5));
      }
    }
    for (const name of await this.readDirectoryNames(this.latestDirectory)) {
      if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
      await this.readLatestPointer(path.join(this.latestDirectory, name));
    }
  }

  private async readLatestPointer(filePath: string): Promise<string | undefined> {
    const text = await this.atomicFileStore.readText(filePath);
    if (text === undefined) return undefined;

    try {
      const migration = parseMigratedRecord(text, "Snapshot generation pointer");
      const snapshotId = migration.value.snapshotId;
      if (typeof snapshotId !== "string" || !/^[0-9a-f]{64}$/u.test(snapshotId)) {
        throw new Error("Invalid snapshot generation pointer");
      }
      if (migration.migrated) {
        const guard = createTrustedPersistencePathGuard(this.rootPath, this.atomicFileStore);
        await publishSchemaMigration(this.atomicFileStore, [{
          filePath,
          original: text,
          migrated: JSON.stringify(migration.value)
        }], guard);
      }
      return snapshotId;
    } catch (error) {
      if (error instanceof UnsupportedPersistedSchemaVersionError) throw error;
      await quarantinePersistedText(this.atomicFileStore, filePath, text, true, createTrustedPersistencePathGuard(this.rootPath, this.atomicFileStore));
      return undefined;
    }
  }

  private async deletePersistedText(filePath: string): Promise<void> {
    if (this.atomicFileStore.deleteText === undefined) {
      throw new Error("AtomicTextFileStore.deleteText is required to remove snapshot persistence.");
    }
    await this.guard(filePath);
    await this.atomicFileStore.deleteText(filePath);
  }

  /** Validates every Node mutation target below the durable snapshot root. */
  private async guard(filePath: string): Promise<void> {
    await createTrustedPersistencePathGuard(this.rootPath, this.atomicFileStore)(filePath);
  }

  private async cleanupUnreferencedSnapshots(
    now: number,
    protectedSnapshotId?: string,
    limits?: { readonly maxSnapshots: number; readonly maxTotalCompressedBytes: number; readonly retentionMs: number },
    lease?: { assertOwned(): Promise<void> }
  ): Promise<void> {
    if (this.atomicFileStore.deleteText === undefined) return;
    const guard = createTrustedPersistencePathGuard(this.rootPath, this.atomicFileStore);
    await guard(this.snapshotsDirectory);
    await guard(this.latestDirectory);
    const referenced = new Set<string>();
    for (const name of await this.readDirectoryNames(this.latestDirectory)) {
      if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
      const value = await this.readLatestPointer(path.join(this.latestDirectory, name));
      if (value !== undefined) referenced.add(value);
    }
    const candidates: Array<{ id: string; createdAt: number; bytes: number }> = [];
    for (const name of await this.readDirectoryNames(this.snapshotsDirectory)) {
      if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
      const raw = await this.atomicFileStore.readText(path.join(this.snapshotsDirectory, name));
      try {
        const value = raw === undefined ? undefined : JSON.parse(raw) as { createdAt?: unknown; bytes?: unknown };
        if (typeof value?.createdAt === "number" && Number.isSafeInteger(value.createdAt) && typeof value.bytes === "string") {
          candidates.push({ id: name.slice(0, -5), createdAt: value.createdAt, bytes: Buffer.from(value.bytes, "base64").byteLength });
        }
      } catch {
        // Corrupt records remain for the established quarantine-on-read boundary.
      }
    }
    candidates.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
    let retained = 0;
    let totalBytes = candidates.reduce((total, candidate) => total + candidate.bytes, 0);
    for (const candidate of candidates) {
      if (referenced.has(candidate.id) || candidate.id === protectedSnapshotId) {
        retained++;
        continue;
      }
      const expired = now - candidate.createdAt > (limits?.retentionMs ?? this.retentionMs);
      const overCount = retained >= (limits?.maxSnapshots ?? this.maxEntries);
      if (expired || overCount || (limits !== undefined && totalBytes > limits.maxTotalCompressedBytes)) {
        const filePath = this.snapshotPath(candidate.id);
        await guard(filePath);
        await lease?.assertOwned();
        // Re-read every pointer immediately before deletion. A concurrent publisher
        // cannot turn an active generation into a deletion candidate after planning.
        let becameActive = false;
        for (const name of await this.readDirectoryNames(this.latestDirectory)) {
          if (/^[0-9a-f]{64}\.json$/u.test(name) && await this.readLatestPointer(path.join(this.latestDirectory, name)) === candidate.id) {
            becameActive = true;
            break;
          }
        }
        if (becameActive) continue;
        await this.atomicFileStore.deleteText(filePath);
        totalBytes -= candidate.bytes;
      } else {
        retained++;
      }
    }
  }

  private async readDirectoryNames(directory: string): Promise<string[]> {
    try {
      return await readdir(directory);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  private snapshotPath(snapshotId: string): string { return path.join(this.snapshotsDirectory, `${assertSnapshotId(snapshotId)}.json`); }
  private latestPath(workspaceContextId: string, fileId: string): string {
    const key = `${workspaceContextId}\0${fileId}`;
    return path.join(this.latestDirectory, `${createHash("sha256").update(key, "utf8").digest("hex")}.json`);
  }
}

const assertSnapshotId = (value: string): string => { if (!/^[0-9a-f]{64}$/u.test(value)) throw new TypeError("snapshotId must be SHA-256 hex"); return value; };
const isNotFound = (error: unknown): boolean => error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

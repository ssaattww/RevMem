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

  public constructor(options: { readonly snapshotDirectory: string; readonly atomicFileStore?: AtomicTextFileStore; readonly maxEntries?: number; readonly retentionMs?: number }) {
    const snapshotDirectory = path.resolve(options.snapshotDirectory);
    this.rootPath = path.dirname(snapshotDirectory);
    this.snapshotsDirectory = path.join(snapshotDirectory, "entries");
    this.latestDirectory = path.join(snapshotDirectory, "latest");
    this.atomicFileStore = options.atomicFileStore ?? new NodeAtomicTextFileStore();
    this.maxEntries = options.maxEntries ?? 128;
    this.retentionMs = options.retentionMs ?? 30 * 24 * 60 * 60 * 1_000;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1 || !Number.isSafeInteger(this.retentionMs) || this.retentionMs < 0) {
      throw new RangeError("Snapshot cleanup bounds must be safe non-negative integers.");
    }
  }
  private readonly atomicFileStore: AtomicTextFileStore;

  public async put(snapshotId: string, bytes: Uint8Array, createdAt: number): Promise<void> {
    await withStorageRootLock({ rootPath: this.rootPath }, () =>
      this.atomicFileStore.writeTextAtomically(this.snapshotPath(snapshotId), JSON.stringify({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, createdAt, bytes: Buffer.from(bytes).toString("base64") } satisfies PersistedSnapshot)));
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
        await publishSchemaMigration(this.atomicFileStore, [{
          filePath,
          original: text,
          migrated: JSON.stringify(migration.value)
        }]);
      }
      return { createdAt, bytes: decoded };
    } catch (error) {
      if (error instanceof UnsupportedPersistedSchemaVersionError) throw error;
      await this.quarantine(snapshotId);
      return undefined;
    }
  }

  public async delete(snapshotId: string): Promise<void> {
    await withStorageRootLock({ rootPath: this.rootPath }, () => this.deletePersistedText(this.snapshotPath(snapshotId)));
  }

  /** Quarantines one corrupt snapshot wrapper and every valid latest pointer that names it. */
  public async quarantine(snapshotId: string): Promise<void> {
    const filePath = this.snapshotPath(snapshotId);
    const text = await this.atomicFileStore.readText(filePath);
    if (text !== undefined) {
      await quarantinePersistedText(this.atomicFileStore, filePath, text);
    }
    for (const name of await this.readDirectoryNames(this.latestDirectory)) {
      if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
      const pointerPath = path.join(this.latestDirectory, name);
      const pointerText = await this.atomicFileStore.readText(pointerPath);
      if (pointerText === undefined) continue;
      try {
        const migration = parseMigratedRecord(pointerText, "Snapshot generation pointer");
        if (migration.value.snapshotId === snapshotId) {
          await quarantinePersistedText(this.atomicFileStore, pointerPath, pointerText);
        }
      } catch (error) {
        if (error instanceof UnsupportedPersistedSchemaVersionError) throw error;
        // Unrelated malformed pointers are handled by their own get/startup migration boundary.
      }
    }
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
    await withStorageRootLock({ rootPath: this.rootPath }, async () => {
      if (snapshotId === undefined) {
        await this.deletePersistedText(pointerPath);
      } else {
        await this.atomicFileStore.writeTextAtomically(pointerPath, JSON.stringify({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, snapshotId } satisfies PersistedLatest));
      }
      await this.cleanupUnreferencedSnapshots(Date.now());
    });
  }

  /** Removes only unreferenced old or surplus immutable snapshots; current generation pointers are always retained. */
  public async cleanup(now = Date.now()): Promise<void> {
    await withStorageRootLock({ rootPath: this.rootPath }, () => this.cleanupUnreferencedSnapshots(now));
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
        await publishSchemaMigration(this.atomicFileStore, [{
          filePath,
          original: text,
          migrated: JSON.stringify(migration.value)
        }]);
      }
      return snapshotId;
    } catch (error) {
      if (error instanceof UnsupportedPersistedSchemaVersionError) throw error;
      await quarantinePersistedText(this.atomicFileStore, filePath, text);
      return undefined;
    }
  }

  private async deletePersistedText(filePath: string): Promise<void> {
    if (this.atomicFileStore.deleteText === undefined) {
      throw new Error("AtomicTextFileStore.deleteText is required to remove snapshot persistence.");
    }
    await this.atomicFileStore.deleteText(filePath);
  }

  private async cleanupUnreferencedSnapshots(now: number): Promise<void> {
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
    const candidates: Array<{ id: string; createdAt: number }> = [];
    for (const name of await this.readDirectoryNames(this.snapshotsDirectory)) {
      if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
      const raw = await this.atomicFileStore.readText(path.join(this.snapshotsDirectory, name));
      try {
        const value = raw === undefined ? undefined : JSON.parse(raw) as { createdAt?: unknown };
        if (typeof value?.createdAt === "number" && Number.isSafeInteger(value.createdAt)) candidates.push({ id: name.slice(0, -5), createdAt: value.createdAt });
      } catch {
        // Corrupt records remain for the established quarantine-on-read boundary.
      }
    }
    candidates.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
    let retained = 0;
    for (const candidate of candidates) {
      if (referenced.has(candidate.id)) {
        retained++;
        continue;
      }
      const expired = now - candidate.createdAt > this.retentionMs;
      if (expired || retained >= this.maxEntries) {
        const filePath = this.snapshotPath(candidate.id);
        await guard(filePath);
        await this.atomicFileStore.deleteText(filePath);
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

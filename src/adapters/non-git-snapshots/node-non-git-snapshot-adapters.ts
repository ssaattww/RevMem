import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import type {
  NonGitSnapshotCodec,
  NonGitSnapshotStorage,
  NonGitSnapshotStoredValue,
} from "../../application/non-git-snapshots/index";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../core/contracts/index";
import { NodeAtomicTextFileStore } from "../state-repository/index";
import type { AtomicTextFileStore } from "../state-repository/index";
import {
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
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION
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

  public constructor(options: { readonly snapshotDirectory: string; readonly atomicFileStore?: AtomicTextFileStore }) {
    this.snapshotsDirectory = path.join(options.snapshotDirectory, "entries");
    this.latestDirectory = path.join(options.snapshotDirectory, "latest");
    this.atomicFileStore = options.atomicFileStore ?? new NodeAtomicTextFileStore();
  }
  private readonly atomicFileStore: AtomicTextFileStore;

  public async put(snapshotId: string, bytes: Uint8Array, createdAt: number): Promise<void> {
    await this.atomicFileStore.writeTextAtomically(this.snapshotPath(snapshotId), JSON.stringify({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, createdAt, bytes: Buffer.from(bytes).toString("base64") } satisfies PersistedSnapshot));
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
    } catch (error) {
      if (error instanceof UnsupportedPersistedSchemaVersionError) throw error;
      await quarantinePersistedText(this.atomicFileStore, filePath, text);
      return undefined;
    }

    if (migration.migrated) {
      await publishSchemaMigration(this.atomicFileStore, [{
        filePath,
        original: text,
        migrated: JSON.stringify(migration.value)
      }]);
    }
    return { createdAt, bytes: Uint8Array.from(Buffer.from(bytes, "base64")) };
  }
  public async delete(snapshotId: string): Promise<void> { await rm(this.snapshotPath(snapshotId), { force: true }); }
  public async entries(): Promise<readonly (readonly [string, NonGitSnapshotStoredValue])[]> {
    try {
      const names = await readdir(this.snapshotsDirectory);
      const values = await Promise.all(names.filter((name) => /^[0-9a-f]{64}\.json$/u.test(name)).map(async (name) => {
        const id = name.slice(0, -5); const value = await this.get(id); return value === undefined ? undefined : [id, value] as const;
      }));
      return values.filter((value): value is readonly [string, NonGitSnapshotStoredValue] => value !== undefined);
    } catch (error) { if (isNotFound(error)) return []; throw error; }
  }
  public async getLatest(workspaceContextId: string, fileId: string): Promise<string | undefined> {
    const filePath = this.latestPath(workspaceContextId, fileId);
    const text = await this.atomicFileStore.readText(filePath);
    if (text === undefined) return undefined;

    let migration: ReturnType<typeof runSchemaMigrationChain>;
    let snapshotId: unknown;
    try {
      migration = parseMigratedRecord(text, "Snapshot generation pointer");
      snapshotId = migration.value.snapshotId;
      if (typeof snapshotId !== "string" || !/^[0-9a-f]{64}$/u.test(snapshotId)) {
        throw new Error("Invalid snapshot generation pointer");
      }
    } catch (error) {
      if (error instanceof UnsupportedPersistedSchemaVersionError) throw error;
      await quarantinePersistedText(this.atomicFileStore, filePath, text);
      return undefined;
    }

    if (migration.migrated) {
      await publishSchemaMigration(this.atomicFileStore, [{
        filePath,
        original: text,
        migrated: JSON.stringify(migration.value)
      }]);
    }
    return snapshotId;
  }
  public async setLatest(workspaceContextId: string, fileId: string, snapshotId: string | undefined): Promise<void> {
    const pointerPath = this.latestPath(workspaceContextId, fileId);
    if (snapshotId === undefined) { await rm(pointerPath, { force: true }); return; }
    await this.atomicFileStore.writeTextAtomically(pointerPath, JSON.stringify({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, snapshotId } satisfies PersistedLatest));
  }
  private snapshotPath(snapshotId: string): string { return path.join(this.snapshotsDirectory, `${assertSnapshotId(snapshotId)}.json`); }
  private latestPath(workspaceContextId: string, fileId: string): string {
    const key = `${workspaceContextId}\0${fileId}`;
    return path.join(this.latestDirectory, `${createHash("sha256").update(key, "utf8").digest("hex")}.json`);
  }
}

const assertSnapshotId = (value: string): string => { if (!/^[0-9a-f]{64}$/u.test(value)) throw new TypeError("snapshotId must be SHA-256 hex"); return value; };
const isNotFound = (error: unknown): boolean => error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

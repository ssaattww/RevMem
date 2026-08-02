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
import { NodeAtomicTextFileStore } from "../state-repository/index";
import type { AtomicTextFileStore } from "../state-repository/index";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

interface PersistedSnapshot { readonly createdAt: number; readonly bytes: string; }
interface PersistedLatest { readonly snapshotId: string; }

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
    await this.atomicFileStore.writeTextAtomically(this.snapshotPath(snapshotId), JSON.stringify({ createdAt, bytes: Buffer.from(bytes).toString("base64") } satisfies PersistedSnapshot));
  }
  public async get(snapshotId: string): Promise<NonGitSnapshotStoredValue | undefined> {
    const text = await this.atomicFileStore.readText(this.snapshotPath(snapshotId));
    if (text === undefined) return undefined;
    const value = JSON.parse(text) as Partial<PersistedSnapshot>;
    const createdAt = value.createdAt;
    const bytes = value.bytes;
    if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0 || typeof bytes !== "string") throw new Error("Invalid persisted snapshot");
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
    const text = await this.atomicFileStore.readText(this.latestPath(workspaceContextId, fileId));
    if (text === undefined) return undefined;
    const value = JSON.parse(text) as Partial<PersistedLatest>;
    if (typeof value.snapshotId !== "string" || !/^[0-9a-f]{64}$/u.test(value.snapshotId)) throw new Error("Invalid snapshot generation pointer");
    return value.snapshotId;
  }
  public async setLatest(workspaceContextId: string, fileId: string, snapshotId: string | undefined): Promise<void> {
    const pointerPath = this.latestPath(workspaceContextId, fileId);
    if (snapshotId === undefined) { await rm(pointerPath, { force: true }); return; }
    await this.atomicFileStore.writeTextAtomically(pointerPath, JSON.stringify({ snapshotId } satisfies PersistedLatest));
  }
  private snapshotPath(snapshotId: string): string { return path.join(this.snapshotsDirectory, `${assertSnapshotId(snapshotId)}.json`); }
  private latestPath(workspaceContextId: string, fileId: string): string {
    const key = `${workspaceContextId}\0${fileId}`;
    return path.join(this.latestDirectory, `${createHash("sha256").update(key, "utf8").digest("hex")}.json`);
  }
}

const assertSnapshotId = (value: string): string => { if (!/^[0-9a-f]{64}$/u.test(value)) throw new TypeError("snapshotId must be SHA-256 hex"); return value; };
const isNotFound = (error: unknown): boolean => error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

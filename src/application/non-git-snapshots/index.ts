import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import type { LineInterval } from "../../core/line-intervals/index";
import { normalizeLineIntervals } from "../../core/line-intervals/index";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface NonGitTrackedFileState {
  readonly workspaceContextId: string;
  readonly fileId: string;
  readonly content: string;
  readonly reviewedRanges: readonly LineInterval[];
}

export interface NonGitSnapshotLimits {
  readonly maxSnapshots: number;
  readonly maxCompressedBytes: number;
  readonly retentionMs: number;
}

export interface SavedNonGitSnapshot {
  readonly snapshotId: string;
  readonly compressedBytes: number;
}

export type NonGitSnapshotMappingResult =
  | { readonly status: "mapped"; readonly reviewedRanges: readonly LineInterval[] }
  | { readonly status: "missing" | "corrupt" | "expired" | "ambiguous"; readonly reviewedRanges: readonly [] };

interface SnapshotEnvelope extends NonGitTrackedFileState {
  readonly schemaVersion: 1;
  readonly createdAt: number;
}

interface StoredSnapshot {
  readonly bytes: Buffer;
  readonly createdAt: number;
}

export interface NonGitSnapshotStorage {
  put(snapshotId: string, bytes: Buffer, createdAt: number): void;
  get(snapshotId: string): StoredSnapshot | undefined;
  delete(snapshotId: string): void;
  entries(): readonly (readonly [string, StoredSnapshot])[];
}

export class InMemoryNonGitSnapshotStorage implements NonGitSnapshotStorage {
  private readonly snapshots = new Map<string, StoredSnapshot>();

  public put(snapshotId: string, bytes: Buffer, createdAt: number): void {
    this.snapshots.set(snapshotId, { bytes: Buffer.from(bytes), createdAt });
  }

  public get(snapshotId: string): StoredSnapshot | undefined {
    const value = this.snapshots.get(snapshotId);
    return value === undefined ? undefined : { bytes: Buffer.from(value.bytes), createdAt: value.createdAt };
  }

  public delete(snapshotId: string): void {
    this.snapshots.delete(snapshotId);
  }

  public entries(): readonly (readonly [string, StoredSnapshot])[] {
    return [...this.snapshots.keys()].map((id) => [id, this.get(id)!] as const);
  }

  public inspect(snapshotId: string): Buffer | undefined {
    return this.get(snapshotId)?.bytes;
  }

  public overwrite(snapshotId: string, bytes: Buffer): void {
    const current = this.snapshots.get(snapshotId);
    if (current === undefined) {
      throw new Error(`Unknown snapshot: ${snapshotId}`);
    }
    this.snapshots.set(snapshotId, { bytes: Buffer.from(bytes), createdAt: current.createdAt });
  }

  public has(snapshotId: string): boolean {
    return this.snapshots.has(snapshotId);
  }

  public count(): number {
    return this.snapshots.size;
  }

  public totalBytes(): number {
    return [...this.snapshots.values()].reduce((total, value) => total + value.bytes.byteLength, 0);
  }
}

export class NonGitSnapshotTracker {
  public constructor(
    private readonly storage: NonGitSnapshotStorage,
    private readonly limits: NonGitSnapshotLimits,
  ) {
    assertPositiveInteger(limits.maxSnapshots, "maxSnapshots");
    assertPositiveInteger(limits.maxCompressedBytes, "maxCompressedBytes");
    assertPositiveInteger(limits.retentionMs, "retentionMs");
  }

  public async save(state: NonGitTrackedFileState, now: number): Promise<SavedNonGitSnapshot> {
    assertTimestamp(now);
    const envelope: SnapshotEnvelope = {
      schemaVersion: 1,
      createdAt: now,
      workspaceContextId: requireNonEmpty(state.workspaceContextId, "workspaceContextId"),
      fileId: requireNonEmpty(state.fileId, "fileId"),
      content: state.content,
      reviewedRanges: normalizeLineIntervals(state.reviewedRanges),
    };
    const payload = Buffer.from(JSON.stringify(envelope), "utf8");
    const snapshotId = createHash("sha256").update(payload).digest("hex");
    const compressed = await gzipAsync(payload, { level: 9 });
    if (compressed.byteLength > this.limits.maxCompressedBytes) {
      throw new Error("Snapshot exceeds maxCompressedBytes");
    }
    this.storage.put(snapshotId, compressed, now);
    this.cleanup(now);
    return { snapshotId, compressedBytes: compressed.byteLength };
  }

  public async restore(snapshotId: string, now: number): Promise<NonGitTrackedFileState | undefined> {
    const restored = await this.read(snapshotId, now);
    return restored.status === "ok" ? restored.state : undefined;
  }

  public async map(snapshotId: string, currentContent: string, now: number): Promise<NonGitSnapshotMappingResult> {
    const restored = await this.read(snapshotId, now);
    if (restored.status !== "ok") {
      return { status: restored.status, reviewedRanges: [] };
    }

    const oldLines = splitLines(restored.state.content);
    const newLines = splitLines(currentContent);
    if (hasChangedDuplicateMultiplicity(oldLines, newLines)) {
      return { status: "ambiguous", reviewedRanges: [] };
    }
    const mapping = uniqueLcsMapping(oldLines, newLines);
    if (mapping === undefined) {
      return { status: "ambiguous", reviewedRanges: [] };
    }

    const reviewedOldLines = new Set<number>();
    for (const range of normalizeLineIntervals(restored.state.reviewedRanges)) {
      for (let line = range.startLine; line < range.endLineExclusive; line += 1) {
        reviewedOldLines.add(line);
      }
    }
    const reviewedNewLines = [...mapping.entries()]
      .filter(([oldLine]) => reviewedOldLines.has(oldLine))
      .map(([, newLine]) => newLine)
      .sort((left, right) => left - right);
    return { status: "mapped", reviewedRanges: linesToIntervals(reviewedNewLines) };
  }

  private async read(snapshotId: string, now: number): Promise<
    | { readonly status: "ok"; readonly state: NonGitTrackedFileState }
    | { readonly status: "missing" | "corrupt" | "expired" }
  > {
    assertTimestamp(now);
    const stored = this.storage.get(snapshotId);
    if (stored === undefined) {
      return { status: "missing" };
    }
    if (now - stored.createdAt > this.limits.retentionMs) {
      this.storage.delete(snapshotId);
      return { status: "expired" };
    }
    try {
      const payload = await gunzipAsync(stored.bytes);
      if (createHash("sha256").update(payload).digest("hex") !== snapshotId) {
        return { status: "corrupt" };
      }
      const value = JSON.parse(payload.toString("utf8")) as Partial<SnapshotEnvelope>;
      if (!isSnapshotEnvelope(value, stored.createdAt)) {
        return { status: "corrupt" };
      }
      return {
        status: "ok",
        state: {
          workspaceContextId: value.workspaceContextId,
          fileId: value.fileId,
          content: value.content,
          reviewedRanges: normalizeLineIntervals(value.reviewedRanges),
        },
      };
    } catch {
      return { status: "corrupt" };
    }
  }

  private cleanup(now: number): void {
    const ordered = (): (readonly [string, StoredSnapshot])[] =>
      [...this.storage.entries()].sort(
        ([leftId, left], [rightId, right]) => left.createdAt - right.createdAt || leftId.localeCompare(rightId),
      );
    for (const [id, value] of ordered()) {
      if (now - value.createdAt > this.limits.retentionMs) {
        this.storage.delete(id);
      }
    }
    const remaining = ordered();
    let totalBytes = remaining.reduce((total, [, value]) => total + value.bytes.byteLength, 0);
    while (remaining.length > this.limits.maxSnapshots || totalBytes > this.limits.maxCompressedBytes) {
      const oldest = remaining.shift();
      if (oldest === undefined) {
        break;
      }
      this.storage.delete(oldest[0]);
      totalBytes -= oldest[1].bytes.byteLength;
    }
  }
}

function isSnapshotEnvelope(value: Partial<SnapshotEnvelope>, createdAt: number): value is SnapshotEnvelope {
  return (
    value.schemaVersion === 1 &&
    value.createdAt === createdAt &&
    typeof value.workspaceContextId === "string" &&
    value.workspaceContextId.length > 0 &&
    typeof value.fileId === "string" &&
    value.fileId.length > 0 &&
    typeof value.content === "string" &&
    Array.isArray(value.reviewedRanges)
  );
}

function hasChangedDuplicateMultiplicity(oldLines: readonly string[], newLines: readonly string[]): boolean {
  const oldCounts = countLines(oldLines);
  const newCounts = countLines(newLines);
  for (const line of new Set([...oldCounts.keys(), ...newCounts.keys()])) {
    const oldCount = oldCounts.get(line) ?? 0;
    const newCount = newCounts.get(line) ?? 0;
    if ((oldCount > 1 || newCount > 1) && oldCount !== newCount) {
      return true;
    }
  }
  return false;
}

function countLines(lines: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

function uniqueLcsMapping(oldLines: readonly string[], newLines: readonly string[]): ReadonlyMap<number, number> | undefined {
  const lengths = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  const counts = Array.from({ length: oldLines.length + 1 }, () => new Uint8Array(newLines.length + 1));
  for (let oldIndex = oldLines.length; oldIndex >= 0; oldIndex -= 1) {
    counts[oldIndex]![newLines.length] = 1;
  }
  for (let newIndex = newLines.length; newIndex >= 0; newIndex -= 1) {
    counts[oldLines.length]![newIndex] = 1;
  }
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        lengths[oldIndex]![newIndex] = 1 + lengths[oldIndex + 1]![newIndex + 1]!;
        counts[oldIndex]![newIndex] = counts[oldIndex + 1]![newIndex + 1]!;
      } else {
        const skipOld = lengths[oldIndex + 1]![newIndex]!;
        const skipNew = lengths[oldIndex]![newIndex + 1]!;
        lengths[oldIndex]![newIndex] = Math.max(skipOld, skipNew);
        counts[oldIndex]![newIndex] =
          skipOld === skipNew
            ? Math.min(2, counts[oldIndex + 1]![newIndex]! + counts[oldIndex]![newIndex + 1]!)
            : skipOld > skipNew
              ? counts[oldIndex + 1]![newIndex]!
              : counts[oldIndex]![newIndex + 1]!;
      }
    }
  }
  if (counts[0]![0] !== 1) {
    return undefined;
  }
  const mapping = new Map<number, number>();
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      mapping.set(oldIndex, newIndex);
      oldIndex += 1;
      newIndex += 1;
    } else if (lengths[oldIndex + 1]![newIndex]! > lengths[oldIndex]![newIndex + 1]!) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  return mapping;
}

function splitLines(content: string): readonly string[] {
  return content.split(/\r\n|\n|\r/u);
}

function linesToIntervals(lines: readonly number[]): readonly LineInterval[] {
  if (lines.length === 0) {
    return [];
  }
  const intervals: LineInterval[] = [];
  let start = lines[0]!;
  let previous = start;
  for (const line of lines.slice(1)) {
    if (line === previous + 1) {
      previous = line;
      continue;
    }
    intervals.push({ startLine: start, endLineExclusive: previous + 1 });
    start = line;
    previous = line;
  }
  intervals.push({ startLine: start, endLineExclusive: previous + 1 });
  return intervals;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("now must be a non-negative safe integer");
  }
}

function requireNonEmpty(value: string, name: string): string {
  if (value.length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return value;
}

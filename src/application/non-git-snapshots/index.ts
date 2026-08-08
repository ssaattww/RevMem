import type { LineInterval } from "../../core/line-intervals/index";
import { normalizeLineIntervals } from "../../core/line-intervals/index";

export interface NonGitTrackedFileState {
  readonly workspaceContextId: string;
  readonly fileId: string;
  readonly content: string;
  readonly reviewedRanges: readonly LineInterval[];
}

interface NonGitSnapshotLimitBase {
  readonly maxSnapshots: number;
  readonly retentionMs: number;
}

export type LegacyNonGitSnapshotLimits = NonGitSnapshotLimitBase & {
  /** @deprecated Use separate per-snapshot and aggregate limits. */
  readonly maxCompressedBytes: number;
  readonly maxSnapshotCompressedBytes?: never;
  readonly maxTotalCompressedBytes?: never;
};

export type SplitNonGitSnapshotLimits = NonGitSnapshotLimitBase & {
  readonly maxCompressedBytes?: never;
  readonly maxSnapshotCompressedBytes: number;
  readonly maxTotalCompressedBytes: number;
};

export type NonGitSnapshotLimits =
  | LegacyNonGitSnapshotLimits
  | SplitNonGitSnapshotLimits;

export interface SavedNonGitSnapshot {
  readonly snapshotId: string;
  readonly compressedBytes: number;
}

export type NonGitSnapshotMappingResult =
  | { readonly status: "mapped"; readonly reviewedRanges: readonly LineInterval[] }
  | { readonly status: "missing" | "corrupt" | "expired" | "ambiguous"; readonly reviewedRanges: readonly [] };

/** Runtime-neutral binary codec port owned by the adapter layer. */
export interface NonGitSnapshotCodec {
  compress(plainText: string): Promise<Uint8Array>;
  decompress(bytes: Uint8Array): Promise<string>;
  sha256(plainText: string): string;
}

export interface NonGitSnapshotStoredValue {
  readonly bytes: Uint8Array;
  readonly createdAt: number;
}

/** Durable storage and authoritative latest-generation pointer port. */
export interface NonGitSnapshotStorage {
  put(snapshotId: string, bytes: Uint8Array, createdAt: number): Promise<void>;
  get(snapshotId: string): Promise<NonGitSnapshotStoredValue | undefined>;
  delete(snapshotId: string): Promise<void>;
  entries(): Promise<readonly (readonly [string, NonGitSnapshotStoredValue])[]>;
  getLatest(workspaceContextId: string, fileId: string): Promise<string | undefined>;
  setLatest(workspaceContextId: string, fileId: string, snapshotId: string | undefined): Promise<void>;
}

/** Deterministic in-memory port used by application tests. */
export class InMemoryNonGitSnapshotStorage implements NonGitSnapshotStorage {
  private readonly snapshots = new Map<string, NonGitSnapshotStoredValue>();
  private readonly latest = new Map<string, string>();

  public async put(snapshotId: string, bytes: Uint8Array, createdAt: number): Promise<void> {
    this.snapshots.set(snapshotId, { bytes: Uint8Array.from(bytes), createdAt });
  }

  public async get(snapshotId: string): Promise<NonGitSnapshotStoredValue | undefined> {
    const value = this.snapshots.get(snapshotId);
    return value === undefined ? undefined : { bytes: Uint8Array.from(value.bytes), createdAt: value.createdAt };
  }

  public async delete(snapshotId: string): Promise<void> {
    this.snapshots.delete(snapshotId);
  }

  public async entries(): Promise<readonly (readonly [string, NonGitSnapshotStoredValue])[]> {
    return [...this.snapshots.entries()].map(([id, value]) => [id, { bytes: Uint8Array.from(value.bytes), createdAt: value.createdAt }] as const);
  }

  public async getLatest(workspaceContextId: string, fileId: string): Promise<string | undefined> {
    return this.latest.get(snapshotKey(workspaceContextId, fileId));
  }

  public async setLatest(workspaceContextId: string, fileId: string, snapshotId: string | undefined): Promise<void> {
    const key = snapshotKey(workspaceContextId, fileId);
    if (snapshotId === undefined) {
      this.latest.delete(key);
      return;
    }
    this.latest.set(key, snapshotId);
  }

  public async inspect(snapshotId: string): Promise<Uint8Array | undefined> {
    return (await this.get(snapshotId))?.bytes;
  }

  public async overwrite(snapshotId: string, bytes: Uint8Array): Promise<void> {
    const current = this.snapshots.get(snapshotId);
    if (current === undefined) {
      throw new Error(`Unknown snapshot: ${snapshotId}`);
    }
    this.snapshots.set(snapshotId, { bytes: Uint8Array.from(bytes), createdAt: current.createdAt });
  }

  public async has(snapshotId: string): Promise<boolean> { return this.snapshots.has(snapshotId); }
  public async count(): Promise<number> { return this.snapshots.size; }
  public async totalBytes(): Promise<number> {
    return [...this.snapshots.values()].reduce((total, value) => total + value.bytes.byteLength, 0);
  }
}

interface SnapshotEnvelope extends NonGitTrackedFileState {
  readonly schemaVersion: 1;
  readonly createdAt: number;
}

export class NonGitSnapshotTracker {
  private readonly maxSnapshotCompressedBytes: number;
  private readonly maxTotalCompressedBytes: number;

  public constructor(
    private readonly storage: NonGitSnapshotStorage,
    private readonly codec: NonGitSnapshotCodec,
    private readonly limits: NonGitSnapshotLimits,
  ) {
    assertPositiveInteger(limits.maxSnapshots, "maxSnapshots");
    this.maxSnapshotCompressedBytes = requireLimit(
      limits.maxSnapshotCompressedBytes ?? limits.maxCompressedBytes,
      "maxSnapshotCompressedBytes"
    );
    this.maxTotalCompressedBytes = requireLimit(
      limits.maxTotalCompressedBytes ?? limits.maxCompressedBytes,
      "maxTotalCompressedBytes"
    );
    if (this.maxTotalCompressedBytes < this.maxSnapshotCompressedBytes) {
      throw new RangeError(
        "maxTotalCompressedBytes must be greater than or equal to maxSnapshotCompressedBytes"
      );
    }
    assertPositiveInteger(limits.retentionMs, "retentionMs");
  }

  public async save(state: NonGitTrackedFileState, now: number): Promise<SavedNonGitSnapshot> {
    assertTimestamp(now);
    const envelope: SnapshotEnvelope = {
      schemaVersion: 1, createdAt: now,
      workspaceContextId: requireNonEmpty(state.workspaceContextId, "workspaceContextId"),
      fileId: requireNonEmpty(state.fileId, "fileId"), content: state.content,
      reviewedRanges: normalizeLineIntervals(state.reviewedRanges),
    };
    const payload = JSON.stringify(envelope);
    const snapshotId = this.codec.sha256(payload);
    const compressed = await this.codec.compress(payload);
    if (compressed.byteLength > this.maxSnapshotCompressedBytes) {
      throw new Error("Snapshot exceeds maxSnapshotCompressedBytes");
    }
    await this.storage.put(snapshotId, compressed, now);
    await this.cleanup(now, snapshotId);
    if (await this.storage.get(snapshotId) === undefined) {
      throw new Error("Saved snapshot was removed during cleanup");
    }
    return { snapshotId, compressedBytes: compressed.byteLength };
  }

  /** Publishes a snapshot only after it has been fully stored and validated by the caller's commit ordering. */
  public async saveLatest(state: NonGitTrackedFileState, now: number): Promise<SavedNonGitSnapshot> {
    const saved = await this.save(state, now);
    await this.storage.setLatest(state.workspaceContextId, state.fileId, saved.snapshotId);
    return saved;
  }

  /** Makes prior review evidence ineligible before a state transition that may fail to snapshot. */
  public async invalidateLatest(workspaceContextId: string, fileId: string): Promise<void> {
    await this.storage.setLatest(workspaceContextId, fileId, undefined);
  }

  public async latestSnapshotId(workspaceContextId: string, fileId: string): Promise<string | undefined> {
    return this.storage.getLatest(workspaceContextId, fileId);
  }

  public async restore(snapshotId: string, now: number): Promise<NonGitTrackedFileState | undefined> {
    const restored = await this.read(snapshotId, now);
    return restored.status === "ok" ? restored.state : undefined;
  }

  public async map(snapshotId: string, currentContent: string, now: number): Promise<NonGitSnapshotMappingResult> {
    const restored = await this.read(snapshotId, now);
    if (restored.status !== "ok") return { status: restored.status, reviewedRanges: [] };
    const mapping = uniqueLcsMapping(splitDocumentEvidence(restored.state.content), splitDocumentEvidence(currentContent));
    if (mapping === undefined) return { status: "ambiguous", reviewedRanges: [] };
    const reviewedOldLines = new Set<number>();
    for (const range of normalizeLineIntervals(restored.state.reviewedRanges)) {
      for (let line = range.startLine; line < range.endLineExclusive; line += 1) reviewedOldLines.add(line);
    }
    return { status: "mapped", reviewedRanges: linesToIntervals([...mapping.entries()]
      .filter(([oldLine]) => reviewedOldLines.has(oldLine)).map(([, newLine]) => newLine).sort((left, right) => left - right)) };
  }

  private async read(snapshotId: string, now: number): Promise<
    | { readonly status: "ok"; readonly state: NonGitTrackedFileState }
    | { readonly status: "missing" | "corrupt" | "expired" }
  > {
    assertTimestamp(now);
    let stored: NonGitSnapshotStoredValue | undefined;
    try { stored = await this.storage.get(snapshotId); } catch { return { status: "corrupt" }; }
    if (stored === undefined) return { status: "missing" };
    if (now - stored.createdAt > this.limits.retentionMs) {
      await this.storage.delete(snapshotId).catch(() => undefined);
      return { status: "expired" };
    }
    try {
      const payload = await this.codec.decompress(stored.bytes);
      if (this.codec.sha256(payload) !== snapshotId) return { status: "corrupt" };
      const value = JSON.parse(payload) as Partial<SnapshotEnvelope>;
      if (!isSnapshotEnvelope(value, stored.createdAt)) return { status: "corrupt" };
      return { status: "ok", state: { workspaceContextId: value.workspaceContextId, fileId: value.fileId, content: value.content, reviewedRanges: normalizeLineIntervals(value.reviewedRanges) } };
    } catch { return { status: "corrupt" }; }
  }

  private async cleanup(now: number, protectedSnapshotId?: string): Promise<void> {
    const ordered = async (): Promise<Array<readonly [string, NonGitSnapshotStoredValue]>> =>
      [...await this.storage.entries()].sort(([leftId, left], [rightId, right]) => left.createdAt - right.createdAt || leftId.localeCompare(rightId));
    for (const [id, value] of await ordered()) {
      if (id !== protectedSnapshotId && now - value.createdAt > this.limits.retentionMs) {
        await this.storage.delete(id);
      }
    }
    const remaining = await ordered();
    let totalBytes = remaining.reduce((total, [, value]) => total + value.bytes.byteLength, 0);
    while (remaining.length > this.limits.maxSnapshots || totalBytes > this.maxTotalCompressedBytes) {
      const removableIndex = remaining.findIndex(([id]) => id !== protectedSnapshotId);
      if (removableIndex < 0) break;
      const [oldest] = remaining.splice(removableIndex, 1);
      await this.storage.delete(oldest[0]);
      totalBytes -= oldest[1].bytes.byteLength;
    }
  }
}

function isSnapshotEnvelope(value: Partial<SnapshotEnvelope>, createdAt: number): value is SnapshotEnvelope {
  return value.schemaVersion === 1 && value.createdAt === createdAt && typeof value.workspaceContextId === "string" && value.workspaceContextId.length > 0 && typeof value.fileId === "string" && value.fileId.length > 0 && typeof value.content === "string" && Array.isArray(value.reviewedRanges);
}

/** Keeps each physical line terminator and final-empty-line state in the LCS evidence. */
function splitDocumentEvidence(content: string): readonly string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    if (char !== "\r" && char !== "\n") continue;
    const terminator = char === "\r" && content[index + 1] === "\n" ? "\r\n" : char;
    lines.push(content.slice(start, index) + terminator);
    index += terminator.length - 1; start = index + 1;
  }
  if (start < content.length || content.length === 0) lines.push(content.slice(start));
  return lines;
}

function uniqueLcsMapping(oldLines: readonly string[], newLines: readonly string[]): ReadonlyMap<number, number> | undefined {
  const suffixLengths = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) suffixLengths[oldIndex]![newIndex] = oldLines[oldIndex] === newLines[newIndex] ? 1 + suffixLengths[oldIndex + 1]![newIndex + 1]! : Math.max(suffixLengths[oldIndex + 1]![newIndex]!, suffixLengths[oldIndex]![newIndex + 1]!);
  const prefixLengths = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let oldIndex = 0; oldIndex < oldLines.length; oldIndex += 1) for (let newIndex = 0; newIndex < newLines.length; newIndex += 1) prefixLengths[oldIndex + 1]![newIndex + 1] = oldLines[oldIndex] === newLines[newIndex] ? 1 + prefixLengths[oldIndex]![newIndex]! : Math.max(prefixLengths[oldIndex]![newIndex + 1]!, prefixLengths[oldIndex + 1]![newIndex]!);
  const longestLength = suffixLengths[0]![0]!;
  const candidates: Array<readonly [number, number]> = [];
  for (let oldIndex = 0; oldIndex < oldLines.length; oldIndex += 1) for (let newIndex = 0; newIndex < newLines.length; newIndex += 1) if (oldLines[oldIndex] === newLines[newIndex] && prefixLengths[oldIndex]![newIndex]! + 1 + suffixLengths[oldIndex + 1]![newIndex + 1]! === longestLength) candidates.push([oldIndex, newIndex]);
  if (candidates.length !== longestLength) return undefined;
  const mapping = new Map<number, number>(); let previousOld = -1; let previousNew = -1;
  for (const [oldIndex, newIndex] of candidates) { if (oldIndex <= previousOld || newIndex <= previousNew) return undefined; mapping.set(oldIndex, newIndex); previousOld = oldIndex; previousNew = newIndex; }
  return mapping;
}

function linesToIntervals(lines: readonly number[]): readonly LineInterval[] { if (lines.length === 0) return []; const intervals: LineInterval[] = []; let start = lines[0]!; let previous = start; for (const line of lines.slice(1)) { if (line === previous + 1) { previous = line; continue; } intervals.push({ startLine: start, endLineExclusive: previous + 1 }); start = line; previous = line; } intervals.push({ startLine: start, endLineExclusive: previous + 1 }); return intervals; }
function snapshotKey(workspaceContextId: string, fileId: string): string { return `${workspaceContextId}\0${fileId}`; }
function assertPositiveInteger(value: number, name: string): void { if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`); }
function requireLimit(value: number | undefined, name: string): number { if (value === undefined) throw new TypeError(`${name} must be configured`); assertPositiveInteger(value, name); return value; }
function assertTimestamp(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("now must be a non-negative safe integer"); }
function requireNonEmpty(value: string, name: string): string { if (value.length === 0) throw new TypeError(`${name} must not be empty`); return value; }

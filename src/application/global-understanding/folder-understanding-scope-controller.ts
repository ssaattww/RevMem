/** A persisted, repository-root isolated marker store for stopped folder scopes. */
export interface FolderUnderstandingStoppedStore {
  /** Reads explicit durable stop markers for one canonical repository owner. */
  loadStopped(repositoryId: string, canonicalRepositoryRoot: string): Promise<readonly string[]>;
  /** Replaces explicit durable stop markers for one canonical repository owner. */
  saveStopped(repositoryId: string, canonicalRepositoryRoot: string, paths: readonly string[]): Promise<void>;
  /** Atomically applies explicit-marker additions/removals when the storage adapter supports it. */
  mutateStopped?(repositoryId: string, canonicalRepositoryRoot: string, mutation: Readonly<{ add: readonly string[]; remove: readonly string[] }>): Promise<readonly string[]>;
}

/** Lifecycle state of one canonical folder scope; stopped is the only restart-durable state. */
export type FolderUnderstandingScopeState = "inactive" | "running" | "active" | "stopped" | "failed";

/** Direct-or-complete-descendant aggregate for one scope. */
export interface FolderUnderstandingTotal {
  /** Reviewed non-empty lines included in this aggregate. */
  readonly reviewed: number;
  /** Known non-empty-line denominator included in this aggregate. */
  readonly total: number;
  /** False when this scope or a descendant has incomplete, stopped, or failed evidence. */
  readonly complete: boolean;
}

/** Immutable, owner-isolated Tree projection row for a canonical folder path. */
export interface FolderUnderstandingScopeSnapshot {
  /** Canonical repository-relative folder path; empty is the repository root. */
  readonly path: string;
  /** Current lifecycle state, never inferred from another repository owner. */
  readonly state: FolderUnderstandingScopeState;
  /** Aggregate whose complete flag controls partial repository presentation. */
  readonly total: FolderUnderstandingTotal;
}

interface ScopeRecord {
  state: FolderUnderstandingScopeState;
  generation: number;
  total?: Omit<FolderUnderstandingTotal, "complete">;
  /** Only this marker survives restart; descendant stops can be inherited. */
  explicitStop?: boolean;
}

const keyOf = (repositoryId: string, repositoryRoot: string): string => `${repositoryId}\0${repositoryRoot}`;
const normalizeFolder = (value: string): string => {
  const normalized = value.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (normalized.length === 0) return "";
  if (normalized.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new RangeError("Folder understanding scope path must be a canonical repository-relative folder.");
  }
  return normalized;
};
const parentFolder = (filePath: string): string => {
  const normalized = normalizeFolder(filePath);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
};
const isDescendantOrSelf = (folder: string, ancestor: string): boolean =>
  ancestor.length === 0 || folder === ancestor || folder.startsWith(`${ancestor}/`);

/**
 * Owns T610 folder lifecycle state. It deliberately persists only explicit
 * stops: active work is session-local and is never restarted implicitly.
 */
export class FolderUnderstandingScopeController {
  private readonly byOwner = new Map<string, Map<string, ScopeRecord>>();
  private readonly restored = new Set<string>();
  private readonly cancellations = new Map<string, AbortController>();

  /** Uses the supplied durable marker store; active results and content evidence remain session-local. */
  public constructor(private readonly store: FolderUnderstandingStoppedStore) {}

  /** Restores stopped markers only; all unmarked scopes remain inactive. */
  public async restore(repositoryId: string, canonicalRepositoryRoot: string): Promise<void> {
    const owner = keyOf(repositoryId, canonicalRepositoryRoot);
    if (this.restored.has(owner)) return;
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    const markers = await this.store.loadStopped(repositoryId, canonicalRepositoryRoot);
    for (const marker of markers) {
      try {
        const folder = normalizeFolder(marker);
        if (marker !== folder || records.has(folder)) continue;
        this.ensureAncestors(records, folder);
        records.set(folder, { state: "stopped", generation: 0, explicitStop: true });
      } catch { /* corrupt marker is fail-closed and never reused */ }
    }
    this.restored.add(owner);
  }

  /** Starts only the opened file's direct containing folder. */
  public openFile(repositoryId: string, canonicalRepositoryRoot: string, filePath: string, autoStartDescendants: boolean): void {
    const folder = parentFolder(filePath);
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    const record = this.record(records, folder);
    if (this.hasStoppedAncestor(records, folder)) return;
    record.state = "active";
    if (autoStartDescendants) void autoStartDescendants;
  }

  /** Registers a discovered direct child without starting or reading its contents. */
  public discoverInactive(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): void {
    this.record(this.records(repositoryId, canonicalRepositoryRoot), normalizeFolder(folderPath));
  }

  /** Explicit start may include a selected subtree but always skips stopped descendants. */
  public async start(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string, discoveredFolders: readonly string[]): Promise<void> {
    const folder = normalizeFolder(folderPath);
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    for (const candidate of [folder, ...discoveredFolders.map(normalizeFolder)]) {
      if (!isDescendantOrSelf(candidate, folder)) continue;
      const record = this.record(records, candidate);
      const stoppedAncestor = this.hasStoppedAncestor(records, candidate);
      if (record.state !== "stopped" && !stoppedAncestor) record.state = "active";
    }
  }

  /** Stops a scope, invalidates its in-flight generation, and persists the marker. */
  public async stop(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): Promise<void> {
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    const folder = normalizeFolder(folderPath);
    this.record(records, folder);
    for (const [candidate, record] of records) {
      if (!isDescendantOrSelf(candidate, folder)) continue;
      this.cancellations.get(this.scopeKey(repositoryId, canonicalRepositoryRoot, candidate))?.abort();
      record.generation += 1;
      record.state = "stopped";
      record.explicitStop = candidate === folder;
    }
    await this.persist(repositoryId, canonicalRepositoryRoot, { add: [folder], remove: [] });
  }

  /** Removes a stopped marker and returns the scope to a new running generation. */
  public async resume(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): Promise<number> {
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    const folder = normalizeFolder(folderPath);
    const record = this.record(records, folder);
    for (const [candidate, descendant] of records) {
      if (candidate !== folder && isDescendantOrSelf(candidate, folder) && descendant.state === "stopped" && !descendant.explicitStop) {
        descendant.state = "inactive";
      }
    }
    record.explicitStop = false;
    record.state = "running";
    record.generation += 1;
    await this.persist(repositoryId, canonicalRepositoryRoot, { add: [], remove: [folder] });
    return record.generation;
  }

  /** Begins a scoped generation and returns its stale-publication fence. */
  public begin(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): number {
    const folder = normalizeFolder(folderPath);
    const record = this.record(this.records(repositoryId, canonicalRepositoryRoot), folder);
    if (this.hasStoppedAncestor(this.records(repositoryId, canonicalRepositoryRoot), folder)) return -1;
    this.cancellations.get(this.scopeKey(repositoryId, canonicalRepositoryRoot, folder))?.abort();
    this.cancellations.set(this.scopeKey(repositoryId, canonicalRepositoryRoot, folder), new AbortController());
    record.state = "running";
    record.generation += 1;
    return record.generation;
  }

  /** Scope-local cancellation is never shared by sibling folders. */
  public signal(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): AbortSignal | undefined {
    return this.cancellations.get(this.scopeKey(repositoryId, canonicalRepositoryRoot, normalizeFolder(folderPath)))?.signal;
  }

  /** Accepts a result only when it still belongs to the current live generation. */
  public accept(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string, generation: number, total: Omit<FolderUnderstandingTotal, "complete">): boolean {
    const record = this.record(this.records(repositoryId, canonicalRepositoryRoot), normalizeFolder(folderPath));
    if (generation < 0 || record.generation !== generation || record.state !== "running") return false;
    record.state = "active";
    record.total = { reviewed: total.reviewed, total: total.total };
    return true;
  }

  /** A failed generation preserves its last accepted direct result as partial evidence. */
  public fail(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string, generation: number): boolean {
    const record = this.record(this.records(repositoryId, canonicalRepositoryRoot), normalizeFolder(folderPath));
    if (generation < 0 || record.generation !== generation || record.state !== "running") return false;
    record.state = "failed";
    return true;
  }

  /** Publishes a validated direct total; stopped scopes reject publication fail-closed. */
  public setComplete(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string, total: Omit<FolderUnderstandingTotal, "complete">): void {
    const record = this.record(this.records(repositoryId, canonicalRepositoryRoot), normalizeFolder(folderPath));
    if (record.state === "stopped") return;
    record.state = "active";
    record.total = { reviewed: total.reviewed, total: total.total };
  }

  /** Returns an owner-isolated scope state without starting I/O. */
  public state(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): FolderUnderstandingScopeState {
    return this.record(this.records(repositoryId, canonicalRepositoryRoot), normalizeFolder(folderPath)).state;
  }

  /** Returns whether an explicit or inherited stopped marker prevents subtree discovery. */
  public isStopped(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): boolean {
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    return this.hasStoppedAncestor(records, normalizeFolder(folderPath));
  }

  /** Lists only active/running scopes; inactive or stopped scopes are never auto-enqueued. */
  public activeFolders(repositoryId: string, canonicalRepositoryRoot: string): string[] {
    return [...this.records(repositoryId, canonicalRepositoryRoot)]
      .filter(([, record]) => record.state === "active" || record.state === "running")
      .map(([folder]) => folder)
      .sort();
  }

  /** Returns immutable, root-isolated rows for the T610 Tree projection. */
  public snapshots(repositoryId: string, canonicalRepositoryRoot: string): readonly FolderUnderstandingScopeSnapshot[] {
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    const totals = this.indexedAggregates(records);
    return [...records]
      .map(([path, record]) => ({ path, state: record.state, total: totals.get(path)! }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  /** Parent totals include direct evidence plus complete direct children only. */
  public aggregate(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): FolderUnderstandingTotal {
    const folder = normalizeFolder(folderPath);
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    this.record(records, folder);
    return this.indexedAggregates(records).get(folder)!;
  }

  private records(repositoryId: string, repositoryRoot: string): Map<string, ScopeRecord> {
    const owner = keyOf(repositoryId, repositoryRoot);
    let records = this.byOwner.get(owner);
    if (records === undefined) {
      records = new Map();
      this.byOwner.set(owner, records);
    }
    return records;
  }

  private record(records: Map<string, ScopeRecord>, folder: string): ScopeRecord {
    this.ensureAncestors(records, folder);
    let record = records.get(folder);
    if (record === undefined) {
      record = { state: "inactive", generation: 0 };
      records.set(folder, record);
    }
    return record;
  }

  private async persist(repositoryId: string, repositoryRoot: string, mutation?: Readonly<{ add: readonly string[]; remove: readonly string[] }>): Promise<void> {
    if (mutation !== undefined && this.store.mutateStopped !== undefined) {
      const stopped = await this.store.mutateStopped(repositoryId, repositoryRoot, mutation);
      const records = this.records(repositoryId, repositoryRoot);
      for (const [folder, record] of records) {
        if (record.explicitStop === true && !stopped.includes(folder)) { record.explicitStop = false; if (record.state === "stopped") record.state = "inactive"; }
      }
      for (const folder of stopped) {
        this.ensureAncestors(records, folder);
        const record = this.record(records, folder); record.state = "stopped"; record.explicitStop = true;
      }
      return;
    }
    const stopped = [...this.records(repositoryId, repositoryRoot)]
      .filter(([, record]) => record.state === "stopped" && record.explicitStop === true)
      .map(([folder]) => folder)
      .sort();
    await this.store.saveStopped(repositoryId, repositoryRoot, stopped);
  }

  private scopeKey(repositoryId: string, repositoryRoot: string, folder: string): string {
    return `${keyOf(repositoryId, repositoryRoot)}\0${folder}`;
  }

  private ensureAncestors(records: Map<string, ScopeRecord>, folder: string): void {
    for (let current = parentFolder(folder); ; current = parentFolder(current)) {
      if (!records.has(current)) records.set(current, { state: "inactive", generation: 0 });
      if (current.length === 0) return;
    }
  }

  private hasStoppedAncestor(records: ReadonlyMap<string, ScopeRecord>, folder: string): boolean {
    return [...records].some(([candidate, record]) => record.state === "stopped" && isDescendantOrSelf(folder, candidate));
  }

  /** Computes every hierarchy aggregate once, from leaves toward the root. */
  private indexedAggregates(records: ReadonlyMap<string, ScopeRecord>): Map<string, FolderUnderstandingTotal> {
    const totals = new Map<string, FolderUnderstandingTotal>();
    const children = new Map<string, string[]>();
    for (const folder of records.keys()) {
      if (folder.length === 0) continue;
      const parent = parentFolder(folder);
      const rows = children.get(parent) ?? [];
      rows.push(folder);
      children.set(parent, rows);
    }
    const ordered = [...records.keys()].sort((left, right) => right.split("/").length - left.split("/").length || right.localeCompare(left));
    for (const folder of ordered) {
      const record = records.get(folder)!;
      let reviewed = record.total?.reviewed ?? 0;
      let total = record.total?.total ?? 0;
      let complete = record.state === "active" && record.total !== undefined;
      for (const candidate of children.get(folder) ?? []) {
        const candidateTotal = totals.get(candidate)!;
        if (!candidateTotal.complete) { complete = false; continue; }
        reviewed += candidateTotal.reviewed;
        total += candidateTotal.total;
      }
      totals.set(folder, { reviewed, total, complete });
    }
    return totals;
  }
}

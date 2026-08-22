/** A persisted, repository-root isolated marker store for stopped folder scopes. */
export interface FolderUnderstandingStoppedStore {
  loadStopped(repositoryId: string, canonicalRepositoryRoot: string): Promise<readonly string[]>;
  saveStopped(repositoryId: string, canonicalRepositoryRoot: string, paths: readonly string[]): Promise<void>;
}

export type FolderUnderstandingScopeState = "inactive" | "running" | "active" | "stopped" | "failed";

export interface FolderUnderstandingTotal {
  readonly reviewed: number;
  readonly total: number;
  readonly complete: boolean;
}

export interface FolderUnderstandingScopeSnapshot {
  readonly path: string;
  readonly state: FolderUnderstandingScopeState;
  readonly total: FolderUnderstandingTotal;
}

interface ScopeRecord {
  state: FolderUnderstandingScopeState;
  generation: number;
  total?: Omit<FolderUnderstandingTotal, "complete">;
}

const keyOf = (repositoryId: string, repositoryRoot: string): string => `${repositoryId}\0${repositoryRoot}`;
const normalizeFolder = (value: string): string => value.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
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

  public constructor(private readonly store: FolderUnderstandingStoppedStore) {}

  /** Restores stopped markers only; all unmarked scopes remain inactive. */
  public async restore(repositoryId: string, canonicalRepositoryRoot: string): Promise<void> {
    const owner = keyOf(repositoryId, canonicalRepositoryRoot);
    if (this.restored.has(owner)) return;
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    const markers = await this.store.loadStopped(repositoryId, canonicalRepositoryRoot);
    for (const marker of markers) {
      const folder = normalizeFolder(marker);
      if (marker !== folder || records.has(folder)) continue;
      records.set(folder, { state: "stopped", generation: 0 });
    }
    this.restored.add(owner);
  }

  /** Starts only the opened file's direct containing folder. */
  public openFile(repositoryId: string, canonicalRepositoryRoot: string, filePath: string, autoStartDescendants: boolean): void {
    const folder = parentFolder(filePath);
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    const record = this.record(records, folder);
    if (record.state === "stopped") return;
    record.state = "active";
    if (autoStartDescendants) void autoStartDescendants;
  }

  /** Explicit start may include a selected subtree but always skips stopped descendants. */
  public async start(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string, discoveredFolders: readonly string[]): Promise<void> {
    const folder = normalizeFolder(folderPath);
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    for (const candidate of [folder, ...discoveredFolders.map(normalizeFolder)]) {
      if (!isDescendantOrSelf(candidate, folder)) continue;
      const record = this.record(records, candidate);
      const stoppedAncestor = [...records].some(([path, value]) =>
        value.state === "stopped" && isDescendantOrSelf(candidate, path));
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
    }
    await this.persist(repositoryId, canonicalRepositoryRoot);
  }

  /** Removes a stopped marker and returns the scope to a new running generation. */
  public async resume(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): Promise<number> {
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    const record = this.record(records, normalizeFolder(folderPath));
    record.state = "running";
    record.generation += 1;
    await this.persist(repositoryId, canonicalRepositoryRoot);
    return record.generation;
  }

  /** Begins a scoped generation and returns its stale-publication fence. */
  public begin(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): number {
    const folder = normalizeFolder(folderPath);
    const record = this.record(this.records(repositoryId, canonicalRepositoryRoot), folder);
    if (record.state === "stopped") return -1;
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

  public setComplete(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string, total: Omit<FolderUnderstandingTotal, "complete">): void {
    const record = this.record(this.records(repositoryId, canonicalRepositoryRoot), normalizeFolder(folderPath));
    if (record.state === "stopped") return;
    record.state = "active";
    record.total = { reviewed: total.reviewed, total: total.total };
  }

  public state(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): FolderUnderstandingScopeState {
    return this.record(this.records(repositoryId, canonicalRepositoryRoot), normalizeFolder(folderPath)).state;
  }

  public activeFolders(repositoryId: string, canonicalRepositoryRoot: string): string[] {
    return [...this.records(repositoryId, canonicalRepositoryRoot)]
      .filter(([, record]) => record.state === "active" || record.state === "running")
      .map(([folder]) => folder)
      .sort();
  }

  /** Returns immutable, root-isolated rows for the T610 Tree projection. */
  public snapshots(repositoryId: string, canonicalRepositoryRoot: string): readonly FolderUnderstandingScopeSnapshot[] {
    return [...this.records(repositoryId, canonicalRepositoryRoot)]
      .map(([path, record]) => ({ path, state: record.state, total: this.aggregate(repositoryId, canonicalRepositoryRoot, path) }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  /** Parent totals include direct evidence plus complete direct children only. */
  public aggregate(repositoryId: string, canonicalRepositoryRoot: string, folderPath: string): FolderUnderstandingTotal {
    const folder = normalizeFolder(folderPath);
    const records = this.records(repositoryId, canonicalRepositoryRoot);
    const self = this.record(records, folder);
    const directChildren = [...records].filter(([candidate]) => candidate !== folder && parentFolder(candidate) === folder);
    let reviewed = self.total?.reviewed ?? 0;
    let total = self.total?.total ?? 0;
    let complete = self.state === "active" && self.total !== undefined;
    for (const [, child] of directChildren) {
      if (child.state !== "active" || child.total === undefined) {
        complete = false;
        continue;
      }
      reviewed += child.total.reviewed;
      total += child.total.total;
    }
    return { reviewed, total, complete };
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
    let record = records.get(folder);
    if (record === undefined) {
      record = { state: "inactive", generation: 0 };
      records.set(folder, record);
    }
    return record;
  }

  private async persist(repositoryId: string, repositoryRoot: string): Promise<void> {
    const stopped = [...this.records(repositoryId, repositoryRoot)]
      .filter(([, record]) => record.state === "stopped")
      .map(([folder]) => folder)
      .sort();
    await this.store.saveStopped(repositoryId, repositoryRoot, stopped);
  }

  private scopeKey(repositoryId: string, repositoryRoot: string, folder: string): string {
    return `${keyOf(repositoryId, repositoryRoot)}\0${folder}`;
  }
}

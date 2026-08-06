import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PullRequestReviewedLineInterval {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

export type GitHubPullRequestLifecycleState = "open" | "closed" | "merged";

export interface GitHubPullRequestContextIdentity {
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
  readonly pullRequestNumber: number;
}

export interface GitHubPullRequestContextLayer extends GitHubPullRequestContextIdentity {
  readonly contextId: string;
  readonly baseRevision: string;
  readonly headRevision: string;
  readonly state: GitHubPullRequestLifecycleState;
  readonly decorationEnabled: boolean;
  readonly updatedAt: string;
  readonly files: Readonly<Record<string, readonly PullRequestReviewedLineInterval[]>>;
}

interface PersistedDocument {
  readonly version: 1;
  readonly layers: readonly GitHubPullRequestContextLayer[];
}

const STORAGE_FILE_NAME = "github-pr-context-layers.v1.json";
const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const AUTHORITY = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/u;
const NAME = /^[A-Za-z0-9_.-]+$/u;

export function createGitHubPullRequestContextId(identity: GitHubPullRequestContextIdentity): string {
  const normalized = normalizeIdentity(identity);
  return `github-pr:${normalized.host}/${normalized.owner}/${normalized.repository}#${normalized.pullRequestNumber}`;
}

/** Persists independent PR review layers below the ExtensionContext.globalStorageUri filesystem path. */
export class NodeGitHubPullRequestContextLayerStore {
  readonly #storagePath: string;

  public constructor(globalStoragePath: string) {
    if (!path.isAbsolute(globalStoragePath)) {
      throw new Error("globalStoragePath must be absolute");
    }
    this.#storagePath = path.join(globalStoragePath, STORAGE_FILE_NAME);
  }

  public async list(): Promise<readonly GitHubPullRequestContextLayer[]> {
    const document = await this.#read();
    return document.layers.map(cloneLayer).sort((left, right) => left.contextId.localeCompare(right.contextId));
  }

  public async get(contextId: string): Promise<GitHubPullRequestContextLayer | undefined> {
    const found = (await this.#read()).layers.find((layer) => layer.contextId === contextId);
    return found === undefined ? undefined : cloneLayer(found);
  }

  public async upsert(candidate: GitHubPullRequestContextLayer): Promise<GitHubPullRequestContextLayer> {
    const normalized = normalizeLayer(candidate);
    const current = await this.#read();
    const layers = current.layers.filter((layer) => layer.contextId !== normalized.contextId);
    layers.push(normalized);
    await this.#write({ version: 1, layers });
    return cloneLayer(normalized);
  }

  public async remove(contextId: string): Promise<boolean> {
    const current = await this.#read();
    const layers = current.layers.filter((layer) => layer.contextId !== contextId);
    if (layers.length === current.layers.length) {
      return false;
    }
    await this.#write({ version: 1, layers });
    return true;
  }

  async #read(): Promise<PersistedDocument> {
    let text: string;
    try {
      text = await readFile(this.#storagePath, "utf8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { version: 1, layers: [] };
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error: unknown) {
      throw new Error("GitHub PR context layer storage is invalid JSON", { cause: error });
    }
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.layers)) {
      throw new Error("GitHub PR context layer storage has an unsupported schema");
    }

    const layers = parsed.layers.map(normalizeLayer);
    const ids = new Set<string>();
    for (const layer of layers) {
      if (ids.has(layer.contextId)) {
        throw new Error(`Duplicate GitHub PR context layer: ${layer.contextId}`);
      }
      ids.add(layer.contextId);
    }
    return { version: 1, layers };
  }

  async #write(document: PersistedDocument): Promise<void> {
    await mkdir(path.dirname(this.#storagePath), { recursive: true });
    const temporaryPath = `${this.#storagePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(document), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.#storagePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

function normalizeIdentity(value: GitHubPullRequestContextIdentity): GitHubPullRequestContextIdentity {
  const host = value.host.trim().toLowerCase();
  const owner = value.owner.trim();
  const repository = value.repository.trim();
  if (!AUTHORITY.test(host) || host.includes("..")) {
    throw new Error("Invalid GitHub host");
  }
  if (!NAME.test(owner) || !NAME.test(repository)) {
    throw new Error("Invalid GitHub owner or repository");
  }
  if (!Number.isSafeInteger(value.pullRequestNumber) || value.pullRequestNumber <= 0) {
    throw new Error("Invalid pull request number");
  }
  return { host, owner, repository, pullRequestNumber: value.pullRequestNumber };
}

function normalizeLayer(value: unknown): GitHubPullRequestContextLayer {
  if (!isRecord(value)) {
    throw new Error("Invalid GitHub PR context layer");
  }
  const identity = normalizeIdentity({
    host: readString(value, "host"),
    owner: readString(value, "owner"),
    repository: readString(value, "repository"),
    pullRequestNumber: readNumber(value, "pullRequestNumber"),
  });
  const contextId = createGitHubPullRequestContextId(identity);
  if (readString(value, "contextId") !== contextId) {
    throw new Error("GitHub PR context ID does not match its identity");
  }
  const baseRevision = normalizeRevision(readString(value, "baseRevision"));
  const headRevision = normalizeRevision(readString(value, "headRevision"));
  const state = readLifecycleState(value.state);
  const updatedAt = readString(value, "updatedAt");
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Invalid updatedAt timestamp");
  }
  return {
    ...identity,
    contextId,
    baseRevision,
    headRevision,
    state,
    decorationEnabled: state === "open" && value.decorationEnabled === true,
    updatedAt: new Date(updatedAt).toISOString(),
    files: normalizeFiles(value.files),
  };
}

function normalizeRevision(value: string): string {
  if (!FULL_OBJECT_ID.test(value)) {
    throw new Error("Revision must be a lowercase full SHA-1 or SHA-256 object ID");
  }
  return value;
}

function normalizeFiles(value: unknown): Readonly<Record<string, readonly PullRequestReviewedLineInterval[]>> {
  if (!isRecord(value)) {
    throw new Error("Invalid PR context files");
  }
  const result: Record<string, readonly PullRequestReviewedLineInterval[]> = {};
  for (const [file, intervals] of Object.entries(value)) {
    if (file.length === 0 || file.startsWith("/") || file.includes("\\") || file.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`Invalid repository-relative path: ${file}`);
    }
    if (!Array.isArray(intervals)) {
      throw new Error(`Invalid intervals for ${file}`);
    }
    let previousEnd = -1;
    result[file] = intervals.map((interval) => {
      if (!isRecord(interval)) {
        throw new Error(`Invalid interval for ${file}`);
      }
      const startLine = readNumber(interval, "startLine");
      const endLineExclusive = readNumber(interval, "endLineExclusive");
      if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLineExclusive) || startLine < 0 || endLineExclusive <= startLine || startLine < previousEnd) {
        throw new Error(`Invalid or overlapping interval for ${file}`);
      }
      previousEnd = endLineExclusive;
      return { startLine, endLineExclusive };
    });
  }
  return result;
}

function cloneLayer(layer: GitHubPullRequestContextLayer): GitHubPullRequestContextLayer {
  return {
    ...layer,
    files: Object.fromEntries(Object.entries(layer.files).map(([file, intervals]) => [file, intervals.map((interval) => ({ ...interval }))])),
  };
}

function readLifecycleState(value: unknown): GitHubPullRequestLifecycleState {
  if (value !== "open" && value !== "closed" && value !== "merged") {
    throw new Error("Invalid pull request lifecycle state");
  }
  return value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${key}`);
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`Invalid ${key}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

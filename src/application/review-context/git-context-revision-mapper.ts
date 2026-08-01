import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewState,
  type GlobalFileReviewState,
  type ReviewContextState
} from "../../core/contracts/index";
import {
  applyGitFileStateTransitions,
  mapReviewedIntervalsAcrossDiff,
  parseZeroContextGitDiff,
  type GitDiffFile,
  type GitDiffMappingOptions,
  type GitNewFileStateInput
} from "../../core/git-diff/index";
import type { FileSystemPathSemantics } from "../workspace-identity/index";
import type {
  GitContextRevisionMapperOptions,
  GitContextRevisionMappingInput,
  GitContextRevisionMappingResult,
  GitRevisionMappingTextReadResult
} from "./contracts";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const lineCountOf = (content: string): number =>
  content.split(/\r\n|\r|\n/u).length;

const contextRevision = (state: ReviewContextState): string => {
  if (state.kind !== "branch" || state.branch === undefined) {
    throw new Error("Git revision mapping requires a persisted branch context.");
  }
  return state.branch.headRevision;
};

const requireFound = (
  result: GitRevisionMappingTextReadResult,
  revision: string,
  filePath: string
): string => {
  if (result.kind === "found") {
    return result.content;
  }
  throw new Error(
    `Cannot map ${filePath} at ${revision}: ${result.kind}`
  );
};

const unique = (values: readonly (string | undefined)[]): string[] =>
  [...new Set(values.filter((value): value is string => value !== undefined))];

const isBinaryDiffSection = (lines: readonly string[]): boolean =>
  lines.some((line) =>
    line.startsWith("Binary files ") || line === "GIT binary patch"
  );

/** Keeps complete text diff sections while excluding files outside line review. */
const reviewableDiff = (diff: string): string => {
  if (typeof diff !== "string") {
    throw new TypeError("diff must be a string.");
  }
  const sections: string[][] = [];
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      sections.push([line]);
    } else if (sections.length > 0) {
      sections.at(-1)?.push(line);
    } else if (line.length > 0) {
      throw new SyntaxError("Diff content must begin with a diff --git header.");
    }
  }
  return sections
    .filter((section) => !isBinaryDiffSection(section))
    .map((section) => section.join("\n"))
    .join("\n");
};

/** Returns paths in Git-declared binary sections so they cannot inherit line-review state. */
const binaryDiffPaths = (diff: string): ReadonlySet<string> => {
  const paths = new Set<string>();
  let headerPaths: readonly string[] = [];
  let binary = false;
  const addPaths = (): void => {
    if (binary) {
      for (const path of headerPaths) {
        paths.add(path);
      }
    }
  };

  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      addPaths();
      binary = false;
      const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
      headerPaths = match === null ? [] : [match[1] as string, match[2] as string];
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      binary = true;
    }
  }
  addPaths();
  return paths;
};

const copyAwareParsedFiles = (diff: string): readonly GitDiffFile[] =>
  parseZeroContextGitDiff(
    diff
      .replace(/^copy from /gmu, "rename from ")
      .replace(/^copy to /gmu, "rename to ")
  ).files;

/** Maps complete context and Global snapshots between immutable Git revisions. */
export class GitContextRevisionMapper {
  private readonly now: () => Date;

  /** Creates a mapper using local immutable content and complete repository diffs. */
  public constructor(
    private readonly options: GitContextRevisionMapperOptions
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Advances both persisted snapshots to `input.current.revisionId`.
   *
   * T204 applies rename/copy/add/delete transitions and T203 maps ordinary
   * same-path modifications. When an old object is unavailable, surviving
   * paths are retained only as unreviewed state.
   */
  public async map(
    input: GitContextRevisionMappingInput
  ): Promise<GitContextRevisionMappingResult> {
    this.validateInput(input);
    const occurredAt = this.now().toISOString();
    const newRevision = input.current.revisionId;
    const oldContextRevision = contextRevision(input.contextState);
    const oldGlobalRevision = input.globalState.currentRevisionId;

    const contextFiles = await this.mapContextFiles(
      input.contextState.files,
      input.current.repositoryId,
      oldContextRevision,
      newRevision,
      input.current.repositoryRoot,
      input.fileSystemPathSemantics,
      input.options,
      occurredAt
    );
    const globalFiles = await this.mapGlobalFiles(
      input.globalState.files,
      input.current.repositoryId,
      oldGlobalRevision,
      newRevision,
      input.current.repositoryRoot,
      input.fileSystemPathSemantics,
      input.options,
      occurredAt
    );

    return {
      contextState: {
        ...clone(input.contextState),
        displayName: input.current.contextState.displayName,
        branch: clone(input.current.contextState.branch),
        files: contextFiles,
        updatedAt: occurredAt
      },
      globalState: {
        ...clone(input.globalState),
        currentRevisionId: newRevision,
        files: globalFiles,
        updatedAt: occurredAt
      }
    };
  }

  private validateInput(input: GitContextRevisionMappingInput): void {
    if (
      input.contextState.contextId !== input.current.contextId ||
      input.contextState.repositoryId !== input.current.repositoryId ||
      input.globalState.repositoryId !== input.current.repositoryId
    ) {
      throw new Error("Git context mapping identities must match the current context.");
    }
    if (
      input.contextState.kind !== "branch" ||
      input.current.contextState.kind !== "branch"
    ) {
      throw new Error("Git context mapping requires branch-schema persistence.");
    }
    if (
      typeof input.options.ignoreWhitespaceChanges !== "boolean" ||
      typeof input.options.ignoreEolChanges !== "boolean"
    ) {
      throw new TypeError("Git mapping options must be booleans.");
    }
  }

  private async mapContextFiles(
    files: Readonly<Record<string, FileReviewState>>,
    repositoryId: string,
    oldRevision: string,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    options: Readonly<GitDiffMappingOptions>,
    occurredAt: string
  ): Promise<Record<string, FileReviewState>> {
    if (oldRevision === newRevision) {
      return clone(files);
    }
    if (!FULL_OBJECT_ID_PATTERN.test(newRevision)) {
      return {};
    }
    const oldExists = FULL_OBJECT_ID_PATTERN.test(oldRevision) &&
      await this.options.source.objectExists(repositoryRoot, oldRevision);
    if (!oldExists) {
      return this.clearAndRefresh(
        files,
        newRevision,
        repositoryRoot,
        semantics,
        occurredAt
      );
    }

    const rawDiff = await this.options.source.diffRevisions(
      repositoryRoot,
      oldRevision,
      newRevision
    );
    const diff = reviewableDiff(rawDiff);
    const binaryPaths = binaryDiffPaths(rawDiff);
    const parsedFiles = parseZeroContextGitDiff(diff).files;
    const oldTexts = await this.loadOldTextsWhenRequired(
      Object.values(files),
      oldRevision,
      repositoryRoot,
      semantics,
      options
    );
    const newFiles = await this.loadNewFileMetadata(
      diff,
      files,
      repositoryId,
      newRevision,
      repositoryRoot,
      semantics
    );
    const transitioned = applyGitFileStateTransitions({
      files,
      diff,
      newRevisionId: newRevision,
      updatedAt: occurredAt,
      options,
      ...(oldTexts === undefined ? {} : { oldTexts }),
      newFiles
    });
    const mapped = this.mapOrdinaryModifications(
      files,
      transitioned.files,
      parsedFiles,
      diff,
      newRevision,
      occurredAt,
      options,
      oldTexts,
      newFiles
    );
    return this.refreshMappedFiles(
      mapped,
      newRevision,
      repositoryRoot,
      semantics,
      occurredAt,
      binaryPaths
    );
  }

  private async mapGlobalFiles(
    files: Readonly<Record<string, GlobalFileReviewState>>,
    repositoryId: string,
    oldRevision: string,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    options: Readonly<GitDiffMappingOptions>,
    occurredAt: string
  ): Promise<Record<string, GlobalFileReviewState>> {
    if (oldRevision === newRevision) {
      return clone(files);
    }
    if (!FULL_OBJECT_ID_PATTERN.test(newRevision)) {
      return {};
    }

    const oldExists = FULL_OBJECT_ID_PATTERN.test(oldRevision) &&
      await this.options.source.objectExists(repositoryRoot, oldRevision);
    if (!oldExists) {
      return this.clearGlobalFiles(
        files,
        newRevision,
        repositoryRoot,
        semantics,
        occurredAt
      );
    }

    const transitionInput: Record<string, FileReviewState> = {};
    const missingOldFiles: GlobalFileReviewState[] = [];
    for (const file of Object.values(files)) {
      const result = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        oldRevision,
        file.currentPath,
        semantics
      );
      if (result.kind !== "found") {
        missingOldFiles.push(clone(file));
        continue;
      }
      transitionInput[file.fileId] = {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: file.fileId,
        currentPath: file.currentPath,
        previousPaths: [],
        revisionId: oldRevision,
        modifiedReviewed: clone(file.reviewed),
        originalReviewedByDiff: {},
        ...(file.contentHash === undefined
          ? { contentHash: this.digest(result.content) }
          : { contentHash: file.contentHash }),
        lineCount: lineCountOf(result.content),
        updatedAt: file.updatedAt
      };
    }

    const mapped = await this.mapContextFiles(
      transitionInput,
      repositoryId,
      oldRevision,
      newRevision,
      repositoryRoot,
      semantics,
      options,
      occurredAt
    );
    const result: Record<string, GlobalFileReviewState> = Object.fromEntries(
      Object.values(mapped).map((file) => [
        file.fileId,
        {
          fileId: file.fileId,
          currentPath: file.currentPath,
          revisionId: newRevision,
          reviewed: clone(file.modifiedReviewed),
          ...(file.contentHash === undefined ? {} : { contentHash: file.contentHash }),
          updatedAt: occurredAt
        }
      ])
    );
    const conservative = await this.clearGlobalFiles(
      Object.fromEntries(missingOldFiles.map((file) => [file.fileId, file])),
      newRevision,
      repositoryRoot,
      semantics,
      occurredAt
    );
    for (const [fileId, file] of Object.entries(conservative)) {
      if (!(fileId in result)) {
        result[fileId] = file;
      }
    }
    return result;
  }

  private mapOrdinaryModifications(
    previous: Readonly<Record<string, FileReviewState>>,
    transitioned: Readonly<Record<string, FileReviewState>>,
    parsedFiles: readonly GitDiffFile[],
    diff: string,
    newRevision: string,
    occurredAt: string,
    options: Readonly<GitDiffMappingOptions>,
    oldTexts: Readonly<Record<string, string>> | undefined,
    newFiles: Readonly<Record<string, GitNewFileStateInput>>
  ): Record<string, FileReviewState> {
    const next = clone(transitioned) as Record<string, FileReviewState>;
    const previousByPath = new Map(
      Object.values(previous).map((file) => [file.currentPath, file])
    );
    for (const file of parsedFiles) {
      if (
        file.isRename ||
        file.hunks.length === 0 ||
        file.oldPath === undefined ||
        file.newPath === undefined ||
        file.oldPath !== file.newPath
      ) {
        continue;
      }
      const prior = previousByPath.get(file.oldPath);
      const current = prior === undefined ? undefined : next[prior.fileId];
      if (prior === undefined || current === undefined) {
        continue;
      }
      const metadata = newFiles[file.newPath];
      const mapped = mapReviewedIntervalsAcrossDiff({
        reviewed: prior.modifiedReviewed,
        diff,
        oldPath: file.oldPath,
        newPath: file.newPath,
        ...(oldTexts?.[file.oldPath] === undefined
          ? {}
          : { oldText: oldTexts[file.oldPath] }),
        ...(metadata?.newText === undefined
          ? {}
          : { newText: metadata.newText }),
        options
      });
      next[prior.fileId] = {
        ...clone(current),
        revisionId: newRevision,
        modifiedReviewed: mapped.reviewed,
        ...(metadata?.lineCount === undefined
          ? {}
          : { lineCount: metadata.lineCount }),
        updatedAt: occurredAt,
        ...(metadata?.contentHash === undefined
          ? {}
          : { contentHash: metadata.contentHash })
      };
    }
    return next;
  }

  private async loadOldTextsWhenRequired(
    files: readonly FileReviewState[],
    oldRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    options: Readonly<GitDiffMappingOptions>
  ): Promise<Record<string, string> | undefined> {
    if (!options.ignoreWhitespaceChanges && !options.ignoreEolChanges) {
      return undefined;
    }
    const entries: Array<readonly [string, string]> = [];
    for (const file of files) {
      const result = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        oldRevision,
        file.currentPath,
        semantics
      );
      entries.push([
        file.currentPath,
        requireFound(result, oldRevision, file.currentPath)
      ]);
    }
    return Object.fromEntries(entries);
  }

  private async loadNewFileMetadata(
    diff: string,
    existing: Readonly<Record<string, FileReviewState>>,
    repositoryId: string,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics
  ): Promise<Record<string, GitNewFileStateInput>> {
    const parsedFiles = parseZeroContextGitDiff(diff).files;
    const copyAwareFiles = copyAwareParsedFiles(diff);
    const existingByPath = new Map(
      Object.values(existing).map((file) => [file.currentPath, file.fileId])
    );
    const preservedDestinationIds = new Map<string, string>();
    for (const file of parsedFiles) {
      if (
        file.oldPath !== undefined &&
        file.newPath !== undefined &&
        (file.isRename || file.oldPath === file.newPath)
      ) {
        const sourceId = existingByPath.get(file.oldPath);
        if (sourceId !== undefined) {
          preservedDestinationIds.set(file.newPath, sourceId);
        }
      }
    }

    const result: Record<string, GitNewFileStateInput> = {};
    const occupiedFileIds = new Set(Object.keys(existing));
    const destinationPaths = unique([
      ...parsedFiles.map((file) => file.newPath),
      ...copyAwareFiles.map((file) => file.newPath)
    ]);
    for (const filePath of destinationPaths) {
      const textResult = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        newRevision,
        filePath,
        semantics
      );
      const content = requireFound(textResult, newRevision, filePath);
      result[filePath] = {
        fileId: preservedDestinationIds.get(filePath) ??
          this.createUnoccupiedFileId(repositoryId, filePath, occupiedFileIds),
        lineCount: lineCountOf(content),
        contentHash: this.digest(content),
        newText: content
      };
      occupiedFileIds.add(result[filePath].fileId);
    }
    return result;
  }

  private async clearAndRefresh(
    files: Readonly<Record<string, FileReviewState>>,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    occurredAt: string
  ): Promise<Record<string, FileReviewState>> {
    const cleared = Object.fromEntries(
      Object.values(files).map((file) => [
        file.fileId,
        {
          ...clone(file),
          revisionId: newRevision,
          modifiedReviewed: [],
          updatedAt: occurredAt
        }
      ])
    );
    return this.refreshMappedFiles(
      cleared,
      newRevision,
      repositoryRoot,
      semantics,
      occurredAt
    );
  }

  private async clearGlobalFiles(
    files: Readonly<Record<string, GlobalFileReviewState>>,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    occurredAt: string
  ): Promise<Record<string, GlobalFileReviewState>> {
    const result: Record<string, GlobalFileReviewState> = {};
    for (const file of Object.values(files)) {
      const read = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        newRevision,
        file.currentPath,
        semantics
      );
      if (read.kind !== "found") {
        continue;
      }
      result[file.fileId] = {
        fileId: file.fileId,
        currentPath: file.currentPath,
        revisionId: newRevision,
        reviewed: [],
        contentHash: this.digest(read.content),
        updatedAt: occurredAt
      };
    }
    return result;
  }

  private async refreshMappedFiles(
    files: Readonly<Record<string, FileReviewState>>,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    occurredAt: string,
    binaryPaths: ReadonlySet<string> = new Set()
  ): Promise<Record<string, FileReviewState>> {
    const refreshed: Record<string, FileReviewState> = {};
    for (const file of Object.values(files)) {
      if (binaryPaths.has(file.currentPath)) {
        continue;
      }
      const result = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        newRevision,
        file.currentPath,
        semantics
      );
      if (result.kind === "missing-file" || result.kind === "invalid-encoding") {
        continue;
      }
      const content = requireFound(result, newRevision, file.currentPath);
      refreshed[file.fileId] = {
        ...clone(file),
        revisionId: newRevision,
        contentHash: this.digest(content),
        lineCount: lineCountOf(content),
        updatedAt: occurredAt
      };
    }
    return refreshed;
  }

  private createFileId(repositoryId: string, filePath: string): string {
    return `repository-file:${this.digest(
      ["repository-file", repositoryId, filePath].join("\0")
    )}`;
  }

  /** Derives a deterministic new-file ID without replacing a retained stable identity. */
  private createUnoccupiedFileId(
    repositoryId: string,
    filePath: string,
    occupiedFileIds: ReadonlySet<string>
  ): string {
    const canonical = this.createFileId(repositoryId, filePath);
    if (!occupiedFileIds.has(canonical)) {
      return canonical;
    }
    for (let discriminator = 1; ; discriminator += 1) {
      const candidate = `repository-file:${this.digest(
        ["repository-file", repositoryId, filePath, String(discriminator)].join("\0")
      )}`;
      if (!occupiedFileIds.has(candidate)) {
        return candidate;
      }
    }
  }

  private digest(content: string): string {
    const digest = this.options.stableHash.digest(content);
    if (!SHA256_HEX_PATTERN.test(digest)) {
      throw new Error(
        "StableHash.digest must return a lowercase 64-character SHA-256 hexadecimal digest."
      );
    }
    return digest;
  }
}

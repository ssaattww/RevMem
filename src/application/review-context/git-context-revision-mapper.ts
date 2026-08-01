import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewState,
  type GlobalFileReviewState,
  type ReviewContextState
} from "../../core/contracts/index";
import {
  applyGitFileStateTransitions,
  parseZeroContextGitDiff,
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
   * Existing objects use T204 file-state transitions. When an old object is no
   * longer available, surviving paths are retained only as unreviewed state.
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
      oldContextRevision,
      newRevision,
      input.current.repositoryRoot,
      input.fileSystemPathSemantics,
      input.options,
      occurredAt
    );
    const globalFiles = await this.mapGlobalFiles(
      input.globalState.files,
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

    const diff = await this.options.source.diffRevisions(
      repositoryRoot,
      oldRevision,
      newRevision
    );
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
    return this.refreshMappedFiles(
      transitioned.files,
      newRevision,
      repositoryRoot,
      semantics,
      occurredAt
    );
  }

  private async mapGlobalFiles(
    files: Readonly<Record<string, GlobalFileReviewState>>,
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

    const transitionInput: Record<string, FileReviewState> = {};
    if (FULL_OBJECT_ID_PATTERN.test(oldRevision)) {
      for (const file of Object.values(files)) {
        const result = await this.options.source.readTextFileAtRevision(
          repositoryRoot,
          oldRevision,
          file.currentPath,
          semantics
        );
        if (result.kind !== "found") {
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
    }

    const mapped = await this.mapContextFiles(
      transitionInput,
      oldRevision,
      newRevision,
      repositoryRoot,
      semantics,
      options,
      occurredAt
    );
    return Object.fromEntries(
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
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics
  ): Promise<Record<string, GitNewFileStateInput>> {
    const parsed = parseZeroContextGitDiff(diff);
    const existingByPath = new Map(
      Object.values(existing).map((file) => [file.currentPath, file.fileId])
    );
    const result: Record<string, GitNewFileStateInput> = {};
    for (const filePath of unique(parsed.files.map((file) => file.newPath))) {
      const textResult = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        newRevision,
        filePath,
        semantics
      );
      const content = requireFound(textResult, newRevision, filePath);
      result[filePath] = {
        fileId: existingByPath.get(filePath) ?? this.createFileId(filePath),
        lineCount: lineCountOf(content),
        contentHash: this.digest(content),
        newText: content
      };
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

  private async refreshMappedFiles(
    files: Readonly<Record<string, FileReviewState>>,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    occurredAt: string
  ): Promise<Record<string, FileReviewState>> {
    const refreshed: Record<string, FileReviewState> = {};
    for (const file of Object.values(files)) {
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

  private createFileId(filePath: string): string {
    return `repository-file:${this.digest(`repository-file\0${filePath}`)}`;
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

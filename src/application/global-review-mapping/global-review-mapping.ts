import type {
  GlobalFileReviewState,
  RepositoryGlobalState
} from "../../core/contracts/index";
import {
  applyGitFileStateTransitions,
  type GitFileStateTransitionInput,
  type GitNewFileStateInput
} from "../../core/git-diff/index";
import {
  mapReviewedRangesThroughDocumentChanges,
  type DocumentContentChange,
  type RangeMappingOptions
} from "../../core/range-mapping/index";

/** Input for mapping one Global file through an editor change transaction. */
export interface MapRepositoryGlobalStateThroughDocumentChangesInput {
  readonly globalState: Readonly<RepositoryGlobalState>;
  readonly fileId: string;
  readonly beforeText: string;
  readonly changes: readonly DocumentContentChange[];
  readonly newRevisionId: string;
  readonly newContentHash?: string;
  readonly updatedAt: string;
  readonly options: Readonly<RangeMappingOptions>;
}

/** Input for mapping the complete Global snapshot through one complete Git diff. */
export interface MapRepositoryGlobalStateThroughGitDiffInput {
  readonly globalState: Readonly<RepositoryGlobalState>;
  readonly diff: string;
  readonly newRevisionId: string;
  readonly updatedAt: string;
  readonly options: GitFileStateTransitionInput["options"];
  readonly oldTexts?: GitFileStateTransitionInput["oldTexts"];
  readonly newFiles?: Readonly<Record<string, Readonly<GitNewFileStateInput>>>;
  readonly oldLineCounts?: Readonly<Record<string, number>>;
}

const cloneGlobalFile = (
  file: Readonly<GlobalFileReviewState>
): GlobalFileReviewState => ({
  ...file,
  reviewed: file.reviewed.map((interval) => ({ ...interval }))
});

const cloneGlobalState = (
  state: Readonly<RepositoryGlobalState>
): RepositoryGlobalState => ({
  ...state,
  files: Object.fromEntries(
    Object.entries(state.files).map(([fileId, file]) => [
      fileId,
      cloneGlobalFile(file)
    ])
  )
});

/**
 * Maps one Global file through a VS Code-compatible document change transaction.
 * Changed old lines and inserted lines become unreviewed; unchanged suffixes shift.
 */
export function mapRepositoryGlobalStateThroughDocumentChanges(
  input: MapRepositoryGlobalStateThroughDocumentChangesInput
): RepositoryGlobalState {
  const file = input.globalState.files[input.fileId];
  if (file === undefined || file.fileId !== input.fileId) {
    throw new RangeError("Global fileId must identify an existing Global file.");
  }
  if (file.revisionId !== input.globalState.currentRevisionId) {
    throw new RangeError("Global file revision must match the Global snapshot revision.");
  }

  const mapped = mapReviewedRangesThroughDocumentChanges({
    beforeText: input.beforeText,
    reviewed: file.reviewed,
    changes: input.changes,
    options: input.options
  });
  const result = cloneGlobalState(input.globalState);
  result.currentRevisionId = input.newRevisionId;
  result.updatedAt = input.updatedAt;
  result.files[input.fileId] = {
    ...cloneGlobalFile(file),
    revisionId: input.newRevisionId,
    reviewed: mapped.reviewed,
    ...(input.newContentHash === undefined
      ? { contentHash: undefined }
      : { contentHash: input.newContentHash }),
    updatedAt: input.updatedAt
  };
  return result;
}

const inferredLineCount = (
  file: Readonly<GlobalFileReviewState>,
  input: MapRepositoryGlobalStateThroughGitDiffInput
): number => {
  const explicit = input.oldLineCounts?.[file.fileId];
  if (explicit !== undefined) {
    return explicit;
  }
  const pathMetadata = input.newFiles?.[file.currentPath];
  if (pathMetadata !== undefined) {
    return pathMetadata.lineCount;
  }
  return file.reviewed.reduce(
    (maximum, interval) => Math.max(maximum, interval.endLineExclusive),
    0
  );
};

/**
 * Maps the owner-wide Global snapshot through the same conservative Git transition
 * engine used by context state. Stable rename IDs are retained; add, copy, delete,
 * ambiguous mapping, and changed hunks never manufacture reviewed ranges.
 */
export function mapRepositoryGlobalStateThroughGitDiff(
  input: MapRepositoryGlobalStateThroughGitDiffInput
): RepositoryGlobalState {
  const contextFiles = Object.fromEntries(
    Object.entries(input.globalState.files).map(([fileId, file]) => [
      fileId,
      {
        schemaVersion: input.globalState.schemaVersion,
        fileId,
        currentPath: file.currentPath,
        previousPaths: [],
        revisionId: file.revisionId,
        modifiedReviewed: file.reviewed.map((interval) => ({ ...interval })),
        originalReviewedByDiff: {},
        ...(file.contentHash === undefined ? {} : { contentHash: file.contentHash }),
        lineCount: inferredLineCount(file, input),
        updatedAt: file.updatedAt
      }
    ])
  );

  const transitioned = applyGitFileStateTransitions({
    files: contextFiles,
    diff: input.diff,
    newRevisionId: input.newRevisionId,
    updatedAt: input.updatedAt,
    options: input.options,
    ...(input.oldTexts === undefined ? {} : { oldTexts: input.oldTexts }),
    ...(input.newFiles === undefined ? {} : { newFiles: input.newFiles })
  });

  return {
    schemaVersion: input.globalState.schemaVersion,
    repositoryId: input.globalState.repositoryId,
    currentRevisionId: input.newRevisionId,
    files: Object.fromEntries(
      Object.entries(transitioned.files).map(([fileId, file]) => [
        fileId,
        {
          fileId,
          currentPath: file.currentPath,
          revisionId: file.revisionId,
          reviewed: file.modifiedReviewed.map((interval) => ({ ...interval })),
          ...(file.contentHash === undefined ? {} : { contentHash: file.contentHash }),
          updatedAt: file.updatedAt
        }
      ])
    ),
    updatedAt: input.updatedAt
  };
}

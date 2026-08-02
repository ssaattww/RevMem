import type {
  GlobalFileReviewState,
  RepositoryGlobalState
} from "../../core/contracts/index";
import {
  applyGitFileStateTransitions,
  mapReviewedIntervalsAcrossDiff,
  parseZeroContextGitDiff,
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

const advanceRetainedFileRevisions = (
  state: RepositoryGlobalState,
  newRevisionId: string
): void => {
  for (const [fileId, file] of Object.entries(state.files)) {
    state.files[fileId] = {
      ...file,
      revisionId: newRevisionId,
      reviewed: file.reviewed.map((interval) => ({ ...interval }))
    };
  }
};

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
  advanceRetainedFileRevisions(result, input.newRevisionId);
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
  input: MapRepositoryGlobalStateThroughGitDiffInput,
  parsed: ReturnType<typeof parseZeroContextGitDiff>
): number => {
  const explicit = input.oldLineCounts?.[file.fileId];
  if (explicit !== undefined) {
    return explicit;
  }
  const reviewedExtent = file.reviewed.reduce(
    (maximum, interval) => Math.max(maximum, interval.endLineExclusive),
    0
  );
  const diffOldExtent = parsed.files
    .filter((diffFile) => diffFile.oldPath === file.currentPath)
    .flatMap((diffFile) => diffFile.hunks)
    .reduce(
      (maximum, hunk) => Math.max(maximum, hunk.oldStart + hunk.oldLineCount),
      0
    );
  return Math.max(reviewedExtent, diffOldExtent);
};

const assertModifiedDestinationIdentity = (
  input: MapRepositoryGlobalStateThroughGitDiffInput,
  parsed: ReturnType<typeof parseZeroContextGitDiff>
): void => {
  const originalByPath = new Map(
    Object.values(input.globalState.files).map((file) => [file.currentPath, file])
  );
  for (const diffFile of parsed.files) {
    if (
      diffFile.isRename ||
      diffFile.oldPath === undefined ||
      diffFile.newPath === undefined ||
      diffFile.oldPath !== diffFile.newPath
    ) {
      continue;
    }
    const original = originalByPath.get(diffFile.oldPath);
    const destination = input.newFiles?.[diffFile.newPath];
    if (
      original !== undefined &&
      destination !== undefined &&
      destination.fileId !== original.fileId
    ) {
      throw new RangeError("Modified destination metadata must preserve the Global fileId.");
    }
  }
};

/**
 * Maps the owner-wide Global snapshot through conservative file transitions and
 * T203 interval mapping. Every retained file is advanced to the snapshot revision;
 * ordinary modified files invalidate only changed lines, while rename/add/copy/delete
 * semantics remain owned by the T204 transition engine.
 */
export function mapRepositoryGlobalStateThroughGitDiff(
  input: MapRepositoryGlobalStateThroughGitDiffInput
): RepositoryGlobalState {
  const parsed = parseZeroContextGitDiff(input.diff);
  assertModifiedDestinationIdentity(input, parsed);
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
        lineCount: inferredLineCount(file, input, parsed),
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

  const originalByPath = new Map(
    Object.values(input.globalState.files).map((file) => [file.currentPath, file])
  );
  for (const diffFile of parsed.files) {
    if (
      diffFile.isRename ||
      diffFile.oldPath === undefined ||
      diffFile.newPath === undefined ||
      diffFile.oldPath !== diffFile.newPath
    ) {
      continue;
    }
    const original = originalByPath.get(diffFile.oldPath);
    if (original === undefined) {
      continue;
    }
    const transitionedFile = transitioned.files[original.fileId];
    if (transitionedFile === undefined) {
      continue;
    }
    const mapped = mapReviewedIntervalsAcrossDiff({
      reviewed: original.reviewed,
      diff: input.diff,
      oldPath: diffFile.oldPath,
      newPath: diffFile.newPath,
      ...(input.oldTexts?.[diffFile.oldPath] === undefined
        ? {}
        : { oldText: input.oldTexts[diffFile.oldPath] }),
      ...(input.newFiles?.[diffFile.newPath]?.newText === undefined
        ? {}
        : { newText: input.newFiles[diffFile.newPath]?.newText }),
      options: input.options
    });
    transitioned.files[original.fileId] = {
      ...transitionedFile,
      revisionId: input.newRevisionId,
      modifiedReviewed: mapped.reviewed,
      ...(input.newFiles?.[diffFile.newPath]?.contentHash === undefined
        ? { contentHash: undefined }
        : { contentHash: input.newFiles[diffFile.newPath]?.contentHash }),
      updatedAt: input.updatedAt
    };
  }

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
          revisionId: input.newRevisionId,
          reviewed: file.modifiedReviewed.map((interval) => ({ ...interval })),
          ...(file.contentHash === undefined ? {} : { contentHash: file.contentHash }),
          updatedAt: file.updatedAt
        }
      ])
    ),
    updatedAt: input.updatedAt
  };
}

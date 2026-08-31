import { mapRepositoryGlobalStateThroughGitDiff } from "../global-review-mapping/index";
import {
  applyGitFileStateTransitions,
  mapReviewedIntervalsAcrossDiff,
  parseZeroContextGitDiff,
  type GitFileStateTransitionInput,
  type GitNewFileStateInput,
} from "../../core/git-diff/index";
import type { FileReviewState, GlobalFileReviewState } from "../../core/contracts/index";
import {
  captureImmutableRevisionSnapshots,
  restoreImmutableRevisionSnapshots,
  type ImmutableRevisionSnapshotEvidence
} from "../../core/review-state/index";
import type {
  PullRequestRevisionMapper,
  PullRequestRevisionMappingEvidence,
} from "./github-pull-request-context-layer-store";

export interface ImmutablePullRequestRevisionEvidence {
  readonly sourceBaseSha: string;
  readonly sourceHeadSha: string;
  readonly targetBaseSha: string;
  readonly targetHeadSha: string;
  readonly diff: string;
  readonly oldTexts: Readonly<Record<string, string>>;
  readonly newFiles: Readonly<Record<string, Readonly<GitNewFileStateInput>>>;
  readonly updatedAt?: string;
}

export type ImmutablePullRequestRevisionEvidenceLoader = (
  evidence: Readonly<PullRequestRevisionMappingEvidence>
) => Promise<ImmutablePullRequestRevisionEvidence>;

const DEFAULT_MAPPING_OPTIONS: GitFileStateTransitionInput["options"] = {
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: false,
};

const requireMatchingEvidence = (
  expected: Readonly<PullRequestRevisionMappingEvidence>,
  actual: Readonly<ImmutablePullRequestRevisionEvidence>,
  contextFiles: Readonly<Record<string, Readonly<FileReviewState>>>,
  globalFiles: Readonly<Record<string, Readonly<GlobalFileReviewState>>>
): void => {
  if (
    actual.sourceBaseSha !== expected.sourceBaseSha ||
    actual.sourceHeadSha !== expected.sourceHeadSha ||
    actual.targetBaseSha !== expected.targetBaseSha ||
    actual.targetHeadSha !== expected.targetHeadSha
  ) {
    throw new Error("Immutable PR revision evidence does not match the requested revision transition");
  }
  const baseOnlyTransition =
    expected.sourceHeadSha === expected.targetHeadSha &&
    expected.sourceBaseSha !== expected.targetBaseSha;
  if (actual.diff.length === 0 && !baseOnlyTransition) throw new Error("Immutable PR revision evidence requires a complete diff");

  const trackedPaths = new Set([
    ...Object.values(contextFiles).map((file) => file.currentPath),
    ...Object.values(globalFiles).map((file) => file.currentPath),
  ]);
  for (const changed of parseZeroContextGitDiff(actual.diff).files) {
    const touchesTracked =
      (changed.oldPath !== undefined && trackedPaths.has(changed.oldPath)) ||
      (changed.newPath !== undefined && trackedPaths.has(changed.newPath));
    if (!touchesTracked) continue;
    if (changed.oldPath !== undefined && actual.oldTexts[changed.oldPath] === undefined) {
      throw new Error(`Immutable PR revision evidence is missing old blob text for ${changed.oldPath}`);
    }
    if (changed.newPath !== undefined) {
      const destination = actual.newFiles[changed.newPath];
      if (destination === undefined || destination.newText === undefined) {
        throw new Error(`Immutable PR revision evidence is missing new blob text for ${changed.newPath}`);
      }
    }
  }
};

const advanceRetainedContextFiles = (
  files: Readonly<Record<string, Readonly<FileReviewState>>>,
  revisionId: string
): Record<string, FileReviewState> => Object.fromEntries(
  Object.entries(files).map(([fileId, file]) => [
    fileId,
    {
      ...file,
      revisionId,
      modifiedReviewed: file.modifiedReviewed.map((interval) => ({ ...interval })),
      originalReviewedByDiff: Object.fromEntries(
        Object.entries(file.originalReviewedByDiff).map(([diffId, intervals]) => [
          diffId,
          intervals.map((interval) => ({ ...interval })),
        ])
      ),
    },
  ])
);

const cloneGlobalState = (
  files: Readonly<Record<string, Readonly<GlobalFileReviewState>>>
): Record<string, GlobalFileReviewState> => Object.fromEntries(
  Object.entries(files).map(([fileId, file]) => [fileId, {
    ...file,
    reviewed: file.reviewed.map((interval) => ({ ...interval })),
  }])
);

const snapshotEvidence = (
  contextState: import("../../core/contracts/index").ReviewContextState,
  globalState: import("../../core/contracts/index").RepositoryGlobalState,
  revisionId: string,
  immutable: Readonly<ImmutablePullRequestRevisionEvidence>
): ImmutableRevisionSnapshotEvidence | undefined => {
  const context = contextState.revisionSnapshots?.[revisionId];
  const global = globalState.revisionSnapshots?.[revisionId];
  if (context === undefined && global === undefined) return undefined;
  return {
    revisionId,
    contextFiles: Object.fromEntries(Object.entries(context?.files ?? {}).map(([fileId, file]) => [fileId, {
      fileId: immutable.newFiles[file.currentPath]?.fileId ?? file.fileId,
      currentPath: file.currentPath,
      lineCount: immutable.newFiles[file.currentPath]?.lineCount ?? file.lineCount,
      contentHash: immutable.newFiles[file.currentPath]?.contentHash ?? file.contentHash
    }])),
    globalFiles: Object.fromEntries(Object.entries(global?.files ?? {}).map(([fileId, file]) => [fileId, {
      fileId: immutable.newFiles[file.currentPath]?.fileId ?? file.fileId,
      currentPath: file.currentPath,
      contentHash: immutable.newFiles[file.currentPath]?.contentHash ?? file.contentHash
    }]))
  };
};

export function createImmutablePullRequestRevisionMapper(
  loadEvidence: ImmutablePullRequestRevisionEvidenceLoader,
  options: GitFileStateTransitionInput["options"] = DEFAULT_MAPPING_OPTIONS
): PullRequestRevisionMapper {
  return async ({ current, nextPullRequest, evidence }) => {
    const source = captureImmutableRevisionSnapshots({
      contextState: current.contextState,
      globalState: current.globalState,
      revisionId: evidence.sourceHeadSha,
      updatedAt: current.contextState.updatedAt
    });
    const immutable = await loadEvidence(Object.freeze({ ...evidence }));
    requireMatchingEvidence(evidence, immutable, source.contextState.files, source.globalState.files);
    const targetEvidence = snapshotEvidence(source.contextState, source.globalState, evidence.targetHeadSha, immutable);
    const restored = targetEvidence === undefined
      ? undefined
      : restoreImmutableRevisionSnapshots({
        contextState: source.contextState,
        globalState: source.globalState,
        evidence: targetEvidence
      });
    if (restored?.context.kind === "hit" && restored.global.kind === "hit") {
      return {
        ...captureImmutableRevisionSnapshots({
          contextState: {
            ...source.contextState,
            pullRequest: { ...nextPullRequest },
            files: restored.context.files,
            updatedAt: source.contextState.updatedAt
          },
          globalState: {
            ...source.globalState,
            currentRevisionId: evidence.targetHeadSha,
            files: restored.global.files,
            updatedAt: source.globalState.updatedAt
          },
          revisionId: evidence.targetHeadSha,
          updatedAt: source.contextState.updatedAt
        }),
        mappingDisposition: "restored"
      };
    }
    const mappingDisposition = restored?.context.kind === "hit" || restored?.global.kind === "hit"
      ? "mixed"
      : "mapped";
    const updatedAt = immutable.updatedAt ?? new Date().toISOString();
    const baseOnlyTransition =
      evidence.sourceHeadSha === evidence.targetHeadSha &&
      evidence.sourceBaseSha !== evidence.targetBaseSha;
    if (baseOnlyTransition) {
      return {
        ...captureImmutableRevisionSnapshots({
          contextState: {
          ...source.contextState,
          pullRequest: { ...nextPullRequest },
          files: restored?.context.kind === "hit"
            ? restored.context.files
            : advanceRetainedContextFiles(source.contextState.files, evidence.targetHeadSha),
          updatedAt,
          },
          globalState: {
          ...source.globalState,
          currentRevisionId: evidence.targetHeadSha,
          files: restored?.global.kind === "hit" ? restored.global.files : cloneGlobalState(source.globalState.files),
          },
          revisionId: evidence.targetHeadSha,
          updatedAt
        }),
        mappingDisposition
      };
    }
    const parsed = parseZeroContextGitDiff(immutable.diff);

    const contextTransition = applyGitFileStateTransitions({
      files: source.contextState.files,
      diff: immutable.diff,
      newRevisionId: evidence.targetHeadSha,
      updatedAt,
      options,
      oldTexts: immutable.oldTexts,
      newFiles: immutable.newFiles,
    });
    if (contextTransition.unresolved.length > 0) {
      throw new Error(`Immutable PR revision mapping is unresolved: ${contextTransition.unresolved.map((item) => item.reason).join(", ")}`);
    }

    const contextFiles = advanceRetainedContextFiles(contextTransition.files, evidence.targetHeadSha);
    const originalByPath = new Map(
      Object.values(source.contextState.files).map((file) => [file.currentPath, file])
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
      const transitioned = contextFiles[original.fileId];
      const destination = immutable.newFiles[diffFile.newPath];
      if (transitioned === undefined || destination === undefined) {
        continue;
      }
      const mapped = mapReviewedIntervalsAcrossDiff({
        reviewed: original.modifiedReviewed,
        diff: immutable.diff,
        oldPath: diffFile.oldPath,
        newPath: diffFile.newPath,
        oldText: immutable.oldTexts[diffFile.oldPath],
        newText: destination.newText,
        options,
      });
      contextFiles[original.fileId] = {
        ...transitioned,
        revisionId: evidence.targetHeadSha,
        modifiedReviewed: mapped.reviewed,
        lineCount: destination.lineCount,
        ...(destination.contentHash === undefined
          ? { contentHash: undefined }
          : { contentHash: destination.contentHash }),
        updatedAt,
      };
    }

    const globalState = mapRepositoryGlobalStateThroughGitDiff({
      globalState: source.globalState,
      diff: immutable.diff,
      newRevisionId: evidence.targetHeadSha,
      updatedAt,
      options,
      oldTexts: immutable.oldTexts,
      newFiles: immutable.newFiles,
    });

    return {
      ...captureImmutableRevisionSnapshots({
      contextState: {
        ...source.contextState,
        pullRequest: { ...nextPullRequest },
        files: restored?.context.kind === "hit" ? restored.context.files : contextFiles,
        updatedAt,
      },
      globalState: restored?.global.kind === "hit" ? { ...globalState, files: restored.global.files } : globalState,
      revisionId: evidence.targetHeadSha,
      updatedAt
      }),
      mappingDisposition
    };
  };
}

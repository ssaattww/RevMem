import type {
  PullRequestDiffFileProgress,
  PullRequestDiffProgress
} from "../../src/core/pr-progress";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestEffectiveProgress,
  type PullRequestLineReviewability,
  type PullRequestProgressTreeDiffSide,
  type PullRequestProgressTreeDiffTarget,
  type PullRequestProgressTreeHost,
  type PullRequestProgressTreeSelectionResult,
  type PullRequestProgressTreeSnapshot
} from "../../src/ui/pr-progress";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const file = {
  fileId: "file-1",
  oldPath: undefined,
  newPath: "src/file.ts",
  status: "added",
  path: "src/file.ts",
  additions: 2,
  deletions: 0,
  reviewedLineCount: 0,
  totalLineCount: 2,
  progress: 0,
  excluded: false
} satisfies PullRequestDiffFileProgress;
const progress = {
  reviewedLineCount: 0,
  totalLineCount: 2,
  progress: 0,
  files: [file]
} satisfies PullRequestDiffProgress;
const reviewability = {
  kind: "unsupported",
  reason: { kind: "invalid-encoding", encoding: "UTF-8" }
} satisfies PullRequestLineReviewability;
const absentSide = {
  kind: "absent",
  filePath: "src/file.ts",
  revision: baseSha
} satisfies PullRequestProgressTreeDiffSide;
const presentSide = {
  kind: "present",
  filePath: "src/file.ts",
  revision: headSha
} satisfies PullRequestProgressTreeDiffSide;
const snapshot = {
  snapshotId: "snapshot-1",
  contextId: "github.com/owner/repository#1",
  baseSha,
  headSha,
  originalDiffId: `${baseSha}..${headSha}`,
  fileSystemPathSemantics: "posix",
  progress,
  lineReviewabilityByFileId: { "file-1": reviewability }
} satisfies PullRequestProgressTreeSnapshot;
const target = {
  snapshotId: snapshot.snapshotId,
  contextId: snapshot.contextId,
  baseSha,
  headSha,
  originalDiffId: snapshot.originalDiffId,
  fileSystemPathSemantics: snapshot.fileSystemPathSemantics,
  file,
  original: absentSide,
  modified: presentSide
} satisfies PullRequestProgressTreeDiffTarget;
const host: PullRequestProgressTreeHost = {
  openDiff: async (value) => {
    const exact: PullRequestProgressTreeDiffTarget = value;
    void exact.original;
  },
  openFile: async (value) => {
    const exact: PullRequestProgressTreeDiffTarget = value;
    void exact.modified;
  }
};
const provider = new PullRequestProgressTreeDataProvider(host);
provider.replaceSnapshot(snapshot);
const effectiveProgress: PullRequestEffectiveProgress = provider.getEffectiveProgress();
const selectionResult: Promise<PullRequestProgressTreeSelectionResult> = provider.select(
  provider.getChildren(
    provider.getChildren().find((node) =>
      node.kind === "category" && node.category === "line-review-unsupported"
    )
  )[0] as never
);

// @ts-expect-error Effective projection must not be assignable to the raw T301 contract.
const rawProgress: PullRequestDiffProgress = effectiveProgress;
// @ts-expect-error Snapshot identity is required for context-isolated selection.
const missingSnapshotIdentity: PullRequestProgressTreeSnapshot = {
  progress,
  lineReviewabilityByFileId: { "file-1": reviewability }
};
// @ts-expect-error Unknown line-review discriminants must be rejected.
const invalidReviewability: PullRequestLineReviewability = { kind: "future" };
// @ts-expect-error Unsupported reviewability requires an explicit reason.
const missingUnsupportedReason: PullRequestLineReviewability = { kind: "unsupported" };
// @ts-expect-error Absent sides still require immutable path and revision identity.
const invalidAbsentSide: PullRequestProgressTreeDiffSide = {
  kind: "absent",
  revision: baseSha
};

void [
  target.original,
  target.modified,
  effectiveProgress.files[0]?.raw.fileId,
  selectionResult,
  rawProgress,
  missingSnapshotIdentity,
  invalidReviewability,
  missingUnsupportedReason,
  invalidAbsentSide
];

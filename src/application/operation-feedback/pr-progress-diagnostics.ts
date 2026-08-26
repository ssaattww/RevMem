import type { OperationDiagnosticDetail } from "./issue-90-detailed-operation-feedback";

interface PullRequestProgressDiagnosticFile {
  readonly path: string;
  readonly status?: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly reviewedLineCount?: number;
  readonly totalLineCount: number;
  readonly excluded: boolean;
  readonly exclusionReason?: { readonly kind: string };
}

interface PullRequestProgressDiagnosticSummary {
  readonly snapshotFileCount: number;
  readonly files: readonly Pick<PullRequestProgressDiagnosticFile, "path" | "excluded" | "totalLineCount">[];
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
}

export const describePullRequestProgressFile = (
  file: PullRequestProgressDiagnosticFile,
): OperationDiagnosticDetail => {
  const reason = file.excluded
    ? `excluded:${file.exclusionReason?.kind ?? "unknown"}`
    : file.totalLineCount === 0
      ? "zero-changed-lines"
      : "included";
  return {
    reason,
    target: file.path,
    phase: `progress-file total=${file.totalLineCount} additions=${file.additions ?? 0} deletions=${file.deletions ?? 0}`,
  };
};

export const describePullRequestProgressSummary = (
  summary: PullRequestProgressDiagnosticSummary,
): OperationDiagnosticDetail => {
  const excluded = summary.files.filter((file) => file.excluded).length;
  const zeroFiles = summary.files.filter((file) => file.totalLineCount === 0).length;
  return {
    reason: summary.totalLineCount === 0 ? "zero-denominator" : "calculated",
    target: `snapshotFiles=${summary.snapshotFileCount} included=${summary.files.length - excluded} excluded=${excluded} zeroFiles=${zeroFiles} reviewed=${summary.reviewedLineCount} total=${summary.totalLineCount}`,
    phase: "progress-summary",
  };
};

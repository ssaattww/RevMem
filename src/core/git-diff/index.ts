export {
  parseZeroContextGitDiff,
  type GitDiffFile,
  type GitDiffHunk,
  type GitDiffIntervalMappingInput,
  type GitDiffIntervalMappingResult,
  type GitDiffMappingOptions,
  type ParsedGitDiff
} from "./git-diff-interval-mapping";
export { mapReviewedIntervalsAcrossDiff } from "./revision-interval-mapper";
export {
  type GitFileStateTransitionInput,
  type GitFileStateTransitionResult,
  type GitFileTransitionUnresolved,
  type GitFileTransitionUnresolvedReason,
  type GitNewFileStateInput
} from "./git-file-state-transition";
export { applyGitFileStateTransitions } from "./validated-git-file-state-transition";

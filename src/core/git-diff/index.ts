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
  applyGitFileStateTransitions,
  type GitFileStateTransitionInput,
  type GitFileStateTransitionResult,
  type GitFileTransitionUnresolved,
  type GitFileTransitionUnresolvedReason
} from "./git-file-state-transition";

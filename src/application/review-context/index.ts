/** Public application API for Git review context resolution, mapping, and monitoring. */
export { GitContextRevisionMapper } from "./history-rewrite-git-context-revision-mapper";
export { GitReviewContextResolver } from "./git-review-context-resolver";
export { PollingGitStateMonitor } from "./polling-git-state-monitor";
export { sameResourceUri } from "./selected-review-context";

export type {
  GitContextRevisionMapperOptions,
  GitContextRevisionMappingInput,
  GitContextRevisionMappingResult,
  GitHistoryRewriteRecoveryInput,
  GitHistoryRewriteRecoveryPort,
  GitHistoryRewriteRecoveryResult,
  GitReviewContextBranchRef,
  GitReviewContextBranchState,
  GitReviewContextDetachedHead,
  GitReviewContextRepositorySnapshot,
  GitReviewContextResolverOptions,
  GitRevisionMappingSource,
  GitRevisionMappingTextReadResult,
  GitStateChange,
  GitStateInspectionPort,
  GitStateInspectionResult,
  GitStateMonitorSchedule,
  GitStateMonitorScheduler,
  GitStateObserver,
  PollingGitStateMonitorOptions,
  ResolvedGitReviewContext,
  ResolvedGitReviewContextKind
} from "./contracts";

export type { SelectedReviewContext } from "./selected-review-context";

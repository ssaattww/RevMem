/** Workspace fallback state-session adapter for normal-editor commands. */
export {
  WorkspaceReviewStateSessionProvider,
  type WorkspaceEditorReviewDescriptor,
  type WorkspaceNormalEditorDecorationState,
  type WorkspaceNormalEditorReviewStateSession,
  type SnapshotAwareWorkspaceReviewStateSessionProviderPort,
  type WorkspaceReviewStateRepository,
  type WorkspaceReviewStateSessionProviderPort,
  type WorkspaceReviewStateSessionProviderOptions,
  isSnapshotAwareWorkspaceReviewStateSessionProvider
} from "./workspace-review-state-session-provider";
export {
  SnapshotTrackingWorkspaceReviewStateSessionProvider,
  type SnapshotTrackingWorkspaceReviewStateSessionProviderOptions,
} from "./snapshot-tracking-workspace-review-state-session-provider";
export {
  WorkspaceRootRuntimeRegistry,
  createWorkspaceRootRuntimeRegistry,
  type WorkspaceRootRuntime,
  type WorkspaceRootRuntimeFactory,
  type WorkspaceRootRuntimeRegistryOptions
} from "./workspace-root-runtime-registry";

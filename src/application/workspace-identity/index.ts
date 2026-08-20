/** Public application API for stable non-Git workspace identity resolution. */
export {
  WorkspaceIdentityService,
  resolveWorkspaceResourceEligibility,
  resolveWorkspaceFolderMembership,
  type FileSystemPathSemantics,
  type ResourceUri,
  type StableHash,
  type WorkspaceFolderDescriptor,
  type WorkspaceFolderMembership,
  type WorkspaceResourceEligibility,
  type WorkspaceIdentity,
  type WorkspaceIdentityInput
} from "./workspace-identity-service";

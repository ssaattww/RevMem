/** Complete immutable HEAD-side text used to seed Global opened-file evidence. */
export interface PullRequestGlobalHeadFile {
  readonly path: string;
  readonly revisionId: string;
  readonly content: string;
}

/** Exact PR/head request made only when that PR is the active Global context. */
export interface PullRequestGlobalHeadFileRequest {
  readonly contextId: string;
  readonly headRevision: string;
  readonly candidatePaths: ReadonlySet<string>;
}

export type PullRequestGlobalHeadFileProvider = (
  request: Readonly<PullRequestGlobalHeadFileRequest>
) => Promise<readonly PullRequestGlobalHeadFile[]>;

const providers = new Map<string, PullRequestGlobalHeadFileProvider>();

/**
 * Registers a lazy provider without reading any PR file content. The caller
 * decides when a PR becomes active; replacing the same context is atomic.
 */
export const registerPullRequestGlobalHeadFileProvider = (
  contextId: string,
  provider: PullRequestGlobalHeadFileProvider
): (() => void) => {
  if (contextId.trim().length === 0) throw new TypeError("PR Global provider contextId must not be empty");
  providers.set(contextId, provider);
  return () => {
    if (providers.get(contextId) === provider) providers.delete(contextId);
  };
};

/** Returns no evidence when the active PR has not been acquired/registered. */
export const readRegisteredPullRequestGlobalHeadFiles = async (
  request: Readonly<PullRequestGlobalHeadFileRequest>
): Promise<readonly PullRequestGlobalHeadFile[]> => {
  const provider = providers.get(request.contextId);
  return provider === undefined ? [] : provider(request);
};

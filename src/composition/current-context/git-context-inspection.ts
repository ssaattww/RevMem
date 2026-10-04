import type {
  LocalGitAdapter,
  LocalGitRepository,
  LocalGitRepositoryInspection
} from "../../adapters/local-git/index";
import { gitInspectionStartPath } from "../../adapters/local-git/index";
import { isCandidateStatEnoent } from "../../application/review-context/repository-resolution";
import type { CurrentContextUiSnapshot } from "../../ui/current-context/index";

/** Inspects a filesystem-backed editor from its parent directory. */
export const inspectCurrentContextDocument = async (
  git: Pick<LocalGitAdapter, "inspectRepository">,
  documentFsPath: string
): Promise<LocalGitRepositoryInspection | undefined> => {
  const inspectionStartPath = gitInspectionStartPath(documentFsPath);
  try {
    return await git.inspectRepository(inspectionStartPath);
  } catch (error) {
    if (isCandidateStatEnoent(error, inspectionStartPath)) return undefined;
    throw error;
  }
};

/** Applies the three-state Git inspection policy for workspace fallback candidates. */
export const isNonGitCurrentContextWorkspace = async (
  git: Pick<LocalGitAdapter, "inspectRepository">,
  workspaceFsPath: string
): Promise<boolean> => {
  let inspection: LocalGitRepositoryInspection;
  try {
    inspection = await git.inspectRepository(workspaceFsPath);
  } catch (error) {
    if (isCandidateStatEnoent(error, workspaceFsPath)) return false;
    throw error;
  }
  switch (inspection.kind) {
    case "repository":
      return false;
    case "not-repository":
    case "git-unavailable":
      return true;
  }
};

/** Projects a resolved Git repository into the Current Context candidate consumed by the runtime. */
export const gitCurrentContextSnapshot = (
  repository: LocalGitRepository,
  pullRequestSynchronizationRevision?: string
): CurrentContextUiSnapshot => ({
  context: {
    kind: "branch",
    label: repository.branch.kind === "branch"
      ? repository.branch.fullRef.replace(/^refs\/heads\//u, "")
      : repository.head === undefined
        ? "detached"
        : repository.head.slice(0, 12),
    detail: repository.rootPath,
    headRevision: repository.head,
    ...(repository.branch.kind === "branch" && pullRequestSynchronizationRevision !== undefined
      ? { pullRequestSynchronizationRevision }
      : {}),
    selection: repository.branch.kind === "branch"
      ? {
          kind: "branch",
          repositoryId: repository.repositoryId,
          repositoryRoot: repository.rootPath,
          branchRef: repository.branch.fullRef
        }
      : repository.head === undefined
        ? undefined
        : {
            kind: "detached",
            repositoryId: repository.repositoryId,
            repositoryRoot: repository.rootPath,
            headRevision: repository.head
          }
  },
  progress: undefined
});

/** Resolves safe Current Context fallbacks after a selected repository disappears or the editor moves. */
export const resolveMissingRepositoryFallback = (input: {
  readonly candidates: readonly CurrentContextUiSnapshot[];
  readonly activeRepositoryRoot?: string;
  readonly selectedRepositoryRoot?: string;
  readonly activeDocumentPath?: string;
  readonly activeWorkspaceCandidate?: CurrentContextUiSnapshot;
}): CurrentContextUiSnapshot | { readonly kind: "unresolved" } | undefined => {
  const matchingRoot = (root: string): CurrentContextUiSnapshot | undefined => input.candidates.find((candidate) =>
    candidate.context.selection?.kind === "pull-request" && candidate.context.selection.repositoryRoot === root
  ) ?? input.candidates.find((candidate) => candidate.context.kind === "branch" && candidate.context.detail === root);
  if (input.activeRepositoryRoot !== undefined) return matchingRoot(input.activeRepositoryRoot);
  if (input.activeWorkspaceCandidate !== undefined) return input.activeWorkspaceCandidate;
  if (input.selectedRepositoryRoot === undefined) return undefined;

  const editorPath = input.activeDocumentPath;
  const selectedRelative = editorPath === undefined
    ? undefined
    : path.relative(path.resolve(input.selectedRepositoryRoot), path.resolve(editorPath));
  const withinSelectedRoot = selectedRelative === undefined || selectedRelative.length === 0 ||
    (selectedRelative !== ".." && !selectedRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(selectedRelative));
  if (!withinSelectedRoot) return undefined;

  const retained = matchingRoot(input.selectedRepositoryRoot);
  if (retained !== undefined) return retained;
  if (editorPath !== undefined) {
    const belongsToSurvivingRepository = input.candidates.some((candidate) => {
      const root = candidate.context.selection?.kind === "pull-request"
        ? candidate.context.selection.repositoryRoot
        : candidate.context.kind === "branch"
          ? candidate.context.detail
          : undefined;
      if (root === undefined) return false;
      const relative = path.relative(path.resolve(root), path.resolve(editorPath));
      return relative.length === 0 || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    });
    if (belongsToSurvivingRepository) return { kind: "unresolved" };
    if (input.candidates.length === 1) return input.candidates[0];
  }
  return { kind: "unresolved" };
};
import path from "node:path";

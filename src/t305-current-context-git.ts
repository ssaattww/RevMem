import type {
  LocalGitAdapter,
  LocalGitRepository,
  LocalGitRepositoryInspection
} from "./adapters/local-git/index";
import { gitInspectionStartPath } from "./adapters/local-git/index";
import type { CurrentContextUiSnapshot } from "./ui/current-context/index";

/** Inspects a filesystem-backed editor from its parent directory. */
export const inspectCurrentContextDocument = (
  git: Pick<LocalGitAdapter, "inspectRepository">,
  documentFsPath: string
): Promise<LocalGitRepositoryInspection> =>
  git.inspectRepository(gitInspectionStartPath(documentFsPath));

/** Applies the three-state Git inspection policy for workspace fallback candidates. */
export const isNonGitCurrentContextWorkspace = async (
  git: Pick<LocalGitAdapter, "inspectRepository">,
  workspaceFsPath: string
): Promise<boolean> => {
  const inspection = await git.inspectRepository(workspaceFsPath);
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
  repository: LocalGitRepository
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

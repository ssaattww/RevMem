import type { CurrentContextUiSnapshot } from "./ui/current-context/index";

/** Returns one repository root only when the current workspace has an unambiguous root owner. */
export const resolveUniqueRepositoryRoot = (
  roots: Iterable<string>
): string | undefined => {
  const uniqueRoots = new Set(roots);
  return uniqueRoots.size === 1 ? uniqueRoots.values().next().value : undefined;
};

/** Keeps same-repository workspace roots distinct for Current Context and PR acquisition source selection. */
export const currentContextCandidateKey = (
  snapshot: CurrentContextUiSnapshot
): string => {
  const selection = snapshot.context.selection;
  if (selection?.kind === "pull-request") return `pr\0${selection.repositoryRoot}\0${selection.contextId}`;
  if (selection?.kind === "branch") return `branch\0${selection.repositoryRoot}\0${selection.repositoryId}\0${selection.branchRef}`;
  if (selection?.kind === "detached") return `detached\0${selection.repositoryRoot}\0${selection.repositoryId}\0${selection.headRevision}`;
  if (selection?.kind === "workspace") return `workspace\0${JSON.stringify(selection.workspaceFolderUri)}`;
  return `${snapshot.context.kind}\0${snapshot.context.detail ?? ""}\0${snapshot.context.label}`;
};

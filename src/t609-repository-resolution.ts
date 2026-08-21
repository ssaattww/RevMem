/** Current Context候補化に必要な最小のGit repository観測結果。 */
export type RepositoryResolutionInspection =
  | {
      readonly kind: "repository";
      readonly repository: {
        readonly rootPath: string;
        readonly repositoryId: string;
      };
    }
  | { readonly kind: "not-repository" }
  | { readonly kind: "git-unavailable" };

/** Repository候補を得た決定的な入力経路。 */
export type RepositoryResolutionSource =
  | "active-document"
  | "opened-document"
  | "known-root"
  | "workspace-folder";

/** Current Context候補へ渡す検証済みrepository root。 */
export interface ResolvedRepositoryCandidate {
  /** Local Git inspectionで再検証済みのrepository。 */
  readonly repository: Extract<RepositoryResolutionInspection, { readonly kind: "repository" }> ["repository"];
  /** 最初にrepositoryを確認できた入力経路。 */
  readonly source: RepositoryResolutionSource;
}

/** Active editor非依存のCurrent Context repository候補収集入力。 */
export interface CurrentContextRepositoryResolutionInput {
  /** Active documentのworkspace-side filesystem path。unsafe URIは渡さない。 */
  readonly activeDocumentPath?: string;
  /** 開いているfilesystem-backed documentのworkspace-side filesystem path。 */
  readonly openedDocumentPaths: readonly (string | undefined)[];
  /** 同一Extension Hostで以前に検証されたroot。毎回再検証する。 */
  readonly knownRootPaths: readonly (string | undefined)[];
  /** 開かれているworkspace folderのworkspace-side filesystem path。 */
  readonly workspaceFolderPaths: readonly (string | undefined)[];
  /** Git inspection境界。 */
  readonly inspectRepository: (path: string) => Promise<RepositoryResolutionInspection>;
}

const nonEmpty = (path: string | undefined): path is string =>
  path !== undefined && path.length > 0 && !path.includes("\0");

/**
 * Collects validated repositories without relying on an active Git editor.
 *
 * Candidates retain their first successful source and are de-duplicated by the
 * canonical root returned from Git. Missing, stale, and unsafe caller inputs
 * produce no candidate and are never substituted with a guessed root.
 */
export const resolveCurrentContextRepositories = async (
  input: CurrentContextRepositoryResolutionInput
): Promise<readonly ResolvedRepositoryCandidate[]> => {
  const ordered: Array<readonly [RepositoryResolutionSource, readonly (string | undefined)[]]> = [
    ["active-document", [input.activeDocumentPath]],
    ["opened-document", input.openedDocumentPaths],
    ["known-root", input.knownRootPaths],
    ["workspace-folder", input.workspaceFolderPaths]
  ];
  const candidates: ResolvedRepositoryCandidate[] = [];
  const roots = new Set<string>();
  for (const [source, paths] of ordered) {
    for (const path of paths) {
      if (!nonEmpty(path)) continue;
      const inspection = await input.inspectRepository(path);
      if (inspection.kind !== "repository" || roots.has(inspection.repository.rootPath)) {
        continue;
      }
      roots.add(inspection.repository.rootPath);
      candidates.push({ repository: inspection.repository, source });
    }
  }
  return candidates;
};

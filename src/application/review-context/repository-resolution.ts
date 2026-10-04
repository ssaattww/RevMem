import path from "node:path";

/** Current Context候補化に必要な最小のGit repository観測結果。 */
export type RepositoryResolutionInspection =
  | {
      readonly kind: "repository";
      readonly repository: {
        readonly rootPath: string;
        readonly repositoryId: string;
      };
      readonly canonicalInspectionStartPath?: string;
      readonly canonicalRepositoryRootPath?: string;
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

/** Minimal VS Code URI boundary shared by T305 and T405 before `fsPath` is trusted. */
export interface WorkspaceFilesystemUri {
  readonly scheme: string;
  readonly authority: string;
  readonly fsPath: string;
  readonly query: string;
  readonly fragment: string;
}

const normalizedPath = (value: string): string => value.replace(/[\\/]+/gu, "/").replace(/\/$/u, "");

const isWithinRemoteWorkspace = (
  uri: WorkspaceFilesystemUri,
  workspaceUris: readonly WorkspaceFilesystemUri[]
): boolean => {
  const candidate = normalizedPath(uri.fsPath);
  return workspaceUris.some((workspace) => {
    if (workspace.scheme !== "vscode-remote" || workspace.authority !== uri.authority) return false;
    const root = normalizedPath(workspace.fsPath);
    return candidate === root || candidate.startsWith(`${root}/`);
  });
};

/** Converts only an unambiguous local or workspace-contained remote URI to an OS path. */
export const workspaceUriToFilesystemPath = (
  uri: WorkspaceFilesystemUri,
  workspaceUris: readonly WorkspaceFilesystemUri[] = []
): string | undefined => {
  if (uri.query.length > 0 || uri.fragment.length > 0 || uri.fsPath.length === 0 || uri.fsPath.includes("\0")) return undefined;
  if (uri.scheme === "file") return uri.authority.length === 0 ? uri.fsPath : undefined;
  return uri.scheme === "vscode-remote" && uri.authority.length > 0 && isWithinRemoteWorkspace(uri, workspaceUris)
    ? uri.fsPath
    : undefined;
};

const nonEmpty = (path: string | undefined): path is string =>
  path !== undefined && path.length > 0 && !path.includes("\0");

const filesystemPath = (value: string): typeof path.posix =>
  value.startsWith("/")
    ? path.posix
    : /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\")
      ? path.win32
      : path.posix;

const isStrictAncestor = (ancestor: string, descendant: string): boolean => {
  const semantics = filesystemPath(ancestor);
  const relative = semantics.relative(semantics.resolve(ancestor), semantics.resolve(descendant));
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${semantics.sep}`) && !semantics.isAbsolute(relative);
};

const sameFilesystemPath = (left: string, right: string): boolean => {
  const semantics = filesystemPath(left);
  const resolvedLeft = semantics.resolve(left);
  const resolvedRight = semantics.resolve(right);
  return semantics === path.win32
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
};

const isAtOrBelow = (candidate: string, boundary: string): boolean =>
  sameFilesystemPath(candidate, boundary) || isStrictAncestor(boundary, candidate);

const isKnownRootInspection = (
  candidate: string,
  inspection: Extract<RepositoryResolutionInspection, { readonly kind: "repository" }>
): boolean => {
  if (sameFilesystemPath(candidate, inspection.repository.rootPath)) return true;
  return nonEmpty(inspection.canonicalInspectionStartPath) &&
    nonEmpty(inspection.canonicalRepositoryRootPath) &&
    sameFilesystemPath(
      inspection.canonicalInspectionStartPath,
      inspection.canonicalRepositoryRootPath
    );
};

export const isCandidateStatEnoent = (error: unknown, candidate: string): boolean => {
  if (!(error instanceof Error)) return false;
  const value = error as { readonly code?: unknown; readonly syscall?: unknown; readonly path?: unknown };
  return value.code === "ENOENT" && value.syscall === "stat" &&
    typeof value.path === "string" && sameFilesystemPath(candidate, value.path);
};

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
  // This map belongs to exactly one resolution call (one Current Context
  // generation). It shares only an identical inspection start path, plus a
  // canonical root returned by an earlier inspection. It deliberately never
  // treats an arbitrary descendant as inspected just because a sibling found
  // the same root.
  const inspections = new Map<string, Promise<RepositoryResolutionInspection>>();
  const inspect = (startPath: string): Promise<RepositoryResolutionInspection> => {
    const existing = inspections.get(startPath);
    if (existing !== undefined) return existing;
    const pending = input.inspectRepository(startPath).then((inspection) => {
      if (inspection.kind === "repository") {
        inspections.set(inspection.repository.rootPath, Promise.resolve(inspection));
      }
      return inspection;
    });
    inspections.set(startPath, pending);
    // A failed inspection is never a reusable result, even within a later
    // independent resolution call.
    void pending.catch(() => {
      if (inspections.get(startPath) === pending) inspections.delete(startPath);
    });
    return pending;
  };
  const boundaries = input.knownRootPaths.filter(nonEmpty);
  const documentIsOutsideBoundary = (documentPath: string, repositoryRoot: string): boolean => {
    const matchingBoundaries = boundaries.filter((boundary) => isAtOrBelow(documentPath, boundary));
    const deepestBoundaries = matchingBoundaries.filter((boundary) =>
      !matchingBoundaries.some((other) => isStrictAncestor(boundary, other)));
    return deepestBoundaries.some((boundary) => isStrictAncestor(repositoryRoot, boundary));
  };
  const inspectCandidate = async (candidate: string): Promise<RepositoryResolutionInspection | undefined> => {
    try {
      return await inspect(candidate);
    } catch (error) {
      if (isCandidateStatEnoent(error, candidate)) return undefined;
      throw error;
    }
  };
  const inspectDocument = async (candidate: string): Promise<RepositoryResolutionInspection | undefined> => {
    const semantics = filesystemPath(candidate);
    return inspectCandidate(semantics.dirname(candidate));
  };
  for (const [source, paths] of ordered) {
    for (const path of paths) {
      if (!nonEmpty(path)) continue;
      const isDocument = source === "active-document" || source === "opened-document";
      const inspection = isDocument
        ? await inspectDocument(path)
        : await inspectCandidate(path);
      if (inspection === undefined) continue;
      if (source === "known-root" && inspection.kind === "repository" &&
        !isKnownRootInspection(path, inspection)) continue;
      if ((source === "active-document" || source === "opened-document") &&
        inspection.kind === "repository" && documentIsOutsideBoundary(path, inspection.repository.rootPath)) continue;
      if (inspection.kind !== "repository" || roots.has(inspection.repository.rootPath)) {
        continue;
      }
      roots.add(inspection.repository.rootPath);
      candidates.push({ repository: inspection.repository, source });
    }
  }
  return candidates;
};

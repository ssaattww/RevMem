import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewState,
  type GlobalFileReviewState,
  type ReviewContextState
} from "../../core/contracts/index";
import {
  applyGitFileStateTransitions,
  mapReviewedIntervalsAcrossDiff,
  parseZeroContextGitDiff,
  type GitDiffFile,
  type GitDiffMappingOptions,
  type GitNewFileStateInput
} from "../../core/git-diff/index";
import type { FileSystemPathSemantics } from "../workspace-identity/index";
import type {
  GitContextRevisionMapperOptions,
  GitContextRevisionMappingInput,
  GitContextRevisionMappingResult
} from "./contracts";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const lineCountOf = (content: string): number =>
  content.split(/\r\n|\r|\n/u).length;

const physicalLineCountOf = (content: string): number =>
  content.length === 0
    ? 0
    : content.split(/\r\n|\r|\n/u).length - Number(/\r\n|\r|\n$/u.test(content));

const contextRevision = (state: ReviewContextState): string => {
  if (state.kind !== "branch" || state.branch === undefined) {
    throw new Error("Git revision mapping requires a persisted branch context.");
  }
  return state.branch.headRevision;
};

const unique = (values: readonly (string | undefined)[]): string[] =>
  [...new Set(values.filter((value): value is string => value !== undefined))];

/**
 * Carries an observed encoding only across an explicit one-to-one rename.
 * Copies, additions, ambiguous metadata, and paths that were not opened do
 * not receive a hint.  This keeps a transient VS Code observation local to
 * the file identity which proved its rename.
 */
const inheritUniqueRenameEncodingHints = (
  rawDiff: string,
  hints: Readonly<Record<string, string>>
): Readonly<Record<string, string>> => {
  const inherited: Record<string, string> = { ...hints };
  const pairs: Array<readonly [string, string]> = [];
  for (const section of rawDiff.split(/^diff --git /mu).slice(1)) {
    if (/^copy (?:from|to) /mu.test(section)) continue;
    const from = /^rename from (.+)$/mu.exec(section)?.[1];
    const to = /^rename to (.+)$/mu.exec(section)?.[1];
    if (from !== undefined && to !== undefined) pairs.push([from, to]);
  }
  for (const [from, to] of pairs) {
    if (pairs.filter(([candidate]) => candidate === from).length !== 1 ||
        pairs.filter(([, candidate]) => candidate === to).length !== 1 ||
        hints[to] === undefined) {
      continue;
    }
    inherited[from] = hints[to] as string;
  }
  return inherited;
};

const isBinaryDiffSection = (lines: readonly string[]): boolean =>
  lines.some((line) =>
    line.startsWith("Binary files ") || line === "GIT binary patch"
  );

const stripDiffPrefix = (path: string): string | undefined =>
  path === "/dev/null"
    ? undefined
    : (path.startsWith("a/") || path.startsWith("b/"))
      ? path.slice(2)
      : path;

const binaryModePath = (section: readonly string[]): string | undefined => {
  const line = section.find((candidate) => candidate.startsWith("Binary files "));
  if (line === undefined || !line.endsWith(" differ")) {
    return undefined;
  }
  const body = line.slice("Binary files ".length, -" differ".length);
  if (section.some((candidate) => candidate.startsWith("new file mode "))) {
    const prefix = "/dev/null and b/";
    return body.startsWith(prefix) ? stripDiffPrefix(body.slice(prefix.length - 2)) : undefined;
  }
  if (section.some((candidate) => candidate.startsWith("deleted file mode "))) {
    const suffix = " and /dev/null";
    return body.endsWith(suffix) ? stripDiffPrefix(body.slice(0, -suffix.length)) : undefined;
  }
  return undefined;
};

const ambiguousHeaderCandidatePaths = (header: string): readonly string[] => {
  const prefix = "diff --git a/";
  if (!header.startsWith(prefix)) {
    return [];
  }
  const candidates = new Set<string>();
  for (let separator = header.indexOf(" b/", prefix.length);
    separator !== -1;
    separator = header.indexOf(" b/", separator + 1)) {
    candidates.add(header.slice(prefix.length, separator));
    candidates.add(header.slice(separator + 3));
  }
  return [...candidates];
};

interface BinaryDiffResolution {
  readonly destinationPaths: ReadonlySet<string>;
  readonly unresolvedPaths: ReadonlySet<string>;
  readonly resolvedSections: ReadonlyMap<number, string>;
}

/** Keeps complete text diff sections while excluding files outside line review. */
const reviewableDiff = (diff: string): string => {
  if (typeof diff !== "string") {
    throw new TypeError("diff must be a string.");
  }
  const sections: string[][] = [];
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      sections.push([line]);
    } else if (sections.length > 0) {
      sections.at(-1)?.push(line);
    } else if (line.length > 0) {
      throw new SyntaxError("Diff content must begin with a diff --git header.");
    }
  }
  return sections
    .filter((section) => !isBinaryDiffSection(section))
    .map((section) => section.join("\n"))
    .join("\n");
};

/** Adds file headers required by the transition validator for binary additions and deletions. */
const fileTransitionDiff = (
  diff: string,
  binaryResolution: Readonly<BinaryDiffResolution>
): string => {
  const sections: string[][] = [];
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      sections.push([line]);
    } else if (sections.length > 0) {
      sections.at(-1)?.push(line);
    }
  }
  return sections.map((section, index) => {
    if (!isBinaryDiffSection(section) || section.some((line) => line.startsWith("--- "))) {
      return section.join("\n");
    }
    const resolvedPath = binaryResolution.resolvedSections.get(index);
    if (resolvedPath === undefined) {
      return "";
    }
    const isNewFile = section.some((line) => line.startsWith("new file mode "));
    const isDeletedFile = section.some((line) => line.startsWith("deleted file mode "));
    if (!isNewFile && !isDeletedFile) {
      return section.join("\n");
    }
    if (isNewFile) {
      return [...section, "--- /dev/null", `+++ b/${resolvedPath}`].join("\n");
    }
    if (isDeletedFile) {
      return [...section, `--- a/${resolvedPath}`, "+++ /dev/null"].join("\n");
    }
    return section.join("\n");
  }).join("\n");
};

/** Resolves binary destinations per section and records possible paths when syntax remains ambiguous. */
const resolveBinarySections = (diff: string): BinaryDiffResolution => {
  const destinationPaths = new Set<string>();
  const unresolvedPaths = new Set<string>();
  const resolvedSections = new Map<number, string>();
  const sections: string[][] = [];
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      sections.push([line]);
    } else if (sections.length > 0) {
      sections.at(-1)?.push(line);
    }
  }
  for (const [index, section] of sections.entries()) {
    if (!isBinaryDiffSection(section)) {
      continue;
    }
    try {
      const destination = copyAwareParsedFiles(section.join("\n"))[0]?.newPath;
      if (destination !== undefined) {
        destinationPaths.add(destination);
        resolvedSections.set(index, destination);
        continue;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }
    const modePath = binaryModePath(section);
    if (modePath !== undefined) {
      destinationPaths.add(modePath);
      resolvedSections.set(index, modePath);
      continue;
    }
    for (const path of ambiguousHeaderCandidatePaths(section[0] as string)) {
      unresolvedPaths.add(path);
    }
  }
  return { destinationPaths, unresolvedPaths, resolvedSections };
};

const copyAwareParsedFiles = (diff: string): readonly GitDiffFile[] =>
  parseZeroContextGitDiff(
    diff
      .replace(/^copy from /gmu, "rename from ")
      .replace(/^copy to /gmu, "rename to ")
  ).files;

/** Maps complete context and Global snapshots between immutable Git revisions. */
export class GitContextRevisionMapper {
  private readonly now: () => Date;

  /** Creates a mapper using local immutable content and complete repository diffs. */
  public constructor(
    private readonly options: GitContextRevisionMapperOptions
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Advances both persisted snapshots to `input.current.revisionId`.
   *
   * T204 applies rename/copy/add/delete transitions and T203 maps ordinary
   * same-path modifications. When an old object is unavailable, surviving
   * paths are retained only as unreviewed state.
   */
  public async map(
    input: GitContextRevisionMappingInput
  ): Promise<GitContextRevisionMappingResult> {
    this.validateInput(input);
    const occurredAt = this.now().toISOString();
    const newRevision = input.current.revisionId;
    const oldContextRevision = contextRevision(input.contextState);
    const oldGlobalRevision = input.globalState.currentRevisionId;
    const oldObjectAvailable = FULL_OBJECT_ID_PATTERN.test(oldContextRevision) &&
      await this.options.source.objectExists(input.current.repositoryRoot, oldContextRevision);

    const contextMapping = await this.mapContextFiles(
      input.contextState.files,
      input.current.repositoryId,
      oldContextRevision,
      newRevision,
      input.current.repositoryRoot,
      input.fileSystemPathSemantics,
      input.options,
      occurredAt,
      input.encodingHintsByPath
    );
    const globalFiles = await this.mapGlobalFiles(
      input.globalState.files,
      input.current.repositoryId,
      oldGlobalRevision,
      newRevision,
      input.current.repositoryRoot,
      input.fileSystemPathSemantics,
      input.options,
      occurredAt,
      input.encodingHintsByPath
    );

    const unresolvedFileIds = oldObjectAvailable
      ? contextMapping.unresolvedFileIds
      : Object.keys(input.contextState.files).sort();
    return {
      contextState: {
        ...clone(input.contextState),
        displayName: input.current.contextState.displayName,
        branch: clone(input.current.contextState.branch),
        files: contextMapping.files,
        updatedAt: occurredAt
      },
      globalState: {
        ...clone(input.globalState),
        currentRevisionId: newRevision,
        files: globalFiles,
        updatedAt: occurredAt
      },
      unresolvedFileIds,
      unresolvedReasonsByFileId: oldObjectAvailable
        ? contextMapping.unresolvedReasonsByFileId
        : Object.fromEntries(unresolvedFileIds.map((fileId) => [fileId, "mapping-unresolved" as const]))
    };
  }

  private validateInput(input: GitContextRevisionMappingInput): void {
    if (
      input.contextState.contextId !== input.current.contextId ||
      input.contextState.repositoryId !== input.current.repositoryId ||
      input.globalState.repositoryId !== input.current.repositoryId
    ) {
      throw new Error("Git context mapping identities must match the current context.");
    }
    if (
      input.contextState.kind !== "branch" ||
      input.current.contextState.kind !== "branch"
    ) {
      throw new Error("Git context mapping requires branch-schema persistence.");
    }
    if (
      typeof input.options.ignoreWhitespaceChanges !== "boolean" ||
      typeof input.options.ignoreEolChanges !== "boolean"
    ) {
      throw new TypeError("Git mapping options must be booleans.");
    }
  }

  private async mapContextFiles(
    files: Readonly<Record<string, FileReviewState>>,
    repositoryId: string,
    oldRevision: string,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    options: Readonly<GitDiffMappingOptions>,
    occurredAt: string,
    encodingHints: Readonly<Record<string, string>> = {}
  ): Promise<{
    readonly files: Record<string, FileReviewState>;
    readonly unresolvedFileIds: readonly string[];
    readonly unresolvedReasonsByFileId: Readonly<Record<string, "immutable-text-unavailable" | "mapping-unresolved">>;
  }> {
    if (oldRevision === newRevision) {
      if (Object.keys(encodingHints).length === 0) {
        return { files: clone(files), unresolvedFileIds: [], unresolvedReasonsByFileId: {} };
      }
      const refreshed = await this.refreshMappedFiles(
        files, newRevision, repositoryRoot, semantics, occurredAt, new Set(), new Set(), encodingHints
      );
      const unresolvedFileIds = Object.values(files)
        .filter((file) => !Object.hasOwn(refreshed, file.fileId))
        .map((file) => file.fileId).sort();
      return {
        files: refreshed,
        unresolvedFileIds,
        unresolvedReasonsByFileId: Object.fromEntries(
          unresolvedFileIds.map((fileId) => [fileId, "immutable-text-unavailable" as const])
        )
      };
    }
    if (!FULL_OBJECT_ID_PATTERN.test(newRevision)) {
      const unresolvedFileIds = Object.keys(files).sort();
      return { files: {}, unresolvedFileIds, unresolvedReasonsByFileId: Object.fromEntries(unresolvedFileIds.map((fileId) => [fileId, "mapping-unresolved" as const])) };
    }
    const oldExists = FULL_OBJECT_ID_PATTERN.test(oldRevision) &&
      await this.options.source.objectExists(repositoryRoot, oldRevision);
    if (!oldExists) {
      return {
        files: await this.clearAndRefresh(
          files,
          newRevision,
          repositoryRoot,
          semantics,
          occurredAt,
          encodingHints
        ),
        unresolvedFileIds: Object.keys(files).sort(),
        unresolvedReasonsByFileId: Object.fromEntries(Object.keys(files).map((fileId) => [fileId, "mapping-unresolved" as const]))
      };
    }

    const rawDiff = await this.options.source.diffRevisions(
      repositoryRoot,
      oldRevision,
      newRevision
    );
    const effectiveEncodingHints = inheritUniqueRenameEncodingHints(rawDiff, encodingHints);
    const diff = reviewableDiff(rawDiff);
    const binaryResolution = resolveBinarySections(rawDiff);
    const transitionDiff = fileTransitionDiff(rawDiff, binaryResolution);
    const parsedFiles = parseZeroContextGitDiff(diff).files;
    const oldTexts = await this.loadOldTextsWhenRequired(
      Object.values(files),
      oldRevision,
      repositoryRoot,
      semantics,
      options,
      effectiveEncodingHints
    );
    const newFiles = await this.loadNewFileMetadata(
      transitionDiff,
      files,
      repositoryId,
      newRevision,
      repositoryRoot,
      semantics,
      binaryResolution.destinationPaths,
      effectiveEncodingHints
    );
    const transitioned = applyGitFileStateTransitions({
      files,
      diff: transitionDiff,
      newRevisionId: newRevision,
      updatedAt: occurredAt,
      options,
      ...(oldTexts === undefined ? {} : { oldTexts }),
      newFiles
    });
    const mapped = this.mapOrdinaryModifications(
      files,
      transitioned.files,
      parsedFiles,
      diff,
      newRevision,
      occurredAt,
      options,
      oldTexts,
      newFiles
    );
    const refreshed = await this.refreshMappedFiles(
      mapped,
      newRevision,
      repositoryRoot,
      semantics,
      occurredAt,
      binaryResolution.destinationPaths,
      binaryResolution.unresolvedPaths,
      effectiveEncodingHints
    );
    const unresolvedFileIds = new Set<string>();
    const unresolvedReasonsByFileId: Record<string, "immutable-text-unavailable" | "mapping-unresolved"> = {};
    for (const file of Object.values(mapped)) {
      if (!Object.hasOwn(refreshed, file.fileId) &&
          !binaryResolution.destinationPaths.has(file.currentPath) &&
          !binaryResolution.unresolvedPaths.has(file.currentPath)) {
        unresolvedFileIds.add(file.fileId);
        unresolvedReasonsByFileId[file.fileId] = "immutable-text-unavailable";
      }
    }
    const byPath = new Map(Object.values(files).map((file) => [file.currentPath, file.fileId]));
    for (const unresolved of transitioned.unresolved) {
      const fileId = unresolved.oldPath === undefined ? undefined : byPath.get(unresolved.oldPath);
      if (fileId !== undefined) {
        unresolvedFileIds.add(fileId);
        unresolvedReasonsByFileId[fileId] ??= "mapping-unresolved";
      }
    }
    for (const file of Object.values(files)) {
      if (binaryResolution.destinationPaths.has(file.currentPath) ||
          binaryResolution.unresolvedPaths.has(file.currentPath)) {
        unresolvedFileIds.add(file.fileId);
        unresolvedReasonsByFileId[file.fileId] ??= "mapping-unresolved";
      }
    }
    let binaryTransitions: readonly GitDiffFile[] = [];
    try {
      binaryTransitions = copyAwareParsedFiles(rawDiff);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }
    for (const file of binaryTransitions) {
      if (file.oldPath === undefined || file.newPath === undefined ||
          (!binaryResolution.destinationPaths.has(file.newPath) &&
           !binaryResolution.unresolvedPaths.has(file.newPath))) {
        continue;
      }
      const sourceId = byPath.get(file.oldPath);
      if (sourceId !== undefined) {
        unresolvedFileIds.add(sourceId);
        unresolvedReasonsByFileId[sourceId] ??= "mapping-unresolved";
      }
    }
    return { files: refreshed, unresolvedFileIds: [...unresolvedFileIds].sort(), unresolvedReasonsByFileId };
  }

  private async mapGlobalFiles(
    files: Readonly<Record<string, GlobalFileReviewState>>,
    repositoryId: string,
    oldRevision: string,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    options: Readonly<GitDiffMappingOptions>,
    occurredAt: string,
    encodingHints: Readonly<Record<string, string>> = {}
  ): Promise<Record<string, GlobalFileReviewState>> {
    if (oldRevision === newRevision) {
      return Object.keys(encodingHints).length === 0
        ? clone(files)
        : this.refreshGlobalFiles(files, newRevision, repositoryRoot, semantics, occurredAt, encodingHints);
    }
    if (!FULL_OBJECT_ID_PATTERN.test(newRevision)) {
      return {};
    }

    const oldExists = FULL_OBJECT_ID_PATTERN.test(oldRevision) &&
      await this.options.source.objectExists(repositoryRoot, oldRevision);
    if (!oldExists) {
      return this.clearGlobalFiles(
        files,
        newRevision,
        repositoryRoot,
        semantics,
        occurredAt,
        encodingHints
      );
    }

    const transitionInput: Record<string, FileReviewState> = {};
    const missingOldFiles: GlobalFileReviewState[] = [];
    for (const file of Object.values(files)) {
      const result = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        oldRevision,
        file.currentPath,
        semantics,
        undefined,
        undefined,
        encodingHints[file.currentPath]
      );
      if (result.kind !== "found") {
        missingOldFiles.push(clone(file));
        continue;
      }
      transitionInput[file.fileId] = {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: file.fileId,
        currentPath: file.currentPath,
        previousPaths: [],
        revisionId: oldRevision,
        modifiedReviewed: clone(file.reviewed),
        originalReviewedByDiff: {},
        ...(file.contentHash === undefined
          ? { contentHash: this.digest(result.content) }
          : { contentHash: file.contentHash }),
        lineCount: lineCountOf(result.content),
        updatedAt: file.updatedAt
      };
    }

    const mapped = await this.mapContextFiles(
      transitionInput,
      repositoryId,
      oldRevision,
      newRevision,
      repositoryRoot,
      semantics,
      options,
      occurredAt,
      encodingHints
    );
    const result: Record<string, GlobalFileReviewState> = Object.fromEntries(
      Object.values(mapped.files).map((file) => [
        file.fileId,
        {
          fileId: file.fileId,
          currentPath: file.currentPath,
          revisionId: newRevision,
          reviewed: clone(file.modifiedReviewed),
          ...(file.contentHash === undefined ? {} : { contentHash: file.contentHash }),
          updatedAt: occurredAt
        }
      ])
    );
    const conservative = await this.clearGlobalFiles(
      Object.fromEntries(missingOldFiles.map((file) => [file.fileId, file])),
      newRevision,
      repositoryRoot,
      semantics,
      occurredAt,
      encodingHints
    );
    for (const [fileId, file] of Object.entries(conservative)) {
      if (!(fileId in result)) {
        result[fileId] = file;
      }
    }
    return result;
  }

  private mapOrdinaryModifications(
    previous: Readonly<Record<string, FileReviewState>>,
    transitioned: Readonly<Record<string, FileReviewState>>,
    parsedFiles: readonly GitDiffFile[],
    diff: string,
    newRevision: string,
    occurredAt: string,
    options: Readonly<GitDiffMappingOptions>,
    oldTexts: Readonly<Record<string, string>> | undefined,
    newFiles: Readonly<Record<string, GitNewFileStateInput>>
  ): Record<string, FileReviewState> {
    const next = clone(transitioned) as Record<string, FileReviewState>;
    const previousByPath = new Map(
      Object.values(previous).map((file) => [file.currentPath, file])
    );
    for (const file of parsedFiles) {
      if (
        file.isRename ||
        file.hunks.length === 0 ||
        file.oldPath === undefined ||
        file.newPath === undefined ||
        file.oldPath !== file.newPath
      ) {
        continue;
      }
      const prior = previousByPath.get(file.oldPath);
      const current = prior === undefined ? undefined : next[prior.fileId];
      if (prior === undefined || current === undefined) {
        continue;
      }
      const metadata = newFiles[file.newPath];
      const mapped = mapReviewedIntervalsAcrossDiff({
        reviewed: prior.modifiedReviewed,
        diff,
        oldPath: file.oldPath,
        newPath: file.newPath,
        ...(oldTexts?.[file.oldPath] === undefined
          ? {}
          : { oldText: oldTexts[file.oldPath] }),
        ...(metadata?.newText === undefined
          ? {}
          : { newText: metadata.newText }),
        options
      });
      next[prior.fileId] = {
        ...clone(current),
        revisionId: newRevision,
        modifiedReviewed: mapped.reviewed,
        ...(metadata?.lineCount === undefined
          ? {}
          : { lineCount: metadata.lineCount }),
        updatedAt: occurredAt,
        ...(metadata?.contentHash === undefined
          ? {}
          : { contentHash: metadata.contentHash })
      };
    }
    return next;
  }

  private async loadOldTextsWhenRequired(
    files: readonly FileReviewState[],
    oldRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    options: Readonly<GitDiffMappingOptions>
    , encodingHints: Readonly<Record<string, string>> = {}
  ): Promise<Record<string, string> | undefined> {
    if (!options.ignoreWhitespaceChanges && !options.ignoreEolChanges) {
      return undefined;
    }
    const entries: Array<readonly [string, string]> = [];
    for (const file of files) {
      const result = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        oldRevision,
        file.currentPath,
        semantics,
        undefined,
        undefined,
        encodingHints[file.currentPath]
      );
      if (result.kind === "found") entries.push([file.currentPath, result.content]);
    }
    return Object.fromEntries(entries);
  }

  private async loadNewFileMetadata(
    diff: string,
    existing: Readonly<Record<string, FileReviewState>>,
    repositoryId: string,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    binaryPaths: ReadonlySet<string>,
    encodingHints: Readonly<Record<string, string>> = {}
  ): Promise<Record<string, GitNewFileStateInput>> {
    const parsedFiles = parseZeroContextGitDiff(diff).files;
    const copyAwareFiles = copyAwareParsedFiles(diff);
    const existingByPath = new Map(
      Object.values(existing).map((file) => [file.currentPath, file.fileId])
    );
    const transitions = copyAwareFiles.filter(
      (file) =>
        file.isRename && file.oldPath !== undefined && file.newPath !== undefined
    );
    const sourceCounts = new Map<string, number>();
    const destinationCounts = new Map<string, number>();
    for (const transition of transitions) {
      const oldPath = transition.oldPath as string;
      const newPath = transition.newPath as string;
      sourceCounts.set(oldPath, (sourceCounts.get(oldPath) ?? 0) + 1);
      destinationCounts.set(newPath, (destinationCounts.get(newPath) ?? 0) + 1);
    }
    const preservedDestinationIds = new Map<string, string>();
    for (const file of parsedFiles) {
      if (
        file.oldPath !== undefined &&
        file.newPath !== undefined &&
        file.isRename &&
        sourceCounts.get(file.oldPath) === 1 &&
        destinationCounts.get(file.newPath) === 1
      ) {
        const sourceId = existingByPath.get(file.oldPath);
        if (sourceId !== undefined) {
          preservedDestinationIds.set(file.newPath, sourceId);
        }
      }
    }

    const result: Record<string, GitNewFileStateInput> = {};
    const occupiedFileIds = new Set(Object.keys(existing));
    const destinationPaths = unique([
      ...parsedFiles.map((file) => file.newPath),
      ...copyAwareFiles.map((file) => file.newPath)
    ]);
    for (const filePath of destinationPaths) {
      const preservedFileId = preservedDestinationIds.get(filePath);
      if (binaryPaths.has(filePath)) {
        if (preservedFileId === undefined) {
          const fileId = this.createUnoccupiedFileId(
            repositoryId,
            filePath,
            occupiedFileIds
          );
          result[filePath] = { fileId, lineCount: 0 };
          occupiedFileIds.add(fileId);
        }
        continue;
      }
      const textResult = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        newRevision,
        filePath,
        semantics,
        undefined,
        undefined,
        encodingHints[filePath]
      );
      if (textResult.kind !== "found") continue;
      const content = textResult.content;
      result[filePath] = {
        fileId: preservedFileId ??
          this.createUnoccupiedFileId(repositoryId, filePath, occupiedFileIds),
        lineCount: lineCountOf(content),
        physicalLineCount: physicalLineCountOf(content),
        contentHash: this.digest(content),
        newText: content
      };
      occupiedFileIds.add(result[filePath].fileId);
    }
    return result;
  }

  private async clearAndRefresh(
    files: Readonly<Record<string, FileReviewState>>,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    occurredAt: string,
    encodingHints: Readonly<Record<string, string>> = {}
  ): Promise<Record<string, FileReviewState>> {
    const cleared = Object.fromEntries(
      Object.values(files).map((file) => [
        file.fileId,
        {
          ...clone(file),
          revisionId: newRevision,
          modifiedReviewed: [],
          updatedAt: occurredAt
        }
      ])
    );
    return this.refreshMappedFiles(
      cleared,
      newRevision,
      repositoryRoot,
      semantics,
      occurredAt,
      new Set(),
      new Set(),
      encodingHints
    );
  }

  private async clearGlobalFiles(
    files: Readonly<Record<string, GlobalFileReviewState>>,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    occurredAt: string,
    encodingHints: Readonly<Record<string, string>> = {}
  ): Promise<Record<string, GlobalFileReviewState>> {
    const result: Record<string, GlobalFileReviewState> = {};
    for (const file of Object.values(files)) {
      const read = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        newRevision,
        file.currentPath,
        semantics,
        undefined,
        undefined,
        encodingHints[file.currentPath]
      );
      if (read.kind !== "found") {
        continue;
      }
      result[file.fileId] = {
        fileId: file.fileId,
        currentPath: file.currentPath,
        revisionId: newRevision,
        reviewed: [],
        contentHash: this.digest(read.content),
        updatedAt: occurredAt
      };
    }
    return result;
  }

  /** Rehashes only the current revision after an opened-document encoding change. */
  private async refreshGlobalFiles(
    files: Readonly<Record<string, GlobalFileReviewState>>,
    revision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    occurredAt: string,
    encodingHints: Readonly<Record<string, string>>
  ): Promise<Record<string, GlobalFileReviewState>> {
    const refreshed: Record<string, GlobalFileReviewState> = {};
    for (const file of Object.values(files)) {
      const read = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        revision,
        file.currentPath,
        semantics,
        undefined,
        undefined,
        encodingHints[file.currentPath]
      );
      if (read.kind !== "found") continue;
      refreshed[file.fileId] = {
        ...clone(file),
        contentHash: this.digest(read.content),
        updatedAt: occurredAt
      };
    }
    return refreshed;
  }

  private async refreshMappedFiles(
    files: Readonly<Record<string, FileReviewState>>,
    newRevision: string,
    repositoryRoot: string,
    semantics: FileSystemPathSemantics,
    occurredAt: string,
    binaryPaths: ReadonlySet<string> = new Set(),
    unresolvedBinaryPaths: ReadonlySet<string> = new Set(),
    encodingHints: Readonly<Record<string, string>> = {}
  ): Promise<Record<string, FileReviewState>> {
    const refreshed: Record<string, FileReviewState> = {};
    for (const file of Object.values(files)) {
      if (binaryPaths.has(file.currentPath)) {
        continue;
      }
      const result = await this.options.source.readTextFileAtRevision(
        repositoryRoot,
        newRevision,
        file.currentPath,
        semantics,
        undefined,
        undefined,
        encodingHints[file.currentPath]
      );
      if (result.kind !== "found") {
        continue;
      }
      const content = result.content;
      refreshed[file.fileId] = {
        ...clone(file),
        revisionId: newRevision,
        ...(unresolvedBinaryPaths.has(file.currentPath)
          ? { modifiedReviewed: [] }
          : {}),
        contentHash: this.digest(content),
        lineCount: lineCountOf(content),
        updatedAt: occurredAt
      };
    }
    return refreshed;
  }

  private createFileId(repositoryId: string, filePath: string): string {
    return `repository-file:${this.digest(
      ["repository-file", repositoryId, filePath].join("\0")
    )}`;
  }

  /** Derives a deterministic new-file ID without replacing a retained stable identity. */
  private createUnoccupiedFileId(
    repositoryId: string,
    filePath: string,
    occupiedFileIds: ReadonlySet<string>
  ): string {
    const canonical = this.createFileId(repositoryId, filePath);
    if (!occupiedFileIds.has(canonical)) {
      return canonical;
    }
    for (let discriminator = 1; ; discriminator += 1) {
      const candidate = `repository-file:${this.digest(
        ["repository-file", repositoryId, filePath, String(discriminator)].join("\0")
      )}`;
      if (!occupiedFileIds.has(candidate)) {
        return candidate;
      }
    }
  }

  private digest(content: string): string {
    const digest = this.options.stableHash.digest(content);
    if (!SHA256_HEX_PATTERN.test(digest)) {
      throw new Error(
        "StableHash.digest must return a lowercase 64-character SHA-256 hexadecimal digest."
      );
    }
    return digest;
  }
}

import type { ReviewContextState } from "../../core/contracts/index";
import { GitContextRevisionMapper as DirectGitContextRevisionMapper } from "./git-context-revision-mapper";
import type {
  GitContextRevisionMapperOptions,
  GitContextRevisionMappingInput,
  GitContextRevisionMappingResult,
  GitHistoryRewriteRecoveryPort,
  GitRevisionMappingSource
} from "./contracts";

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const registeredHistoryRewriteRecovery = new WeakMap<
  GitRevisionMappingSource,
  GitHistoryRewriteRecoveryPort
>();

interface GitRevisionTreePathSource extends GitRevisionMappingSource {
  listFilePathsAtRevision(
    repositoryRoot: string,
    revision: string
  ): Promise<readonly string[] | undefined>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const contextRevision = (state: ReviewContextState): string => {
  if (state.kind !== "branch" || state.branch === undefined) {
    throw new Error("Git context mapping requires branch-schema persistence.");
  }
  return state.branch.headRevision;
};

const hasTreePathSource = (
  source: GitRevisionMappingSource
): source is GitRevisionTreePathSource =>
  "listFilePathsAtRevision" in source &&
  typeof source.listFilePathsAtRevision === "function";

/** Registers one source-local runtime recovery before constructing its mapper. */
export function registerGitHistoryRewriteRecovery(
  source: GitRevisionMappingSource,
  recovery: GitHistoryRewriteRecoveryPort
): void {
  registeredHistoryRewriteRecovery.set(source, recovery);
}

/**
 * Keeps direct immutable Git mapping authoritative and invokes T602 snapshot
 * recovery only for the snapshot side whose old object is proven missing.
 */
export class GitContextRevisionMapper {
  private readonly directMapper: DirectGitContextRevisionMapper;
  private readonly historyRewriteRecovery: GitHistoryRewriteRecoveryPort | undefined;

  public constructor(
    private readonly options: GitContextRevisionMapperOptions
  ) {
    this.directMapper = new DirectGitContextRevisionMapper(options);
    this.historyRewriteRecovery = options.historyRewriteRecovery ??
      registeredHistoryRewriteRecovery.get(options.source);
  }

  public async map(
    input: GitContextRevisionMappingInput
  ): Promise<GitContextRevisionMappingResult> {
    this.validateCandidatePaths(input.currentCandidatePaths ?? []);
    const oldContextRevisionId = contextRevision(input.contextState);
    const oldGlobalRevisionId = input.globalState.currentRevisionId;
    const availability = await this.oldObjectAvailability(
      input.current.repositoryRoot,
      oldContextRevisionId,
      oldGlobalRevisionId
    );

    const direct = await this.directMapper.map(input);
    if (
      this.historyRewriteRecovery === undefined ||
      (!availability.contextMissing && !availability.globalMissing)
    ) {
      return direct;
    }

    const currentCandidatePaths = await this.currentCandidatePaths(input);
    const recovered = await this.historyRewriteRecovery.recover({
      current: input.current,
      contextFiles: availability.contextMissing
        ? clone(input.contextState.files)
        : {},
      globalFiles: availability.globalMissing
        ? clone(input.globalState.files)
        : {},
      oldContextRevisionId,
      oldGlobalRevisionId,
      fileSystemPathSemantics: input.fileSystemPathSemantics,
      options: input.options,
      currentCandidatePaths,
      occurredAt: direct.contextState.updatedAt
    });

    return {
      contextState: {
        ...clone(direct.contextState),
        files: availability.contextMissing
          ? clone(recovered.contextFiles)
          : clone(direct.contextState.files)
      },
      globalState: {
        ...clone(direct.globalState),
        files: availability.globalMissing
          ? clone(recovered.globalFiles)
          : clone(direct.globalState.files)
      },
      unresolvedFileIds: [
        ...new Set([
          ...(availability.contextMissing
            ? []
            : direct.unresolvedFileIds),
          ...recovered.unresolvedFileIds
        ])
      ].sort()
    };
  }

  private async currentCandidatePaths(
    input: GitContextRevisionMappingInput
  ): Promise<readonly string[]> {
    if (input.currentCandidatePaths !== undefined) {
      return [...input.currentCandidatePaths];
    }
    if (!hasTreePathSource(this.options.source)) {
      return [];
    }

    let paths: readonly string[] | undefined;
    try {
      paths = await this.options.source.listFilePathsAtRevision(
        input.current.repositoryRoot,
        input.current.revisionId
      );
    } catch {
      return [];
    }
    if (paths === undefined) {
      return [];
    }
    this.validateCandidatePaths(paths);
    return [...paths];
  }

  private async oldObjectAvailability(
    repositoryRoot: string,
    oldContextRevisionId: string,
    oldGlobalRevisionId: string
  ): Promise<{
    readonly contextMissing: boolean;
    readonly globalMissing: boolean;
  }> {
    const contextEligible = FULL_OBJECT_ID.test(oldContextRevisionId);
    const globalEligible = FULL_OBJECT_ID.test(oldGlobalRevisionId);
    if (!contextEligible && !globalEligible) {
      return { contextMissing: false, globalMissing: false };
    }

    if (
      contextEligible &&
      globalEligible &&
      oldContextRevisionId === oldGlobalRevisionId
    ) {
      const exists = await this.options.source.objectExists(
        repositoryRoot,
        oldContextRevisionId
      );
      return {
        contextMissing: !exists,
        globalMissing: !exists
      };
    }

    const [contextExists, globalExists] = await Promise.all([
      contextEligible
        ? this.options.source.objectExists(repositoryRoot, oldContextRevisionId)
        : Promise.resolve(true),
      globalEligible
        ? this.options.source.objectExists(repositoryRoot, oldGlobalRevisionId)
        : Promise.resolve(true)
    ]);
    return {
      contextMissing: contextEligible && !contextExists,
      globalMissing: globalEligible && !globalExists
    };
  }

  private validateCandidatePaths(paths: readonly string[]): void {
    const seen = new Set<string>();
    for (const path of paths) {
      if (path.length === 0 || path.includes("\0") || seen.has(path)) {
        throw new TypeError(
          "currentCandidatePaths must contain unique non-empty paths without null characters."
        );
      }
      seen.add(path);
    }
  }
}

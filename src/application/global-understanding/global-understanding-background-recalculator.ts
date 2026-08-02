import type {
  GlobalFileReviewState,
  RepositoryGlobalState
} from "../../core/contracts/index";
import {
  aggregateRepositoryGlobalUnderstandingProgress,
  type GlobalUnderstandingFileProgress,
  type GlobalUnderstandingFileSnapshot,
  type RepositoryGlobalUnderstandingProgress
} from "../../core/global-understanding/index";
import {
  buildGlobalUnderstandingEvidenceKey,
  calculateGlobalUnderstandingFileProgressCooperatively,
  globalUnderstandingEvidenceKeysEqual,
  type GlobalUnderstandingCalculationWorkOptions,
  type GlobalUnderstandingEvidenceKey
} from "./cooperative-global-understanding-calculation";

/** One T503-included file and its authoritative non-empty denominator count. */
export interface IncludedGlobalUnderstandingFile {
  /** Canonical repository-relative path. */
  readonly path: string;
  /** Non-empty line count produced by repository enumeration. */
  readonly nonEmptyLineCount: number;
}

/** Loaded current-file evidence with a stable source-version cache key. */
export interface LoadedGlobalUnderstandingFile extends GlobalUnderstandingFileSnapshot {
  /** Changes whenever the source evidence used by the calculator changes. */
  readonly cacheKey: string;
  /** Optional final validation used after cooperative post-load work before publishing the result. */
  readonly validateCurrent?: () => Promise<void>;
}

/** Cooperative bounded-work options for loading one current repository file. */
export interface GlobalUnderstandingFileLoadOptions {
  /** Maximum source bytes decoded, scanned, and hashed before yielding. */
  readonly maxWorkBytes: number;
  /** Scheduler boundary used between non-final source chunks. */
  readonly yieldControl: () => void | Promise<void>;
}

/** Runtime-neutral source used to load one included repository file. */
export interface GlobalUnderstandingFileSource {
  /** Loads exact current content evidence for the requested revision. */
  readonly load: (
    repositoryPath: string,
    revisionId: string,
    options?: GlobalUnderstandingFileLoadOptions
  ) => Promise<LoadedGlobalUnderstandingFile>;
}

/** Cache boundary for exact file-level Global progress evidence. */
export interface GlobalUnderstandingProgressCache {
  /** Returns a cached result only when every bounded evidence part is identical. */
  readonly get: (
    identity: string,
    evidenceKey: GlobalUnderstandingEvidenceKey,
    workOptions: GlobalUnderstandingCalculationWorkOptions
  ) => Promise<GlobalUnderstandingFileProgress | undefined>;
  /** Replaces the latest exact evidence and result for one repository-file identity. */
  readonly set: (
    identity: string,
    evidenceKey: GlobalUnderstandingEvidenceKey,
    progress: GlobalUnderstandingFileProgress
  ) => void;
  /** Clears every cached file result. */
  readonly clear: () => void;
}

interface CacheEntry {
  readonly evidenceKey: GlobalUnderstandingEvidenceKey;
  readonly progress: GlobalUnderstandingFileProgress;
}

interface GlobalUnderstandingCalculationInputSnapshot {
  readonly repositoryId: string;
  readonly currentRevisionId: string;
  readonly globalByPath: ReadonlyMap<string, GlobalFileReviewState>;
  readonly ordered: readonly IncludedGlobalUnderstandingFile[];
}

/** In-memory exact-evidence progress cache for one Extension Host process. */
export class InMemoryGlobalUnderstandingProgressCache
implements GlobalUnderstandingProgressCache {
  private readonly entries = new Map<string, CacheEntry>();

  public async get(
    identity: string,
    evidenceKey: GlobalUnderstandingEvidenceKey,
    workOptions: GlobalUnderstandingCalculationWorkOptions
  ): Promise<GlobalUnderstandingFileProgress | undefined> {
    const entry = this.entries.get(identity);
    if (entry === undefined) return undefined;
    return await globalUnderstandingEvidenceKeysEqual(
      entry.evidenceKey,
      evidenceKey,
      workOptions
    ) ? entry.progress : undefined;
  }

  public set(
    identity: string,
    evidenceKey: GlobalUnderstandingEvidenceKey,
    progress: GlobalUnderstandingFileProgress
  ): void {
    this.entries.set(identity, { evidenceKey, progress });
  }

  public clear(): void {
    this.entries.clear();
  }
}

/** Dependencies for asynchronous chunked Global-understanding recalculation. */
export interface GlobalUnderstandingBackgroundRecalculatorDependencies {
  /** Current repository-file source. */
  readonly source: GlobalUnderstandingFileSource;
  /** Exact file progress cache. */
  readonly cache: GlobalUnderstandingProgressCache;
  /** Cooperative scheduler used within source, post-load calculation, and between file chunks. */
  readonly yieldControl: () => void | Promise<void>;
}

/** Partial or complete background recalculation result. */
export interface GlobalUnderstandingRecalculationProgress {
  /** Aggregate for files processed so far. */
  readonly progress: RepositoryGlobalUnderstandingProgress;
  /** Number of included files processed so far. */
  readonly processedFileCount: number;
  /** Total included file count for this request. */
  readonly totalFileCount: number;
  /** Whether every included file has been processed. */
  readonly complete: boolean;
  /** Number of exact file calculations reused from cache. */
  readonly cacheHitCount: number;
  /** Number of file calculations executed during this request. */
  readonly calculatedFileCount: number;
}

/** Input for one background recalculation pass. */
export interface GlobalUnderstandingRecalculationInput {
  /** Current repository Global state. */
  readonly globalState: RepositoryGlobalState;
  /** T503 included files only. */
  readonly included: readonly IncludedGlobalUnderstandingFile[];
  /** Open repository files to process first, in caller priority order. */
  readonly openFilePaths?: readonly string[];
  /** Canonical exclusion/settings identity; changes force recalculation. */
  readonly configurationKey: string;
  /** Maximum number of files processed before yielding; defaults to 25. */
  readonly chunkSize?: number;
  /** Maximum source bytes processed before yielding within one file; defaults to 64 KiB. */
  readonly fileWorkChunkBytes?: number;
  /** Maximum post-load evidence, interval, or line items processed before yielding; defaults to 4096. */
  readonly calculationWorkChunkItems?: number;
  /** Optional progress callback invoked after every chunk, including the final chunk. */
  readonly onProgress?: (
    progress: GlobalUnderstandingRecalculationProgress
  ) => void | Promise<void>;
}

const DEFAULT_FILE_WORK_CHUNK_BYTES = 64 * 1024;
const DEFAULT_CALCULATION_WORK_CHUNK_ITEMS = 4096;

const requireNonEmptyString = (value: string, label: string): void => {
  if (value.length === 0) throw new TypeError(`${label} must be a non-empty string.`);
};

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
};

const validatePositiveCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
};

const globalFilesByPath = (
  state: RepositoryGlobalState
): ReadonlyMap<string, GlobalFileReviewState> => {
  requireNonEmptyString(state.repositoryId, "globalState.repositoryId");
  requireNonEmptyString(state.currentRevisionId, "globalState.currentRevisionId");
  const files = new Map<string, GlobalFileReviewState>();
  for (const file of Object.values(state.files)) {
    requireNonEmptyString(file.currentPath, "Global currentPath");
    if (files.has(file.currentPath)) {
      throw new RangeError(`duplicate Global currentPath: ${file.currentPath}`);
    }
    files.set(file.currentPath, file);
  }
  return files;
};

const copyGlobalFile = (file: GlobalFileReviewState): GlobalFileReviewState => {
  const reviewed = Object.freeze(file.reviewed.map((interval) => Object.freeze({
    startLine: interval.startLine,
    endLineExclusive: interval.endLineExclusive
  }))) as unknown as GlobalFileReviewState["reviewed"];
  return Object.freeze({
    fileId: file.fileId,
    currentPath: file.currentPath,
    revisionId: file.revisionId,
    reviewed,
    contentHash: file.contentHash,
    updatedAt: file.updatedAt
  }) as GlobalFileReviewState;
};

const snapshotCalculationInput = (
  input: GlobalUnderstandingRecalculationInput
): GlobalUnderstandingCalculationInputSnapshot => {
  const globalByPath = new Map<string, GlobalFileReviewState>();
  for (const [repositoryPath, file] of globalFilesByPath(input.globalState)) {
    globalByPath.set(repositoryPath, copyGlobalFile(file));
  }
  const included = Object.freeze(input.included.map((file) => Object.freeze({
    path: file.path,
    nonEmptyLineCount: file.nonEmptyLineCount
  })));
  const openFilePaths = Object.freeze([...(input.openFilePaths ?? [])]);
  return Object.freeze({
    repositoryId: input.globalState.repositoryId,
    currentRevisionId: input.globalState.currentRevisionId,
    globalByPath,
    ordered: Object.freeze(orderedIncludedFiles(included, openFilePaths))
  });
};

const orderedIncludedFiles = (
  included: readonly IncludedGlobalUnderstandingFile[],
  openFilePaths: readonly string[]
): readonly IncludedGlobalUnderstandingFile[] => {
  const byPath = new Map<string, IncludedGlobalUnderstandingFile>();
  for (const file of included) {
    requireNonEmptyString(file.path, "included.path");
    validateCount(file.nonEmptyLineCount, `included.nonEmptyLineCount for ${file.path}`);
    if (byPath.has(file.path)) {
      throw new RangeError(`duplicate included repository path: ${file.path}`);
    }
    byPath.set(file.path, file);
  }

  const ordered: IncludedGlobalUnderstandingFile[] = [];
  const added = new Set<string>();
  for (const repositoryPath of openFilePaths) {
    const file = byPath.get(repositoryPath);
    if (file !== undefined && !added.has(repositoryPath)) {
      ordered.push(file);
      added.add(repositoryPath);
    }
  }
  for (const file of included) {
    if (!added.has(file.path)) {
      ordered.push(file);
      added.add(file.path);
    }
  }
  return ordered;
};

const validateLoadedFile = (
  included: IncludedGlobalUnderstandingFile,
  revisionId: string,
  loaded: LoadedGlobalUnderstandingFile
): void => {
  if (loaded.path !== included.path) {
    throw new RangeError(`Loaded path mismatch for ${included.path}.`);
  }
  if (loaded.revisionId !== revisionId) {
    throw new RangeError(`Loaded revision mismatch for ${included.path}.`);
  }
  requireNonEmptyString(loaded.cacheKey, `cacheKey for ${included.path}`);
  if (loaded.nonEmptyLines.length !== included.nonEmptyLineCount) {
    throw new RangeError(
      `Loaded ${included.path} no longer matches its enumerated non-empty line count.`
    );
  }
};

/**
 * Recalculates Global understanding asynchronously, prioritizing open files and yielding within source, post-load calculation, and between file chunks.
 */
export class GlobalUnderstandingBackgroundRecalculator {
  public constructor(
    private readonly dependencies: GlobalUnderstandingBackgroundRecalculatorDependencies
  ) {}

  /** Executes one exact recalculation pass and emits chunk-level progress. */
  public async recalculate(
    input: GlobalUnderstandingRecalculationInput
  ): Promise<GlobalUnderstandingRecalculationProgress> {
    requireNonEmptyString(input.configurationKey, "configurationKey");
    const chunkSize = input.chunkSize ?? 25;
    validatePositiveCount(chunkSize, "chunkSize");
    const fileWorkChunkBytes = input.fileWorkChunkBytes ?? DEFAULT_FILE_WORK_CHUNK_BYTES;
    validatePositiveCount(fileWorkChunkBytes, "fileWorkChunkBytes");
    const calculationWorkChunkItems = input.calculationWorkChunkItems ??
      DEFAULT_CALCULATION_WORK_CHUNK_ITEMS;
    validatePositiveCount(calculationWorkChunkItems, "calculationWorkChunkItems");
    const calculationWorkOptions: GlobalUnderstandingCalculationWorkOptions = {
      maxWorkItems: calculationWorkChunkItems,
      yieldControl: this.dependencies.yieldControl
    };

    const snapshot = snapshotCalculationInput(input);
    const { repositoryId, currentRevisionId, globalByPath, ordered } = snapshot;
    const calculated: GlobalUnderstandingFileProgress[] = [];
    let cacheHitCount = 0;
    let calculatedFileCount = 0;

    const emit = async (complete: boolean): Promise<GlobalUnderstandingRecalculationProgress> => {
      const event: GlobalUnderstandingRecalculationProgress = {
        progress: aggregateRepositoryGlobalUnderstandingProgress(calculated),
        processedFileCount: calculated.length,
        totalFileCount: ordered.length,
        complete,
        cacheHitCount,
        calculatedFileCount
      };
      await input.onProgress?.(event);
      return event;
    };

    if (ordered.length === 0) return emit(true);

    for (let chunkStart = 0; chunkStart < ordered.length; chunkStart += chunkSize) {
      const chunk = ordered.slice(chunkStart, chunkStart + chunkSize);
      for (const included of chunk) {
        const loaded = await this.dependencies.source.load(
          included.path,
          currentRevisionId,
          {
            maxWorkBytes: fileWorkChunkBytes,
            yieldControl: this.dependencies.yieldControl
          }
        );
        validateLoadedFile(included, currentRevisionId, loaded);
        const globalFile = globalByPath.get(included.path);
        const identity = `${repositoryId}\0${included.path}`;
        const evidenceKey = await buildGlobalUnderstandingEvidenceKey({
          repositoryId,
          currentRevisionId,
          configurationKey: input.configurationKey,
          includedPath: included.path,
          includedNonEmptyLineCount: included.nonEmptyLineCount,
          loaded,
          globalFile
        }, calculationWorkOptions);
        const cached = await this.dependencies.cache.get(
          identity,
          evidenceKey,
          calculationWorkOptions
        );
        if (cached !== undefined) {
          await loaded.validateCurrent?.();
          calculated.push(cached);
          cacheHitCount += 1;
          continue;
        }

        const progress = await calculateGlobalUnderstandingFileProgressCooperatively(
          loaded,
          globalFile,
          calculationWorkOptions
        );
        await loaded.validateCurrent?.();
        this.dependencies.cache.set(identity, evidenceKey, progress);
        calculated.push(progress);
        calculatedFileCount += 1;
      }

      const complete = calculated.length === ordered.length;
      const event = await emit(complete);
      if (complete) return event;
      await this.dependencies.yieldControl();
    }

    throw new Error("Global understanding recalculation ended without a final chunk.");
  }
}

import type { Stats } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import type {
  GlobalUnderstandingFileLoadOptions,
  GlobalUnderstandingFileSource,
  LoadedGlobalUnderstandingFile
} from "../../application/global-understanding/index";
import { requireCanonicalRepositoryRelativePath } from "../../application/repository-path/index";
import type { FileSystemPathSemantics } from "../../application/workspace-identity/index";

const DEFAULT_MAX_WORK_BYTES = 64 * 1024;
const NON_WHITESPACE = /\S/u;

const requireNonEmptyString = (value: string, label: string): void => {
  if (value.length === 0) throw new TypeError(`${label} must be a non-empty string.`);
};

const defaultYieldControl = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const resolveLoadOptions = (
  options: GlobalUnderstandingFileLoadOptions | undefined
): GlobalUnderstandingFileLoadOptions => {
  const resolved = options ?? {
    maxWorkBytes: DEFAULT_MAX_WORK_BYTES,
    yieldControl: defaultYieldControl
  };
  if (!Number.isSafeInteger(resolved.maxWorkBytes) || resolved.maxWorkBytes <= 0) {
    throw new RangeError("maxWorkBytes must be a positive integer.");
  }
  return resolved;
};

const assertStableRegularFile = (
  expected: Stats,
  observed: Stats,
  canonicalPath: string
): void => {
  if (
    observed.isSymbolicLink() ||
    !observed.isFile() ||
    expected.dev !== observed.dev ||
    expected.ino !== observed.ino ||
    expected.size !== observed.size ||
    expected.mtimeMs !== observed.mtimeMs
  ) {
    throw new Error(
      `Included repository file changed while reading or analyzing: ${canonicalPath}`
    );
  }
};

interface AnalyzedContent {
  readonly lineCount: number;
  readonly nonEmptyLines: readonly number[];
  readonly contentHash: string;
}

const analyzeContent = async (
  content: Buffer,
  options: GlobalUnderstandingFileLoadOptions
): Promise<AnalyzedContent> => {
  const decoder = new TextDecoder("utf-8");
  const hash = createHash("sha256");
  const nonEmptyLines: number[] = [];
  let lineIndex = 0;
  let currentLineNonEmpty = false;
  let pendingCarriageReturn = false;

  const completeLine = (): void => {
    if (currentLineNonEmpty) nonEmptyLines.push(lineIndex);
    lineIndex += 1;
    currentLineNonEmpty = false;
  };

  const consumeDecoded = (decoded: string): void => {
    for (let index = 0; index < decoded.length; index += 1) {
      const character = decoded[index]!;
      if (pendingCarriageReturn) {
        completeLine();
        pendingCarriageReturn = false;
        if (character === "\n") continue;
      }
      if (character === "\r") {
        pendingCarriageReturn = true;
      } else if (character === "\n") {
        completeLine();
      } else if (!currentLineNonEmpty && NON_WHITESPACE.test(character)) {
        currentLineNonEmpty = true;
      }
    }
  };

  for (let offset = 0; offset < content.length; offset += options.maxWorkBytes) {
    const end = Math.min(content.length, offset + options.maxWorkBytes);
    const chunk = content.subarray(offset, end);
    hash.update(chunk);
    consumeDecoded(decoder.decode(chunk, { stream: end < content.length }));
    if (end < content.length) await options.yieldControl();
  }

  if (pendingCarriageReturn) completeLine();
  if (currentLineNonEmpty) nonEmptyLines.push(lineIndex);
  return {
    lineCount: lineIndex + 1,
    nonEmptyLines,
    contentHash: hash.digest("hex")
  };
};

/** Node filesystem adapter that loads exact current-file evidence for Global calculation. */
export class NodeGlobalUnderstandingFileSource
implements GlobalUnderstandingFileSource {
  public constructor(
    private readonly repositoryRoot: string,
    private readonly pathSemantics: FileSystemPathSemantics
  ) {
    requireNonEmptyString(repositoryRoot, "repositoryRoot");
  }

  /**
   * Reads one canonical included repository file and rejects non-regular entries or observable races across read and analysis.
   * Decode, line scanning, and hashing are split into bounded byte chunks with cooperative yields.
   *
   * @throws When the path is non-canonical, either validation observes a non-regular entry, the entry metadata
   * changes before analysis completes, the work budget is invalid, or the filesystem operation fails.
   */
  public async load(
    repositoryPath: string,
    revisionId: string,
    options?: GlobalUnderstandingFileLoadOptions
  ): Promise<LoadedGlobalUnderstandingFile> {
    requireNonEmptyString(revisionId, "revisionId");
    const loadOptions = resolveLoadOptions(options);
    const canonicalPath = requireCanonicalRepositoryRelativePath(
      repositoryPath,
      this.pathSemantics
    );
    const absolutePath = path.join(this.repositoryRoot, ...canonicalPath.split("/"));
    const before = await lstat(absolutePath);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new TypeError(`Included repository path is not a regular file: ${canonicalPath}`);
    }

    const content = await readFile(absolutePath);
    assertStableRegularFile(before, await lstat(absolutePath), canonicalPath);
    const analyzed = await analyzeContent(content, loadOptions);
    assertStableRegularFile(before, await lstat(absolutePath), canonicalPath);

    return {
      path: canonicalPath,
      revisionId,
      lineCount: analyzed.lineCount,
      nonEmptyLines: analyzed.nonEmptyLines,
      contentHash: analyzed.contentHash,
      cacheKey: analyzed.contentHash,
      validateCurrent: async () => {
        assertStableRegularFile(before, await lstat(absolutePath), canonicalPath);
      }
    };
  }
}

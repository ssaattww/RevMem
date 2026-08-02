import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  GlobalUnderstandingFileSource,
  LoadedGlobalUnderstandingFile
} from "../../application/global-understanding/index";
import { requireCanonicalRepositoryRelativePath } from "../../application/repository-path/index";
import type { FileSystemPathSemantics } from "../../application/workspace-identity/index";

const requireNonEmptyString = (value: string, label: string): void => {
  if (value.length === 0) throw new TypeError(`${label} must be a non-empty string.`);
};

const splitLogicalLines = (content: string): readonly string[] =>
  content.length === 0 ? [] : content.split(/\r\n|\r|\n/u);

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
   * Reads one canonical included repository file and rejects non-regular entries or observable read races.
   *
   * @throws When the path is non-canonical, either validation observes a non-regular entry, the entry metadata
   * changes during the read, or the filesystem operation fails.
   */
  public async load(
    repositoryPath: string,
    revisionId: string
  ): Promise<LoadedGlobalUnderstandingFile> {
    requireNonEmptyString(revisionId, "revisionId");
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
    const after = await lstat(absolutePath);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new Error(`Included repository file changed while reading: ${canonicalPath}`);
    }

    const decoded = content.toString("utf8");
    const lines = splitLogicalLines(decoded);
    const nonEmptyLines: number[] = [];
    lines.forEach((line, index) => {
      if (line.trim().length > 0) nonEmptyLines.push(index);
    });
    const contentHash = createHash("sha256").update(content).digest("hex");
    return {
      path: canonicalPath,
      revisionId,
      lineCount: lines.length,
      nonEmptyLines,
      contentHash,
      cacheKey: contentHash
    };
  }
}

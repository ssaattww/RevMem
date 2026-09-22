import path from "node:path";

import type { LoadedGlobalUnderstandingFile } from "../../application/global-understanding/index";
import type { T505GlobalUnderstandingOwner } from "./global-understanding-source";

export interface GlobalUnderstandingOpenTextDocument {
  readonly isClosed: boolean;
  readonly uri: {
    readonly scheme: string;
    readonly fsPath: string;
    toString(skipEncoding?: boolean): string;
  };
  readonly version: number;
  readonly lineCount: number;
  getText(): string;
  lineAt(line: number): { readonly text: string };
}

export interface GlobalUnderstandingOpenDocumentReaderDependencies {
  readonly readDocuments: () => readonly GlobalUnderstandingOpenTextDocument[];
  readonly filesystemSchemes: ReadonlySet<string>;
  readonly stableHash: { digest(value: string): string };
}

/** Builds working-tree evidence only after the caller accepts a repository-relative candidate path. */
export const createGlobalUnderstandingOpenDocumentReader = (
  dependencies: GlobalUnderstandingOpenDocumentReaderDependencies
): ((
  owner: Readonly<T505GlobalUnderstandingOwner>,
  isCandidatePath?: (repositoryPath: string) => boolean
) => readonly LoadedGlobalUnderstandingFile[]) =>
  (owner, isCandidatePath) => dependencies.readDocuments().flatMap((document) => {
    if (document.isClosed || !dependencies.filesystemSchemes.has(document.uri.scheme)) return [];
    const relativePath = path.relative(owner.repositoryRoot, document.uri.fsPath);
    if (
      relativePath.length === 0 ||
      path.isAbsolute(relativePath) ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`)
    ) return [];
    const repositoryPath = relativePath.split(path.sep).join("/");
    if (isCandidatePath?.(repositoryPath) === false) return [];

    const content = document.getText();
    const contentHash = dependencies.stableHash.digest(content);
    const version = document.version;
    const nonEmptyLines: number[] = [];
    for (let line = 0; line < document.lineCount; line += 1) {
      if (document.lineAt(line).text.trim().length > 0) nonEmptyLines.push(line);
    }
    return [{
      path: repositoryPath,
      revisionId: owner.currentRevisionId,
      lineCount: document.lineCount,
      nonEmptyLines,
      contentHash,
      cacheKey: `vscode:${document.uri.toString(true)}:${version}:${contentHash}`,
      validateCurrent: async () => {
        if (
          document.isClosed ||
          document.version !== version ||
          dependencies.stableHash.digest(document.getText()) !== contentHash
        ) throw new Error(`Open document changed during Global recalculation: ${repositoryPath}`);
      }
    }];
  });

import {
  parseZeroContextGitDiff,
  type GitNewFileStateInput,
} from "../../core/git-diff/index";
import type {
  ImmutablePullRequestRevisionEvidence,
  PullRequestReviewStateCommit,
  PullRequestRevisionMappingEvidence,
} from "../github-pr-context/index";

export type PullRequestRevisionTextReadResult =
  | { readonly kind: "found"; readonly content: string }
  | { readonly kind: "binary" }
  | { readonly kind: "unavailable" };

export interface PullRequestRevisionEvidenceLoaderDependencies {
  readonly loadCurrent: (
    evidence: Readonly<PullRequestRevisionMappingEvidence>
  ) => Promise<PullRequestReviewStateCommit | undefined>;
  readonly loadDiff: (
    evidence: Readonly<PullRequestRevisionMappingEvidence>
  ) => Promise<string>;
  readonly readText: (
    revision: string,
    path: string
  ) => Promise<PullRequestRevisionTextReadResult>;
  readonly createFileId: (repositoryId: string, path: string) => string;
  readonly hashText: (text: string) => string;
  readonly now?: () => Date;
}

const lineCount = (text: string): number => text.split(/\r\n|\r|\n/u).length;

/**
 * Builds the complete immutable evidence required by the T404 revision mapper.
 * It never substitutes moving refs: every read is bound to the requested source
 * or target commit object ID.
 */
export class PullRequestRevisionEvidenceLoader {
  private readonly now: () => Date;

  public constructor(
    private readonly dependencies: PullRequestRevisionEvidenceLoaderDependencies
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public async load(
    evidence: Readonly<PullRequestRevisionMappingEvidence>
  ): Promise<ImmutablePullRequestRevisionEvidence> {
    const current = await this.dependencies.loadCurrent(evidence);
    if (
      current === undefined ||
      current.contextState.repositoryId !== evidence.repositoryId ||
      current.contextState.contextId !== evidence.contextId ||
      current.contextState.pullRequest?.baseSha !== evidence.sourceBaseSha ||
      current.contextState.pullRequest?.headSha !== evidence.sourceHeadSha ||
      current.globalState.repositoryId !== evidence.repositoryId
    ) {
      throw new Error("Current pull-request state does not match requested revision evidence");
    }

    const updatedAt = this.now().toISOString();
    const baseOnlyTransition =
      evidence.sourceHeadSha === evidence.targetHeadSha &&
      evidence.sourceBaseSha !== evidence.targetBaseSha;
    if (baseOnlyTransition) {
      return {
        ...evidence,
        diff: "",
        oldTexts: {},
        newFiles: {},
        updatedAt,
      };
    }

    const diff = await this.dependencies.loadDiff(evidence);
    if (diff.length === 0) {
      throw new Error("Pull-request revision evidence requires a complete head diff");
    }

    const trackedByPath = new Map<string, string>();
    for (const file of Object.values(current.contextState.files)) {
      trackedByPath.set(file.currentPath, file.fileId);
    }
    for (const file of Object.values(current.globalState.files)) {
      if (!trackedByPath.has(file.currentPath)) trackedByPath.set(file.currentPath, file.fileId);
    }

    const oldTexts: Record<string, string> = {};
    const newFiles: Record<string, GitNewFileStateInput> = {};
    for (const file of parseZeroContextGitDiff(diff).files) {
      if (file.oldPath !== undefined && trackedByPath.has(file.oldPath)) {
        const oldText = await this.dependencies.readText(evidence.sourceHeadSha, file.oldPath);
        if (oldText.kind !== "found") {
          throw new Error(`Tracked source text is unavailable for ${file.oldPath}`);
        }
        oldTexts[file.oldPath] = oldText.content;
      }

      if (file.newPath === undefined) continue;
      const newText = await this.dependencies.readText(evidence.targetHeadSha, file.newPath);
      const stableFileId = trackedByPath.get(file.newPath) ??
        (file.isRename && file.oldPath !== undefined ? trackedByPath.get(file.oldPath) : undefined);
      const fileId = stableFileId ?? this.dependencies.createFileId(evidence.repositoryId, file.newPath);
      if (newText.kind === "found") {
        newFiles[file.newPath] = {
          fileId,
          lineCount: lineCount(newText.content),
          contentHash: this.dependencies.hashText(newText.content),
          newText: newText.content,
        };
        continue;
      }
      if (trackedByPath.has(file.newPath) || stableFileId !== undefined) {
        throw new Error(`Tracked destination text is unavailable for ${file.newPath}`);
      }
      if (newText.kind === "binary") {
        newFiles[file.newPath] = { fileId, lineCount: 0 };
        continue;
      }
      throw new Error(`Destination content is unavailable for ${file.newPath}`);
    }

    return {
      ...evidence,
      diff,
      oldTexts,
      newFiles,
      updatedAt,
    };
  }
}

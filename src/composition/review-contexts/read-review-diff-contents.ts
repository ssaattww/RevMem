import type { PullRequestRemoteTextReadResult } from "../../application/github-pr-diff/index";
import type {
  GitCommitReviewDiffDocumentDescriptor,
  RevisionTextContentReadResult,
} from "../../application/diff-document/index";

/** Resolves unavailable local PR file reads through GitHub one at a time. */
export async function readReviewDiffContentsSequentially(
  descriptors: readonly GitCommitReviewDiffDocumentDescriptor[],
  local: ReadonlyMap<string, RevisionTextContentReadResult>,
  readRemote: (
    descriptor: GitCommitReviewDiffDocumentDescriptor,
    signal?: AbortSignal,
  ) => Promise<PullRequestRemoteTextReadResult>,
  signal?: AbortSignal,
): Promise<readonly RevisionTextContentReadResult[]> {
  const assertActive = (): void => {
    if (signal?.aborted === true) throw new DOMException("PR content acquisition was superseded.", "AbortError");
  };

  const results: RevisionTextContentReadResult[] = [];
  for (const descriptor of descriptors) {
    assertActive();
    const result = local.get(descriptor.filePath) ?? { kind: "missing-file" as const };
    if (result.kind === "found" || result.kind === "invalid-encoding") {
      results.push(result);
      continue;
    }

    assertActive();
    const fallback = await readRemote(descriptor, signal);
    assertActive();
    if (fallback.kind === "found") {
      results.push(fallback);
    } else if (fallback.kind === "binary") {
      results.push({ kind: "invalid-encoding", encoding: "utf-8" });
    } else if (fallback.reason === "missing-file") {
      results.push({ kind: "missing-file" });
    } else if (fallback.reason === "missing-revision") {
      results.push({ kind: "missing-revision" });
    } else {
      results.push(result.kind === "missing-revision"
        ? { kind: "missing-revision" }
        : { kind: "missing-file" });
    }
  }
  return results;
}

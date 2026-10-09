import type { ReviewContextState } from "../../core/contracts/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * 明示選択したPRを状態やローカルHEADとの差によらず保持する。
 * 明示選択がない場合は既存のopen/HEAD一致だけを自動候補にし、複数は確定しない。
 */
export function findCurrentPullRequestContext(
  contexts: readonly ReviewContextState[],
  repositoryId: string,
  headRevision: string,
  preferredContextId?: string,
  suppressAutomaticSelection = false,
): ReviewContextState | undefined {
  // 明示選択はローカルHEADに紐づけて保存済み。closed/mergedや履歴HEADも保持する。
  if (preferredContextId !== undefined) {
    const preferred = contexts.find(context => context.kind === "pull-request" &&
      context.repositoryId === repositoryId && context.pullRequest !== undefined && context.contextId === preferredContextId);
    if (preferred !== undefined) return clone(preferred);
  }
  const matches = contexts.filter((context) =>
    context.kind === "pull-request" &&
    context.repositoryId === repositoryId &&
    context.pullRequest !== undefined &&
    context.pullRequest.state === "open" &&
    context.pullRequest.headSha === headRevision
  );
  if (suppressAutomaticSelection) return undefined;
  return matches.length === 1 ? clone(matches[0]!) : undefined;
}

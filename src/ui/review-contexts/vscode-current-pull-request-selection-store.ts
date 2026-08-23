import * as vscode from "vscode";

import { currentPullRequestSelectionKey } from "./current-pull-request-selection";

const CURRENT_PULL_REQUEST_SELECTIONS_KEY = "reviewRange.currentPullRequestSelections.v2";
const branchScopeByRepositoryHead = new Map<string, string | undefined>();

const scopeIdentity = (repositoryId: string, headRevision: string): string =>
  `${repositoryId}\0${headRevision}`;

export const setCurrentPullRequestSelectionBranchScope = (
  repositoryId: string,
  headRevision: string,
  branchRef: string | undefined,
): void => {
  branchScopeByRepositoryHead.set(scopeIdentity(repositoryId, headRevision), branchRef);
};

const resolveBranchRef = (
  repositoryId: string,
  headRevision: string,
  branchRef: string | undefined,
): string | undefined => branchRef ?? branchScopeByRepositoryHead.get(scopeIdentity(repositoryId, headRevision));

const readSelections = (state: vscode.Memento): Record<string, string | false> => {
  const raw = state.get<unknown>(CURRENT_PULL_REQUEST_SELECTIONS_KEY, {});
  const selections: Record<string, string | false> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return selections;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if ((typeof value === "string" && value.trim().length > 0) || value === false) {
      selections[key] = value;
    }
  }
  return selections;
};

/** Remembers an explicit PR or branch choice for one branch at one immutable HEAD. */
export class VscodeCurrentPullRequestSelectionStore {
  public constructor(private readonly state: vscode.Memento) {}

  public read(repositoryId: string, headRevision: string, branchRef?: string): string | undefined {
    const key = currentPullRequestSelectionKey(
      repositoryId,
      headRevision,
      resolveBranchRef(repositoryId, headRevision, branchRef),
    );
    const value = readSelections(this.state)[key];
    return typeof value === "string" ? value : undefined;
  }

  public async select(
    repositoryId: string,
    headRevision: string,
    contextId: string,
    branchRef?: string,
  ): Promise<void> {
    if (contextId.trim().length === 0) throw new TypeError("contextId must not be empty");
    const selections = readSelections(this.state);
    const resolved = resolveBranchRef(repositoryId, headRevision, branchRef);
    selections[currentPullRequestSelectionKey(repositoryId, headRevision, resolved)] = contextId;
    await this.state.update(CURRENT_PULL_REQUEST_SELECTIONS_KEY, selections);
  }

  public async clear(repositoryId: string, headRevision: string, branchRef?: string): Promise<void> {
    const selections = readSelections(this.state);
    const resolved = resolveBranchRef(repositoryId, headRevision, branchRef);
    delete selections[currentPullRequestSelectionKey(repositoryId, headRevision, resolved)];
    await this.state.update(CURRENT_PULL_REQUEST_SELECTIONS_KEY, selections);
  }

  public async selectBranch(repositoryId: string, headRevision: string, branchRef?: string): Promise<void> {
    const selections = readSelections(this.state);
    const resolved = resolveBranchRef(repositoryId, headRevision, branchRef);
    selections[currentPullRequestSelectionKey(repositoryId, headRevision, resolved)] = false;
    await this.state.update(CURRENT_PULL_REQUEST_SELECTIONS_KEY, selections);
  }

  public prefersBranch(repositoryId: string, headRevision: string, branchRef?: string): boolean {
    const resolved = resolveBranchRef(repositoryId, headRevision, branchRef);
    return readSelections(this.state)[
      currentPullRequestSelectionKey(repositoryId, headRevision, resolved)
    ] === false;
  }
}

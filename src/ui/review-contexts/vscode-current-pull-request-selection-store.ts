import * as vscode from "vscode";

import { currentPullRequestSelectionKey } from "./current-pull-request-selection";

const CURRENT_PULL_REQUEST_SELECTIONS_KEY = "reviewRange.currentPullRequestSelections.v2";

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

/** Remembers an explicit PR or branch choice for one local branch at one immutable HEAD. */
export class VscodeCurrentPullRequestSelectionStore {
  public constructor(private readonly state: vscode.Memento) {}

  public read(repositoryId: string, headRevision: string, branchRef?: string): string | undefined {
    const value = readSelections(this.state)[currentPullRequestSelectionKey(repositoryId, headRevision, branchRef)];
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
    selections[currentPullRequestSelectionKey(repositoryId, headRevision, branchRef)] = contextId;
    await this.state.update(CURRENT_PULL_REQUEST_SELECTIONS_KEY, selections);
  }

  public async clear(repositoryId: string, headRevision: string, branchRef?: string): Promise<void> {
    const selections = readSelections(this.state);
    delete selections[currentPullRequestSelectionKey(repositoryId, headRevision, branchRef)];
    await this.state.update(CURRENT_PULL_REQUEST_SELECTIONS_KEY, selections);
  }

  /** Records an explicit branch/no-PR choice that suppresses saved-PR auto-inference only on this branch. */
  public async selectBranch(repositoryId: string, headRevision: string, branchRef?: string): Promise<void> {
    const selections = readSelections(this.state);
    selections[currentPullRequestSelectionKey(repositoryId, headRevision, branchRef)] = false;
    await this.state.update(CURRENT_PULL_REQUEST_SELECTIONS_KEY, selections);
  }

  /** Returns whether this branch at this HEAD has an explicit branch/no-PR choice. */
  public prefersBranch(repositoryId: string, headRevision: string, branchRef?: string): boolean {
    return readSelections(this.state)[currentPullRequestSelectionKey(repositoryId, headRevision, branchRef)] === false;
  }
}

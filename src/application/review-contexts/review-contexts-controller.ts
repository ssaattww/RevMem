import { isPullRequestDecorationEnabled } from "../github-pr-context/index";
import type { ReviewContextState } from "../../core/contracts/index";

/** Presentation groups required by the Review Contexts View. */
export type ReviewContextListGroup =
  | "current-pull-request"
  | "current-branch"
  | "saved-open-pull-request"
  | "saved-closed-pull-request"
  | "workspace";

/** One context projected for the T405 Review Contexts View. */
export interface ReviewContextListItem {
  readonly context: ReviewContextState;
  readonly current: boolean;
  readonly group: ReviewContextListGroup;
  readonly label: string;
  readonly description?: string;
  readonly layerEnabled?: boolean;
}

/** Inputs for deterministic current/saved context projection. */
export interface ReviewContextsProjectionInput {
  readonly current: readonly ReviewContextState[];
  readonly saved: readonly ReviewContextState[];
  readonly hiddenContextIds: ReadonlySet<string>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const groupFor = (
  context: ReviewContextState,
  current: boolean
): ReviewContextListGroup | undefined => {
  if (context.kind === "pull-request") {
    if (current) return "current-pull-request";
    return context.pullRequest?.state === "open"
      ? "saved-open-pull-request"
      : "saved-closed-pull-request";
  }
  if (context.kind === "branch") {
    return current ? "current-branch" : undefined;
  }
  if (context.kind === "workspace") return "workspace";
  return undefined;
};

const labelFor = (context: ReviewContextState): string => {
  if (context.kind === "pull-request" && context.pullRequest !== undefined) {
    return `PR #${context.pullRequest.number}`;
  }
  if (context.kind === "branch") return `Branch: ${context.displayName}`;
  return `Workspace: ${context.displayName}`;
};

const descriptionFor = (context: ReviewContextState): string | undefined => {
  if (context.kind !== "pull-request" || context.pullRequest === undefined) {
    return undefined;
  }
  const state = context.pullRequest.state;
  return context.pullRequest.title === undefined
    ? state
    : `${context.pullRequest.title} · ${state}`;
};

const GROUP_ORDER: Record<ReviewContextListGroup, number> = {
  "current-pull-request": 0,
  "current-branch": 1,
  "saved-open-pull-request": 2,
  "saved-closed-pull-request": 3,
  workspace: 4,
};

const toItem = (
  context: ReviewContextState,
  current: boolean,
  group: ReviewContextListGroup
): ReviewContextListItem => ({
  context: clone(context),
  current,
  group,
  label: labelFor(context),
  description: descriptionFor(context),
  ...(context.kind === "pull-request" && context.pullRequest !== undefined
    ? { layerEnabled: isPullRequestDecorationEnabled(context.pullRequest) }
    : {}),
});

/**
 * Projects current and saved contexts in the design-defined View order.
 * Current identities win over saved duplicates and cannot be hidden; hiding only
 * removes a non-current presentation row and never removes persisted review state.
 */
export const projectReviewContexts = (
  input: ReviewContextsProjectionInput
): ReviewContextListItem[] => {
  const currentIds = new Set(input.current.map((context) => context.contextId));
  const candidates: ReviewContextListItem[] = [];

  for (const context of input.current) {
    const group = groupFor(context, true);
    if (group !== undefined) candidates.push(toItem(context, true, group));
  }
  for (const context of input.saved) {
    if (
      currentIds.has(context.contextId) ||
      input.hiddenContextIds.has(context.contextId)
    ) continue;
    const group = groupFor(context, false);
    if (group !== undefined) candidates.push(toItem(context, false, group));
  }

  const unique = new Map<string, ReviewContextListItem>();
  for (const item of candidates) {
    if (!unique.has(item.context.contextId)) unique.set(item.context.contextId, item);
  }
  return [...unique.values()].sort((left, right) =>
    GROUP_ORDER[left.group] - GROUP_ORDER[right.group] ||
    left.label.localeCompare(right.label) ||
    left.context.contextId.localeCompare(right.context.contextId)
  );
};

/** Presentation-only persistence boundary; authoritative Review State and history are deliberately absent. */
export interface ReviewContextVisibilityStore {
  readHiddenContextIds(): Promise<readonly string[]>;
  hide(contextId: string): Promise<void>;
}

/** Small deterministic visibility store used by application tests and non-VS-Code hosts. */
export class InMemoryReviewContextVisibilityStore implements ReviewContextVisibilityStore {
  private readonly hidden = new Set<string>();

  public async readHiddenContextIds(): Promise<readonly string[]> {
    return [...this.hidden].sort();
  }

  public async hide(contextId: string): Promise<void> {
    if (contextId.trim().length === 0) throw new TypeError("contextId must not be empty");
    this.hidden.add(contextId);
  }
}

/** Runtime actions delegated by the Review Contexts controller. */
export interface ReviewContextsControllerDependencies {
  readonly visibility: ReviewContextVisibilityStore;
  readonly setPullRequestLayerEnabled: (
    context: ReviewContextState,
    enabled: boolean
  ) => Promise<void>;
  readonly refreshPullRequestCache: (context: ReviewContextState) => Promise<void>;
  readonly openPullRequestDiff: (context: ReviewContextState) => Promise<void>;
  readonly redetectPullRequest: () => Promise<void>;
  readonly reconnectGitHub: () => Promise<void>;
}

const requirePullRequest = (context: ReviewContextState): void => {
  if (context.kind !== "pull-request" || context.pullRequest === undefined) {
    throw new TypeError("This Review Contexts operation requires a pull-request context");
  }
};

/** Coordinates T405 actions without owning Review State or history deletion. */
export class ReviewContextsController {
  public constructor(private readonly dependencies: ReviewContextsControllerDependencies) {}

  public hide(contextId: string): Promise<void> {
    return this.dependencies.visibility.hide(contextId);
  }

  public async setLayerEnabled(
    context: ReviewContextState,
    enabled: boolean
  ): Promise<void> {
    requirePullRequest(context);
    await this.dependencies.setPullRequestLayerEnabled(clone(context), enabled);
  }

  public async refreshCache(context: ReviewContextState): Promise<void> {
    requirePullRequest(context);
    await this.dependencies.refreshPullRequestCache(clone(context));
  }

  public async openDiff(context: ReviewContextState): Promise<void> {
    requirePullRequest(context);
    await this.dependencies.openPullRequestDiff(clone(context));
  }

  public redetectPullRequest(): Promise<void> {
    return this.dependencies.redetectPullRequest();
  }

  public reconnectGitHub(): Promise<void> {
    return this.dependencies.reconnectGitHub();
  }
}

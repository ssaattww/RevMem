import { isPullRequestDecorationEnabled } from "../github-pr-context/index";
import type { OperationFeedbackContext } from "../operation-feedback/index";
import type { ReviewContextState } from "../../core/contracts/index";

/** Presentation groups required by the Review Contexts View. */
export type ReviewContextListGroup =
  | "current-pull-request"
  | "current-branch"
  | "saved-open-pull-request"
  | "saved-closed-pull-request"
  | "workspace";

/** Aggregate PR progress projected beside one Review Contexts row. */
export interface ReviewContextListProgress {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
}

/** Review Contexts Viewへ表示するPR cacheの取得元・鮮度・最終成功時刻。 */
export type ReviewContextCacheStatus =
  | {
      readonly origin: "live" | "offline";
      readonly freshness: "fresh" | "stale" | "not-cached";
      readonly updatedAt?: string;
    }
  | {
      readonly origin: "unavailable";
      readonly freshness: "unavailable";
    };

/** Formats one PR progress snapshot for a user-visible Review Contexts row or tooltip. */
export const formatReviewContextProgress = (
  progress: ReviewContextListProgress | undefined
): string | undefined => progress === undefined
  ? undefined
  : `進捗: ${Math.round(progress.progress * 100)}% (${progress.reviewedLineCount}/${progress.totalLineCount})`;

/** PR cacheの取得状態をReview Contexts Viewで判別可能な文言へ整形する。 */
export const formatReviewContextCacheStatus = (
  cache: ReviewContextCacheStatus | undefined
): string | undefined => {
  if (cache === undefined) return undefined;
  if (cache.origin === "unavailable") return "Cache: 更新失敗";
  const parts = [`Cache: ${cache.origin}`, cache.freshness];
  if (cache.updatedAt !== undefined) parts.push(`更新: ${cache.updatedAt}`);
  return parts.join(" · ");
};

/** One context projected for the T405 Review Contexts View. */
export interface ReviewContextListItem {
  readonly context: ReviewContextState;
  readonly current: boolean;
  readonly group: ReviewContextListGroup;
  readonly label: string;
  readonly description?: string;
  readonly layerEnabled?: boolean;
  readonly progress?: ReviewContextListProgress;
  /** PR cacheの取得元・鮮度・最終成功時刻。 */
  readonly cache?: ReviewContextCacheStatus;
}

/** Inputs for deterministic current/saved context projection. */
export interface ReviewContextsProjectionInput {
  readonly current: readonly ReviewContextState[];
  readonly saved: readonly ReviewContextState[];
  readonly hiddenContextIds: ReadonlySet<string>;
  readonly progressByContextId?: Readonly<Record<string, ReviewContextListProgress>>;
  /** contextId単位で保持したPR cacheの表示状態。 */
  readonly cacheByContextId?: Readonly<Record<string, ReviewContextCacheStatus>>;
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
  group: ReviewContextListGroup,
  progress: ReviewContextListProgress | undefined,
  cache: ReviewContextCacheStatus | undefined
): ReviewContextListItem => ({
  context: clone(context),
  current,
  group,
  label: labelFor(context),
  description: descriptionFor(context),
  ...(context.kind === "pull-request" && context.pullRequest !== undefined
    ? {
        layerEnabled: isPullRequestDecorationEnabled(context.pullRequest),
        ...(progress === undefined ? {} : { progress: { ...progress } }),
        ...(cache === undefined ? {} : { cache: { ...cache } }),
      }
    : {}),
});

/**
 * Projects current and saved contexts in the design-defined View order.
 * Hiding is presentation-only but applies uniformly to current and saved rows;
 * authoritative Review State and history remain untouched.
 */
export const projectReviewContexts = (
  input: ReviewContextsProjectionInput
): ReviewContextListItem[] => {
  const currentIds = new Set(input.current.map((context) => context.contextId));
  const candidates: ReviewContextListItem[] = [];

  for (const context of input.current) {
    if (input.hiddenContextIds.has(context.contextId)) continue;
    const group = groupFor(context, true);
    if (group !== undefined) {
      candidates.push(toItem(
        context,
        true,
        group,
        input.progressByContextId?.[context.contextId],
        input.cacheByContextId?.[context.contextId]
      ));
    }
  }
  for (const context of input.saved) {
    if (
      currentIds.has(context.contextId) ||
      input.hiddenContextIds.has(context.contextId)
    ) continue;
    const group = groupFor(context, false);
    if (group !== undefined) {
      candidates.push(toItem(
        context,
        false,
        group,
        input.progressByContextId?.[context.contextId],
        input.cacheByContextId?.[context.contextId]
      ));
    }
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
    enabled: boolean,
    feedbackContext?: OperationFeedbackContext,
  ) => Promise<void>;
  readonly refreshPullRequestCache: (context: ReviewContextState, feedbackContext?: OperationFeedbackContext) => Promise<void>;
  readonly openPullRequestDiff: (context: ReviewContextState, feedbackContext?: OperationFeedbackContext) => Promise<void>;
  readonly redetectPullRequest: (feedbackContext?: OperationFeedbackContext) => Promise<void>;
  readonly reconnectGitHub: (feedbackContext?: OperationFeedbackContext) => Promise<void>;
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
    enabled: boolean,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<void> {
    requirePullRequest(context);
    await this.dependencies.setPullRequestLayerEnabled(clone(context), enabled, feedbackContext);
  }

  public async refreshCache(context: ReviewContextState, feedbackContext?: OperationFeedbackContext): Promise<void> {
    requirePullRequest(context);
    await this.dependencies.refreshPullRequestCache(clone(context), feedbackContext);
  }

  public async openDiff(context: ReviewContextState, feedbackContext?: OperationFeedbackContext): Promise<void> {
    requirePullRequest(context);
    await this.dependencies.openPullRequestDiff(clone(context), feedbackContext);
  }

  public redetectPullRequest(feedbackContext?: OperationFeedbackContext): Promise<void> {
    return this.dependencies.redetectPullRequest(feedbackContext);
  }

  public reconnectGitHub(feedbackContext?: OperationFeedbackContext): Promise<void> {
    return this.dependencies.reconnectGitHub(feedbackContext);
  }
}

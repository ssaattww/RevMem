import {
  ReviewFileExclusionPolicy,
  type ReviewFileExclusionCandidate,
  type ReviewFileExclusionDecision
} from "../../core/file-exclusion/index";

/** Constructor options for the shared policy service. Omitted entries use manifest defaults. */
export interface ReviewFileExclusionPolicyServiceOptions {
  /**
   * Raw setting entries or a replay-safe canonical snapshot. Omission uses manifest defaults,
   * while an explicit empty array retains only binary and `.git` exclusion.
   */
  readonly userGlobs?: readonly string[];
}

/** Immutable notification emitted when the normalized effective policy changes. */
export interface ReviewFileExclusionPolicyChangeEvent {
  /** Monotonic revision assigned to this new policy snapshot. */
  readonly revision: number;
  /** Detached replay-safe canonical decision-bearing entries for this revision. */
  readonly userGlobs: readonly string[];
}

/** Releases one exclusion-policy change subscription. */
export interface ReviewFileExclusionPolicyChangeDisposable {
  /** Stops future notifications for the associated listener. */
  dispose(): void;
}

/** Receives a detached event after a normalized effective policy change. */
export type ReviewFileExclusionPolicyChangeListener = (
  event: Readonly<ReviewFileExclusionPolicyChangeEvent>
) => void;

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

let activeReviewFileExclusionPolicyService: ReviewFileExclusionPolicyService | undefined;

/** Returns the policy service created by the active extension composition root. */
export const getActiveReviewFileExclusionPolicyService = (): ReviewFileExclusionPolicyService => {
  if (activeReviewFileExclusionPolicyService === undefined) {
    throw new Error("The shared exclusion policy service is not active.");
  }
  return activeReviewFileExclusionPolicyService;
};

/** Owns the current shared file-exclusion policy and publishes effective setting changes. */
export class ReviewFileExclusionPolicyService {
  private policy: ReviewFileExclusionPolicy;
  private readonly listeners = new Set<ReviewFileExclusionPolicyChangeListener>();
  private revision = 0;

  public constructor(options: ReviewFileExclusionPolicyServiceOptions = {}) {
    this.policy = new ReviewFileExclusionPolicy({ userGlobs: options.userGlobs });
    activeReviewFileExclusionPolicyService = this;
  }

  /** Evaluates one changed file using the current immutable policy snapshot. */
  public evaluate(candidate: Readonly<ReviewFileExclusionCandidate>): ReviewFileExclusionDecision {
    return this.policy.evaluate(candidate);
  }

  /** Evaluates whether a directory subtree can be pruned using the current policy snapshot. */
  public evaluateDirectory(path: string): ReviewFileExclusionDecision {
    return this.policy.evaluateDirectory(path);
  }

  /** Returns a detached replay-safe canonical snapshot of the current decision-bearing effective setting. */
  public getUserGlobs(): readonly string[] {
    return [...this.policy.getUserGlobs()];
  }

  /** Returns the monotonic revision used by progress caches and runtime tests. */
  public getRevision(): number {
    return this.revision;
  }

  /** Replaces raw or canonical entries and notifies only when the decision-bearing canonical snapshot changed. */
  public updateUserGlobs(userGlobs: readonly string[]): boolean {
    const nextPolicy = new ReviewFileExclusionPolicy({ userGlobs });
    const currentGlobs = this.policy.getUserGlobs();
    const nextGlobs = nextPolicy.getUserGlobs();
    if (sameStrings(currentGlobs, nextGlobs)) {
      return false;
    }

    this.policy = nextPolicy;
    const event: ReviewFileExclusionPolicyChangeEvent = {
      revision: ++this.revision,
      userGlobs: [...nextGlobs]
    };
    for (const listener of [...this.listeners]) listener(event);
    return true;
  }

  /** Subscribes to effective policy changes. Disposal is idempotent. */
  public onDidChange(
    listener: ReviewFileExclusionPolicyChangeListener
  ): ReviewFileExclusionPolicyChangeDisposable {
    this.listeners.add(listener);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.listeners.delete(listener);
      }
    };
  }
}

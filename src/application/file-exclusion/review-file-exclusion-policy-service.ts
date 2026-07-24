import {
  ReviewFileExclusionPolicy,
  type ReviewFileExclusionCandidate,
  type ReviewFileExclusionDecision
} from "../../core/file-exclusion/index";

/** Constructor options for the application-level shared exclusion policy service. */
export interface ReviewFileExclusionPolicyServiceOptions {
  /** Initial user-configured exclusion globs. */
  readonly userGlobs?: readonly string[];
}

/** Notification emitted after a semantically different exclusion setting is applied. */
export interface ReviewFileExclusionPolicyChangeEvent {
  /** Monotonic service-local revision, starting at one for the first effective change. */
  readonly revision: number;
  /** Detached normalized user-glob snapshot used by the new policy. */
  readonly userGlobs: readonly string[];
}

/** Minimal disposable returned by exclusion-policy change subscriptions. */
export interface ReviewFileExclusionPolicyChangeDisposable {
  dispose(): void;
}

/** Listener invoked synchronously after an exclusion-policy snapshot is replaced. */
export type ReviewFileExclusionPolicyChangeListener = (
  event: Readonly<ReviewFileExclusionPolicyChangeEvent>
) => void;

const sameStrings = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * Owns the current shared file-exclusion policy and publishes effective setting changes.
 *
 * PR progress and Global enumeration depend on this application boundary instead of creating
 * independent matchers. Replacing user globs immediately changes subsequent evaluations and
 * notifies consumers so cached progress can be recomputed from the same normalized snapshot.
 */
export class ReviewFileExclusionPolicyService {
  private policy: ReviewFileExclusionPolicy;
  private readonly listeners = new Set<ReviewFileExclusionPolicyChangeListener>();
  private revision = 0;

  public constructor(options: ReviewFileExclusionPolicyServiceOptions = {}) {
    this.policy = new ReviewFileExclusionPolicy({ userGlobs: options.userGlobs });
  }

  /** Evaluates one changed file using the current immutable policy snapshot. */
  public evaluate(
    candidate: Readonly<ReviewFileExclusionCandidate>
  ): ReviewFileExclusionDecision {
    return this.policy.evaluate(candidate);
  }

  /** Returns a detached normalized snapshot of the current user globs. */
  public getUserGlobs(): readonly string[] {
    return [...this.policy.getUserGlobs()];
  }

  /**
   * Replaces user globs and notifies subscribers only when normalized semantics changed.
   *
   * @returns `true` when a new policy snapshot was installed; otherwise `false`.
   */
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
    for (const listener of [...this.listeners]) {
      listener(event);
    }
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
        if (disposed) {
          return;
        }
        disposed = true;
        this.listeners.delete(listener);
      }
    };
  }
}

import {
  ReviewFileExclusionPolicy,
  type ReviewFileExclusionCandidate,
  type ReviewFileExclusionDecision
} from "../../core/file-exclusion/index";

export interface ReviewFileExclusionPolicyServiceOptions {
  readonly userGlobs?: readonly string[];
}

export interface ReviewFileExclusionPolicyChangeEvent {
  readonly revision: number;
  readonly userGlobs: readonly string[];
}

export interface ReviewFileExclusionPolicyChangeDisposable {
  dispose(): void;
}

export type ReviewFileExclusionPolicyChangeListener = (
  event: Readonly<ReviewFileExclusionPolicyChangeEvent>
) => void;

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/** Owns the current shared file-exclusion policy and publishes effective setting changes. */
export class ReviewFileExclusionPolicyService {
  private policy: ReviewFileExclusionPolicy;
  private readonly listeners = new Set<ReviewFileExclusionPolicyChangeListener>();
  private revision = 0;

  public constructor(options: ReviewFileExclusionPolicyServiceOptions = {}) {
    this.policy = new ReviewFileExclusionPolicy({ userGlobs: options.userGlobs });
  }

  /** Evaluates one changed file using the current immutable policy snapshot. */
  public evaluate(candidate: Readonly<ReviewFileExclusionCandidate>): ReviewFileExclusionDecision {
    return this.policy.evaluate(candidate);
  }

  /** Returns a detached normalized snapshot of the current user globs. */
  public getUserGlobs(): readonly string[] {
    return [...this.policy.getUserGlobs()];
  }

  /** Returns the monotonic revision used by progress caches and runtime tests. */
  public getRevision(): number {
    return this.revision;
  }

  /** Replaces user globs and notifies subscribers only when normalized semantics changed. */
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

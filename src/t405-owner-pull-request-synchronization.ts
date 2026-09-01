import { isDeepStrictEqual } from "node:util";

import type {
  ReviewStateRepositorySnapshot,
  ReviewStateRepositoryTransactionLike,
} from "./adapters/state-repository/index";
import type {
  PreparedPullRequestContextUpdate,
  PullRequestReviewStateCommit,
  UpdatePullRequestContextInput,
} from "./application/github-pr-context/index";
import type { ReviewContextState } from "./core/contracts/index";

export interface PullRequestOwnerSynchronizationTarget {
  readonly repositoryId: string;
  readonly headRevision: string;
}

export interface PullRequestOwnerSynchronizationRepository {
  loadRepositorySnapshot(repositoryId: string): Promise<ReviewStateRepositorySnapshot | undefined>;
  commitRepository(transaction: Readonly<ReviewStateRepositoryTransactionLike>): Promise<void>;
}

export interface PullRequestOwnerSynchronizationDependencies {
  readonly repository: PullRequestOwnerSynchronizationRepository;
  readonly resolveUpdate: (
    context: Readonly<ReviewContextState>,
    signal?: AbortSignal,
  ) => Promise<UpdatePullRequestContextInput | undefined>;
  readonly prepareUpdate: (
    input: UpdatePullRequestContextInput,
    current: PullRequestReviewStateCommit,
  ) => Promise<PreparedPullRequestContextUpdate>;
  readonly recordPreparedUpdateHistory: (
    prepared: Readonly<PreparedPullRequestContextUpdate>,
  ) => Promise<void>;
}

export interface PullRequestOwnerSynchronizationResult {
  readonly committed: boolean;
  readonly mappedContextIds: readonly string[];
  readonly skippedRevisionContextIds: readonly string[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const withoutUpdatedAt = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutUpdatedAt);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "updatedAt")
      .map(([key, child]) => [key, withoutUpdatedAt(child)]),
  );
};

const globalStatesEquivalent = (
  left: Readonly<ReviewStateRepositorySnapshot["globalState"]>,
  right: Readonly<ReviewStateRepositorySnapshot["globalState"]>,
): boolean => isDeepStrictEqual(withoutUpdatedAt(left), withoutUpdatedAt(right));

const assertCurrent = (signal?: AbortSignal): void => {
  if (signal?.aborted === true) {
    throw new DOMException("Pull-request owner synchronization was superseded.", "AbortError");
  }
};

const semanticUpdateRequired = (
  context: Readonly<ReviewContextState>,
  input: Readonly<UpdatePullRequestContextInput>,
): boolean =>
  context.displayName !== (input.displayName ?? context.displayName) ||
  !isDeepStrictEqual(context.pullRequest, input.pullRequest);

/**
 * Plans every eligible pull-request lifecycle update against one immutable
 * repository-owner generation, then publishes all Contexts and the single
 * Global snapshot through one manifest-level CAS.
 */
export const synchronizePullRequestOwner = async (
  target: Readonly<PullRequestOwnerSynchronizationTarget>,
  dependencies: Readonly<PullRequestOwnerSynchronizationDependencies>,
  signal?: AbortSignal,
): Promise<PullRequestOwnerSynchronizationResult> => {
  assertCurrent(signal);
  const expected = await dependencies.repository.loadRepositorySnapshot(target.repositoryId);
  assertCurrent(signal);
  if (expected === undefined) {
    return { committed: false, mappedContextIds: [], skippedRevisionContextIds: [] };
  }
  if (expected.repositoryId !== target.repositoryId) {
    throw new Error("Repository-owner synchronization loaded a foreign owner snapshot.");
  }

  const nextContexts = new Map(
    expected.contextStates.map((context) => [context.contextId, clone(context)]),
  );
  const preparedUpdates: PreparedPullRequestContextUpdate[] = [];
  const mappedContextIds: string[] = [];
  const skippedRevisionContextIds: string[] = [];
  let mappedGlobal: ReviewStateRepositorySnapshot["globalState"] | undefined;

  for (const context of expected.contextStates) {
    assertCurrent(signal);
    if (context.kind !== "pull-request" || context.pullRequest === undefined) continue;
    const input = await dependencies.resolveUpdate(context, signal);
    assertCurrent(signal);
    if (input === undefined || !semanticUpdateRequired(context, input)) continue;

    const revisionChanged =
      context.pullRequest.baseSha !== input.pullRequest.baseSha ||
      context.pullRequest.headSha !== input.pullRequest.headSha;
    if (
      revisionChanged &&
      (
        input.pullRequest.headSha !== target.headRevision ||
        context.pullRequest.headSha !== expected.globalState.currentRevisionId
      )
    ) {
      skippedRevisionContextIds.push(context.contextId);
      continue;
    }

    const current: PullRequestReviewStateCommit = {
      contextState: clone(context),
      globalState: clone(expected.globalState),
    };
    const prepared = await dependencies.prepareUpdate(input, current);
    assertCurrent(signal);
    if (
      prepared.repositoryId !== target.repositoryId ||
      prepared.contextId !== context.contextId ||
      !isDeepStrictEqual(prepared.expected.contextState, current.contextState) ||
      !isDeepStrictEqual(prepared.expected.globalState, current.globalState)
    ) {
      throw new Error("Prepared pull-request update does not match the repository-owner source generation.");
    }

    if (revisionChanged) {
      if (!prepared.revisionChanged) {
        throw new Error("Prepared pull-request update lost a required revision transition.");
      }
      if (
        prepared.next.contextState.pullRequest?.headSha !== target.headRevision ||
        prepared.next.globalState.currentRevisionId !== target.headRevision
      ) {
        throw new Error("Prepared pull-request update does not target the repository-owner revision.");
      }
      if (mappedGlobal === undefined) {
        mappedGlobal = clone(prepared.next.globalState);
      } else if (!globalStatesEquivalent(mappedGlobal, prepared.next.globalState)) {
        throw new Error("Pull-request updates produced conflicting owner-wide Global snapshots.");
      }
      mappedContextIds.push(context.contextId);
    } else {
      if (prepared.revisionChanged || !isDeepStrictEqual(prepared.next.globalState, expected.globalState)) {
        throw new Error("Metadata-only pull-request synchronization cannot mutate owner-wide Global state.");
      }
    }

    nextContexts.set(context.contextId, clone(prepared.next.contextState));
    preparedUpdates.push(prepared);
  }

  if (preparedUpdates.length === 0) {
    return {
      committed: false,
      mappedContextIds,
      skippedRevisionContextIds,
    };
  }

  const next: ReviewStateRepositorySnapshot = {
    schemaVersion: expected.schemaVersion,
    repositoryId: expected.repositoryId,
    contextStates: [...nextContexts.values()].sort((left, right) => left.contextId.localeCompare(right.contextId)),
    globalState: clone(mappedGlobal ?? expected.globalState),
  };
  assertCurrent(signal);
  await dependencies.repository.commitRepository({
    repositoryId: target.repositoryId,
    expected,
    next,
  });

  for (const prepared of preparedUpdates.sort((left, right) => left.contextId.localeCompare(right.contextId))) {
    await dependencies.recordPreparedUpdateHistory(prepared);
  }

  return {
    committed: true,
    mappedContextIds,
    skippedRevisionContextIds,
  };
};

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
  readonly prepareOwnerGlobal?: (
    current: Readonly<ReviewStateRepositorySnapshot["globalState"]>,
    targetRevision: string,
    signal?: AbortSignal,
  ) => Promise<ReviewStateRepositorySnapshot["globalState"]>;
  readonly recordPreparedUpdateHistory: (
    prepared: Readonly<PreparedPullRequestContextUpdate>,
  ) => Promise<void>;
}

export interface PullRequestOwnerSynchronizationResult {
  readonly committed: boolean;
  readonly mappedContextIds: readonly string[];
  readonly skippedRevisionContextIds: readonly string[];
  readonly unavailableContextIds: readonly string[];
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

const globalAtRevision = (
  globalState: Readonly<ReviewStateRepositorySnapshot["globalState"]>,
  revisionId: string,
): ReviewStateRepositorySnapshot["globalState"] | undefined => {
  if (globalState.currentRevisionId === revisionId) return clone(globalState);
  const snapshot = globalState.revisionSnapshots?.[revisionId];
  if (snapshot === undefined) return undefined;
  return {
    ...clone(globalState),
    currentRevisionId: revisionId,
    files: clone(snapshot.files),
    updatedAt: snapshot.updatedAt,
  };
};

const metadataOnlyInput = (
  context: Readonly<ReviewContextState>,
  input: Readonly<UpdatePullRequestContextInput>,
): UpdatePullRequestContextInput => {
  if (context.pullRequest === undefined) {
    throw new Error("Deferred pull-request synchronization requires persisted pull-request metadata.");
  }
  return {
    ...clone(input),
    pullRequest: {
      ...clone(input.pullRequest),
      baseSha: context.pullRequest.baseSha,
      headSha: context.pullRequest.headSha,
    },
  };
};

const emptyResult = (
  unavailableContextIds: readonly string[] = [],
): PullRequestOwnerSynchronizationResult => ({
  committed: false,
  mappedContextIds: [],
  skippedRevisionContextIds: [],
  unavailableContextIds: [...unavailableContextIds].sort(),
});

/**
 * Plans every pull-request lifecycle update against one immutable owner
 * generation, then publishes all Contexts and one Global snapshot through a
 * single manifest-level CAS. No state or history is written until every
 * lifecycle read and every mapping plan has succeeded.
 */
export const synchronizePullRequestOwner = async (
  target: Readonly<PullRequestOwnerSynchronizationTarget>,
  dependencies: Readonly<PullRequestOwnerSynchronizationDependencies>,
  signal?: AbortSignal,
): Promise<PullRequestOwnerSynchronizationResult> => {
  assertCurrent(signal);
  const expected = await dependencies.repository.loadRepositorySnapshot(target.repositoryId);
  assertCurrent(signal);
  if (expected === undefined) return emptyResult();
  if (expected.repositoryId !== target.repositoryId) {
    throw new Error("Repository-owner synchronization loaded a foreign owner snapshot.");
  }

  const resolvedUpdates = new Map<string, UpdatePullRequestContextInput>();
  const unavailableContextIds: string[] = [];
  for (const context of expected.contextStates) {
    assertCurrent(signal);
    if (context.kind !== "pull-request" || context.pullRequest === undefined) continue;
    const input = await dependencies.resolveUpdate(context, signal);
    assertCurrent(signal);
    if (input === undefined) {
      unavailableContextIds.push(context.contextId);
      continue;
    }
    resolvedUpdates.set(context.contextId, clone(input));
  }
  if (unavailableContextIds.length > 0) {
    return emptyResult(unavailableContextIds);
  }

  const nextContexts = new Map(
    expected.contextStates.map((context) => [context.contextId, clone(context)]),
  );
  const preparedUpdates: PreparedPullRequestContextUpdate[] = [];
  const revisionUpdates: PreparedPullRequestContextUpdate[] = [];
  const mappedContextIds: string[] = [];
  const skippedRevisionContextIds: string[] = [];
  let mappedGlobal: ReviewStateRepositorySnapshot["globalState"] | undefined;

  for (const context of expected.contextStates) {
    assertCurrent(signal);
    if (context.kind !== "pull-request" || context.pullRequest === undefined) continue;
    const resolved = resolvedUpdates.get(context.contextId);
    if (resolved === undefined) {
      throw new Error("Repository-owner synchronization lost acquired pull-request lifecycle metadata.");
    }

    const revisionChanged =
      context.pullRequest.baseSha !== resolved.pullRequest.baseSha ||
      context.pullRequest.headSha !== resolved.pullRequest.headSha;
    const revisionEligible =
      !revisionChanged || resolved.pullRequest.headSha === target.headRevision;
    const input = revisionEligible ? resolved : metadataOnlyInput(context, resolved);
    if (!revisionEligible) skippedRevisionContextIds.push(context.contextId);
    if (!semanticUpdateRequired(context, input)) continue;

    const sourceGlobal = revisionChanged
      ? globalAtRevision(expected.globalState, context.pullRequest.headSha)
      : clone(expected.globalState);
    if (sourceGlobal === undefined) {
      skippedRevisionContextIds.push(context.contextId);
      continue;
    }
    const current: PullRequestReviewStateCommit = {
      contextState: clone(context),
      globalState: sourceGlobal,
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

    if (revisionEligible && revisionChanged) {
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
        mappedGlobal = dependencies.prepareOwnerGlobal === undefined
          ? clone(prepared.next.globalState)
          : await dependencies.prepareOwnerGlobal(expected.globalState, target.headRevision, signal);
        assertCurrent(signal);
        if (
          mappedGlobal.repositoryId !== target.repositoryId ||
          mappedGlobal.currentRevisionId !== target.headRevision
        ) {
          throw new Error("Prepared owner-wide Global snapshot does not target the repository-owner revision.");
        }
      } else if (
        dependencies.prepareOwnerGlobal === undefined &&
        !globalStatesEquivalent(mappedGlobal, prepared.next.globalState)
      ) {
        throw new Error("Pull-request updates produced conflicting owner-wide Global snapshots.");
      }
      mappedContextIds.push(context.contextId);
      revisionUpdates.push(prepared);
    } else if (
      prepared.revisionChanged ||
      !isDeepStrictEqual(prepared.next.globalState, expected.globalState)
    ) {
      throw new Error("Metadata-only pull-request synchronization cannot mutate owner-wide Global state.");
    }

    nextContexts.set(context.contextId, clone(prepared.next.contextState));
    preparedUpdates.push(prepared);
  }

  const nextGlobal = clone(mappedGlobal ?? expected.globalState);
  const next: ReviewStateRepositorySnapshot = {
    schemaVersion: expected.schemaVersion,
    repositoryId: expected.repositoryId,
    contextStates: [...nextContexts.values()].sort((left, right) => left.contextId.localeCompare(right.contextId)),
    globalState: nextGlobal,
  };
  if (preparedUpdates.length === 0 || isDeepStrictEqual(expected, next)) {
    return {
      committed: false,
      mappedContextIds: [...mappedContextIds].sort(),
      skippedRevisionContextIds: [...skippedRevisionContextIds].sort(),
      unavailableContextIds: [],
    };
  }

  assertCurrent(signal);
  await dependencies.repository.commitRepository({
    repositoryId: target.repositoryId,
    expected,
    next,
  });

  // Cancellation after publication does not turn a committed owner generation
  // into a partial success. Complete the post-commit audit sequence instead.
  for (const prepared of revisionUpdates.sort((left, right) => left.contextId.localeCompare(right.contextId))) {
    await dependencies.recordPreparedUpdateHistory({
      ...prepared,
      expected: {
        ...prepared.expected,
        globalState: clone(expected.globalState),
      },
      next: {
        ...prepared.next,
        globalState: clone(nextGlobal),
      },
    });
  }

  return {
    committed: true,
    mappedContextIds: [...mappedContextIds].sort(),
    skippedRevisionContextIds: [...skippedRevisionContextIds].sort(),
    unavailableContextIds: [],
  };
};

import type {
  ReviewHistoryEvent,
  ReviewHistoryEventType,
  ReviewContextState,
  RepositoryGlobalState
} from "../../core/contracts/index";
import type {
  ReviewStateFileTarget,
  ReviewStateTransaction
} from "../../core/review-state/index";

/** Storage identity needed by an append-only history persistence boundary. */
export interface ReviewHistoryStorageTarget {
  /** Owner kind selected from the already-resolved review context. */
  readonly kind: "git" | "pull-request" | "workspace" | "external-file";
  /** Stable owner identity used by the common storage router. */
  readonly repositoryId: string;
  /** Stable review-context identity used by the common storage router. */
  readonly contextId: string;
}

/** Inputs required to create ordered, session-scoped review-history events. */
export interface ReviewHistoryRecorderOptions {
  /** Stable identifier for the currently active extension session. */
  readonly sessionId: string;
  /** Opaque event ID source; callers provide a collision-resistant implementation. */
  readonly createEventId: () => string;
  /** Persistence boundary that validates and appends canonical JSONL. */
  readonly appender: {
    append(target: ReviewHistoryStorageTarget, event: ReviewHistoryEvent): Promise<void>;
  };
}

const targetFor = (state: Readonly<{
  readonly kind: "pull-request" | "branch" | "workspace" | "external-file";
  readonly repositoryId: string;
  readonly contextId: string;
}>): ReviewHistoryStorageTarget => ({
  kind: state.kind === "branch" ? "git" : state.kind,
  repositoryId: state.repositoryId,
  contextId: state.contextId
});

const typeForOperation = (operation: ReviewStateTransaction["operation"]): ReviewHistoryEventType => {
  switch (operation) {
    case "mark-ranges-reviewed":
    case "mark-original-ranges-reviewed":
      return "marked-reviewed";
    case "unmark-ranges-reviewed":
    case "unmark-original-ranges-reviewed":
      return "unmarked-reviewed";
    case "mark-file-reviewed": return "marked-file-reviewed";
    case "unmark-file-reviewed": return "unmarked-file-reviewed";
  }
};

/** Converts committed state transactions into auditable append-only history events. */
export class ReviewHistoryRecorder {
  public constructor(private readonly options: ReviewHistoryRecorderOptions) {}

  /** Appends the one file event represented by an already-successful user state transaction. */
  public async recordTransaction(
    transaction: Readonly<ReviewStateTransaction>,
    reason: string
  ): Promise<void> {
    const nextContext = transaction.next.contextState;
    const nextFile = nextContext.files[transaction.fileId];
    if (nextFile === undefined) {
      throw new Error("Committed review-state transaction must retain its affected file for history.");
    }
    const previousFile = transaction.expected.contextState.files[transaction.fileId];
    const isOriginal = transaction.side === "original";
    if (isOriginal && transaction.diffId === undefined) {
      throw new Error("Original-side review transaction must include a diff identity for history.");
    }
    const previousRanges = isOriginal
      ? previousFile?.originalReviewedByDiff[transaction.diffId!] ?? []
      : previousFile?.modifiedReviewed ?? [];
    const nextRanges = isOriginal
      ? nextFile.originalReviewedByDiff[transaction.diffId!] ?? []
      : nextFile.modifiedReviewed;
    const event: ReviewHistoryEvent = {
      schemaVersion: nextContext.schemaVersion,
      eventId: this.options.createEventId(),
      occurredAt: nextContext.updatedAt,
      sessionId: this.options.sessionId,
      repositoryId: transaction.repositoryId,
      contextId: transaction.contextId,
      revisionId: nextFile.revisionId,
      type: typeForOperation(transaction.operation),
      reason,
      filePath: nextFile.currentPath,
      diffSide: isOriginal ? "original" : "modified",
      previousRanges: previousRanges.map((range) => ({ ...range })),
      nextRanges: nextRanges.map((range) => ({ ...range }))
    };
    await this.options.appender.append(targetFor(nextContext), event);
  }

  /** Appends a context event after an initial context snapshot becomes durable. */
  public async recordContextCreated(
    contextState: Readonly<ReviewContextState>,
    reason = "context-initialized"
  ): Promise<void> {
    await this.options.appender.append(targetFor(contextState), {
      schemaVersion: contextState.schemaVersion,
      eventId: this.options.createEventId(),
      occurredAt: contextState.updatedAt,
      sessionId: this.options.sessionId,
      repositoryId: contextState.repositoryId,
      contextId: contextState.contextId,
      revisionId: revisionOf(contextState),
      type: "context-created",
      reason
    });
  }

  /** Appends one context and one affected-file event after a durable Git revision mapping. */
  public async recordRevisionMapping(
    previous: Readonly<{ contextState: ReviewContextState; globalState: RepositoryGlobalState }>,
    next: Readonly<{ contextState: ReviewContextState; globalState: RepositoryGlobalState }>,
    reason = "git-revision-mapped",
    unresolvedFileIds: readonly string[] = []
  ): Promise<void> {
    const nextRevision = revisionOf(next.contextState);
    const events: ReviewHistoryEvent[] = [{
      schemaVersion: next.contextState.schemaVersion,
      eventId: this.options.createEventId(),
      occurredAt: next.contextState.updatedAt,
      sessionId: this.options.sessionId,
      repositoryId: next.contextState.repositoryId,
      contextId: next.contextState.contextId,
      revisionId: nextRevision,
      type: "context-revision-changed",
      reason
    }];
    const fileIds = new Set([
      ...Object.keys(previous.contextState.files),
      ...Object.keys(next.contextState.files)
    ]);
    for (const fileId of [...fileIds].sort()) {
      const before = previous.contextState.files[fileId];
      const after = next.contextState.files[fileId];
      if (before === undefined && after === undefined) {
        continue;
      }
      events.push({
        schemaVersion: next.contextState.schemaVersion,
        eventId: this.options.createEventId(),
        occurredAt: next.contextState.updatedAt,
        sessionId: this.options.sessionId,
        repositoryId: next.contextState.repositoryId,
        contextId: next.contextState.contextId,
        revisionId: nextRevision,
        type: unresolvedFileIds.includes(fileId) ? "mapping-unresolved" :
          before === undefined ? "remapped-by-diff" :
          after === undefined ? "file-deleted" :
            before.currentPath !== after.currentPath ? "file-renamed" : "remapped-by-diff",
        reason: unresolvedFileIds.includes(fileId) ? "mapping-unresolved" : "git-revision-mapped",
        filePath: after?.currentPath ?? before!.currentPath,
        diffSide: "modified",
        previousRanges: (before?.modifiedReviewed ?? []).map((range) => ({ ...range })),
        nextRanges: (after?.modifiedReviewed ?? []).map((range) => ({ ...range }))
      });
    }
    for (const event of events) {
      await this.options.appender.append(targetFor(next.contextState), event);
    }
  }

  /** Appends a file event after a stale edited document has been conservatively invalidated. */
  public async recordEditInvalidation(
    contextState: Readonly<ReviewContextState>,
    target: Readonly<ReviewStateFileTarget>,
    previousRanges: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
    nextRanges: readonly { readonly startLine: number; readonly endLineExclusive: number }[]
  ): Promise<void> {
    await this.options.appender.append(targetFor(contextState), {
      schemaVersion: contextState.schemaVersion,
      eventId: this.options.createEventId(),
      occurredAt: contextState.updatedAt,
      sessionId: this.options.sessionId,
      repositoryId: contextState.repositoryId,
      contextId: contextState.contextId,
      revisionId: target.revisionId,
      type: "invalidated-by-edit",
      reason: "content-hash-mismatch",
      filePath: target.currentPath,
      diffSide: "modified",
      previousRanges: previousRanges.map((range) => ({ ...range })),
      nextRanges: nextRanges.map((range) => ({ ...range }))
    });
  }
}

const revisionOf = (state: Readonly<ReviewContextState>): string => {
  if (state.kind === "branch") {
    if (state.branch === undefined) {
      throw new Error("Branch review context must include a revision for history.");
    }
    return state.branch.headRevision;
  }
  if (state.kind === "pull-request") {
    if (state.pullRequest === undefined) {
      throw new Error("Pull-request review context must include a revision for history.");
    }
    return state.pullRequest.headSha;
  }
  if (state.kind === "workspace") {
    if (state.workspace === undefined) {
      throw new Error("Workspace review context must include a revision for history.");
    }
    return state.workspace.snapshotRevision;
  }
  if (state.externalFile === undefined) {
    throw new Error("External-file review context must include a revision for history.");
  }
  return state.externalFile.snapshotRevision;
};

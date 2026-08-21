import type {
  ReviewHistoryEvent,
  FileReviewHistoryEventType,
  ReviewContextState,
  RepositoryGlobalState
} from "../../core/contracts/index";
import type {
  ReviewStateFileTarget,
  ReviewStateTransaction
} from "../../core/review-state/index";

/** Storage identity selected from a committed review context. */
export interface ReviewHistoryStorageTarget {
  /** Backing storage category. */
  readonly kind: "git" | "pull-request" | "workspace" | "external-file";
  /** Repository that owns the event stream. */
  readonly repositoryId: string;
  /** Context that owns the event stream. */
  readonly contextId: string;
}

/** Dependencies for recording canonical events after state persistence succeeds. */
export interface ReviewHistoryRecorderOptions {
  /** Stable identity for events created by this recorder instance. */
  readonly sessionId: string;
  /** Creates a new unique event identity for every append. */
  readonly createEventId: () => string;
  /** Append-only persistence port. */
  readonly appender: { append(target: ReviewHistoryStorageTarget, event: ReviewHistoryEvent): Promise<void> };
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

const typeForOperation = (operation: ReviewStateTransaction["operation"]): FileReviewHistoryEventType => {
  switch (operation) {
    case "mark-ranges-reviewed":
    case "mark-original-ranges-reviewed": return "marked-reviewed";
    case "unmark-ranges-reviewed":
    case "unmark-original-ranges-reviewed": return "unmarked-reviewed";
    case "mark-file-reviewed": return "marked-file-reviewed";
    case "unmark-file-reviewed": return "unmarked-file-reviewed";
  }
};

/** Records state and lifecycle transitions in canonical append-only history order. */
export class ReviewHistoryRecorder {
  /** Creates a recorder that appends only after the state transaction has committed. */
  public constructor(private readonly options: ReviewHistoryRecorderOptions) {}

  /**
   * Records the modified and, when applicable, original-side ranges changed by one already committed transaction.
   * @returns A promise that resolves after every affected event is appended in modified-then-sorted-original order.
   * @throws {Error} When the committed next state omits the affected file or an original transaction lacks its diff ID.
   * Appender failures propagate; this method never hides a post-commit history failure.
   */
  public async recordTransaction(transaction: Readonly<ReviewStateTransaction>, reason: string): Promise<void> {
    const nextContext = transaction.next.contextState;
    const nextFile = nextContext.files[transaction.fileId];
    if (nextFile === undefined) throw new Error("Committed review-state transaction must retain its affected file for history.");
    const previousFile = transaction.expected.contextState.files[transaction.fileId];
    const previousGlobalFile = transaction.expected.globalState.files[transaction.fileId];
    const nextGlobalFile = transaction.next.globalState.files[transaction.fileId];
    const eventType = typeForOperation(transaction.operation);
    const events: ReviewHistoryEvent[] = [];
    const appendFileEvent = (
      diffSide: "modified" | "original",
      previousRanges: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
      nextRanges: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
      diffId?: string,
      globalPreviousRanges?: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
      globalNextRanges?: readonly { readonly startLine: number; readonly endLineExclusive: number }[]
    ): void => {
      const common = {
        schemaVersion: nextContext.schemaVersion,
        eventId: this.options.createEventId(),
        occurredAt: nextContext.updatedAt,
        sessionId: this.options.sessionId,
        repositoryId: transaction.repositoryId,
        contextId: transaction.contextId,
        revisionId: nextFile.revisionId,
        type: eventType,
        reason,
        filePath: nextFile.currentPath,
        previousRanges: previousRanges.map((range) => ({ ...range })),
        nextRanges: nextRanges.map((range) => ({ ...range }))
      };
      if (diffSide === "original") events.push({ ...common, diffSide, diffId: diffId! });
      else if (globalPreviousRanges !== undefined && globalNextRanges !== undefined) {
        events.push({
          ...common,
          diffSide,
          rangeRepresentation: "context-and-global",
          globalPreviousRanges: globalPreviousRanges.map((range) => ({ ...range })),
          globalNextRanges: globalNextRanges.map((range) => ({ ...range }))
        });
      } else events.push({ ...common, diffSide });
    };
    if (transaction.side === "original") {
      if (transaction.diffId === undefined) throw new Error("Original-side review transaction must include a diff identity for history.");
      appendFileEvent(
        "original",
        previousFile?.originalReviewedByDiff[transaction.diffId] ?? [],
        nextFile.originalReviewedByDiff[transaction.diffId] ?? [],
        transaction.diffId
      );
    } else {
      appendFileEvent(
        "modified",
        previousFile?.modifiedReviewed ?? [],
        nextFile.modifiedReviewed,
        undefined,
        previousGlobalFile?.reviewed ?? [],
        nextGlobalFile?.reviewed ?? []
      );
      if (transaction.operation === "mark-file-reviewed" || transaction.operation === "unmark-file-reviewed") {
        const diffIds = new Set([
          ...Object.keys(previousFile?.originalReviewedByDiff ?? {}),
          ...Object.keys(nextFile.originalReviewedByDiff)
        ]);
        for (const diffId of [...diffIds].sort()) {
          const before = previousFile?.originalReviewedByDiff[diffId] ?? [];
          const after = nextFile.originalReviewedByDiff[diffId] ?? [];
          if (JSON.stringify(before) !== JSON.stringify(after)) appendFileEvent("original", before, after, diffId);
        }
      }
    }
    for (const event of events) await this.options.appender.append(targetFor(nextContext), event);
  }

  /** Records one already committed live-document edit with lossless Context and Global ranges. */
  public async recordDocumentEditMapping(
    previous: Readonly<{ contextState: ReviewContextState; globalState: RepositoryGlobalState }>,
    next: Readonly<{ contextState: ReviewContextState; globalState: RepositoryGlobalState }>,
    fileId: string,
    occurredAt: string,
    reason = "document-content-changed"
  ): Promise<void> {
    const previousContextFile = previous.contextState.files[fileId];
    const nextContextFile = next.contextState.files[fileId];
    const previousGlobalFile = previous.globalState.files[fileId];
    const nextGlobalFile = next.globalState.files[fileId];
    const filePath =
      nextContextFile?.currentPath ??
      nextGlobalFile?.currentPath ??
      previousContextFile?.currentPath ??
      previousGlobalFile?.currentPath;
    if (filePath === undefined) {
      throw new Error("Committed document edit history requires an affected file identity.");
    }
    await this.options.appender.append(targetFor(next.contextState), {
      schemaVersion: next.contextState.schemaVersion,
      eventId: this.options.createEventId(),
      occurredAt,
      sessionId: this.options.sessionId,
      repositoryId: next.contextState.repositoryId,
      contextId: next.contextState.contextId,
      revisionId: revisionOf(next.contextState),
      type: "invalidated-by-edit",
      reason,
      filePath,
      diffSide: "modified",
      previousRanges: (previousContextFile?.modifiedReviewed ?? []).map((range) => ({ ...range })),
      nextRanges: (nextContextFile?.modifiedReviewed ?? []).map((range) => ({ ...range })),
      rangeRepresentation: "context-and-global",
      globalPreviousRanges: (previousGlobalFile?.reviewed ?? []).map((range) => ({ ...range })),
      globalNextRanges: (nextGlobalFile?.reviewed ?? []).map((range) => ({ ...range }))
    });
  }

  /**
   * Appends the lifecycle event for a newly created review context.
   * @returns A promise that resolves after the append succeeds.
   * @throws {Error} When the context lacks the revision required by its kind or the appender rejects.
   */
  public async recordContextCreated(contextState: Readonly<ReviewContextState>, reason = "context-initialized"): Promise<void> {
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

  /**
   * Appends context and per-file events for a revision mapping, including unresolved files.
   * @returns A promise that resolves after the ordered lifecycle and file events append.
   * @throws {Error} When the next context lacks its kind-specific revision or an append fails; failures propagate.
   */
  public async recordRevisionMapping(
    previous: Readonly<{ contextState: ReviewContextState; globalState: RepositoryGlobalState }>,
    next: Readonly<{ contextState: ReviewContextState; globalState: RepositoryGlobalState }>,
    reason = "git-revision-mapped",
    unresolvedFileIds: readonly string[] = [],
    unresolvedReasonsByFileId: Readonly<Record<string, string>> = {}
  ): Promise<void> {
    const nextRevision = revisionOf(next.contextState);
    const events: ReviewHistoryEvent[] = [{
      schemaVersion: next.contextState.schemaVersion,
      eventId: this.options.createEventId(), occurredAt: next.contextState.updatedAt,
      sessionId: this.options.sessionId, repositoryId: next.contextState.repositoryId,
      contextId: next.contextState.contextId, revisionId: nextRevision,
      type: "context-revision-changed", reason
    }];
    const fileIds = new Set([...Object.keys(previous.contextState.files), ...Object.keys(next.contextState.files)]);
    for (const fileId of [...fileIds].sort()) {
      const before = previous.contextState.files[fileId];
      const after = next.contextState.files[fileId];
      if (before === undefined && after === undefined) continue;
      events.push({
        schemaVersion: next.contextState.schemaVersion,
        eventId: this.options.createEventId(), occurredAt: next.contextState.updatedAt,
        sessionId: this.options.sessionId, repositoryId: next.contextState.repositoryId,
        contextId: next.contextState.contextId, revisionId: nextRevision,
        type: unresolvedFileIds.includes(fileId) ? "mapping-unresolved" : before === undefined ? "remapped-by-diff" : after === undefined ? "file-deleted" : before.currentPath !== after.currentPath ? "file-renamed" : "remapped-by-diff",
        reason: unresolvedFileIds.includes(fileId)
          ? unresolvedReasonsByFileId[fileId] ?? "mapping-unresolved"
          : "git-revision-mapped",
        filePath: after?.currentPath ?? before!.currentPath,
        diffSide: "modified",
        previousRanges: (before?.modifiedReviewed ?? []).map((range) => ({ ...range })),
        nextRanges: (after?.modifiedReviewed ?? []).map((range) => ({ ...range })),
        rangeRepresentation: "context-and-global",
        globalPreviousRanges: (previous.globalState.files[fileId]?.reviewed ?? []).map((range) => ({ ...range })),
        globalNextRanges: (next.globalState.files[fileId]?.reviewed ?? []).map((range) => ({ ...range }))
      });
    }
    for (const event of events) await this.options.appender.append(targetFor(next.contextState), event);
  }

  /**
   * Appends the modified-side range transition caused by content invalidation.
   * @returns A promise that resolves after the invalidation event is persisted.
   * @throws {Error} When the history appender rejects; the persistence failure propagates to the caller.
   */
  public async recordEditInvalidation(
    contextState: Readonly<ReviewContextState>,
    target: Readonly<ReviewStateFileTarget>,
    previousRanges: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
    nextRanges: readonly { readonly startLine: number; readonly endLineExclusive: number }[]
  ): Promise<void> {
    await this.options.appender.append(targetFor(contextState), {
      schemaVersion: contextState.schemaVersion, eventId: this.options.createEventId(),
      occurredAt: contextState.updatedAt, sessionId: this.options.sessionId,
      repositoryId: contextState.repositoryId, contextId: contextState.contextId,
      revisionId: target.revisionId, type: "invalidated-by-edit", reason: "content-hash-mismatch",
      filePath: target.currentPath, diffSide: "modified",
      previousRanges: previousRanges.map((range) => ({ ...range })),
      nextRanges: nextRanges.map((range) => ({ ...range }))
    });
  }
}

const revisionOf = (state: Readonly<ReviewContextState>): string => {
  if (state.kind === "branch") {
    if (state.branch === undefined) throw new Error("Branch review context must include a revision for history.");
    return state.branch.headRevision;
  }
  if (state.kind === "pull-request") {
    if (state.pullRequest === undefined) throw new Error("Pull-request review context must include a revision for history.");
    return state.pullRequest.headSha;
  }
  if (state.kind === "workspace") {
    if (state.workspace === undefined) throw new Error("Workspace review context must include a revision for history.");
    return state.workspace.snapshotRevision;
  }
  if (state.externalFile === undefined) throw new Error("External-file review context must include a revision for history.");
  return state.externalFile.snapshotRevision;
};

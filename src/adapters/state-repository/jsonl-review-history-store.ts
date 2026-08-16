import path from "node:path";

import type { ReviewHistoryEvent } from "../../core/contracts/index";
import {
  parseReviewHistoryEventLine,
  serializeReviewHistoryEvent
} from "../../core/review-history/index";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";
import type {
  JsonlReviewHistoryStoreOptions,
  ReviewHistoryEventAppender,
  ReviewStateRepositoryTarget
} from "./contracts";
import { resolveReviewStateStorageRoute } from "./storage-router";

const monthFileName = (occurredAt: string): string => `events-${occurredAt.slice(0, 7)}.jsonl`;
const sharedHistoryTailByFilePath = new Map<string, Promise<void>>();

const validateExistingHistory = (content: string): void => {
  if (content.length === 0) {
    return;
  }
  if (!content.endsWith("\n")) {
    throw new SyntaxError("Review history must end with a complete LF-terminated JSONL record.");
  }
  for (const line of content.slice(0, -1).split("\n")) {
    parseReviewHistoryEventLine(line);
  }
};

/** Appends canonical validated JSONL events through the existing atomic storage route. */
export class JsonlReviewHistoryStore implements ReviewHistoryEventAppender {
  private readonly atomicFileStore;

  public constructor(private readonly options: JsonlReviewHistoryStoreOptions) {
    this.atomicFileStore = options.atomicFileStore ?? new NodeAtomicTextFileStore();
  }

  /** Validates, serializes, and appends one event while sharing a same-process file serialization boundary across store instances. */
  public async append(target: ReviewStateRepositoryTarget, event: ReviewHistoryEvent): Promise<void> {
    const canonical = serializeReviewHistoryEvent(event);
    if (event.repositoryId !== target.repositoryId || event.contextId !== target.contextId) {
      throw new Error("Review history event identity must match its storage target.");
    }
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    const filePath = path.join(route.historyDirectory, monthFileName(event.occurredAt));
    const previous = sharedHistoryTailByFilePath.get(filePath) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const existing = await this.atomicFileStore.readText(filePath) ?? "";
      validateExistingHistory(existing);
      await this.atomicFileStore.writeTextAtomically(filePath, `${existing}${canonical}\n`);
    });
    const tail = operation.catch(() => undefined);
    sharedHistoryTailByFilePath.set(filePath, tail);
    try {
      await operation;
    } finally {
      if (sharedHistoryTailByFilePath.get(filePath) === tail) {
        sharedHistoryTailByFilePath.delete(filePath);
      }
    }
  }
}

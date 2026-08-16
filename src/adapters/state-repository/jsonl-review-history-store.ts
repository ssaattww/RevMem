import path from "node:path";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewHistoryEvent
} from "../../core/contracts/index";
import {
  serializeReviewHistoryEvent
} from "../../core/review-history/index";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";
import type {
  JsonlReviewHistoryStoreOptions,
  ReviewHistoryEventAppender,
  ReviewStateRepositoryTarget
} from "./contracts";
import {
  publishSchemaMigration,
  quarantinePersistedText,
  runSchemaMigrationChain,
  UnsupportedPersistedSchemaVersionError
} from "./persistence-schema-recovery";
import { resolveReviewStateStorageRoute } from "./storage-router";

const monthFileName = (occurredAt: string): string => `events-${occurredAt.slice(0, 7)}.jsonl`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const HISTORY_MIGRATION_STEPS = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: (value: Record<string, unknown>): Record<string, unknown> => ({
      ...value,
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION
    })
  }
] as const;

interface PreparedHistory {
  readonly content: string;
  readonly migrated: boolean;
  readonly corrupt: boolean;
}

const prepareExistingHistory = (content: string): PreparedHistory => {
  if (content.length === 0) {
    return { content: "", migrated: false, corrupt: false };
  }

  const terminated = content.endsWith("\n");
  const segments = content.split("\n");
  if (terminated) {
    segments.pop();
  }
  const completeSegments = terminated ? segments : segments.slice(0, -1);
  const canonicalLines: string[] = [];
  let migrated = false;
  let corrupt = !terminated;

  for (const line of completeSegments) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        throw new TypeError("Review history record must be an object.");
      }
      if (parsed.schemaVersion === undefined) {
        throw new TypeError("Review history record schemaVersion is missing.");
      }
      const migration = runSchemaMigrationChain(
        parsed,
        "Review history event",
        HISTORY_MIGRATION_STEPS
      );
      const canonical = serializeReviewHistoryEvent(migration.value);
      canonicalLines.push(canonical);
      migrated ||= migration.migrated;
      if (!migration.migrated && canonical !== line) {
        corrupt = true;
      }
    } catch (error) {
      if (error instanceof UnsupportedPersistedSchemaVersionError) {
        throw error;
      }
      corrupt = true;
    }
  }

  return {
    content: canonicalLines.map((line) => `${line}\n`).join(""),
    migrated,
    corrupt
  };
};

/** Appends canonical validated JSONL events through migration and corruption-recovery boundaries. */
export class JsonlReviewHistoryStore implements ReviewHistoryEventAppender {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly atomicFileStore;

  public constructor(private readonly options: JsonlReviewHistoryStoreOptions) {
    this.atomicFileStore = options.atomicFileStore ?? new NodeAtomicTextFileStore();
  }

  /** Validates, migrates legacy records, isolates corrupt bytes, and appends one canonical event. */
  public async append(target: ReviewStateRepositoryTarget, event: ReviewHistoryEvent): Promise<void> {
    const canonical = serializeReviewHistoryEvent(event);
    if (event.repositoryId !== target.repositoryId || event.contextId !== target.contextId) {
      throw new Error("Review history event identity must match its storage target.");
    }
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    const filePath = path.join(route.historyDirectory, monthFileName(event.occurredAt));
    const previous = this.tails.get(route.rootPath) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const existing = await this.atomicFileStore.readText(filePath) ?? "";
      const prepared = prepareExistingHistory(existing);
      if (prepared.corrupt && existing.length > 0) {
        await quarantinePersistedText(
          this.atomicFileStore,
          filePath,
          existing,
          false
        );
      }
      const next = `${prepared.content}${canonical}\n`;
      if (prepared.migrated) {
        await publishSchemaMigration(this.atomicFileStore, [{
          filePath,
          original: existing,
          migrated: next
        }]);
      } else {
        await this.atomicFileStore.writeTextAtomically(filePath, next);
      }
    });
    this.tails.set(route.rootPath, operation.catch(() => undefined));
    await operation;
  }
}

import path from "node:path";

import {
  type ReviewHistoryEvent
} from "../../core/contracts/index";
import {
  serializeReviewHistoryEvent
} from "../../core/review-history/index";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";
import type {
  AtomicTextFileStore,
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
      schemaVersion: 1
    })
  }
] as const;

interface PreparedHistory {
  readonly content: string;
  readonly migrated: boolean;
  readonly corrupt: boolean;
}

interface HistoryIdentity {
  readonly repositoryId: string;
}

const expectedMonthFromPath = (filePath: string): string | undefined => {
  const match = /^events-(\d{4}-\d{2})\.jsonl$/u.exec(path.basename(filePath));
  return match?.[1];
};

const prepareExistingHistory = (
  content: string,
  expectedTarget?: ReviewStateRepositoryTarget,
  expectedMonth?: string
): PreparedHistory => {
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
  const eventIds = new Set<string>();
  let migrated = false;
  let corrupt = !terminated;
  let observedIdentity: HistoryIdentity | undefined;

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
      const event = JSON.parse(canonical) as ReviewHistoryEvent;
      const identity = {
        repositoryId: event.repositoryId
      };
      observedIdentity ??= identity;
      if (identity.repositoryId !== observedIdentity.repositoryId) {
        corrupt = true;
      }
      if (
        expectedTarget !== undefined &&
        event.repositoryId !== expectedTarget.repositoryId
      ) {
        corrupt = true;
      }
      if (expectedMonth !== undefined && event.occurredAt.slice(0, 7) !== expectedMonth) {
        corrupt = true;
      }
      if (eventIds.has(event.eventId)) {
        corrupt = true;
      }
      eventIds.add(event.eventId);
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

/** Migrates one existing monthly JSONL file without appending new evidence. Corruption is quarantined and removed from the active path so later history can restart cleanly. */
export const migratePersistedReviewHistoryFile = async (
  store: AtomicTextFileStore,
  filePath: string
): Promise<"absent" | "ready" | "reset"> => {
  const existing = await store.readText(filePath);
  if (existing === undefined) {
    return "absent";
  }
  const month = expectedMonthFromPath(filePath);
  if (month === undefined) {
    await quarantinePersistedText(store, filePath, existing);
    return "reset";
  }
  const prepared = prepareExistingHistory(existing, undefined, month);
  if (prepared.corrupt) {
    if (existing.length > 0) {
      await quarantinePersistedText(store, filePath, existing);
    }
    return "reset";
  }
  if (prepared.migrated) {
    await publishSchemaMigration(store, [{
      filePath,
      original: existing,
      migrated: prepared.content
    }]);
  }
  return "ready";
};

/** Appends canonical validated JSONL events. Corrupt existing history is preserved in quarantine and the active history restarts from the new event without salvaging uncertain records. */
export class JsonlReviewHistoryStore implements ReviewHistoryEventAppender {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly atomicFileStore;

  public constructor(private readonly options: JsonlReviewHistoryStoreOptions) {
    this.atomicFileStore = options.atomicFileStore ?? new NodeAtomicTextFileStore();
  }

  /** Validates/migrates legacy records and restarts the active monthly history after quarantining corrupt or misrouted evidence. */
  public async append(target: ReviewStateRepositoryTarget, event: ReviewHistoryEvent): Promise<void> {
    const canonical = serializeReviewHistoryEvent(event);
    if (event.repositoryId !== target.repositoryId || event.contextId !== target.contextId) {
      throw new Error("Review history event identity must match its storage target.");
    }
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    const month = event.occurredAt.slice(0, 7);
    const filePath = path.join(route.historyDirectory, monthFileName(event.occurredAt));
    const previous = this.tails.get(route.rootPath) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const existing = await this.atomicFileStore.readText(filePath) ?? "";
      const prepared = prepareExistingHistory(existing, target, month);
      if (prepared.corrupt) {
        if (existing.length > 0) {
          await quarantinePersistedText(
            this.atomicFileStore,
            filePath,
            existing
          );
        }
        await this.atomicFileStore.writeTextAtomically(filePath, `${canonical}\n`);
        return;
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

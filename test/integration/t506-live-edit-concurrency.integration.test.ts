import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import {
  JsonlReviewHistoryStore,
  StaleReviewStateError,
  type AtomicTextFileStore,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import { markReviewedRanges } from "../../src/core/review-state/index";
import {
  DocumentReviewEditRuntime,
  type DocumentReviewEditSnapshot
} from "../../src/document-review-edit-runtime";

const REPOSITORY_ID = "github.com/ssaattww/t506-concurrency";
const BRANCH_REF = "refs/heads/main";
const REVISION_ID = "0123456789abcdef0123456789abcdef01234567";
const FILE_A_ID = "file-a";
const FILE_B_ID = "file-b";
const FILE_A_PATH = "src/a.ts";
const FILE_B_PATH = "src/b.ts";
const BEFORE_TEXT = "const first = 1;\nconst second = 2;";
const AFTER_TEXT = "const first = 1;\nconst inserted = 9;\nconst second = 2;";
const BEFORE_HASH = createHash("sha256").update(BEFORE_TEXT).digest("hex");
const AFTER_HASH = createHash("sha256").update(AFTER_TEXT).digest("hex");
const FILE_B_HASH = createHash("sha256").update("const other = 3;").digest("hex");
const INITIAL_TIME = "2026-08-16T10:45:00.000Z";

const digest = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const stableId = (domain: string, ...parts: readonly string[]): string =>
  `${domain}:${digest([domain, ...parts].join("\0"))}`;

const CONTEXT_ID = stableId("branch-context", REPOSITORY_ID, BRANCH_REF);
const TARGET: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: REPOSITORY_ID,
  contextId: CONTEXT_ID
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createInitialCommit = (): ReviewStateCommit => {
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: CONTEXT_ID,
    kind: "branch",
    repositoryId: REPOSITORY_ID,
    displayName: "main",
    branch: {
      refName: BRANCH_REF,
      headRevision: REVISION_ID
    },
    files: {
      [FILE_A_ID]: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: FILE_A_ID,
        currentPath: FILE_A_PATH,
        previousPaths: [],
        revisionId: REVISION_ID,
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }],
        originalReviewedByDiff: {},
        contentHash: BEFORE_HASH,
        lineCount: 2,
        updatedAt: INITIAL_TIME
      },
      [FILE_B_ID]: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: FILE_B_ID,
        currentPath: FILE_B_PATH,
        previousPaths: [],
        revisionId: REVISION_ID,
        modifiedReviewed: [],
        originalReviewedByDiff: {},
        contentHash: FILE_B_HASH,
        lineCount: 1,
        updatedAt: INITIAL_TIME
      }
    },
    createdAt: INITIAL_TIME,
    updatedAt: INITIAL_TIME
  };
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: REPOSITORY_ID,
    currentRevisionId: REVISION_ID,
    files: {
      [FILE_A_ID]: {
        fileId: FILE_A_ID,
        currentPath: FILE_A_PATH,
        revisionId: REVISION_ID,
        reviewed: [{ startLine: 0, endLineExclusive: 2 }],
        contentHash: BEFORE_HASH,
        updatedAt: INITIAL_TIME
      }
    },
    updatedAt: INITIAL_TIME
  };
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState,
    globalState
  };
};

class ControlledSharedRepository {
  private current = createInitialCommit();
  private firstLoadResolve: (() => void) | undefined;
  private readonly firstLoad = new Promise<void>((resolve) => {
    this.firstLoadResolve = resolve;
  });
  private commandCommitted = false;
  private commandCommittedResolve: (() => void) | undefined;
  private readonly commandCommit = new Promise<void>((resolve) => {
    this.commandCommittedResolve = resolve;
  });

  public async load(target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit | undefined> {
    assert.deepEqual(target, TARGET);
    this.firstLoadResolve?.();
    this.firstLoadResolve = undefined;
    return clone(this.current);
  }

  public async commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void> {
    const isEdit =
      transaction.next.contextState.files[FILE_A_ID]?.contentHash === AFTER_HASH;
    if (isEdit && !this.commandCommitted) {
      await this.commandCommit;
    }
    if (!isDeepStrictEqual(transaction.expected.contextState, this.current.contextState) ||
        !isDeepStrictEqual(transaction.expected.globalState, this.current.globalState)) {
      throw new StaleReviewStateError(TARGET);
    }
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: clone(transaction.next.contextState) as ReviewContextState,
      globalState: clone(transaction.next.globalState) as RepositoryGlobalState
    };
    if (!isEdit) {
      this.commandCommitted = true;
      this.commandCommittedResolve?.();
      this.commandCommittedResolve = undefined;
    }
  }

  public async waitForFirstLoad(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.firstLoad,
        new Promise<void>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("DocumentReviewEditRuntime did not use the injected shared repository.")),
            500
          );
        })
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  public snapshot(): ReviewStateCommit {
    return clone(this.current);
  }
}

class MemoryAtomicTextFileStore implements AtomicTextFileStore {
  private readonly files = new Map<string, string>();

  public async readText(filePath: string): Promise<string | undefined> {
    return this.files.get(filePath);
  }

  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  public historyEvents(): readonly Record<string, unknown>[] {
    return [...this.files.values()].flatMap((text) =>
      text.split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    );
  }
}

const beforeSnapshot = (): DocumentReviewEditSnapshot => ({
  documentKey: "file:///repo/src/a.ts",
  documentUri: {
    scheme: "file",
    authority: "",
    path: "/repo/src/a.ts",
    query: "",
    fragment: ""
  },
  documentFsPath: "/repo/src/a.ts",
  fileSystemPathSemantics: "posix",
  text: BEFORE_TEXT,
  lineCount: 2,
  contentHash: BEFORE_HASH
});

const afterSnapshot = (): DocumentReviewEditSnapshot => ({
  ...beforeSnapshot(),
  text: AFTER_TEXT,
  lineCount: 3,
  contentHash: AFTER_HASH
});

test("T506 live edit and command share one serialized state/history boundary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t506-concurrency-"));
  const repository = new ControlledSharedRepository();
  const historyFiles = new MemoryAtomicTextFileStore();
  const historyRecorder = new ReviewHistoryRecorder({
    sessionId: "t506-concurrency",
    createEventId: (() => {
      let sequence = 0;
      return () => `event-${++sequence}`;
    })(),
    appender: new JsonlReviewHistoryStore({
      storageUris: {
        globalStorageUri: { fsPath: path.join(root, "global") },
        storageUri: { fsPath: path.join(root, "workspace") }
      },
      atomicFileStore: historyFiles
    })
  });
  const stableHash = { digest };
  const editRuntime = new DocumentReviewEditRuntime({
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "unused-global") },
      storageUri: { fsPath: path.join(root, "unused-workspace") }
    },
    repository,
    historyRecorder,
    gitInspector: {
      inspectRepository: async () => ({
        kind: "repository" as const,
        repository: {
          gitVersion: "2.50.0",
          rootPath: "/repo",
          repositoryId: REPOSITORY_ID,
          branch: { kind: "branch" as const, fullRef: BRANCH_REF },
          head: REVISION_ID
        }
      })
    },
    stableHash,
    now: () => new Date("2026-08-16T10:46:00.000Z")
  } as never);

  try {
    editRuntime.observe(beforeSnapshot());
    const edit = editRuntime.apply({
      after: afterSnapshot(),
      changes: [{
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 }
        },
        rangeOffset: BEFORE_TEXT.indexOf("const second"),
        rangeLength: 0,
        text: "const inserted = 9;\n"
      }],
      options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
    });

    await repository.waitForFirstLoad();
    const command = (async (): Promise<void> => {
      const loaded = await repository.load(TARGET);
      assert.ok(loaded);
      const transaction = markReviewedRanges({
        contextState: loaded.contextState,
        globalState: loaded.globalState,
        target: {
          fileId: FILE_B_ID,
          currentPath: FILE_B_PATH,
          revisionId: REVISION_ID,
          lineCount: 1,
          contentHash: FILE_B_HASH
        },
        intervals: [{ startLine: 0, endLineExclusive: 1 }],
        occurredAt: "2026-08-16T10:45:30.000Z"
      });
      await repository.commit(transaction);
      await historyRecorder.recordTransaction(transaction, "t506-concurrent-command");
    })();

    assert.equal(await edit, "applied");
    await command;

    const persisted = repository.snapshot();
    assert.deepEqual(
      persisted.contextState.files[FILE_A_ID]?.modifiedReviewed,
      [
        { startLine: 0, endLineExclusive: 1 },
        { startLine: 2, endLineExclusive: 3 }
      ],
      "Edit mapping must survive the concurrent command after stale retry."
    );
    assert.equal(persisted.contextState.files[FILE_A_ID]?.contentHash, AFTER_HASH);
    assert.deepEqual(
      persisted.contextState.files[FILE_B_ID]?.modifiedReviewed,
      [{ startLine: 0, endLineExclusive: 1 }],
      "The concurrent command update must not be overwritten by edit mapping."
    );
    assert.deepEqual(
      persisted.globalState.files[FILE_B_ID]?.reviewed,
      [{ startLine: 0, endLineExclusive: 1 }]
    );

    const events = historyFiles.historyEvents();
    assert.equal(events.length, 2, "Both command and edit history events must be retained.");
    assert.deepEqual(
      new Set(events.map((event) => event.type)),
      new Set(["marked-reviewed", "invalidated-by-edit"])
    );
  } finally {
    await editRuntime.drain();
    await rm(root, { recursive: true, force: true });
  }
});
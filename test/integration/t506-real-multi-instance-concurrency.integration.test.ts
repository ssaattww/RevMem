import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";

import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  StaleReviewStateError,
  resolveReviewStateStorageRoute,
  type AtomicTextFileStore,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import { markReviewedRanges } from "../../src/core/review-state/index";

const REPOSITORY_ID = "github.com/ssaattww/t506-real-multi-instance";
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
const INITIAL_TIME = "2026-08-16T22:00:00.000Z";
const EDIT_TIME = "2026-08-16T22:01:00.000Z";
const COMMAND_TIME = "2026-08-16T22:02:00.000Z";

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

const createEditCommit = (previous: ReviewStateCommit): ReviewStateCommit => {
  const next = clone(previous);
  next.contextState.files[FILE_A_ID] = {
    ...next.contextState.files[FILE_A_ID]!,
    modifiedReviewed: [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ],
    contentHash: AFTER_HASH,
    lineCount: 3,
    updatedAt: EDIT_TIME
  };
  next.contextState.updatedAt = EDIT_TIME;
  next.globalState.files[FILE_A_ID] = {
    ...next.globalState.files[FILE_A_ID]!,
    reviewed: [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ],
    contentHash: AFTER_HASH,
    updatedAt: EDIT_TIME
  };
  next.globalState.updatedAt = EDIT_TIME;
  return next;
};

const createEditTransaction = (
  previous: ReviewStateCommit,
  next: ReviewStateCommit
): ReviewStateTransactionLike => ({
  repositoryId: REPOSITORY_ID,
  contextId: CONTEXT_ID,
  expected: {
    contextState: previous.contextState,
    globalState: previous.globalState
  },
  next: {
    contextState: next.contextState,
    globalState: next.globalState
  }
});

const createCommandTransaction = (commit: ReviewStateCommit) =>
  markReviewedRanges({
    contextState: commit.contextState,
    globalState: commit.globalState,
    target: {
      fileId: FILE_B_ID,
      currentPath: FILE_B_PATH,
      revisionId: REVISION_ID,
      lineCount: 1,
      contentHash: FILE_B_HASH
    },
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt: COMMAND_TIME
  });

const waitForImmediate = async (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

const within = async <T>(label: string, operation: Promise<T>): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}.`)),
          2_000
        );
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

class SharedControlledAtomicBackend {
  private readonly files = new Map<string, string>();
  private gatedPath: string | undefined;
  private gatedWriteCount = 0;
  private firstGatedWriteEntered: Promise<void> = Promise.resolve();
  private firstGatedWriteEnteredResolve: (() => void) | undefined;
  private firstGatedWriteRelease: Promise<void> = Promise.resolve();
  private firstGatedWriteReleaseResolve: (() => void) | undefined;

  public arm(pathToGate: string): void {
    this.gatedPath = pathToGate;
    this.gatedWriteCount = 0;
    this.firstGatedWriteEntered = new Promise<void>((resolve) => {
      this.firstGatedWriteEnteredResolve = resolve;
    });
    this.firstGatedWriteRelease = new Promise<void>((resolve) => {
      this.firstGatedWriteReleaseResolve = resolve;
    });
  }

  public async readText(filePath: string): Promise<string | undefined> {
    return this.files.get(filePath);
  }

  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    if (filePath === this.gatedPath) {
      this.gatedWriteCount += 1;
      if (this.gatedWriteCount === 1) {
        this.firstGatedWriteEnteredResolve?.();
        await this.firstGatedWriteRelease;
      }
    }
    this.files.set(filePath, content);
  }

  public async waitForFirstGatedWrite(): Promise<void> {
    await within("first gated atomic write", this.firstGatedWriteEntered);
  }

  public releaseFirstGatedWrite(): void {
    this.firstGatedWriteReleaseResolve?.();
    this.firstGatedWriteReleaseResolve = undefined;
  }

  public getText(filePath: string): string | undefined {
    return this.files.get(filePath);
  }
}

class SharedBackendAtomicTextFileStore implements AtomicTextFileStore {
  public constructor(private readonly backend: SharedControlledAtomicBackend) {}

  public readText(filePath: string): Promise<string | undefined> {
    return this.backend.readText(filePath);
  }

  public writeTextAtomically(filePath: string, content: string): Promise<void> {
    return this.backend.writeTextAtomically(filePath, content);
  }
}

const storageUris = (suffix: string): ReviewStateStorageUris => ({
  globalStorageUri: { fsPath: `/t506-real-multi-instance/${suffix}/global` },
  storageUri: { fsPath: `/t506-real-multi-instance/${suffix}/workspace` }
});

const repositoryFactory = (
  storage: ReviewStateStorageUris,
  backend: SharedControlledAtomicBackend
): [FileSystemReviewStateRepository, FileSystemReviewStateRepository] => {
  let commitSequence = 0;
  const createCommitId = (): string => `t506-real-${++commitSequence}`;
  const options = () => ({
    storageUris: storage,
    atomicFileStore: new SharedBackendAtomicTextFileStore(backend),
    createCommitId,
    now: () => new Date("2026-08-16T22:03:00.000Z")
  });
  return [
    new FileSystemReviewStateRepository(options()),
    new FileSystemReviewStateRepository(options())
  ];
};

test("T506 separate real repository instances serialize competing CAS and retain both updates after stale replan", async () => {
  const backend = new SharedControlledAtomicBackend();
  const storage = storageUris("state");
  const route = resolveReviewStateStorageRoute(storage, TARGET);
  const [editRepository, commandRepository] = repositoryFactory(storage, backend);
  assert.notStrictEqual(editRepository, commandRepository);

  const initial = createInitialCommit();
  await editRepository.save(TARGET, initial);
  const editExpected = await editRepository.load(TARGET);
  const commandExpected = await commandRepository.load(TARGET);
  assert.ok(editExpected);
  assert.ok(commandExpected);

  const editNext = createEditCommit(editExpected);
  const editTransaction = createEditTransaction(editExpected, editNext);
  const firstCommandTransaction = createCommandTransaction(commandExpected);

  backend.arm(route.statePointerPath);
  const editCommit = editRepository.commit(editTransaction);
  await backend.waitForFirstGatedWrite();

  let commandError: unknown;
  const competingCommand = commandRepository
    .commit(firstCommandTransaction)
    .catch((error: unknown) => {
      commandError = error;
    });

  await waitForImmediate();
  backend.releaseFirstGatedWrite();
  await Promise.all([editCommit, competingCommand]);

  assert.ok(
    commandError instanceof StaleReviewStateError,
    "A second real repository instance must observe the first commit before its CAS comparison."
  );

  const latest = await commandRepository.load(TARGET);
  assert.ok(latest);
  const retriedCommandTransaction = createCommandTransaction(latest);
  await commandRepository.commit(retriedCommandTransaction);

  const persisted = await editRepository.load(TARGET);
  assert.ok(persisted);
  assert.deepEqual(
    persisted.contextState.files[FILE_A_ID]?.modifiedReviewed,
    [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ]
  );
  assert.equal(persisted.contextState.files[FILE_A_ID]?.contentHash, AFTER_HASH);
  assert.deepEqual(
    persisted.contextState.files[FILE_B_ID]?.modifiedReviewed,
    [{ startLine: 0, endLineExclusive: 1 }]
  );
  assert.deepEqual(
    persisted.globalState.files[FILE_B_ID]?.reviewed,
    [{ startLine: 0, endLineExclusive: 1 }]
  );
});

test("T506 separate real history stores and recorders serialize one JSONL file without losing either event", async () => {
  const backend = new SharedControlledAtomicBackend();
  const storage = storageUris("history");
  const route = resolveReviewStateStorageRoute(storage, TARGET);
  const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
  const firstStore = new JsonlReviewHistoryStore({
    storageUris: storage,
    atomicFileStore: new SharedBackendAtomicTextFileStore(backend)
  });
  const secondStore = new JsonlReviewHistoryStore({
    storageUris: storage,
    atomicFileStore: new SharedBackendAtomicTextFileStore(backend)
  });
  assert.notStrictEqual(firstStore, secondStore);

  const editRecorder = new ReviewHistoryRecorder({
    sessionId: "t506-real-edit",
    createEventId: () => "event-edit",
    appender: firstStore
  });
  const commandRecorder = new ReviewHistoryRecorder({
    sessionId: "t506-real-command",
    createEventId: () => "event-command",
    appender: secondStore
  });
  assert.notStrictEqual(editRecorder, commandRecorder);

  const initial = createInitialCommit();
  const editNext = createEditCommit(initial);
  const commandTransaction = createCommandTransaction(initial);

  backend.arm(historyPath);
  const editHistory = editRecorder.recordDocumentEditMapping(
    initial,
    editNext,
    FILE_A_ID,
    EDIT_TIME,
    "t506-real-live-edit"
  );
  await backend.waitForFirstGatedWrite();

  const commandHistory = commandRecorder.recordTransaction(
    commandTransaction,
    "t506-real-concurrent-command"
  );
  await waitForImmediate();
  backend.releaseFirstGatedWrite();
  await Promise.all([editHistory, commandHistory]);

  const persistedHistory = backend.getText(historyPath);
  assert.ok(persistedHistory);
  const events = persistedHistory
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { type?: unknown; eventId?: unknown });
  assert.equal(events.length, 2, "Both separately recorded history events must survive.");
  assert.deepEqual(
    new Set(events.map((event) => event.type)),
    new Set(["invalidated-by-edit", "marked-reviewed"])
  );
  assert.deepEqual(
    new Set(events.map((event) => event.eventId)),
    new Set(["event-edit", "event-command"])
  );
});

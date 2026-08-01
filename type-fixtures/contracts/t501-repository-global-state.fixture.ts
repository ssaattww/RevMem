import {
  RepositoryGlobalStateRepository,
  type RepositoryGlobalStateMutationInput,
  type RepositoryGlobalStateRepositoryDependencies
} from "../../src/application/repository-global-state/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import type {
  ReviewStateTransaction,
  ReviewStateTransactionCommitter
} from "../../src/core/review-state/index";

const contextState = {
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "context-1",
  kind: "branch",
  repositoryId: "repository-1",
  displayName: "main",
  branch: { refName: "refs/heads/main", headRevision: "revision-1" },
  files: {},
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z"
} satisfies ReviewContextState;
const globalState = {
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: "revision-1",
  files: {},
  updatedAt: "2026-08-02T00:00:00.000Z"
} satisfies RepositoryGlobalState;
const committer: ReviewStateTransactionCommitter = { commit: async (_transaction) => undefined };
const dependencies = {
  requestHistory: async (_transaction: Readonly<ReviewStateTransaction>) => undefined
} satisfies RepositoryGlobalStateRepositoryDependencies;
const repository = new RepositoryGlobalStateRepository(dependencies);
const rangeInput = {
  operation: "mark-ranges-reviewed",
  contextState,
  globalState,
  target: { fileId: "file-1", currentPath: "src/example.ts", revisionId: "revision-1", lineCount: 3 },
  intervals: [{ startLine: 0, endLineExclusive: 2 }],
  occurredAt: "2026-08-02T00:00:00.000Z",
  committer
} satisfies RepositoryGlobalStateMutationInput;
const fileInput = {
  ...rangeInput,
  operation: "unmark-file-reviewed" as const
} satisfies RepositoryGlobalStateMutationInput;

const consume = async (): Promise<void> => {
  const rangeResult = await repository.apply(rangeInput);
  const fileResult = await repository.apply(fileInput);
  if (rangeResult.status === "applied") void rangeResult.transaction.next.globalState;
  if (fileResult.status === "no-op") void fileResult.transaction.expected.contextState;
};

void consume();

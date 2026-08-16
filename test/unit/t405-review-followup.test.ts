import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import "./t405-composition-regression.test.js";

import {
  findCurrentPullRequestContext,
  formatReviewContextProgress,
  projectReviewContexts,
} from "../../src/application/review-contexts/index.js";
import type { SelectedReviewContext } from "../../src/application/review-context/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import {
  currentContextSelectionKey,
  type CurrentContextUiSnapshot,
} from "../../src/ui/current-context/index.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const PR_CONTEXT_ID = `github-pr:${REPOSITORY_ID}#52`;

const context = (
  contextId: string,
  kind: ReviewContextState["kind"],
  displayName: string,
  overrides: Partial<ReviewContextState> = {},
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind,
  repositoryId: REPOSITORY_ID,
  displayName,
  files: {},
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
  ...overrides,
});

const pullRequest = context(PR_CONTEXT_ID, "pull-request", "PR #52", {
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 52,
    state: "open",
    title: "Current PR",
    baseSha: A,
    headSha: B,
  },
});
const secondPullRequest = context(`github-pr:${REPOSITORY_ID}#53`, "pull-request", "PR #53", {
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 53,
    state: "open",
    title: "Second current-head PR",
    baseSha: A,
    headSha: B,
  },
});
const branch = context("branch:main", "branch", "main", {
  branch: { refName: "refs/heads/main", headRevision: B },
});
const workspace = context("workspace:sample", "workspace", "sample", {
  workspace: { workspaceId: "sample", snapshotRevision: "snapshot-1" },
});

test("R405-4 presentation hide applies to current PR, branch, and workspace without deleting state", () => {
  const items = projectReviewContexts({
    current: [pullRequest, branch, workspace],
    saved: [pullRequest],
    hiddenContextIds: new Set([
      pullRequest.contextId,
      branch.contextId,
      workspace.contextId,
    ]),
  });

  assert.deepEqual(items, []);
  assert.equal(pullRequest.pullRequest?.state, "open");
});

test("R405-5 Review Contexts projects T304-compatible PR progress", () => {
  const progress = {
    reviewedLineCount: 3,
    totalLineCount: 4,
    progress: 0.75,
  };
  const items = projectReviewContexts({
    current: [pullRequest],
    saved: [],
    hiddenContextIds: new Set(),
    progressByContextId: {
      [pullRequest.contextId]: progress,
    },
  });

  assert.deepEqual(items[0]?.progress, progress);
});

test("R405-5 progress formatter covers zero, partial, and complete PR states", () => {
  assert.equal(formatReviewContextProgress(undefined), undefined);
  assert.equal(formatReviewContextProgress({
    reviewedLineCount: 0,
    totalLineCount: 4,
    progress: 0,
  }), "進捗: 0% (0/4)");
  assert.equal(formatReviewContextProgress({
    reviewedLineCount: 3,
    totalLineCount: 4,
    progress: 0.75,
  }), "進捗: 75% (3/4)");
  assert.equal(formatReviewContextProgress({
    reviewedLineCount: 4,
    totalLineCount: 4,
    progress: 1,
  }), "進捗: 100% (4/4)");
});

test("R405-5 Review Contexts Tree renders projected progress to users", async () => {
  const ui = await readFile("src/ui/review-contexts/vscode-review-contexts-runtime.ts", "utf8");

  assert.match(ui, /formatReviewContextProgress\(element\.progress\)/u);
  assert.match(ui, /formatReviewContextProgress\(item\.progress\)/u);
});

test("R405-7 pull-request Current Context identity is stable across rediscovery and not label-derived", () => {
  const selection = {
    kind: "pull-request",
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    contextId: PR_CONTEXT_ID,
    pullRequestNumber: 52,
    headRevision: B,
  } satisfies SelectedReviewContext;
  const snapshot: CurrentContextUiSnapshot = {
    context: {
      kind: "pull-request",
      label: "#52",
      detail: "Current PR",
      baseRevision: A,
      headRevision: B,
      selection,
    },
    progress: undefined,
  };
  const rediscovered: CurrentContextUiSnapshot = {
    ...snapshot,
    context: {
      ...snapshot.context,
      detail: "Renamed title",
    },
  };

  assert.equal(currentContextSelectionKey(snapshot), currentContextSelectionKey(rediscovered));
  assert.match(currentContextSelectionKey(snapshot), /github-pr:github\.com\/ssaattww\/revmem#52/u);
});

test("R405-7/R405-8 current PR is inferred only from persisted open state at the local HEAD", () => {
  assert.equal(
    findCurrentPullRequestContext([pullRequest], REPOSITORY_ID, B)?.contextId,
    PR_CONTEXT_ID,
  );
  assert.equal(
    findCurrentPullRequestContext([
      {
        ...pullRequest,
        pullRequest: { ...pullRequest.pullRequest!, state: "closed" },
      },
    ], REPOSITORY_ID, B),
    undefined,
  );
  assert.equal(findCurrentPullRequestContext([pullRequest], REPOSITORY_ID, C), undefined);
  assert.equal(findCurrentPullRequestContext([pullRequest], "github.com/other/repo", B), undefined);
});

test("R405-7 multiple current-head PRs retain the PR explicitly chosen by redetection", () => {
  assert.equal(
    findCurrentPullRequestContext(
      [pullRequest, secondPullRequest],
      REPOSITORY_ID,
      B,
      secondPullRequest.contextId,
    )?.contextId,
    secondPullRequest.contextId,
  );
  assert.equal(
    findCurrentPullRequestContext([pullRequest, secondPullRequest], REPOSITORY_ID, B),
    undefined,
  );
});

test("R405-7 redetection persists and reloads explicit current PR identity", async () => {
  const runtime = await readFile("src/t405-review-contexts-runtime.ts", "utf8");

  assert.match(runtime, /currentPullRequestSelection\.select\([\s\S]*state\.contextId/u);
  assert.match(runtime, /currentPullRequestSelection\.read\([\s\S]*findCurrentPullRequestContext/u);
});

test("R405-6/R405-9 remove the dead closed-layer setting and document connected Review Contexts", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    contributes: { configuration: { properties: Record<string, unknown> } };
  };
  const readme = await readFile("README.md", "utf8");

  assert.equal(
    manifest.contributes.configuration.properties["reviewRange.closedPullRequestLayerDefault"],
    undefined,
  );
  assert.doesNotMatch(readme, /Global Understanding ViewとReview Contexts Viewも未接続/u);
  assert.match(readme, /Review Contexts/u);
  assert.match(readme, /T406/u);
});

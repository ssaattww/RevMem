import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryReviewContextVisibilityStore,
  ReviewContextsController,
  projectReviewContexts,
} from "../../src/application/review-contexts/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";

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

const branch = context("branch:main", "branch", "main", {
  branch: { refName: "refs/heads/main", headRevision: SHA_B },
});
const currentPr = context("github-pr:github.com/ssaattww/revmem#52", "pull-request", "PR #52", {
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 52,
    state: "open",
    title: "Current PR",
    baseSha: SHA_A,
    headSha: SHA_B,
  },
});
const savedOpenPr = context("github-pr:github.com/ssaattww/revmem#51", "pull-request", "PR #51", {
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 51,
    state: "open",
    title: "Saved open",
    baseSha: SHA_A,
    headSha: SHA_B,
  },
});
const savedClosedPr = context("github-pr:github.com/ssaattww/revmem#50", "pull-request", "PR #50", {
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 50,
    state: "closed",
    title: "Saved closed",
    baseSha: SHA_A,
    headSha: SHA_B,
  },
});
const workspace = context("workspace:sample", "workspace", "sample", {
  workspace: { workspaceId: "sample", snapshotRevision: "snapshot-1" },
});

test("current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR", () => {
  const items = projectReviewContexts({
    current: [currentPr, branch],
    saved: [savedClosedPr, currentPr, workspace, savedOpenPr],
    hiddenContextIds: new Set(),
  });

  assert.deepEqual(items.map((item) => [item.context.contextId, item.current, item.layerEnabled]), [
    [currentPr.contextId, true, true],
    [branch.contextId, true, undefined],
    [savedOpenPr.contextId, false, true],
    [savedClosedPr.contextId, false, false],
    [workspace.contextId, false, undefined],
  ]);
});

test("hidden presentation identity filters current and saved contexts without deleting state", () => {
  const hiddenContextIds = new Set([currentPr.contextId, savedClosedPr.contextId]);
  const items = projectReviewContexts({
    current: [currentPr, branch],
    saved: [currentPr, savedClosedPr],
    hiddenContextIds,
  });

  assert.deepEqual(items.map((item) => item.context.contextId), [branch.contextId]);
  assert.equal(currentPr.pullRequest?.state, "open");
});

test("controller hides only the presentation identity and delegates T405 operations without deleting review state", async () => {
  const visibility = new InMemoryReviewContextVisibilityStore();
  const calls: string[] = [];
  const controller = new ReviewContextsController({
    visibility,
    setPullRequestLayerEnabled: async (contextState, enabled) => {
      calls.push(`layer:${contextState.contextId}:${enabled}`);
    },
    refreshPullRequestCache: async (contextState) => {
      calls.push(`cache:${contextState.contextId}`);
    },
    openPullRequestDiff: async (contextState) => {
      calls.push(`diff:${contextState.contextId}`);
    },
    redetectPullRequest: async () => {
      calls.push("redetect");
    },
    reconnectGitHub: async () => {
      calls.push("reconnect");
    },
  });

  await controller.hide(savedClosedPr.contextId);
  assert.deepEqual(await visibility.readHiddenContextIds(), [savedClosedPr.contextId]);
  assert.equal(savedClosedPr.pullRequest?.state, "closed");

  await controller.setLayerEnabled(savedClosedPr, true);
  await controller.refreshCache(savedClosedPr);
  await controller.openDiff(savedClosedPr);
  await controller.redetectPullRequest();
  await controller.reconnectGitHub();

  assert.deepEqual(calls, [
    `layer:${savedClosedPr.contextId}:true`,
    `cache:${savedClosedPr.contextId}`,
    `diff:${savedClosedPr.contextId}`,
    "redetect",
    "reconnect",
  ]);
});

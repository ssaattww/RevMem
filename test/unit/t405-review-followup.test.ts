import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
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

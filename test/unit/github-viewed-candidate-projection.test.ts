import assert from "node:assert/strict";
import test from "node:test";

import type { GitHubRepositoryIdentity } from "../../src/application/github-pr-context/index";
import type { PullRequestDiffFileProgress } from "../../src/core/pr-progress/index";
import type { PullRequestProgressTreeFileNode } from
  "../../src/ui/pr-progress/pull-request-progress-tree-data-provider";
import {
  projectGitHubViewedCandidates,
  type GitHubViewedChangedFile,
  type GitHubViewedReadSnapshot,
  type GitHubViewedSelectedPullRequest,
  type GitHubViewedViewer,
  type GitHubViewedProgressSnapshot,
  type ProjectGitHubViewedCandidatesInput
} from "../../src/ui/pr-progress/github-viewed-candidate-projection";

const REPOSITORY: GitHubRepositoryIdentity = {
  host: "github.com",
  owner: "example",
  repository: "reviewed-repo"
};

const VIEWER: GitHubViewedViewer = {
  id: "U_viewer_1",
  login: "reviewer",
  host: "github.com"
};

const VIEWER_ID = "U_viewer_1";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const ORIGINAL_DIFF_ID = `${BASE_SHA}..${HEAD_SHA}`;
const GENERATION = 7;
const PR_NODE_ID = "PR_node_42";
const PR_NUMBER = 42;

const completedFile = (
  fileId: string,
  path: string,
  options: Partial<PullRequestDiffFileProgress> = {}
): PullRequestDiffFileProgress => ({
  fileId,
  oldPath: path,
  newPath: path,
  status: "modified",
  path,
  additions: 2,
  deletions: 1,
  reviewedLineCount: 3,
  totalLineCount: 3,
  progress: 1,
  excluded: false,
  ...options
});

const localFile = (
  source: PullRequestDiffFileProgress,
  category: PullRequestProgressTreeFileNode["category"] = "completed"
): Pick<PullRequestProgressTreeFileNode, "category" | "source"> => ({
  category,
  source
});

const changedFile = (
  path: string,
  options: Partial<GitHubViewedChangedFile> = {}
): GitHubViewedChangedFile => ({
  path,
  status: "modified",
  additions: 2,
  deletions: 1,
  viewedState: "UNVIEWED",
  ...options
});

const selectedPullRequest = (
  overrides: Partial<GitHubViewedSelectedPullRequest> = {}
): GitHubViewedSelectedPullRequest => ({
  nodeId: PR_NODE_ID,
  number: PR_NUMBER,
  state: "open",
  repository: REPOSITORY,
  headSha: HEAD_SHA,
  comparisonBaseSha: BASE_SHA,
  originalDiffId: ORIGINAL_DIFF_ID,
  generation: GENERATION,
  ...overrides
});

const progressSnapshot = (
  overrides: Partial<GitHubViewedProgressSnapshot> = {}
): GitHubViewedProgressSnapshot => ({
  contextId: "github.com/example/reviewed-repo#42",
  repository: REPOSITORY,
  pullRequestNumber: PR_NUMBER,
  headSha: HEAD_SHA,
  comparisonBaseSha: BASE_SHA,
  originalDiffId: ORIGINAL_DIFF_ID,
  generation: GENERATION,
  complete: true,
  ...overrides
});

const viewedRead = (
  files: readonly GitHubViewedChangedFile[],
  overrides: Partial<GitHubViewedReadSnapshot> = {}
): GitHubViewedReadSnapshot => ({
  viewerId: VIEWER_ID,
  repository: REPOSITORY,
  pullRequestNodeId: PR_NODE_ID,
  pullRequestNumber: PR_NUMBER,
  state: "open",
  headSha: HEAD_SHA,
  comparisonBaseSha: BASE_SHA,
  originalDiffId: ORIGINAL_DIFF_ID,
  generation: GENERATION,
  complete: true,
  files,
  ...overrides
});

const input = (
  overrides: Partial<ProjectGitHubViewedCandidatesInput> = {}
): ProjectGitHubViewedCandidatesInput => ({
  viewer: VIEWER,
  expectedViewerId: VIEWER_ID,
  targetRepository: REPOSITORY,
  selectedPullRequest: selectedPullRequest(),
  progressSnapshot: progressSnapshot(),
  viewedRead: viewedRead([changedFile("src/ready.ts")]),
  files: [localFile(completedFile("file-ready", "src/ready.ts"))],
  ...overrides
});

test("projects only an exact completed file for the authenticated viewer and selected PR", () => {
  const candidates = projectGitHubViewedCandidates(input());

  assert.deepEqual(candidates, [{
    fileId: "file-ready",
    path: "src/ready.ts",
    localCategory: "completed",
    viewedState: "UNVIEWED",
    synchronizationEligible: false
  }]);
});

test("does not project a candidate when viewer identity is unavailable or mismatched", () => {
  assert.deepEqual(projectGitHubViewedCandidates(input({ viewer: undefined })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({ expectedViewerId: undefined })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    expectedViewerId: "U_other_viewer"
  })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    viewedRead: viewedRead([changedFile("src/ready.ts")], {
      viewerId: "U_other_viewer"
    })
  })), []);
});

test("does not project a candidate for a different repository, PR, or closed PR", () => {
  assert.deepEqual(projectGitHubViewedCandidates(input({
    targetRepository: {
      host: "github.com",
      owner: "example",
      repository: "another-repo"
    }
  })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    selectedPullRequest: selectedPullRequest({
      nodeId: "PR_other",
      number: 43
    })
  })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    selectedPullRequest: selectedPullRequest({ state: "closed" })
  })), []);
});

test("invalidates stale reads when head, comparison base, diff identity, or generation changes", () => {
  assert.deepEqual(projectGitHubViewedCandidates(input({
    selectedPullRequest: selectedPullRequest({ headSha: "c".repeat(40) })
  })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    progressSnapshot: progressSnapshot({ comparisonBaseSha: "c".repeat(40) })
  })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    viewedRead: viewedRead([changedFile("src/ready.ts")], {
      originalDiffId: "stale-diff"
    })
  })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    viewedRead: viewedRead([changedFile("src/ready.ts")], {
      generation: GENERATION - 1
    })
  })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    viewedRead: viewedRead([changedFile("src/ready.ts")], {
      complete: false
    })
  })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    progressSnapshot: progressSnapshot({ complete: false })
  })), []);
});

test("does not project uncompleted, excluded, unsupported, or zero-change files", () => {
  const pending = completedFile("pending", "src/pending.ts", {
    reviewedLineCount: 2,
    totalLineCount: 3,
    progress: 2 / 3
  });
  const excluded = completedFile("excluded", "src/excluded.ts", {
    excluded: true,
    totalLineCount: 0
  });
  const zeroChange = completedFile("zero", "src/zero.ts", {
    additions: 0,
    deletions: 0,
    reviewedLineCount: 0,
    totalLineCount: 0
  });

  const result = projectGitHubViewedCandidates(input({
    files: [
      localFile(pending, "unreviewed"),
      localFile(excluded, "excluded"),
      localFile(zeroChange, "non-line-change"),
      localFile(completedFile("unsupported", "src/binary.dat"), "line-review-unsupported")
    ],
    viewedRead: viewedRead([
      changedFile("src/pending.ts"),
      changedFile("src/excluded.ts"),
      changedFile("src/zero.ts"),
      changedFile("src/binary.dat")
    ])
  }));

  assert.deepEqual(result, []);
});

test("does not guess paths for renamed or copied files", () => {
  const renamed = completedFile("renamed", "src/new-name.ts", {
    oldPath: "src/old-name.ts",
    newPath: "src/new-name.ts",
    status: "renamed"
  });
  const copied = completedFile("copied", "src/copied.ts", {
    oldPath: "src/source.ts",
    newPath: "src/copied.ts",
    status: "copied"
  });

  const result = projectGitHubViewedCandidates(input({
    files: [localFile(renamed), localFile(copied)],
    viewedRead: viewedRead([
      changedFile("src/new-name.ts", { status: "renamed" }),
      changedFile("src/copied.ts", { status: "copied" })
    ])
  }));

  assert.deepEqual(result, []);
});

test("does not project ambiguous duplicate local or GitHub file paths", () => {
  const first = completedFile("file-1", "src/duplicate.ts");
  const second = completedFile("file-2", "src/duplicate.ts");

  assert.deepEqual(projectGitHubViewedCandidates(input({
    files: [localFile(first), localFile(second)],
    viewedRead: viewedRead([changedFile("src/duplicate.ts")])
  })), []);

  assert.deepEqual(projectGitHubViewedCandidates(input({
    files: [localFile(first), localFile(second, "unreviewed")],
    viewedRead: viewedRead([changedFile("src/duplicate.ts")])
  })), []);

  assert.deepEqual(projectGitHubViewedCandidates(input({
    files: [localFile(first)],
    viewedRead: viewedRead([
      changedFile("src/duplicate.ts"),
      changedFile("src/duplicate.ts")
    ])
  })), []);
});

test("keeps GitHub Viewed states separate from the local completed classification", () => {
  const files = ["VIEWED", "UNVIEWED", "DISMISSED"] as const;
  const candidates = projectGitHubViewedCandidates(input({
    files: files.map((viewedState, index) => {
      const path = `src/file-${index}.ts`;
      return localFile(completedFile(`file-${index}`, path));
    }),
    viewedRead: viewedRead(files.map((viewedState, index) =>
      changedFile(`src/file-${index}.ts`, { viewedState })
    ))
  }));

  assert.deepEqual(candidates.map(({ localCategory, viewedState }) => ({
    localCategory,
    viewedState
  })), files.map((viewedState) => ({
    localCategory: "completed",
    viewedState
  })));
});

test("does not display a partial match when another diff file is missing or different", () => {
  const local = [
    localFile(completedFile("ready", "src/ready.ts")),
    localFile(completedFile("pending", "src/pending.ts"), "unreviewed")
  ];

  assert.deepEqual(projectGitHubViewedCandidates(input({ files: local })), []);
  assert.deepEqual(projectGitHubViewedCandidates(input({
    files: local,
    viewedRead: viewedRead([
      changedFile("src/ready.ts"),
      changedFile("src/pending.ts", { additions: 7 })
    ])
  })), []);
  assert.equal(projectGitHubViewedCandidates(input({
    files: local,
    viewedRead: viewedRead([changedFile("src/ready.ts"), changedFile("src/pending.ts")])
  })).length, 1);
});

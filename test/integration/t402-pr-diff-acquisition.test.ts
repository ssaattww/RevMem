import assert from "node:assert/strict";
import test from "node:test";

import {
  PullRequestDiffAcquisitionService,
  type LocalPullRequestDiffPort,
  type PullRequestDiffAcquisitionRequest,
  type PullRequestRemoteDataPort,
  type PullRequestRemoteFile
} from "../../src/application/github-pr-diff/index";
import { FetchGitHubPullRequestDiffAdapter } from "../../src/adapters/github/index";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

const request: PullRequestDiffAcquisitionRequest = {
  contextId: "github:github.com/example/review-range#42",
  repository: {
    host: "github.com",
    owner: "example",
    repository: "review-range"
  },
  number: 42,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA
};

const metadata = {
  number: 42,
  title: "T402",
  url: "https://github.com/example/review-range/pull/42",
  state: "open" as const,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA
};

const modifiedPatchFile = (patch: string | undefined): PullRequestRemoteFile => ({
  oldPath: "src/value.ts",
  newPath: "src/value.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  ...(patch === undefined ? {} : { patch })
});

const unavailableLocal = (reason = "missing-revision"): LocalPullRequestDiffPort => ({
  loadDiff: async () => ({ kind: "unavailable", reason })
});

const remoteData = (
  files: readonly PullRequestRemoteFile[],
  readFile: PullRequestRemoteDataPort["readFile"] = async () => ({
    kind: "unavailable",
    reason: "api"
  })
): PullRequestRemoteDataPort => ({
  fetch: async () => ({ kind: "available", metadata, files }),
  readFile
});

test("GitHub diff adapter fetches exact PR metadata and paginated file records", async () => {
  const requestedUrls: string[] = [];
  const authorizationHeaders: Array<string | null> = [];
  const adapter = new FetchGitHubPullRequestDiffAdapter({
    apiBaseUrl: "https://api.github.test",
    token: "test-token",
    fetch: async (input, init) => {
      const url = new URL(input.toString());
      requestedUrls.push(url.toString());
      authorizationHeaders.push(new Headers(init?.headers).get("authorization"));
      if (url.pathname === "/repos/example/review-range/pulls/42") {
        return new Response(JSON.stringify({
          number: 42,
          title: "T402",
          html_url: "https://github.test/example/review-range/pull/42",
          state: "closed",
          merged_at: "2026-08-02T00:00:00Z",
          base: { sha: BASE_SHA },
          head: { sha: HEAD_SHA }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const page = url.searchParams.get("page") ?? "1";
      if (url.pathname === "/repos/example/review-range/pulls/42/files" && page === "1") {
        return new Response(JSON.stringify([{ 
          filename: "src/value.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old\n+new"
        }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.test/repos/example/review-range/pulls/42/files?per_page=100&page=2>; rel="next"'
          }
        });
      }
      if (url.pathname === "/repos/example/review-range/pulls/42/files" && page === "2") {
        return new Response(JSON.stringify([{ 
          filename: "src/new-name.ts",
          previous_filename: "src/old-name.ts",
          status: "renamed",
          additions: 0,
          deletions: 0
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    }
  });

  const result = await adapter.fetch(request);

  assert.deepEqual(result, {
    kind: "available",
    metadata: {
      number: 42,
      title: "T402",
      url: "https://github.test/example/review-range/pull/42",
      state: "merged",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA
    },
    files: [
      {
        oldPath: "src/value.ts",
        newPath: "src/value.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new"
      },
      {
        oldPath: "src/old-name.ts",
        newPath: "src/new-name.ts",
        status: "renamed",
        additions: 0,
        deletions: 0
      }
    ]
  });
  assert.equal(requestedUrls.length, 3);
  assert.deepEqual(authorizationHeaders, ["Bearer test-token", "Bearer test-token", "Bearer test-token"]);
});

test("local Git diff is the first successful acquisition source", async () => {
  let remoteCalls = 0;
  const local: LocalPullRequestDiffPort = {
    loadDiff: async () => ({
      kind: "available",
      diff: [
        "diff --git a/src/value.ts b/src/value.ts",
        "index 1234567..89abcde 100644",
        "--- a/src/value.ts",
        "+++ b/src/value.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        ""
      ].join("\n")
    })
  };
  const remote: PullRequestRemoteDataPort = {
    fetch: async () => {
      remoteCalls += 1;
      return { kind: "unavailable", reason: "api" };
    },
    readFile: async () => {
      throw new Error("content fallback must not run");
    }
  };
  const service = new PullRequestDiffAcquisitionService({ local, remote });

  const result = await service.acquire(request);

  assert.equal(result.kind, "acquired");
  assert.equal(result.source, "local-git");
  assert.equal(remoteCalls, 0);
  assert.deepEqual(result.snapshot, {
    contextId: request.contextId,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
    files: [{
      fileId: "src/value.ts",
      oldPath: "src/value.ts",
      newPath: "src/value.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      hunks: [{
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [
          { kind: "deletion", oldLine: 1, text: "old" },
          { kind: "addition", newLine: 1, text: "new" }
        ]
      }]
    }]
  });
});

test("GitHub PR files patch is used after local Git is unavailable", async () => {
  const remote = remoteData([
    modifiedPatchFile("@@ -1 +1 @@\n-old\n+new")
  ], async () => {
    throw new Error("content fallback must not run for a complete patch");
  });
  const service = new PullRequestDiffAcquisitionService({
    local: unavailableLocal(),
    remote
  });

  const result = await service.acquire(request);

  assert.equal(result.kind, "acquired");
  assert.equal(result.source, "github-patch");
  assert.equal(result.snapshot.files[0]?.additions, 1);
  assert.equal(result.snapshot.files[0]?.deletions, 1);
});

test("a missing GitHub patch falls back to exact base and head file contents", async () => {
  const reads: Array<{ revision: string; path: string }> = [];
  const remote = remoteData([modifiedPatchFile(undefined)], async (_repository, revision, path) => {
    reads.push({ revision, path });
    return {
      kind: "found",
      content: revision === BASE_SHA ? "old\nshared\n" : "new\nshared\n"
    };
  });
  const service = new PullRequestDiffAcquisitionService({
    local: unavailableLocal(),
    remote
  });

  const result = await service.acquire(request);

  assert.equal(result.kind, "acquired");
  assert.equal(result.source, "github-content");
  assert.deepEqual(reads, [
    { revision: BASE_SHA, path: "src/value.ts" },
    { revision: HEAD_SHA, path: "src/value.ts" }
  ]);
  assert.deepEqual(result.snapshot.files[0]?.hunks, [{
    oldStart: 1,
    oldCount: 1,
    newStart: 1,
    newCount: 1,
    lines: [
      { kind: "deletion", oldLine: 1, text: "old" },
      { kind: "addition", newLine: 1, text: "new" }
    ]
  }]);
});

test("an incomplete GitHub patch is rejected and rebuilt from base/head contents", async () => {
  const incomplete: PullRequestRemoteFile = {
    oldPath: "src/value.ts",
    newPath: "src/value.ts",
    status: "modified",
    additions: 2,
    deletions: 2,
    patch: "@@ -1 +1 @@\n-old\n+new"
  };
  const remote = remoteData([incomplete], async (_repository, revision) => ({
    kind: "found",
    content: revision === BASE_SHA ? "old\nx\n" : "new\ny\n"
  }));
  const service = new PullRequestDiffAcquisitionService({
    local: unavailableLocal(),
    remote
  });

  const result = await service.acquire(request);

  assert.equal(result.kind, "acquired");
  assert.equal(result.source, "github-content");
  assert.equal(result.snapshot.files[0]?.additions, 2);
  assert.equal(result.snapshot.files[0]?.deletions, 2);
});

test("all failed routes return no snapshot and never infer reviewed changes", async () => {
  const remote = remoteData([modifiedPatchFile(undefined)], async () => ({
    kind: "unavailable",
    reason: "network"
  }));
  const service = new PullRequestDiffAcquisitionService({
    local: unavailableLocal("git-failure"),
    remote
  });

  const result = await service.acquire(request);

  assert.equal(result.kind, "unavailable");
  assert.equal("snapshot" in result, false);
  assert.deepEqual(result.attempts, [
    { source: "local-git", reason: "git-failure" },
    { source: "github-patch", reason: "missing-patch" },
    { source: "github-content", reason: "network" }
  ]);
});

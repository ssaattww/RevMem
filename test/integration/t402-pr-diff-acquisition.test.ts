import assert from "node:assert/strict";
import test from "node:test";

import {
  PullRequestDiffAcquisitionService,
  type LocalPullRequestDiffPort,
  type PullRequestDiffAcquisitionRequest,
  type PullRequestDiffUnavailableReason,
  type PullRequestRemoteDataPort,
  type PullRequestRemoteFile
} from "../../src/application/github-pr-diff/index";
import { FetchGitHubPullRequestDiffAdapter } from "../../src/adapters/github/index";
import {
  LocalGitPullRequestDiffAdapter,
  type GitCommandExecutor,
  type GitCommandInvocation
} from "../../src/adapters/local-git/index";

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

const unavailableLocal = (reason: PullRequestDiffUnavailableReason = "missing-revision"): LocalPullRequestDiffPort => ({
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
          changed_files: 2,
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

test("GitHub patch parser accepts ordinary context lines while preserving changed coordinates", async () => {
  const contextual: PullRequestRemoteFile = {
    oldPath: "src/value.ts",
    newPath: "src/value.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: "@@ -1,3 +1,3 @@\n shared-before\n-old\n+new\n shared-after"
  };
  const service = new PullRequestDiffAcquisitionService({
    local: unavailableLocal(),
    remote: remoteData([contextual], async () => {
      throw new Error("complete contextual patch must not use content fallback");
    })
  });

  const result = await service.acquire(request);

  assert.equal(result.kind, "acquired");
  assert.equal(result.source, "github-patch");
  assert.deepEqual(result.snapshot.files[0]?.hunks[0]?.lines, [
    { kind: "context", oldLine: 1, newLine: 1, text: "shared-before" },
    { kind: "deletion", oldLine: 2, text: "old" },
    { kind: "addition", newLine: 2, text: "new" },
    { kind: "context", oldLine: 3, newLine: 3, text: "shared-after" }
  ]);
});

test("remote metadata from a different comparison is rejected before content reads", async () => {
  let reads = 0;
  const remote: PullRequestRemoteDataPort = {
    fetch: async () => ({
      kind: "available",
      metadata: { ...metadata, headSha: "3333333333333333333333333333333333333333" },
      files: [modifiedPatchFile(undefined)]
    }),
    readFile: async () => {
      reads += 1;
      return { kind: "found", content: "unexpected" };
    }
  };
  const service = new PullRequestDiffAcquisitionService({ local: unavailableLocal(), remote });

  const result = await service.acquire(request);

  assert.equal(result.kind, "unavailable");
  assert.equal(reads, 0);
  assert.deepEqual(result.attempts.slice(-2), [
    { source: "github-patch", reason: "identity-mismatch" },
    { source: "github-content", reason: "identity-mismatch" }
  ]);
});

test("local Git adapter passes immutable revisions as separate arguments and classifies missing objects", async () => {
  const invocations: GitCommandInvocation[] = [];
  let acquisition = 0;
  const executor: GitCommandExecutor = {
    execute: async invocation => {
      invocations.push(invocation);
      if (invocation.argumentsList[0] === "rev-parse") {
        const revision = invocation.argumentsList[3]!.replace(/\^\{commit\}$/u, "");
        if (acquisition === 1 && revision === BASE_SHA) {
          return { exitCode: 1, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: `${revision}\n`, stderr: "" };
      }
      acquisition += 1;
      return { exitCode: 0, stdout: "diff --git a/a.ts b/a.ts\n", stderr: "" };
    }
  };
  const adapter = new LocalGitPullRequestDiffAdapter(executor, "/workspace/repository");

  assert.deepEqual(await adapter.loadDiff(request), {
    kind: "available",
    diff: "diff --git a/a.ts b/a.ts\n"
  });
  assert.deepEqual(await adapter.loadDiff(request), {
    kind: "unavailable",
    reason: "missing-revision"
  });
  assert.deepEqual(invocations.map(({ argumentsList }) => argumentsList), [
    ["rev-parse", "--verify", "--quiet", `${BASE_SHA}^{commit}`],
    ["rev-parse", "--verify", "--quiet", `${HEAD_SHA}^{commit}`],
    [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--unified=0",
      "--find-renames",
      "--find-copies",
      "-l1000",
      BASE_SHA,
      HEAD_SHA,
      "--"
    ],
    ["rev-parse", "--verify", "--quiet", `${BASE_SHA}^{commit}`]
  ]);
});

test("invalid revision input is rejected before invoking local Git", async () => {
  let calls = 0;
  const adapter = new LocalGitPullRequestDiffAdapter({
    execute: async () => {
      calls += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  }, "/workspace/repository");

  await assert.rejects(
    adapter.loadDiff({ ...request, baseSha: "--output=stolen" }),
    /baseSha and headSha/
  );
  assert.equal(calls, 0);
});

test("GitHub raw-content reads bind the exact immutable ref and classify missing files", async () => {
  const calls: Array<{ url: string; authorization: string | null; accept: string | null }> = [];
  const adapter = new FetchGitHubPullRequestDiffAdapter({
    apiBaseUrl: "https://api.github.test",
    token: "test-token",
    fetch: async (input, init) => {
      const url = new URL(input.toString());
      const headers = new Headers(init?.headers);
      calls.push({
        url: url.toString(),
        authorization: headers.get("authorization"),
        accept: headers.get("accept")
      });
      return url.pathname.endsWith("/missing.ts")
        ? new Response(JSON.stringify({ message: "Not Found" }), { status: 404 })
        : new Response(new TextEncoder().encode("exact-content\n"), { status: 200 });
    }
  });

  assert.deepEqual(await adapter.readFile(request.repository, BASE_SHA, "src/value.ts"), {
    kind: "found",
    content: "exact-content\n"
  });
  assert.deepEqual(await adapter.readFile(request.repository, BASE_SHA, "missing.ts"), {
    kind: "unavailable",
    reason: "missing-file"
  });
  const first = new URL(calls[0]!.url);
  assert.equal(first.pathname, "/repos/example/review-range/contents/src/value.ts");
  assert.equal(first.searchParams.get("ref"), BASE_SHA);
  assert.equal(calls[0]?.authorization, "Bearer test-token");
  assert.equal(calls[0]?.accept, "application/vnd.github.raw+json");
});

test("malformed remote file identity fails closed without reading repository contents", async () => {
  let reads = 0;
  const remote: PullRequestRemoteDataPort = {
    fetch: async () => ({
      kind: "available",
      metadata,
      files: [{
        oldPath: "../outside.ts",
        newPath: "../outside.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new"
      }]
    }),
    readFile: async () => {
      reads += 1;
      return { kind: "found", content: "unexpected" };
    }
  };
  const service = new PullRequestDiffAcquisitionService({ local: unavailableLocal(), remote });

  const result = await service.acquire(request);

  assert.equal(result.kind, "unavailable");
  assert.equal(reads, 0);
  assert.deepEqual(result.attempts.slice(-2), [
    { source: "github-patch", reason: "invalid-data" },
    { source: "github-content", reason: "invalid-data" }
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { PullRequestDiffAcquisitionRequest } from "../../src/application/github-pr-diff/index";
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
  repository: { host: "github.com", owner: "example", repository: "review-range" },
  number: 42,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA
};

test("local Git adapter verifies both revisions as commit objects before diffing", async () => {
  const invocations: GitCommandInvocation[] = [];
  const executor: GitCommandExecutor = {
    execute: async invocation => {
      invocations.push(invocation);
      const revision = invocation.argumentsList[3];
      if (invocation.argumentsList[0] === "rev-parse") {
        return {
          exitCode: 0,
          stdout: `${revision?.replace(/\^\{commit\}$/u, "")}\n`,
          stderr: ""
        };
      }
      return { exitCode: 0, stdout: "diff --git a/a.ts b/a.ts\n", stderr: "" };
    }
  };
  const adapter = new LocalGitPullRequestDiffAdapter(executor, "/workspace/repository");

  const result = await adapter.loadDiff(request);

  assert.equal(invocations[0]?.argumentsList[0], "rev-parse");
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
    ]
  ]);
  assert.deepEqual(result, { kind: "available", diff: "diff --git a/a.ts b/a.ts\n" });
});

test("local Git adapter stops before diff when a commit object is unavailable", async () => {
  const invocations: GitCommandInvocation[] = [];
  const adapter = new LocalGitPullRequestDiffAdapter({
    execute: async invocation => {
      invocations.push(invocation);
      return { exitCode: 1, stdout: "", stderr: "" };
    }
  }, "/workspace/repository");

  assert.deepEqual(await adapter.loadDiff(request), {
    kind: "unavailable",
    reason: "missing-revision"
  });
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]?.argumentsList[0], "rev-parse");
});

test("GitHub files acquisition rejects the 3000-file endpoint cap as incomplete", async () => {
  const adapter = new FetchGitHubPullRequestDiffAdapter({
    apiBaseUrl: "https://api.github.test",
    fetch: async input => {
      const url = new URL(input.toString());
      if (url.pathname === "/repos/example/review-range/pulls/42") {
        return new Response(JSON.stringify({
          number: 42,
          title: "T402",
          html_url: "https://github.test/example/review-range/pull/42",
          state: "open",
          merged_at: null,
          changed_files: 3000,
          base: { sha: BASE_SHA },
          head: { sha: HEAD_SHA }
        }), { status: 200 });
      }
      return new Response(JSON.stringify(Array.from({ length: 3000 }, (_, index) => ({
        filename: `src/file-${index}.ts`,
        status: "modified",
        additions: 0,
        deletions: 0
      }))), { status: 200 });
    }
  });

  const result = await adapter.fetch(request);

  assert.equal(result.kind, "unavailable");
  if (result.kind === "unavailable") assert.equal(result.reason, "diff-too-large");
});

test("GitHub files acquisition rejects a missing Link when changed_files proves the list is partial", async () => {
  const adapter = new FetchGitHubPullRequestDiffAdapter({
    apiBaseUrl: "https://api.github.test",
    fetch: async input => {
      const url = new URL(input.toString());
      if (url.pathname === "/repos/example/review-range/pulls/42") {
        return new Response(JSON.stringify({
          number: 42,
          title: "T402",
          html_url: "https://github.test/example/review-range/pull/42",
          state: "open",
          merged_at: null,
          changed_files: 2,
          base: { sha: BASE_SHA },
          head: { sha: HEAD_SHA }
        }), { status: 200 });
      }
      return new Response(JSON.stringify([{
        filename: "src/only-one.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new"
      }]), { status: 200 });
    }
  });

  assert.deepEqual(await adapter.fetch(request), {
    kind: "unavailable",
    reason: "api"
  });
});

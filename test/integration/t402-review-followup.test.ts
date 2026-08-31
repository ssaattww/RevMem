import { execFile } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { promisify } from "node:util";

import {
  PullRequestDiffAcquisitionService,
  type LocalPullRequestDiffPort,
  type PullRequestDiffAcquisitionRequest,
  type PullRequestRemoteDataPort,
  type PullRequestRemoteFile
} from "../../src/application/github-pr-diff/index";
import { FetchGitHubPullRequestDiffAdapter } from "../../src/adapters/github/index";
import {
  LocalGitPullRequestDiffAdapter,
  NodeGitCommandExecutor
} from "../../src/adapters/local-git/index";
import type { ReviewContextState } from "../../src/core/contracts/index";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index";
import { calculatePullRequestDiffProgress } from "../../src/core/pr-progress/index";
import { createTemporaryDirectory } from "../support/temporary-directory";

const execFileAsync = promisify(execFile);
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

const metadataPayload = {
  number: 42,
  title: "T402 review follow-up",
  html_url: "https://github.com/example/review-range/pull/42",
  state: "open",
  merged_at: null,
  changed_files: 1,
  base: { sha: BASE_SHA },
  head: { sha: HEAD_SHA }
};

const unavailableLocal = (): LocalPullRequestDiffPort => ({
  loadDiff: async () => ({ kind: "unavailable", reason: "missing-revision" })
});

const remoteMetadata = {
  number: 42,
  title: "T402 review follow-up",
  url: "https://github.com/example/review-range/pull/42",
  state: "open" as const,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA
};

const reviewContext = (): ReviewContextState => ({
  schemaVersion: 1,
  contextId: request.contextId,
  kind: "pull-request",
  repositoryId: "github.com/example/review-range",
  displayName: "PR #42",
  pullRequest: {
    host: "github.com",
    owner: "example",
    repository: "review-range",
    number: 42,
    state: "open",
    baseSha: BASE_SHA,
    headSha: HEAD_SHA
  },
  files: {},
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z"
});

test("T402-R001 rejects content fallback when duplicate lines permit different optimal coordinates", async () => {
  const file: PullRequestRemoteFile = {
    oldPath: "src/value.ts",
    newPath: "src/value.ts",
    status: "modified",
    additions: 2,
    deletions: 0
  };
  const remote: PullRequestRemoteDataPort = {
    fetch: async () => ({ kind: "available", metadata: remoteMetadata, files: [file] }),
    readFile: async (_repository, revision) => ({
      kind: "found",
      content: revision === BASE_SHA ? "a\n" : "b\na\na\n"
    })
  };
  const service = new PullRequestDiffAcquisitionService({
    local: unavailableLocal(),
    remote
  });

  const result = await service.acquire(request);

  assert.equal(result.kind, "unavailable");
  assert.deepEqual(result.attempts.slice(-2), [
    { source: "github-patch", reason: "missing-patch" },
    { source: "github-content", reason: "invalid-data" }
  ]);
});

test("T402-R002 rejects the GitHub changed status instead of treating a type change as modified", async () => {
  const adapter = new FetchGitHubPullRequestDiffAdapter({
    apiBaseUrl: "https://api.github.test",
    fetch: async input => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith(`/compare/${BASE_SHA}...${HEAD_SHA}`)) {
        return new Response(JSON.stringify({ merge_base_commit: { sha: BASE_SHA } }), { status: 200 });
      }
      if (!url.pathname.endsWith("/files")) {
        return new Response(JSON.stringify(metadataPayload), { status: 200 });
      }
      return new Response(JSON.stringify([{
        filename: "src/value.ts",
        status: "changed",
        additions: 0,
        deletions: 0
      }]), { status: 200 });
    }
  });

  assert.deepEqual(await adapter.fetch(request), {
    kind: "unavailable",
    reason: "api"
  });
});

test("T402-R002 classifies patchless binary content and reaches the shared binary exclusion", async () => {
  const adapter = new FetchGitHubPullRequestDiffAdapter({
    apiBaseUrl: "https://api.github.test",
    fetch: async input => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/contents/assets/image.bin")) {
        return new Response(Uint8Array.from([0, 1, 2, 3]), { status: 200 });
      }
      if (url.pathname.endsWith(`/compare/${BASE_SHA}...${HEAD_SHA}`)) {
        return new Response(JSON.stringify({ merge_base_commit: { sha: BASE_SHA } }), { status: 200 });
      }
      if (url.pathname.endsWith("/files")) {
        return new Response(JSON.stringify([{
          filename: "assets/image.bin",
          status: "modified",
          additions: 0,
          deletions: 0
        }]), { status: 200 });
      }
      return new Response(JSON.stringify(metadataPayload), { status: 200 });
    }
  });
  const service = new PullRequestDiffAcquisitionService({
    local: unavailableLocal(),
    remote: adapter
  });

  const result = await service.acquire(request);

  assert.equal(result.kind, "acquired");
  assert.equal(result.source, "github-content");
  assert.equal(result.snapshot.files[0]?.status, "binary");
  const progress = calculatePullRequestDiffProgress({
    diff: result.snapshot,
    reviewContext: reviewContext(),
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
  });
  assert.equal(progress.files[0]?.excluded, true);
  assert.deepEqual(progress.files[0]?.exclusionReason, { kind: "binary" });
});

test("T402-IFR-P2 classifies every patchless zero-stat status from immutable binary content", async () => {
  const cases: ReadonlyArray<{
    readonly status: PullRequestRemoteFile["status"];
    readonly oldPath?: string;
    readonly newPath?: string;
  }> = [
    { status: "added", newPath: "assets/added.bin" },
    { status: "deleted", oldPath: "assets/deleted.bin" },
    { status: "renamed", oldPath: "assets/old.bin", newPath: "assets/renamed.bin" },
    { status: "copied", oldPath: "assets/source.bin", newPath: "assets/copied.bin" }
  ];

  for (const item of cases) {
    const reads: Array<{ readonly revision: string; readonly path: string }> = [];
    const remote: PullRequestRemoteDataPort = {
      fetch: async () => ({
        kind: "available",
        metadata: remoteMetadata,
        files: [{ ...item, additions: 0, deletions: 0 }]
      }),
      readFile: async (_repository, revision, path) => {
        reads.push({ revision, path });
        return { kind: "binary" };
      }
    };
    const service = new PullRequestDiffAcquisitionService({
      local: unavailableLocal(),
      remote
    });

    const result = await service.acquire(request);

    assert.equal(result.kind, "acquired", item.status);
    assert.equal(result.source, "github-content", item.status);
    assert.equal(result.snapshot.files[0]?.status, "binary", item.status);
    assert.equal(reads.length, item.status === "added" || item.status === "deleted" ? 1 : 2, item.status);
    const progress = calculatePullRequestDiffProgress({
      diff: result.snapshot,
      reviewContext: reviewContext(),
      exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
    });
    assert.deepEqual(progress.files[0]?.exclusionReason, { kind: "binary" }, item.status);
  }
});

test("T402-IFR-P2 retains patchless empty-text and rename-only content through fallback", async () => {
  const cases: ReadonlyArray<{
    readonly status: PullRequestRemoteFile["status"];
    readonly oldPath?: string;
    readonly newPath?: string;
  }> = [
    { status: "added", newPath: "docs/empty.txt" },
    { status: "renamed", oldPath: "docs/old.txt", newPath: "docs/new.txt" }
  ];

  for (const item of cases) {
    const service = new PullRequestDiffAcquisitionService({
      local: unavailableLocal(),
      remote: {
        fetch: async () => ({
          kind: "available",
          metadata: remoteMetadata,
          files: [{ ...item, additions: 0, deletions: 0 }]
        }),
        readFile: async () => ({ kind: "found", content: "" })
      }
    });

    const result = await service.acquire(request);

    assert.equal(result.kind, "acquired", item.status);
    assert.equal(result.source, "github-content", item.status);
    assert.equal(result.snapshot.files[0]?.status, item.status, item.status);
    assert.deepEqual(result.snapshot.files[0]?.hunks, [], item.status);
  }
});

test("T402-R003 detects a pure copy from an unchanged source with bounded harder copy detection", async () => {
  const directory = await createTemporaryDirectory("t402-pure-copy");
  const runGit = async (argumentsList: readonly string[]): Promise<string> => {
    const { stdout } = await execFileAsync("git", [...argumentsList], {
      cwd: directory.path,
      windowsHide: true
    });
    return stdout.trim();
  };

  try {
    await runGit(["init", "--initial-branch=main"]);
    await runGit(["config", "user.name", "T402 Test"]);
    await runGit(["config", "user.email", "t402@example.invalid"]);
    await runGit(["config", "diff.renameLimit", "0"]);
    await writeFile(`${directory.path}/source.txt`, "a\nb\nc\n", "utf8");
    await runGit(["add", "source.txt"]);
    await runGit(["commit", "--message", "base"]);
    const baseSha = await runGit(["rev-parse", "HEAD"]);

    await copyFile(`${directory.path}/source.txt`, `${directory.path}/copied.txt`);
    await runGit(["add", "copied.txt"]);
    await runGit(["commit", "--message", "copy"]);
    const headSha = await runGit(["rev-parse", "HEAD"]);

    const local = new LocalGitPullRequestDiffAdapter(
      new NodeGitCommandExecutor(),
      directory.path
    );
    const service = new PullRequestDiffAcquisitionService({
      local,
      remote: {
        fetch: async () => {
          throw new Error("local Git must satisfy the acquisition");
        },
        readFile: async () => {
          throw new Error("local Git must satisfy the acquisition");
        }
      }
    });
    const result = await service.acquire({ ...request, baseSha, headSha });

    assert.equal(result.kind, "acquired");
    assert.equal(result.source, "local-git");
    assert.deepEqual(result.snapshot.files, [{
      fileId: "copied.txt",
      oldPath: "source.txt",
      newPath: "copied.txt",
      status: "copied",
      additions: 0,
      deletions: 0,
      hunks: []
    }]);
  } finally {
    await directory.cleanup();
  }
});

test("T402-IFR-P1 acquires raw blob coordinates when repository textconv is configured", async () => {
  const directory = await createTemporaryDirectory("t402-no-textconv");
  const runGit = async (argumentsList: readonly string[]): Promise<string> => {
    const { stdout } = await execFileAsync("git", [...argumentsList], {
      cwd: directory.path,
      windowsHide: true
    });
    return stdout.trim();
  };

  try {
    await runGit(["init", "--initial-branch=main"]);
    await runGit(["config", "user.name", "T402 Test"]);
    await runGit(["config", "user.email", "t402@example.invalid"]);
    await runGit(["config", "diff.foo.textconv", "git hash-object"]);
    await writeFile(`${directory.path}/.gitattributes`, "*.foo diff=foo\n", "utf8");
    await writeFile(`${directory.path}/value.foo`, "shared\nactual-old\n", "utf8");
    await runGit(["add", "value.foo"]);
    await runGit(["commit", "--message", "base"]);
    const baseSha = await runGit(["rev-parse", "HEAD"]);

    await writeFile(`${directory.path}/value.foo`, "shared\nactual-new\n", "utf8");
    await runGit(["commit", "--all", "--message", "head"]);
    const headSha = await runGit(["rev-parse", "HEAD"]);

    const service = new PullRequestDiffAcquisitionService({
      local: new LocalGitPullRequestDiffAdapter(new NodeGitCommandExecutor(), directory.path),
      remote: {
        fetch: async () => {
          throw new Error("local Git must satisfy the acquisition");
        },
        readFile: async () => {
          throw new Error("local Git must satisfy the acquisition");
        }
      }
    });

    const result = await service.acquire({ ...request, baseSha, headSha });

    assert.equal(result.kind, "acquired");
    assert.equal(result.source, "local-git");
    assert.deepEqual(result.snapshot.files[0]?.hunks, [{
      oldStart: 2,
      oldCount: 1,
      newStart: 2,
      newCount: 1,
      lines: [
        { kind: "deletion", oldLine: 2, text: "actual-old" },
        { kind: "addition", newLine: 2, text: "actual-new" }
      ]
    }]);
  } finally {
    await directory.cleanup();
  }
});

test("T402-R003 fails closed when Git skips exhaustive rename and copy detection", async () => {
  const adapter = new LocalGitPullRequestDiffAdapter({
    execute: async invocation => {
      if (invocation.argumentsList[0] === "rev-parse") {
        const revision = invocation.argumentsList[3]!.replace(/\^\{commit\}$/u, "");
        return { exitCode: 0, stdout: `${revision}\n`, stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: "diff --git a/source.txt b/copied.txt\n",
        stderr: "warning: exhaustive rename detection was skipped due to too many files.\n"
      };
    }
  }, "/workspace/repository");

  assert.deepEqual(await adapter.loadDiff(request), {
    kind: "unavailable",
    reason: "diff-too-large"
  });
});

test("T402-R004 rejects page jumps and per-page changes in GitHub pagination links", async () => {
  const invalidLinks = [
    "https://api.github.test/repos/example/review-range/pulls/42/files?per_page=100&page=3",
    "https://api.github.test/repos/example/review-range/pulls/42/files?per_page=99&page=2"
  ];

  for (const next of invalidLinks) {
    let fileRequests = 0;
    const adapter = new FetchGitHubPullRequestDiffAdapter({
      apiBaseUrl: "https://api.github.test",
      fetch: async input => {
        const url = new URL(input.toString());
        if (url.pathname.endsWith(`/compare/${BASE_SHA}...${HEAD_SHA}`)) {
          return new Response(JSON.stringify({ merge_base_commit: { sha: BASE_SHA } }), { status: 200 });
        }
        if (!url.pathname.endsWith("/files")) {
          return new Response(JSON.stringify(metadataPayload), { status: 200 });
        }
        fileRequests += 1;
        return new Response(JSON.stringify([]), fileRequests === 1 ? {
          status: 200,
          headers: { link: `<${next}>; rel="next"` }
        } : { status: 200 });
      }
    });

    assert.deepEqual(await adapter.fetch(request), {
      kind: "unavailable",
      reason: "api"
    }, next);
    assert.equal(fileRequests, 1, next);
  }
});

test("T402-R004 rejects an empty-page next chain before it can issue unbounded requests", async () => {
  let fileRequests = 0;
  const adapter = new FetchGitHubPullRequestDiffAdapter({
    apiBaseUrl: "https://api.github.test",
    fetch: async input => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith(`/compare/${BASE_SHA}...${HEAD_SHA}`)) {
        return new Response(JSON.stringify({ merge_base_commit: { sha: BASE_SHA } }), { status: 200 });
      }
      if (!url.pathname.endsWith("/files")) {
        return new Response(JSON.stringify(metadataPayload), { status: 200 });
      }
      fileRequests += 1;
      if (fileRequests > 40) throw new Error("unbounded pagination");
      const nextPage = fileRequests + 1;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          link: `<https://api.github.test/repos/example/review-range/pulls/42/files?per_page=100&page=${nextPage}>; rel="next"`
        }
      });
    }
  });

  const result = await adapter.fetch(request);

  assert.deepEqual(result, { kind: "unavailable", reason: "api" });
  assert.ok(fileRequests <= 30, `file requests must be bounded, actual=${fileRequests}`);
});

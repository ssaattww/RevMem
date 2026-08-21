import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index";
import { GitContextRevisionMapper, GitReviewContextResolver } from "../../src/application/review-context/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState } from "../../src/core/contracts/index";
import { currentGlobalForNewPullRequest } from "../../src/t405-new-pull-request-global-composition";

const execFileAsync = promisify(execFile);
const runGit = async (root: string, args: readonly string[]): Promise<string> =>
  (await execFileAsync("git", [...args], { cwd: root })).stdout.trim();

test("T609-NR-001 maps an opened Shift-JIS file through the actual T405 new-PR Global composition", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t609-t405-"));
  const filePath = "src/shifted.txt";
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await runGit(root, ["init", "-b", "main"]);
    await runGit(root, ["config", "user.email", "review-range@example.invalid"]);
    await runGit(root, ["config", "user.name", "Review Range Test"]);
    await writeFile(path.join(root, filePath), Buffer.from([0x82, 0xa0, 0x0a]));
    await runGit(root, ["add", filePath]);
    await runGit(root, ["commit", "-m", "old"]);
    const oldRevision = await runGit(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, filePath), Buffer.from([0x82, 0xa2, 0x0a]));
    await runGit(root, ["commit", "-am", "new"]);
    const newRevision = await runGit(root, ["rev-parse", "HEAD"]);
    const hash = new NodeSha256StableHash();
    const git = createNodeLocalGitAdapter({
      decodeWithHint: async (bytes, encoding) => new TextDecoder(encoding).decode(bytes)
    });
    const current = new GitReviewContextResolver({ stableHash: hash }).resolve({
      repositoryId: "local/t609-t405",
      rootPath: root,
      branch: { kind: "branch", fullRef: "refs/heads/main" },
      head: newRevision
    });
    const global: RepositoryGlobalState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId: current.repositoryId,
      currentRevisionId: oldRevision,
      files: {
        shifted: {
          fileId: "shifted",
          currentPath: filePath,
          revisionId: oldRevision,
          reviewed: [{ startLine: 0, endLineExclusive: 1 }],
          contentHash: hash.digest("あ\n"),
          updatedAt: "2026-08-22T00:00:00.000Z"
        }
      },
      updatedAt: "2026-08-22T00:00:00.000Z"
    };
    const prepared = await currentGlobalForNewPullRequest(
      { loadGlobal: async () => global },
      current,
      new GitContextRevisionMapper({ source: git, stableHash: hash }),
      { ignoreWhitespaceChanges: false, ignoreEolChanges: false },
      { [filePath]: "shift_jis" }
    );

    assert.equal(prepared.nextGlobalState.files.shifted?.revisionId, newRevision);
    assert.ok(prepared.nextGlobalState.files.shifted);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

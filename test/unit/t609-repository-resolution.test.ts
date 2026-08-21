import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCurrentContextRepositories,
  type RepositoryResolutionInspection
} from "../../src/t609-repository-resolution.js";

const repository = (rootPath: string, repositoryId = rootPath): RepositoryResolutionInspection => ({
  kind: "repository",
  repository: { rootPath, repositoryId }
});

test("T609 resolves a Git workspace without an active Git editor in deterministic source order", async () => {
  const inspected: string[] = [];
  const result = await resolveCurrentContextRepositories({
    activeDocumentPath: "/workspace/readme.txt",
    openedDocumentPaths: ["/workspace/opened.ts"],
    knownRootPaths: ["/workspace/known"],
    workspaceFolderPaths: ["/workspace"],
    inspectRepository: async (path) => {
      inspected.push(path);
      return path === "/workspace/readme.txt"
        ? { kind: "not-repository" }
        : path === "/workspace/opened.ts"
          ? repository("/workspace/opened-repository")
          : path === "/workspace/known"
            ? repository("/workspace/known-repository")
            : repository("/workspace/folder-repository");
    }
  });

  assert.deepEqual(inspected, [
    "/workspace/readme.txt",
    "/workspace/opened.ts",
    "/workspace/known",
    "/workspace"
  ]);
  assert.deepEqual(result.map((candidate) => [candidate.repository.rootPath, candidate.source]), [
    ["/workspace/opened-repository", "opened-document"],
    ["/workspace/known-repository", "known-root"],
    ["/workspace/folder-repository", "workspace-folder"]
  ]);
});

test("T609 deduplicates a repository and fails closed for unsafe candidates", async () => {
  const result = await resolveCurrentContextRepositories({
    activeDocumentPath: "/repo/src/active.ts",
    openedDocumentPaths: ["/repo/src/opened.ts", undefined],
    knownRootPaths: ["/stale", "/repo"],
    workspaceFolderPaths: ["/repo", undefined],
    inspectRepository: async (path) => path === "/stale"
      ? { kind: "not-repository" }
      : repository("/repo", "repository-id")
  });

  assert.deepEqual(result.map((candidate) => candidate.source), ["active-document"]);
  assert.equal(result[0]?.repository.rootPath, "/repo");
});

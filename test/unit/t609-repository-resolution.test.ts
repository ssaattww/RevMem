import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCurrentContextRepositories,
  workspaceUriToFilesystemPath,
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

test("T609 rejects query, fragment, and mismatched authority before T305 or T405 can use a URI filesystem path", () => {
  const uri = (overrides: Partial<{
    scheme: string;
    authority: string;
    fsPath: string;
    query: string;
    fragment: string;
  }> = {}) => ({
    scheme: "file",
    authority: "",
    fsPath: "/workspace/repository/file.txt",
    query: "",
    fragment: "",
    ...overrides
  });

  assert.equal(workspaceUriToFilesystemPath(uri()), "/workspace/repository/file.txt");
  assert.equal(workspaceUriToFilesystemPath(uri({ query: "revision=old" })), undefined);
  assert.equal(workspaceUriToFilesystemPath(uri({ fragment: "selection" })), undefined);
  assert.equal(workspaceUriToFilesystemPath(uri({ authority: "server" })), undefined);
  assert.equal(workspaceUriToFilesystemPath(uri({ scheme: "untitled" })), undefined);
  assert.equal(
    workspaceUriToFilesystemPath(
      uri({ scheme: "vscode-remote", authority: "ssh-remote+host" }),
      [uri({ scheme: "vscode-remote", authority: "ssh-remote+host", fsPath: "/workspace" })]
    ),
    "/workspace/repository/file.txt",
    "a remote authority is valid only for the explicitly supported vscode-remote workspace"
  );
  assert.equal(
    workspaceUriToFilesystemPath(
      uri({ scheme: "vscode-remote", authority: "ssh-remote+host", fsPath: "/outside/file.txt" }),
      [uri({ scheme: "vscode-remote", authority: "ssh-remote+host", fsPath: "/workspace" })]
    ),
    undefined,
    "a remote Uri outside its workspace must be rejected"
  );
  assert.equal(
    workspaceUriToFilesystemPath(uri({ scheme: "vscode-remote", authority: "" })),
    undefined
  );
});

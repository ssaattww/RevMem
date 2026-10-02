import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  resolveCurrentContextRepositories,
  workspaceUriToFilesystemPath,
  type RepositoryResolutionInspection
} from "../../src/application/review-context/repository-resolution.js";

const repository = (rootPath: string, repositoryId = rootPath): RepositoryResolutionInspection => ({
  kind: "repository",
  repository: { rootPath, repositoryId }
});

test("T609 resolves a Git workspace without an active Git editor in deterministic source order", async () => {
  const inspected: string[] = [];
  const result = await resolveCurrentContextRepositories({
    activeDocumentPath: "/workspace/active/readme.txt",
    openedDocumentPaths: ["/workspace/opened/opened.ts"],
    knownRootPaths: ["/workspace/known"],
    workspaceFolderPaths: ["/workspace"],
    inspectRepository: async (path) => {
      inspected.push(path);
      return path === "/workspace/active"
        ? { kind: "not-repository" }
        : path === "/workspace/opened"
          ? repository("/workspace/opened-repository")
          : path === "/workspace/known"
            ? repository("/workspace/known")
            : repository("/workspace/folder-repository");
    }
  });

  assert.deepEqual(inspected, [
    "/workspace/active",
    "/workspace/opened",
    "/workspace/known",
    "/workspace"
  ]);
  assert.deepEqual(result.map((candidate) => [candidate.repository.rootPath, candidate.source]), [
    ["/workspace/opened-repository", "opened-document"],
    ["/workspace/known", "known-root"],
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

test("T609 does not accept a disjoint known-root inspection without canonical identity", async () => {
  const result = await resolveCurrentContextRepositories({
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: ["/workspace/known-alias"],
    workspaceFolderPaths: [],
    inspectRepository: async () => repository("/other/repository")
  });
  assert.deepEqual(result, []);
});

test("T609 accepts a disjoint known-root alias only when canonical identities match", async () => {
  const matchingIdentity = {
    kind: "repository" as const,
    repository: { rootPath: "/physical/repository", repositoryId: "physical-repository" },
    canonicalInspectionStartPath: "/physical/repository",
    canonicalRepositoryRootPath: "/physical/repository"
  };
  const mismatchedIdentity = {
    ...matchingIdentity,
    canonicalRepositoryRootPath: "/other/physical-repository"
  };
  const input = {
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: ["/workspace/repository-alias"],
    workspaceFolderPaths: [],
    inspectRepository: async () => matchingIdentity
  };

  const accepted = await resolveCurrentContextRepositories(input);
  assert.deepEqual(accepted.map(({ repository: resolved, source }) => [resolved.rootPath, source]), [
    ["/physical/repository", "known-root"]
  ]);

  const rejected = await resolveCurrentContextRepositories({
    ...input,
    inspectRepository: async () => mismatchedIdentity
  });
  assert.deepEqual(rejected, []);
});

test("T609 keeps strict known-root matching for absolute and Windows case-varied paths", async () => {
  for (const [candidate, rootPath] of [
    ["/workspace/repository", "/workspace/repository"],
    ["C:\\Workspace\\Repository", "c:/workspace/repository"]
  ]) {
    const result = await resolveCurrentContextRepositories({
      activeDocumentPath: undefined,
      openedDocumentPaths: [],
      knownRootPaths: [candidate],
      workspaceFolderPaths: [],
      inspectRepository: async () => repository(rootPath)
    });
    assert.deepEqual(result.map(({ repository: resolved, source }) => [resolved.rootPath, source]), [
      [rootPath, "known-root"]
    ]);
  }
});

test("T609 skips only a candidate-specific stat ENOENT and propagates other failures", async () => {
  const missing = path.resolve("missing-known-root");
  const enoent = Object.assign(new Error("missing"), {
    code: "ENOENT",
    syscall: "stat",
    path: missing
  });
  const recovered = await resolveCurrentContextRepositories({
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: [missing, "/workspace/repository"],
    workspaceFolderPaths: [],
    inspectRepository: async (candidate) => {
      if (candidate === missing) throw enoent;
      return repository(candidate);
    }
  });
  assert.deepEqual(recovered.map(({ repository: resolved, source }) => [resolved.rootPath, source]), [
    ["/workspace/repository", "known-root"]
  ]);

  const denied = Object.assign(new Error("denied"), {
    code: "EACCES",
    syscall: "stat",
    path: missing
  });
  await assert.rejects(resolveCurrentContextRepositories({
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: [missing],
    workspaceFolderPaths: [],
    inspectRepository: async () => { throw denied; }
  }), (error: unknown) => error === denied);

  const unrelatedMissing = Object.assign(new Error("different path"), {
    code: "ENOENT",
    syscall: "stat",
    path: `${missing}-other`
  });
  await assert.rejects(resolveCurrentContextRepositories({
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: [missing],
    workspaceFolderPaths: [],
    inspectRepository: async () => { throw unrelatedMissing; }
  }), (error: unknown) => error === unrelatedMissing);
});

test("T609 compares Windows candidate stat paths without case or separator sensitivity", async () => {
  const missing = "C:\\Workspace\\Missing-Root";
  const enoent = Object.assign(new Error("missing"), {
    code: "ENOENT",
    syscall: "stat",
    path: "c:/workspace/missing-root"
  });
  const result = await resolveCurrentContextRepositories({
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: [missing, "D:\\workspace\\repository"],
    workspaceFolderPaths: [],
    inspectRepository: async (candidate) => {
      if (candidate === missing) throw enoent;
      return repository(candidate);
    }
  });
  assert.deepEqual(result.map(({ repository: resolved, source }) => [resolved.rootPath, source]), [
    ["D:\\workspace\\repository", "known-root"]
  ]);
});

test("T609 rethrows non-Error rejection values unchanged", async () => {
  const thrown = "unexpected inspector rejection";
  await assert.rejects(resolveCurrentContextRepositories({
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: ["/workspace/repository"],
    workspaceFolderPaths: [],
    inspectRepository: async () => { throw thrown; }
  }), (error: unknown) => error === thrown);
});

test("T609 does not accept a stale known-root inspection that resolves to its parent", async () => {
  const result = await resolveCurrentContextRepositories({
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: ["/workspace/repository/nested"],
    workspaceFolderPaths: [],
    inspectRepository: async () => repository("/workspace/repository")
  });
  assert.deepEqual(result, []);
});

test("T609 applies the deepest known boundary separately to each document", async () => {
  const result = await resolveCurrentContextRepositories({
    activeDocumentPath: "C:\\workspace\\nested\\gone.txt",
    openedDocumentPaths: ["C:\\workspace\\outer.txt"],
    knownRootPaths: ["C:\\workspace", "C:\\workspace\\nested"],
    workspaceFolderPaths: [],
    inspectRepository: async () => repository("C:\\workspace")
  });
  assert.deepEqual(result.map(({ repository: resolved, source }) => [resolved.rootPath, source]), [
    ["C:\\workspace", "opened-document"]
  ]);
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

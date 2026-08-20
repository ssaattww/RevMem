import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import { resolveReviewStateStorageRoute } from "../../src/adapters/state-repository/index";
import {
  resolveWorkspaceFolderMembership,
  WorkspaceIdentityService
} from "../../src/application/workspace-identity/index";
import { WorkspaceRootRuntimeRegistry } from "../../src/adapters/workspace-review-state/index";

const hash = new NodeSha256StableHash();

test("T605 chooses exactly the longest matching multi-root URI and preserves remote authority", () => {
  const membership = resolveWorkspaceFolderMembership({
    documentUri: { scheme: "vscode-remote", authority: "ssh-remote+alpha", path: "/work/repo/packages/a/src/file.ts" },
    workspaceFolders: [
      { uri: { scheme: "vscode-remote", authority: "ssh-remote+alpha", path: "/work/repo" }, name: "same" },
      { uri: { scheme: "vscode-remote", authority: "ssh-remote+alpha", path: "/work/repo/packages/a" }, name: "same" },
      { uri: { scheme: "vscode-remote", authority: "dev-container+beta", path: "/work/repo/packages/a" }, name: "same" }
    ],
    fileSystemPathSemantics: "posix"
  });

  assert.deepEqual(membership, {
    workspaceFolder: { uri: { scheme: "vscode-remote", authority: "ssh-remote+alpha", path: "/work/repo/packages/a" }, name: "same" },
    relativePath: "src/file.ts"
  });
});

test("T605 fails closed for URI boundaries and separates workspace storage roots", () => {
  const folders = [
    { uri: { scheme: "vscode-remote", authority: "codespaces+one", path: "/work/repo" }, name: "repo" },
    { uri: { scheme: "vscode-remote", authority: "codespaces+two", path: "/work/repo" }, name: "repo" }
  ];
  assert.equal(resolveWorkspaceFolderMembership({
    documentUri: { scheme: "untitled", path: "/work/repo/file.ts" },
    workspaceFolders: folders,
    fileSystemPathSemantics: "posix"
  }), undefined);
  assert.equal(resolveWorkspaceFolderMembership({
    documentUri: { scheme: "vscode-remote", authority: "codespaces+one", path: "/outside/file.ts" },
    workspaceFolders: folders,
    fileSystemPathSemantics: "posix"
  }), undefined);
  assert.equal(resolveWorkspaceFolderMembership({
    documentUri: { scheme: "vscode-remote", authority: "codespaces+one", path: "/work/repo/file.ts", query: "rev=1" },
    workspaceFolders: folders,
    fileSystemPathSemantics: "posix"
  }), undefined);

  const identities = folders.map((folder) => new WorkspaceIdentityService(hash).resolve({
    workspaceFolderUri: folder.uri,
    documentUri: { ...folder.uri, path: `${folder.uri.path}/file.ts` },
    fileSystemPathSemantics: "posix",
    relativePath: "file.ts"
  }));
  const routes = identities.map((identity) => resolveReviewStateStorageRoute({
    globalStorageUri: { fsPath: path.resolve("/state/global") },
    storageUri: { fsPath: path.resolve("/state/workspace") }
  }, { kind: "workspace", repositoryId: identity.repositoryId, contextId: identity.workspaceContextId }));

  assert.notEqual(routes[0].rootPath, routes[1].rootPath);
  assert.match(routes[0].rootPath, /workspaces/u);
});

test("T605 root registry preserves snapshot and Git-rewrite capabilities across its wrapper", () => {
  const identityService = new WorkspaceIdentityService(hash);
  const tracker = {};
  const registry = new WorkspaceRootRuntimeRegistry({
    identityService,
    historyRewriteSnapshotTracker: tracker as never,
    factory: { create: () => ({
      open: async () => { throw new Error("not used"); },
      loadForDecoration: async () => undefined,
      commitWithSnapshot: async () => undefined
    }) }
  });
  const capability = registry as unknown as {
    readonly historyRewriteSnapshotTracker?: unknown;
    commitWithSnapshot?: unknown;
  };
  assert.equal(capability.historyRewriteSnapshotTracker, tracker);
  assert.equal(typeof capability.commitWithSnapshot, "function");
});

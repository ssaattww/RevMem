import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveT305RepositoryRootUri,
  resolveT305RepositoryWorkingTreeFileTarget
} from "../../src/t305-repository-root-uri.js";

test("T305 resolves a Windows Git root within one workspace and retains the remote URI authority", () => {
  const selected = resolveT305RepositoryRootUri({
    repositoryRoot: "C:\\WORK\\Repo",
    fileSystemPathSemantics: "windows",
    workspaceFolders: [
      {
        filesystemPath: "c:/work",
        uri: { scheme: "vscode-remote", authority: "ssh-remote+BuildHost", path: "/C:/Work" }
      },
      {
        filesystemPath: "C:\\other",
        uri: { scheme: "vscode-remote", authority: "ssh-remote+other", path: "/C:/Other" }
      }
    ]
  });

  assert.deepEqual(selected, {
    scheme: "vscode-remote",
    authority: "ssh-remote+BuildHost",
    path: "/C:/Work"
  });
});

test("T305 fails closed when the Windows repository root belongs to multiple workspace roots", () => {
  const workspaceFolders = [
    {
      filesystemPath: "C:\\work",
      uri: { scheme: "vscode-remote", authority: "ssh-remote+first", path: "/C:/Work" }
    },
    {
      filesystemPath: "c:/WORK/repo",
      uri: { scheme: "vscode-remote", authority: "ssh-remote+second", path: "/C:/Work/Repo" }
    }
  ];

  assert.equal(resolveT305RepositoryRootUri({
    repositoryRoot: "c:\\work\\REPO",
    fileSystemPathSemantics: "windows",
    workspaceFolders
  }), undefined);
});

test("T305 resolves a nested repository working-tree path without losing remote URI identity", () => {
  const selected = resolveT305RepositoryWorkingTreeFileTarget({
    repositoryRoot: "C:\\WORK\\Repo",
    repositoryPath: "src/日本語 name.ts",
    fileSystemPathSemantics: "windows",
    workspaceFolders: [{
      filesystemPath: "c:/work",
      uri: { scheme: "vscode-remote", authority: "ssh-remote+BuildHost", path: "/C:/Work" }
    }]
  });

  assert.deepEqual(selected, {
    workspaceFolderUri: {
      scheme: "vscode-remote",
      authority: "ssh-remote+BuildHost",
      path: "/C:/Work"
    },
    relativePathSegments: ["Repo", "src", "日本語 name.ts"]
  });
});

test("T305 working-tree path resolution rejects traversal and ambiguous workspace ownership", () => {
  assert.throws(() => resolveT305RepositoryWorkingTreeFileTarget({
    repositoryRoot: "/work/repo",
    repositoryPath: "../escape.ts",
    fileSystemPathSemantics: "posix",
    workspaceFolders: [{
      filesystemPath: "/work",
      uri: { scheme: "vscode-remote", authority: "ssh-remote+one", path: "/work" }
    }]
  }), /repository-relative|parent/i);

  assert.equal(resolveT305RepositoryWorkingTreeFileTarget({
    repositoryRoot: "/work/repo",
    repositoryPath: "src/current.ts",
    fileSystemPathSemantics: "posix",
    workspaceFolders: [
      {
        filesystemPath: "/work",
        uri: { scheme: "vscode-remote", authority: "ssh-remote+one", path: "/work" }
      },
      {
        filesystemPath: "/work/repo",
        uri: { scheme: "vscode-remote", authority: "ssh-remote+two", path: "/work/repo" }
      }
    ]
  }), undefined);
});

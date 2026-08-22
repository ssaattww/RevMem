import assert from "node:assert/strict";
import test from "node:test";

import { resolveT305RepositoryRootUri } from "../../src/t305-repository-root-uri.js";

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

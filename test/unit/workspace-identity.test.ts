import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceIdentityService,
  type ResourceUri
} from "../../src/application/workspace-identity/index";
import { NodeSha256StableHash } from "../../src/adapters/crypto/index";

const uri = (
  scheme: string,
  path: string,
  authority = "",
  query = "",
  fragment = ""
): ResourceUri => ({
  scheme,
  authority,
  path,
  query,
  fragment
});

const createService = (): WorkspaceIdentityService =>
  new WorkspaceIdentityService(new NodeSha256StableHash());

test("workspace identity is deterministic for a POSIX workspace across service instances", () => {
  const input = {
    workspaceFolderUri: uri("file", "/home/alice/project/"),
    documentUri: uri("file", "/home/alice/project/src/../src/main.ts"),
    relativePath: "./src/main.ts"
  } as const;

  const first = createService().resolve(input);
  const afterRestart = createService().resolve(input);

  assert.deepEqual(afterRestart, first);
  assert.deepEqual(first, {
    canonicalWorkspaceUri: "file:///home/alice/project",
    canonicalDocumentUri: "file:///home/alice/project/src/main.ts",
    relativePath: "src/main.ts",
    repositoryId:
      "non-git-repository:2dbabb7ce5c233e2cf257325c99a3ef118a3a7d32ac56fc80810184321a26a9d",
    workspaceId:
      "workspace:529e8bebda04afb2ba16908d939b36e6ff2d26db400d7368b2f90f2e84420ac9",
    workspaceContextId:
      "workspace-context:6648a5282aca3fbbc96207bb153ab39d1f3d2bb074aa7a6ba70c73346c009577",
    fileId:
      "workspace-file:076a0e0c1019d2e81eb72a05fc55a1aee5348d6af9cef631b5505e9fd4103740"
  });
});

test("Windows file URI variants normalize drive, casing, and separators", () => {
  const first = createService().resolve({
    workspaceFolderUri: uri("FILE", "/C:/Work/RevMem/"),
    documentUri: uri("file", "/c:/work/revmem/SRC\\Index.ts"),
    relativePath: "SRC\\Index.ts"
  });
  const second = createService().resolve({
    workspaceFolderUri: uri("file", "c:\\work\\revmem"),
    documentUri: uri("file", "C:\\WORK\\REVMEM\\src\\index.ts"),
    relativePath: "src/index.ts"
  });

  assert.deepEqual(second, first);
  assert.equal(first.canonicalWorkspaceUri, "file:///c:/work/revmem");
  assert.equal(first.canonicalDocumentUri, "file:///c:/work/revmem/src/index.ts");
  assert.equal(first.relativePath, "src/index.ts");
});

test("POSIX paths remain case-sensitive", () => {
  const upper = createService().resolve({
    workspaceFolderUri: uri("file", "/work/repository"),
    documentUri: uri("file", "/work/repository/src/Worker.ts"),
    relativePath: "src/Worker.ts"
  });
  const lower = createService().resolve({
    workspaceFolderUri: uri("file", "/work/repository"),
    documentUri: uri("file", "/work/repository/src/worker.ts"),
    relativePath: "src/worker.ts"
  });

  assert.notEqual(upper.fileId, lower.fileId);
  assert.notEqual(upper.canonicalDocumentUri, lower.canonicalDocumentUri);
});

test("remote URI identity includes normalized scheme and authority", () => {
  const first = createService().resolve({
    workspaceFolderUri: uri(
      "VSCODE-REMOTE",
      "/home/dev/repo/",
      "ssh-remote+BuildHost"
    ),
    documentUri: uri(
      "vscode-remote",
      "/home/dev/repo/src/Worker.ts",
      "ssh-remote+buildhost"
    ),
    relativePath: "src/Worker.ts"
  });
  const sameRemote = createService().resolve({
    workspaceFolderUri: uri(
      "vscode-remote",
      "/home/dev/repo",
      "SSH-REMOTE+BUILDHOST"
    ),
    documentUri: uri(
      "VSCODE-REMOTE",
      "/home/dev/repo/src/Worker.ts",
      "ssh-remote+BUILDHOST"
    ),
    relativePath: "src/Worker.ts"
  });
  const otherRemote = createService().resolve({
    workspaceFolderUri: uri(
      "vscode-remote",
      "/home/dev/repo",
      "ssh-remote+other-host"
    ),
    documentUri: uri(
      "vscode-remote",
      "/home/dev/repo/src/Worker.ts",
      "ssh-remote+other-host"
    ),
    relativePath: "src/Worker.ts"
  });

  assert.deepEqual(sameRemote, first);
  assert.equal(
    first.canonicalWorkspaceUri,
    "vscode-remote://ssh-remote+buildhost/home/dev/repo"
  );
  assert.notEqual(otherRemote.repositoryId, first.repositoryId);
  assert.notEqual(otherRemote.workspaceContextId, first.workspaceContextId);
  assert.notEqual(otherRemote.fileId, first.fileId);
});

test("the same relative path in different workspace roots receives different IDs", () => {
  const first = createService().resolve({
    workspaceFolderUri: uri("file", "/work/root-a"),
    documentUri: uri("file", "/work/root-a/src/index.ts"),
    relativePath: "src/index.ts"
  });
  const second = createService().resolve({
    workspaceFolderUri: uri("file", "/work/root-b"),
    documentUri: uri("file", "/work/root-b/src/index.ts"),
    relativePath: "src/index.ts"
  });

  assert.notEqual(second.repositoryId, first.repositoryId);
  assert.notEqual(second.workspaceId, first.workspaceId);
  assert.notEqual(second.workspaceContextId, first.workspaceContextId);
  assert.notEqual(second.fileId, first.fileId);
});

test("workspace identity rejects documents outside the workspace or mismatched relative paths", () => {
  const service = createService();
  const workspaceFolderUri = uri("file", "/work/root");

  assert.throws(
    () =>
      service.resolve({
        workspaceFolderUri,
        documentUri: uri("file", "/work/other/file.ts"),
        relativePath: "file.ts"
      }),
    /inside the workspace folder/
  );
  assert.throws(
    () =>
      service.resolve({
        workspaceFolderUri,
        documentUri: uri("file", "/work/root/src/file.ts"),
        relativePath: "src/other.ts"
      }),
    /relativePath does not match/
  );
  assert.throws(
    () =>
      service.resolve({
        workspaceFolderUri,
        documentUri: uri("vscode-remote", "/work/root/src/file.ts", "ssh-remote+host"),
        relativePath: "src/file.ts"
      }),
    /scheme and authority/
  );
});

test("relative paths reject absolute forms, root escape, and empty file paths", () => {
  const service = createService();
  const workspaceFolderUri = uri("file", "/work/root");
  const documentUri = uri("file", "/work/root/src/file.ts");

  for (const relativePath of [
    "/work/root/src/file.ts",
    "C:\\work\\root\\src\\file.ts",
    "../src/file.ts",
    "src/../../file.ts",
    ""
  ]) {
    assert.throws(
      () => service.resolve({ workspaceFolderUri, documentUri, relativePath }),
      TypeError
    );
  }
});

test("identity resolution does not mutate URI inputs", () => {
  const workspaceFolderUri = Object.freeze(uri("file", "/work/root/"));
  const documentUri = Object.freeze(uri("file", "/work/root/src/file.ts"));

  createService().resolve({
    workspaceFolderUri,
    documentUri,
    relativePath: "src/file.ts"
  });

  assert.deepEqual(workspaceFolderUri, uri("file", "/work/root/"));
  assert.deepEqual(documentUri, uri("file", "/work/root/src/file.ts"));
});

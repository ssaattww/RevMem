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
    relativePath: "./src/main.ts",
    fileSystemPathSemantics: "posix"
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

test("workspace file URIs reject query and fragment suffixes", () => {
  const service = createService();

  for (const input of [
    {
      workspaceFolderUri: uri("file", "/work/root", "", "view=one"),
      documentUri: uri("file", "/work/root/file.ts"),
      relativePath: "file.ts"
    },
    {
      workspaceFolderUri: uri("file", "/work/root", "", "", "section"),
      documentUri: uri("file", "/work/root/file.ts"),
      relativePath: "file.ts"
    },
    {
      workspaceFolderUri: uri("file", "/work/root"),
      documentUri: uri("file", "/work/root/file.ts", "", "view=one"),
      relativePath: "file.ts"
    },
    {
      workspaceFolderUri: uri("file", "/work/root"),
      documentUri: uri("file", "/work/root/file.ts", "", "", "section"),
      relativePath: "file.ts"
    }
  ]) {
    assert.throws(
      () => service.resolve({ ...input, fileSystemPathSemantics: "posix" }),
      /query or fragment/
    );
  }
});

test("POSIX semantics preserves backslashes and drive-like roots", () => {
  const backslash = createService().resolve({
    workspaceFolderUri: uri("file", "/repo"),
    documentUri: uri("file", "/repo/a\\b.ts"),
    relativePath: "a\\b.ts",
    fileSystemPathSemantics: "posix"
  });
  const slash = createService().resolve({
    workspaceFolderUri: uri("file", "/repo"),
    documentUri: uri("file", "/repo/a/b.ts"),
    relativePath: "a/b.ts",
    fileSystemPathSemantics: "posix"
  });
  const upperDriveRoot = createService().resolve({
    workspaceFolderUri: uri("file", "/C:/Repo"),
    documentUri: uri("file", "/C:/Repo/file.ts"),
    relativePath: "file.ts",
    fileSystemPathSemantics: "posix"
  });
  const lowerDriveRoot = createService().resolve({
    workspaceFolderUri: uri("file", "/c:/repo"),
    documentUri: uri("file", "/c:/repo/file.ts"),
    relativePath: "file.ts",
    fileSystemPathSemantics: "posix"
  });

  assert.notEqual(backslash.fileId, slash.fileId);
  assert.notEqual(backslash.canonicalDocumentUri, slash.canonicalDocumentUri);
  assert.notEqual(upperDriveRoot.repositoryId, lowerDriveRoot.repositoryId);
  assert.notEqual(
    upperDriveRoot.canonicalWorkspaceUri,
    lowerDriveRoot.canonicalWorkspaceUri
  );
});

test("Windows file URI variants normalize drive, casing, and separators", () => {
  const first = createService().resolve({
    workspaceFolderUri: uri("FILE", "/C:/Work/RevMem/"),
    documentUri: uri("file", "/c:/work/revmem/SRC\\Index.ts"),
    relativePath: "SRC\\Index.ts",
    fileSystemPathSemantics: "windows"
  });
  const second = createService().resolve({
    workspaceFolderUri: uri("file", "c:\\work\\revmem"),
    documentUri: uri("file", "C:\\WORK\\REVMEM\\src\\index.ts"),
    relativePath: "src/index.ts",
    fileSystemPathSemantics: "windows"
  });

  assert.deepEqual(second, first);
  assert.equal(first.canonicalWorkspaceUri, "file:///c:/work/revmem");
  assert.equal(first.canonicalDocumentUri, "file:///c:/work/revmem/src/index.ts");
  assert.equal(first.relativePath, "src/index.ts");
});

test("remote Windows paths use the explicit Windows semantics", () => {
  const first = createService().resolve({
    workspaceFolderUri: uri("vscode-remote", "/C:/Work/RevMem", "ssh-remote+win"),
    documentUri: uri(
      "vscode-remote",
      "/c:/work/revmem/SRC\\Index.ts",
      "ssh-remote+win"
    ),
    relativePath: "SRC\\Index.ts",
    fileSystemPathSemantics: "windows"
  });
  const second = createService().resolve({
    workspaceFolderUri: uri("VSCODE-REMOTE", "c:\\work\\revmem", "SSH-REMOTE+WIN"),
    documentUri: uri(
      "vscode-remote",
      "C:\\WORK\\REVMEM\\src\\index.ts",
      "ssh-remote+WIN"
    ),
    relativePath: "src/index.ts",
    fileSystemPathSemantics: "windows"
  });

  assert.deepEqual(second, first);
  assert.equal(
    first.canonicalDocumentUri,
    "vscode-remote://ssh-remote+win/c:/work/revmem/src/index.ts"
  );
});

test("workspace identity rejects unsupported filesystem path semantics", () => {
  assert.throws(
    () =>
      createService().resolve({
        workspaceFolderUri: uri("file", "/repo"),
        documentUri: uri("file", "/repo/file.ts"),
        relativePath: "file.ts",
        fileSystemPathSemantics: "case-sensitive" as never
      }),
    /fileSystemPathSemantics/
  );
});

test("POSIX paths remain case-sensitive", () => {
  const upper = createService().resolve({
    workspaceFolderUri: uri("file", "/work/repository"),
    documentUri: uri("file", "/work/repository/src/Worker.ts"),
    relativePath: "src/Worker.ts",
    fileSystemPathSemantics: "posix"
  });
  const lower = createService().resolve({
    workspaceFolderUri: uri("file", "/work/repository"),
    documentUri: uri("file", "/work/repository/src/worker.ts"),
    relativePath: "src/worker.ts",
    fileSystemPathSemantics: "posix"
  });

  assert.notEqual(upper.fileId, lower.fileId);
  assert.notEqual(upper.canonicalDocumentUri, lower.canonicalDocumentUri);
});

test("POSIX relative paths allow a colon in a root-level file name", () => {
  const identity = createService().resolve({
    workspaceFolderUri: uri("file", "/work/repository"),
    documentUri: uri("file", "/work/repository/schema:v1.json"),
    relativePath: "schema:v1.json",
    fileSystemPathSemantics: "posix"
  });

  assert.equal(identity.relativePath, "schema:v1.json");
  assert.equal(
    identity.canonicalDocumentUri,
    "file:///work/repository/schema%3Av1.json"
  );
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
    relativePath: "src/Worker.ts",
    fileSystemPathSemantics: "posix"
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
    relativePath: "src/Worker.ts",
    fileSystemPathSemantics: "posix"
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
    relativePath: "src/Worker.ts",
    fileSystemPathSemantics: "posix"
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
    relativePath: "src/index.ts",
    fileSystemPathSemantics: "posix"
  });
  const second = createService().resolve({
    workspaceFolderUri: uri("file", "/work/root-b"),
    documentUri: uri("file", "/work/root-b/src/index.ts"),
    relativePath: "src/index.ts",
    fileSystemPathSemantics: "posix"
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
        relativePath: "file.ts",
        fileSystemPathSemantics: "posix"
      }),
    /inside the workspace folder/
  );
  assert.throws(
    () =>
      service.resolve({
        workspaceFolderUri,
        documentUri: uri("file", "/work/root/src/file.ts"),
        relativePath: "src/other.ts",
        fileSystemPathSemantics: "posix"
      }),
    /relativePath does not match/
  );
  assert.throws(
    () =>
      service.resolve({
        workspaceFolderUri,
        documentUri: uri("vscode-remote", "/work/root/src/file.ts", "ssh-remote+host"),
        relativePath: "src/file.ts",
        fileSystemPathSemantics: "posix"
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
      () =>
        service.resolve({
          workspaceFolderUri,
          documentUri,
          relativePath,
          fileSystemPathSemantics: "windows"
        }),
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
    relativePath: "src/file.ts",
    fileSystemPathSemantics: "posix"
  });

  assert.deepEqual(workspaceFolderUri, uri("file", "/work/root/"));
  assert.deepEqual(documentUri, uri("file", "/work/root/src/file.ts"));
});

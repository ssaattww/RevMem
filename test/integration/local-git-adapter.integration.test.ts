import assert from "node:assert/strict";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index";
import { resolveCurrentContextRepositories } from "../../src/application/review-context/repository-resolution";
import { createTemporaryGitRepository, type TemporaryGitRepository } from "../support/temporary-git-repository";

test("real Git inspection resolves a nested path, branch ref, HEAD, and root identity", async () => {
  const repository = await createTemporaryGitRepository();
  const nestedPath = path.join(repository.path, "src", "nested");

  try {
    await mkdir(nestedPath, { recursive: true });
    const inspection = await createNodeLocalGitAdapter().inspectRepository(nestedPath);

    assert.equal(inspection.kind, "repository");
    if (inspection.kind !== "repository") {
      return;
    }

    assert.equal(inspection.repository.rootPath, repository.path);
    assert.equal(inspection.repository.remote, undefined);
    assert.match(inspection.repository.repositoryId, /^git-root:[0-9a-f]{64}$/);
    assert.deepEqual(inspection.repository.branch, {
      kind: "branch",
      fullRef: "refs/heads/main"
    });
    assert.equal(inspection.repository.head, repository.headCommit);
    assert.match(inspection.repository.gitVersion, /^\d+\.\d+(?:\.\d+)?/);
  } finally {
    await repository.cleanup();
  }
});

test("origin remote normalization keeps a fork separate from its upstream", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();

  try {
    await repository.runGit([
      "remote",
      "add",
      "origin",
      "git@github.com:upstream/project.git"
    ]);
    await repository.runGit([
      "remote",
      "add",
      "upstream",
      "https://github.com/upstream/project.git"
    ]);

    const upstreamInspection = await adapter.inspectRepository(repository.path);
    assert.equal(upstreamInspection.kind, "repository");
    if (upstreamInspection.kind !== "repository") {
      return;
    }

    assert.equal(
      upstreamInspection.repository.repositoryId,
      "github.com/upstream/project"
    );
    assert.equal(upstreamInspection.repository.remote?.name, "origin");

    await repository.runGit([
      "remote",
      "set-url",
      "origin",
      "https://github.com/contributor/project.git"
    ]);

    const forkInspection = await adapter.inspectRepository(repository.path);
    assert.equal(forkInspection.kind, "repository");
    if (forkInspection.kind !== "repository") {
      return;
    }

    assert.equal(
      forkInspection.repository.repositoryId,
      "github.com/contributor/project"
    );
    assert.notEqual(
      forkInspection.repository.repositoryId,
      upstreamInspection.repository.repositoryId
    );
  } finally {
    await repository.cleanup();
  }
});

test("real Git inspection distinguishes detached HEAD and supports merge-base/object checks", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();

  try {
    assert.equal(
      await adapter.findMergeBase(
        repository.path,
        repository.baseCommit,
        repository.headCommit
      ),
      repository.baseCommit
    );
    assert.equal(
      await adapter.objectExists(repository.path, repository.baseCommit),
      true
    );
    assert.equal(
      await adapter.objectExists(
        repository.path,
        "0000000000000000000000000000000000000000"
      ),
      false
    );

    await repository.runGit(["checkout", "--detach", repository.baseCommit]);
    const detached = await adapter.inspectRepository(repository.path);

    assert.equal(detached.kind, "repository");
    if (detached.kind !== "repository") {
      return;
    }

    assert.deepEqual(detached.repository.branch, { kind: "detached" });
    assert.equal(detached.repository.head, repository.baseCommit);
  } finally {
    await repository.cleanup();
  }
});

test("real Git revision content returns exact original and modified text", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();

  try {
    assert.deepEqual(
      await adapter.readTextFileAtRevision(
        repository.path,
        repository.baseCommit,
        "fixture.txt",
        "posix"
      ),
      { kind: "found", content: "base\n" }
    );
    assert.deepEqual(
      await adapter.readTextFileAtRevision(
        repository.path,
        repository.headCommit,
        "fixture.txt",
        "posix"
      ),
      { kind: "found", content: "base\nhead\n" }
    );
    assert.deepEqual(
      await adapter.readTextFileAtRevision(
        repository.path,
        repository.headCommit,
        "missing.txt",
        "posix"
      ),
      { kind: "missing-file" }
    );
    assert.deepEqual(
      await adapter.readTextFileAtRevision(
        repository.path,
        "0000000000000000000000000000000000000000",
        "fixture.txt",
        "posix"
      ),
      { kind: "missing-revision" }
    );
  } finally {
    await repository.cleanup();
  }
});

test("a missing Git executable is reported without conflating it with a plain folder", async () => {
  const adapter = createNodeLocalGitAdapter({
    executable: "review-range-git-executable-that-does-not-exist"
  });

  const inspection = await adapter.inspectRepository(process.cwd());

  assert.equal(inspection.kind, "git-unavailable");
  if (inspection.kind === "git-unavailable") {
    assert.equal(
      inspection.executable,
      "review-range-git-executable-that-does-not-exist"
    );
  }
});


test("real Git revision diff streams output larger than the legacy 4 MiB buffer", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();
  const lineCount = 70_000;
  const baseContent = Array.from(
    { length: lineCount },
    (_, index) => `base-${String(index).padStart(8, "0")}-${"a".repeat(30)}`
  ).join("\n") + "\n";
  const headContent = Array.from(
    { length: lineCount },
    (_, index) => `head-${String(index).padStart(8, "0")}-${"b".repeat(30)}`
  ).join("\n") + "\n";

  try {
    const largePath = path.join(repository.path, "large.txt");
    await writeFile(largePath, baseContent, "utf8");
    await repository.runGit(["add", "large.txt"]);
    await repository.runGit(["commit", "--message", "large diff base"]);
    const largeBase = await repository.runGit(["rev-parse", "HEAD"]);

    await writeFile(largePath, headContent, "utf8");
    await repository.runGit(["commit", "--all", "--message", "large diff head"]);
    const largeHead = await repository.runGit(["rev-parse", "HEAD"]);

    const diff = await adapter.diffRevisions(
      repository.path,
      largeBase,
      largeHead
    );

    assert.ok(Buffer.byteLength(diff, "utf8") > 4 * 1024 * 1024);
    assert.match(diff, /^diff --git /u);
  } finally {
    await repository.cleanup();
  }
});

type NestedGitFixture = {
  readonly rootPath: string;
  readonly documentPath: string;
};

const createNestedGitFixture = async (
  outer: TemporaryGitRepository,
  relativePath: string
): Promise<NestedGitFixture> => {
  await outer.runGit(["init", "--initial-branch=main", relativePath]);
  await outer.runGit(["-C", relativePath, "config", "user.name", "Review Range Test"]);
  await outer.runGit(["-C", relativePath, "config", "user.email", "review-range-test@example.invalid"]);
  const rootPath = path.join(outer.path, relativePath);
  const documentPath = path.join(rootPath, "nested-fixture.txt");
  await writeFile(documentPath, "nested repository fixture\n", "utf8");
  await outer.runGit(["-C", relativePath, "add", "nested-fixture.txt"]);
  await outer.runGit(["-C", relativePath, "commit", "--message", "nested fixture"]);
  return { rootPath, documentPath };
};

test("repository resolution normalizes a deleted document to its surviving parent directory", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();
  const documentDirectory = path.join(repository.path, "src", "nested");
  const documentPath = path.join(documentDirectory, "deleted.txt");

  try {
    await mkdir(documentDirectory, { recursive: true });
    await writeFile(documentPath, "temporary document\n", "utf8");
    await rm(documentPath);

    const result = await resolveCurrentContextRepositories({
      activeDocumentPath: documentPath,
      openedDocumentPaths: [],
      knownRootPaths: [],
      workspaceFolderPaths: [repository.path],
      inspectRepository: (startPath) => adapter.inspectRepository(startPath)
    });

    assert.deepEqual(
      result.map(({ repository: resolved, source }) => [resolved.rootPath, source]),
      [[repository.path, "active-document"]]
    );
  } finally {
    await repository.cleanup();
  }
});

test("a deleted nested Git marker does not assign its document to the outer repository", async () => {
  const outer = await createTemporaryGitRepository();
  const nested = await createNestedGitFixture(outer, "nested");
  const adapter = createNodeLocalGitAdapter();

  try {
    await rm(path.join(nested.rootPath, ".git"), { force: true, recursive: true });

    const result = await resolveCurrentContextRepositories({
      activeDocumentPath: nested.documentPath,
      openedDocumentPaths: [],
      knownRootPaths: [nested.rootPath],
      workspaceFolderPaths: [outer.path],
      inspectRepository: (startPath) => adapter.inspectRepository(startPath)
    });

    assert.deepEqual(
      result.map(({ repository: resolved, source }) => [resolved.rootPath, source]),
      [[outer.path, "workspace-folder"]],
      "the explicit outer workspace stays listed, but the document is not its owner evidence"
    );
  } finally {
    await outer.cleanup();
  }
});

test("a removed nested repository skips only its missing candidates and preserves other roots", async () => {
  const outer = await createTemporaryGitRepository();
  const unrelated = await createTemporaryGitRepository();
  const nested = await createNestedGitFixture(outer, "nested-gone");
  const adapter = createNodeLocalGitAdapter();

  try {
    await rm(nested.rootPath, { force: true, recursive: true });

    const result = await resolveCurrentContextRepositories({
      activeDocumentPath: nested.documentPath,
      openedDocumentPaths: [path.join(nested.rootPath, "opened.txt")],
      knownRootPaths: [nested.rootPath],
      workspaceFolderPaths: [outer.path, unrelated.path],
      inspectRepository: (startPath) => adapter.inspectRepository(startPath)
    });

    assert.deepEqual(
      result.map(({ repository: resolved, source }) => [resolved.rootPath, source]),
      [
        [outer.path, "workspace-folder"],
        [unrelated.path, "workspace-folder"]
      ]
    );
  } finally {
    await Promise.all([outer.cleanup(), unrelated.cleanup()]);
  }
});

test("a stale ancestor boundary does not hide a live deeper repository", async () => {
  const outer = await createTemporaryGitRepository();
  const staleParent = await createNestedGitFixture(outer, "stale-parent");
  const liveChild = await createNestedGitFixture(outer, "stale-parent/live-child");
  const adapter = createNodeLocalGitAdapter();

  try {
    await rm(path.join(staleParent.rootPath, ".git"), { force: true, recursive: true });

    for (const knownRootPaths of [
      [staleParent.rootPath, liveChild.rootPath],
      [liveChild.rootPath, staleParent.rootPath]
    ]) {
      const result = await resolveCurrentContextRepositories({
        activeDocumentPath: liveChild.documentPath,
        openedDocumentPaths: [],
        knownRootPaths,
        workspaceFolderPaths: [outer.path],
        inspectRepository: (startPath) => adapter.inspectRepository(startPath)
      });

      assert.deepEqual(
        result.map(({ repository: resolved, source }) => [resolved.rootPath, source]),
        [
          [liveChild.rootPath, "active-document"],
          [outer.path, "workspace-folder"]
        ]
      );
    }
  } finally {
    await outer.cleanup();
  }
});

test("a stale nested known root does not hide a valid explicit outer known root in either order", async () => {
  const outer = await createTemporaryGitRepository();
  const nested = await createNestedGitFixture(outer, "nested-known-root");
  const adapter = createNodeLocalGitAdapter();

  try {
    await rm(path.join(nested.rootPath, ".git"), { force: true, recursive: true });

    for (const knownRootPaths of [
      [nested.rootPath, outer.path],
      [outer.path, nested.rootPath]
    ]) {
      const result = await resolveCurrentContextRepositories({
        activeDocumentPath: nested.documentPath,
        openedDocumentPaths: [],
        knownRootPaths,
        workspaceFolderPaths: [],
        inspectRepository: (startPath) => adapter.inspectRepository(startPath)
      });

      assert.deepEqual(
        result.map(({ repository: resolved, source }) => [resolved.rootPath, source]),
        [[outer.path, "known-root"]]
      );
    }
  } finally {
    await outer.cleanup();
  }
});

test("a fully removed nested repository without a known root does not climb to its live outer repository", async () => {
  const outer = await createTemporaryGitRepository();
  const nested = await createNestedGitFixture(outer, "missing-parent/missing-child/nested");
  const adapter = createNodeLocalGitAdapter();

  try {
    await rm(path.join(outer.path, "missing-parent"), { force: true, recursive: true });

    const result = await resolveCurrentContextRepositories({
      activeDocumentPath: nested.documentPath,
      openedDocumentPaths: [path.join(outer.path, "fixture.txt")],
      knownRootPaths: [],
      workspaceFolderPaths: [],
      inspectRepository: (startPath) => adapter.inspectRepository(startPath)
    });

    assert.deepEqual(
      result.map(({ repository: resolved, source }) => [resolved.rootPath, source]),
      [[outer.path, "opened-document"]],
      "the missing document must be skipped after its immediate parent fails, leaving the outer repo to its own document evidence"
    );
  } finally {
    await outer.cleanup();
  }
});

test("a workspace subdirectory does not become a repository ownership boundary", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();
  const workspaceSubdirectory = path.join(repository.path, "src", "nested");
  const documentPath = path.join(workspaceSubdirectory, "live.txt");

  try {
    await mkdir(workspaceSubdirectory, { recursive: true });
    await writeFile(documentPath, "live document\n", "utf8");

    const result = await resolveCurrentContextRepositories({
      activeDocumentPath: documentPath,
      openedDocumentPaths: [],
      knownRootPaths: [],
      workspaceFolderPaths: [workspaceSubdirectory],
      inspectRepository: (startPath) => adapter.inspectRepository(startPath)
    });

    assert.deepEqual(
      result.map(({ repository: resolved, source }) => [resolved.rootPath, source]),
      [[repository.path, "active-document"]]
    );
  } finally {
    await repository.cleanup();
  }
});

test("a real inaccessible path remains a filesystem permission error through the Node Git adapter", async (t) => {
  if (process.platform !== "win32") {
    t.skip("the protected Windows filesystem path is unavailable on this platform");
    return;
  }

  const deniedPath = "C:\\Windows\\System32\\config\\SAM";
  const adapter = createNodeLocalGitAdapter();
  try {
    await stat(deniedPath);
    t.skip("this runner can stat the protected path");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") throw error;
    await assert.rejects(adapter.inspectRepository(deniedPath), (inspectionError: unknown) => {
      const inspectionCode = (inspectionError as NodeJS.ErrnoException).code;
      assert.ok(inspectionCode === "EACCES" || inspectionCode === "EPERM");
      assert.equal((inspectionError as NodeJS.ErrnoException).syscall, "stat");
      assert.equal((inspectionError as NodeJS.ErrnoException).path, deniedPath);
      return true;
    });
  }
});

import assert from "node:assert/strict";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index";
import { NodeGitBlobReader } from "../../src/adapters/local-git/node-git-blob-reader.js";
import { NodeGitBlobBatchTransport } from "../../src/adapters/local-git/node-git-blob-batch-transport.js";
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

test("real cat-file batch transport returns the same raw bytes as single-object reads", async () => {
  const repository = await createTemporaryGitRepository();

  try {
    const blobObjectId = await repository.runGit(["rev-parse", `${repository.headCommit}:fixture.txt`]);
    const single = await new NodeGitBlobReader().readBlob(repository.path, blobObjectId);
    let batched: Uint8Array | undefined;

    await new NodeGitBlobBatchTransport().readBlobs(repository.path, [blobObjectId], (_objectId, bytes) => {
      batched = bytes;
    });

    assert.ok(batched);
    assert.deepEqual(Buffer.from(batched), Buffer.from(single));
    assert.equal(Buffer.from(batched).toString("utf8"), "base\nhead\n");
  } finally {
    await repository.cleanup();
  }
});

test("verified commit cache rechecks an object pruned after a successful read", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();

  try {
    assert.deepEqual(await adapter.readTextFileAtRevision(
      repository.path, repository.headCommit, "fixture.txt", "posix"
    ), { kind: "found", content: "base\nhead\n" });

    await repository.runGit(["update-ref", "-d", "refs/heads/main"]);
    await repository.runGit(["reflog", "expire", "--expire=now", "--all"]);
    await repository.runGit(["gc", "--prune=now"]);
    await assert.rejects(repository.runGit(["cat-file", "-e", `${repository.headCommit}^{commit}`]));

    assert.deepEqual(await adapter.readTextFileAtRevision(
      repository.path, repository.headCommit, "fixture.txt", "posix"
    ), { kind: "missing-revision" });
  } finally {
    await repository.cleanup();
  }
});

test("batch immutable read rechecks a cached commit pruned after a successful lookup", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();

  try {
    assert.deepEqual(await adapter.readTextFilesAtRevision(
      repository.path,
      repository.headCommit,
      ["fixture.txt"],
      "posix",
    ), new Map([["fixture.txt", { kind: "found", content: "base\nhead\n" }]]));

    await repository.runGit(["update-ref", "-d", "refs/heads/main"]);
    await repository.runGit(["reflog", "expire", "--expire=now", "--all"]);
    await repository.runGit(["gc", "--prune=now"]);
    await assert.rejects(repository.runGit(["cat-file", "-e", `${repository.headCommit}^{commit}`]));

    assert.deepEqual(await adapter.readTextFilesAtRevision(
      repository.path,
      repository.headCommit,
      ["fixture.txt"],
      "posix",
    ), new Map([["fixture.txt", { kind: "missing-revision" }]]));
  } finally {
    await repository.cleanup();
  }
});

test("revision path lookup preserves blob-only behavior for directories, gitlinks, symlinks, and colons", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();

  try {
    await mkdir(path.join(repository.path, "nested"), { recursive: true });
    await writeFile(path.join(repository.path, "nested", "tracked.txt"), "nested file\n", "utf8");
    await writeFile(path.join(repository.path, "colon:name.txt"), "colon path\n", "utf8");
    await symlink("fixture.txt", path.join(repository.path, "fixture-link"));
    await repository.runGit(["add", "--all"]);
    await repository.runGit(["commit", "--message", "add path edge cases"]);
    const commit = await repository.runGit(["rev-parse", "HEAD"]);
    const nestedTree = await repository.runGit(["ls-tree", "-d", commit, "--", ":(literal)nested"]);
    assert.match(nestedTree, /^040000 tree [0-9a-f]{40}\tnested$/u);

    const missingSubmodule = "f".repeat(40);
    await assert.rejects(repository.runGit(["cat-file", "-e", `${missingSubmodule}^{commit}`]));
    await mkdir(path.join(repository.path, "vendor"), { recursive: true });
    await repository.runGit(["update-index", "--add", "--cacheinfo", `160000,${missingSubmodule},vendor/submodule`]);
    await repository.runGit(["commit", "--message", "add gitlink"]);
    const gitlinkCommit = await repository.runGit(["rev-parse", "HEAD"]);

    assert.deepEqual(await adapter.readTextFileAtRevision(repository.path, commit, "nested", "posix"), { kind: "missing-file" });
    assert.deepEqual(await adapter.readTextFileAtRevision(repository.path, commit, "nested/tracked.txt", "posix"), { kind: "found", content: "nested file\n" });
    assert.deepEqual(await adapter.readTextFileAtRevision(repository.path, gitlinkCommit, "vendor/submodule", "posix"), { kind: "missing-file" });
    assert.deepEqual(await adapter.readTextFileAtRevision(repository.path, commit, "fixture-link", "posix"), { kind: "found", content: "fixture.txt" });
    assert.deepEqual(await adapter.readTextFileAtRevision(repository.path, commit, "colon:name.txt", "posix"), { kind: "found", content: "colon path\n" });
  } finally {
    await repository.cleanup();
  }
});

test("batch immutable reads match single-path results for exact paths and special Git entries", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();

  try {
    await mkdir(path.join(repository.path, "nested"), { recursive: true });
    await mkdir(path.join(repository.path, "vendor"), { recursive: true });
    await writeFile(path.join(repository.path, "nested", "tracked.txt"), "nested content\n", "utf8");
    await writeFile(path.join(repository.path, "colon:name.ts"), "colon content\n", "utf8");
    await writeFile(path.join(repository.path, "tab\tname.ts"), "tab content\n", "utf8");
    await writeFile(path.join(repository.path, "line\nname.ts"), "line content\n", "utf8");
    await writeFile(path.join(repository.path, "prefix-name.ts"), "exact prefix path\n", "utf8");
    await writeFile(path.join(repository.path, "prefix-name-extra.ts"), "unrequested sibling\n", "utf8");
    await symlink("fixture.txt", path.join(repository.path, "fixture-link"));
    await repository.runGit(["add", "--all"]);
    const missingSubmodule = "f".repeat(40);
    await repository.runGit(["update-index", "--add", "--cacheinfo", `160000,${missingSubmodule},vendor/submodule`]);
    await repository.runGit(["commit", "--message", "add batch lookup cases"]);
    const revision = await repository.runGit(["rev-parse", "HEAD"]);
    const paths = [
      "fixture.txt",
      "nested/tracked.txt",
      "colon:name.ts",
      "tab\tname.ts",
      "line\nname.ts",
      "prefix-name.ts",
      "fixture-link",
      "vendor/submodule",
      "nested",
      "missing.ts",
    ];
    const bulkReader = (adapter as unknown as {
      readTextFilesAtRevision: (
        root: string,
        object: string,
        requestedPaths: readonly string[],
        semantics: "posix" | "windows",
      ) => Promise<ReadonlyMap<string, unknown>>;
    }).readTextFilesAtRevision;

    const batched = await bulkReader.call(adapter, repository.path, revision, paths, "posix");
    const individual = new Map(await Promise.all(paths.map(async (filePath) => [
      filePath,
      await adapter.readTextFileAtRevision(repository.path, revision, filePath, "posix"),
    ] as const)));

    assert.deepEqual(batched, individual);
    assert.deepEqual(batched.get("fixture-link"), { kind: "found", content: "fixture.txt" });
    assert.deepEqual(batched.get("vendor/submodule"), { kind: "missing-file" });
    assert.deepEqual(batched.get("nested"), { kind: "missing-file" });
    assert.deepEqual(batched.get("prefix-name.ts"), { kind: "found", content: "exact prefix path\n" });
    assert.deepEqual(batched.get("missing.ts"), { kind: "missing-file" });
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

test("a known repository root reached through a directory link remains a known-root candidate", async () => {
  const repository = await createTemporaryGitRepository();
  const aliasPath = `${repository.path}-alias`;
  const adapter = createNodeLocalGitAdapter();

  try {
    await symlink(repository.path, aliasPath, process.platform === "win32" ? "junction" : "dir");
    const inspected = await adapter.inspectRepository(aliasPath);
    assert.equal(inspected.kind, "repository");
    if (inspected.kind !== "repository") return;
    assert.ok("canonicalInspectionStartPath" in inspected);
    assert.ok("canonicalRepositoryRootPath" in inspected);
    assert.equal(inspected.canonicalInspectionStartPath, await realpath(aliasPath));
    assert.equal(inspected.canonicalRepositoryRootPath, await realpath(repository.path));
    assert.equal(inspected.canonicalInspectionStartPath, inspected.canonicalRepositoryRootPath);

    const result = await resolveCurrentContextRepositories({
      openedDocumentPaths: [],
      knownRootPaths: [aliasPath],
      workspaceFolderPaths: [],
      inspectRepository: (startPath) => adapter.inspectRepository(startPath)
    });
    assert.deepEqual(
      result.map(({ repository: resolved, source }) => [resolved.rootPath, source]),
      [[inspected.repository.rootPath, "known-root"]]
    );
  } finally {
    await rm(aliasPath, { force: true, recursive: true });
    await repository.cleanup();
  }
});

test("unrelated real Git repositories keep distinct canonical identities", async () => {
  const first = await createTemporaryGitRepository();
  const second = await createTemporaryGitRepository();
  const adapter = createNodeLocalGitAdapter();

  try {
    const firstInspection = await adapter.inspectRepository(first.path);
    const secondInspection = await adapter.inspectRepository(second.path);
    assert.equal(firstInspection.kind, "repository");
    assert.equal(secondInspection.kind, "repository");
    if (firstInspection.kind !== "repository" || secondInspection.kind !== "repository") return;

    assert.ok("canonicalRepositoryRootPath" in firstInspection);
    assert.ok("canonicalRepositoryRootPath" in secondInspection);
    assert.notEqual(firstInspection.canonicalRepositoryRootPath, secondInspection.canonicalRepositoryRootPath);

    const result = await resolveCurrentContextRepositories({
      openedDocumentPaths: [],
      knownRootPaths: [first.path],
      workspaceFolderPaths: [second.path],
      inspectRepository: (startPath) => adapter.inspectRepository(startPath)
    });
    assert.deepEqual(
      result.map(({ repository: resolved, source }) => [resolved.rootPath, source]),
      [[firstInspection.repository.rootPath, "known-root"], [secondInspection.repository.rootPath, "workspace-folder"]]
    );

    const unrelatedAlias = await resolveCurrentContextRepositories({
      openedDocumentPaths: [],
      knownRootPaths: [first.path],
      workspaceFolderPaths: [],
      inspectRepository: async (startPath) => {
        assert.equal(startPath, first.path);
        return {
          ...firstInspection,
          repository: secondInspection.repository,
          canonicalRepositoryRootPath: secondInspection.canonicalRepositoryRootPath
        };
      }
    });
    assert.deepEqual(unrelatedAlias, []);
  } finally {
    await Promise.all([first.cleanup(), second.cleanup()]);
  }
});

test("a nested known root whose Git marker is gone cannot alias its outer repository", async () => {
  const outer = await createTemporaryGitRepository();
  const nested = await createNestedGitFixture(outer, "nested-known-root");
  const adapter = createNodeLocalGitAdapter();

  try {
    await rm(path.join(nested.rootPath, ".git"), { force: true, recursive: true });
    const inspected = await adapter.inspectRepository(nested.rootPath);
    assert.equal(inspected.kind, "repository");
    if (inspected.kind !== "repository") return;
    assert.equal(inspected.repository.rootPath, outer.path);
    assert.ok("canonicalInspectionStartPath" in inspected);
    assert.ok("canonicalRepositoryRootPath" in inspected);
    assert.notEqual(inspected.canonicalInspectionStartPath, inspected.canonicalRepositoryRootPath);

    const result = await resolveCurrentContextRepositories({
      openedDocumentPaths: [],
      knownRootPaths: [nested.rootPath],
      workspaceFolderPaths: [],
      inspectRepository: (startPath) => adapter.inspectRepository(startPath)
    });
    assert.deepEqual(result, []);
  } finally {
    await outer.cleanup();
  }
});

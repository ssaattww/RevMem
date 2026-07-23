import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  LocalGitAdapter,
  NodeGitCommandExecutor
} from "../../src/adapters/local-git/index";
import { createTemporaryGitRepository } from "../support/temporary-git-repository";

test("real Git inspection resolves a nested path, branch ref, HEAD, and root identity", async () => {
  const repository = await createTemporaryGitRepository();
  const nestedPath = path.join(repository.path, "src", "nested");

  try {
    await mkdir(nestedPath, { recursive: true });
    const inspection = await new LocalGitAdapter(
      new NodeGitCommandExecutor()
    ).inspectRepository(nestedPath);

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
  const adapter = new LocalGitAdapter(new NodeGitCommandExecutor());

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
  const adapter = new LocalGitAdapter(new NodeGitCommandExecutor());

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

test("a missing Git executable is reported without conflating it with a plain folder", async () => {
  const adapter = new LocalGitAdapter(
    new NodeGitCommandExecutor({
      executable: "review-range-git-executable-that-does-not-exist"
    })
  );

  const inspection = await adapter.inspectRepository(process.cwd());

  assert.equal(inspection.kind, "git-unavailable");
  if (inspection.kind === "git-unavailable") {
    assert.equal(
      inspection.executable,
      "review-range-git-executable-that-does-not-exist"
    );
  }
});

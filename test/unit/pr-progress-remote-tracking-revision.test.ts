import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import { gitCurrentContextSnapshot } from "../../src/composition/current-context/git-context-inspection.js";
import type { CurrentContextUiSnapshot } from "../../src/ui/current-context/index.js";
import { createOwnerProductFixture, OWNER_FILE, OWNER_ID } from "../support/t405-owner-product-fixture.js";
import { createTemporaryGitRepository } from "../support/temporary-git-repository.js";

test("PR Progress advances to the fetched tracking revision while local HEAD stays stale", async () => {
  const fixture = await createOwnerProductFixture([52]);
  try {
    fixture.remote.set(52, { base: fixture.A, head: fixture.C, state: "open" });
    const local = [{
      context: {
        kind: "branch" as const,
        label: "main",
        headRevision: fixture.B,
        pullRequestSynchronizationRevision: fixture.C,
        selection: {
          kind: "branch" as const,
          repositoryId: OWNER_ID,
          repositoryRoot: fixture.repositoryRoot,
          branchRef: "refs/heads/main",
        },
      },
      progress: undefined,
    }] satisfies readonly CurrentContextUiSnapshot[];

    const candidates = await fixture.runtime.augmentCurrentContextCandidates(local);
    const current = candidates.find((candidate) => candidate.context.selection?.kind === "pull-request");
    assert.ok(current, "the persisted PR must remain the current PR candidate");
    assert.equal(current.context.headRevision, fixture.C, "PR Progress must use the fetched tracking revision");

    const saved = await fixture.load(52);
    assert.equal(saved?.contextState.pullRequest?.headSha, fixture.C);
    assert.equal(saved?.globalState.currentRevisionId, fixture.C);
    assert.equal(local[0]!.context.headRevision, fixture.B, "branch/editor ownership must stay on local HEAD");
  } finally {
    await fixture.dispose();
  }
});

test("PR Progress advances from a dirty stale checkout without changing local work", async () => {
  const fixture = await createOwnerProductFixture([52]);
  try {
    await fixture.git("checkout", "-B", "main", fixture.B);
    await fixture.git("update-ref", "refs/remotes/origin/main", fixture.C);
    await fixture.git("config", "branch.main.remote", "origin");
    await fixture.git("config", "branch.main.merge", "refs/heads/main");
    const dirtyPath = fixture.repositoryRoot + "/" + OWNER_FILE;
    const dirtyContent = "keep\nlocal dirty\nstable";
    await writeFile(dirtyPath, dirtyContent, "utf8");
    assert.equal(await fixture.git("status", "--short"), "M " + OWNER_FILE);

    fixture.remote.set(52, { base: fixture.A, head: fixture.C, state: "open" });
    const adapter = createNodeLocalGitAdapter();
    const inspection = await adapter.inspectRepository(fixture.repositoryRoot);
    assert.equal(inspection.kind, "repository");
    if (inspection.kind !== "repository") throw new Error("fixture must remain a Git repository");
    const synchronizationRevision = await adapter.resolveIdentityRemoteTrackingRevision(inspection.repository);
    assert.equal(synchronizationRevision, fixture.C);

    const local = [gitCurrentContextSnapshot(inspection.repository, synchronizationRevision)];
    const candidates = await fixture.runtime.augmentCurrentContextCandidates(local);
    const current = candidates.find((candidate) => candidate.context.selection?.kind === "pull-request");
    assert.ok(current, "the persisted PR must remain the current PR candidate");
    assert.equal(current.context.headRevision, fixture.C);

    const saved = await fixture.load(52);
    assert.equal(saved?.contextState.pullRequest?.headSha, fixture.C);
    assert.equal(saved?.globalState.currentRevisionId, fixture.C);
    assert.equal(await fixture.git("rev-parse", "HEAD"), fixture.B);
    assert.equal(await readFile(dirtyPath, "utf8"), dirtyContent);
    assert.equal(await fixture.git("status", "--short"), "M " + OWNER_FILE);
  } finally {
    await fixture.dispose();
  }
});

test("PR tracking synchronization remains available with dirty working-tree changes", async () => {
  const repository = await createTemporaryGitRepository();
  try {
    await repository.runGit(["remote", "add", "origin", "https://github.com/ssaattww/revmem.git"]);
    await repository.runGit(["update-ref", "refs/remotes/origin/main", repository.headCommit]);
    await repository.runGit(["reset", "--hard", repository.baseCommit]);
    await repository.runGit(["config", "branch.main.remote", "origin"]);
    await repository.runGit(["config", "branch.main.merge", "refs/heads/main"]);

    const dirtyContent = "base\nlocal working-tree change\n";
    const fixturePath = repository.path + "/fixture.txt";
    await writeFile(fixturePath, dirtyContent, "utf8");
    assert.match(await repository.runGit(["status", "--short"]), /^M fixture\.txt$/mu);

    const adapter = createNodeLocalGitAdapter();
    const inspection = await adapter.inspectRepository(repository.path);
    assert.equal(inspection.kind, "repository");
    if (inspection.kind !== "repository") throw new Error("fixture must remain a Git repository");

    assert.equal(await adapter.resolveIdentityRemoteTrackingRevision(inspection.repository), repository.headCommit);
    assert.equal(await repository.runGit(["rev-parse", "HEAD"]), repository.baseCommit);
    assert.equal(await readFile(fixturePath, "utf8"), dirtyContent);
    assert.match(await repository.runGit(["status", "--short"]), /^M fixture\.txt$/mu);
  } finally {
    await repository.cleanup();
  }
});

test("PR Progress keeps tracking the fetched PR revision with a dirty local checkout", async () => {
  const fixture = await createOwnerProductFixture([52]);
  try {
    fixture.remote.set(52, { base: fixture.A, head: fixture.C, state: "open" });
    await fixture.git("checkout", "main");
    await fixture.git("reset", "--hard", fixture.B);
    await fixture.git("update-ref", "refs/remotes/origin/main", fixture.C);
    await fixture.git("config", "branch.main.remote", "origin");
    await fixture.git("config", "branch.main.merge", "refs/heads/main");
    const sourcePath = fixture.repositoryRoot + "/" + OWNER_FILE;
    const dirtyContent = "keep\nlocal working-tree change\nstable";
    await writeFile(sourcePath, dirtyContent, "utf8");
    assert.equal(await fixture.git("status", "--short"), "M " + OWNER_FILE);

    const adapter = createNodeLocalGitAdapter();
    const inspection = await adapter.inspectRepository(fixture.repositoryRoot);
    assert.equal(inspection.kind, "repository");
    if (inspection.kind !== "repository") throw new Error("fixture must remain a Git repository");
    const trackingRevision = await adapter.resolveIdentityRemoteTrackingRevision(inspection.repository);
    assert.equal(trackingRevision, fixture.C);

    const candidates = await fixture.runtime.augmentCurrentContextCandidates([
      gitCurrentContextSnapshot(inspection.repository, trackingRevision),
    ]);
    const current = candidates.find((candidate) => candidate.context.selection?.kind === "pull-request");
    assert.ok(current, "dirty working-tree state must not suppress the persisted PR candidate");
    assert.equal(current.context.headRevision, fixture.C);
    const saved = await fixture.load(52);
    assert.equal(saved?.contextState.pullRequest?.headSha, fixture.C);
    assert.equal(saved?.globalState.currentRevisionId, fixture.C);
    assert.equal(await fixture.git("rev-parse", "HEAD"), fixture.B);
    assert.equal(await readFile(sourcePath, "utf8"), dirtyContent);
    assert.equal(await fixture.git("status", "--short"), "M " + OWNER_FILE);
  } finally {
    await fixture.dispose();
  }
});

test("PR synchronization resolves only the identity remote upstream as its tracking target", async () => {
  const repository = await createTemporaryGitRepository();
  try {
    await repository.runGit(["remote", "add", "origin", "https://github.com/ssaattww/revmem.git"]);
    await repository.runGit(["update-ref", "refs/remotes/origin/main", repository.headCommit]);
    await repository.runGit(["reset", "--hard", repository.baseCommit]);
    await repository.runGit(["config", "branch.main.remote", "origin"]);
    await repository.runGit(["config", "branch.main.merge", "refs/heads/main"]);

    const adapter = createNodeLocalGitAdapter();
    const inspection = await adapter.inspectRepository(repository.path);
    assert.equal(inspection.kind, "repository");
    if (inspection.kind !== "repository") throw new Error("fixture must be a Git repository");

    assert.equal(await adapter.resolveIdentityRemoteTrackingRevision(inspection.repository), repository.headCommit);

    await repository.runGit(["reset", "--hard", repository.headCommit]);
    await repository.runGit(["update-ref", "refs/remotes/origin/main", repository.baseCommit]);
    const localAheadInspection = await adapter.inspectRepository(repository.path);
    assert.equal(localAheadInspection.kind, "repository");
    if (localAheadInspection.kind !== "repository") throw new Error("fixture must remain a Git repository");
    assert.equal(
      await adapter.resolveIdentityRemoteTrackingRevision(localAheadInspection.repository),
      undefined,
      "a tracking revision behind local HEAD must not regress PR synchronization",
    );

    await repository.runGit(["config", "branch.main.remote", "upstream"]);
    assert.equal(
      await adapter.resolveIdentityRemoteTrackingRevision(inspection.repository),
      undefined,
      "an upstream on another remote must not drive this GitHub repository's PR revision",
    );

    await repository.runGit(["config", "--unset", "branch.main.remote"]);
    await repository.runGit(["config", "--unset", "branch.main.merge"]);
    assert.equal(await adapter.resolveIdentityRemoteTrackingRevision(inspection.repository), undefined);
  } finally {
    await repository.cleanup();
  }
});

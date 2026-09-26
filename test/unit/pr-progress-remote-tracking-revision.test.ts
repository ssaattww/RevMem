import assert from "node:assert/strict";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import type { CurrentContextUiSnapshot } from "../../src/ui/current-context/index.js";
import { createOwnerProductFixture } from "../support/t405-owner-product-fixture.js";
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
        ...({ pullRequestHeadRevision: fixture.C } as Record<string, string>),
        selection: {
          kind: "branch" as const,
          repositoryId: "github.com/ssaattw/revmem",
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

    const resolver = (adapter as unknown as {
      resolveIdentityRemoteTrackingRevision?: (
        repository: unknown,
      ) => Promise<string | undefined>;
    }).resolveIdentityRemoteTrackingRevision;
    if (typeof resolver !== "function") {
      throw new Error("Local Git must expose the identity-remote tracking revision");
    }
    assert.equal(await resolver.call(adapter, inspection.repository), repository.headCommit);

    await repository.runGit(["config", "branch.main.remote", "upstream"]);
    assert.equal(
      await resolver.call(adapter, inspection.repository),
      undefined,
      "an upstream on another remote must not drive this GitHub repository's PR revision",
    );

    await repository.runGit(["config", "--unset", "branch.main.remote"]);
    await repository.runGit(["config", "--unset", "branch.main.merge"]);
    assert.equal(await resolver.call(adapter, inspection.repository), undefined);
  } finally {
    await repository.cleanup();
  }
});

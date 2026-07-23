import assert from "node:assert/strict";
import test from "node:test";

import { createTemporaryGitRepository } from "../support/temporary-git-repository";
import { pathExists } from "../support/temporary-directory";

test("temporary Git repository provides base/head revisions and removes itself", async () => {
  const repository = await createTemporaryGitRepository();
  const repositoryPath = repository.path;

  try {
    assert.notEqual(repository.baseCommit, repository.headCommit);
    assert.equal(await repository.runGit(["rev-parse", "HEAD"]), repository.headCommit);
    assert.equal(
      await repository.runGit(["merge-base", repository.baseCommit, repository.headCommit]),
      repository.baseCommit
    );
    assert.equal(await pathExists(repositoryPath), true);
  } finally {
    await repository.cleanup();
  }

  assert.equal(await pathExists(repositoryPath), false);
});

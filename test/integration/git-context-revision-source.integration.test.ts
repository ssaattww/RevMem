import assert from "node:assert/strict";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index";
import { parseZeroContextGitDiff } from "../../src/core/git-diff/index";
import { createTemporaryGitRepository } from "../support/temporary-git-repository";

/** The production Node adapter must expose one complete, parseable zero-context revision diff. */
test("Node local Git revision source returns a complete zero-context diff", async () => {
  const repository = await createTemporaryGitRepository();
  try {
    const adapter = createNodeLocalGitAdapter({ timeoutMs: 5_000 });
    const diff = await adapter.diffRevisions(
      repository.path,
      repository.baseCommit,
      repository.headCommit
    );
    const parsed = parseZeroContextGitDiff(diff);

    assert.match(diff, /^diff --git a\/fixture\.txt b\/fixture\.txt$/mu);
    assert.match(diff, /^\+head$/mu);
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0]?.oldPath, "fixture.txt");
    assert.equal(parsed.files[0]?.newPath, "fixture.txt");
    assert.deepEqual(
      parsed.files[0]?.hunks.map((hunk) => ({
        oldLineCount: hunk.oldLineCount,
        newLineCount: hunk.newLineCount
      })),
      [{ oldLineCount: 0, newLineCount: 1 }]
    );
  } finally {
    await repository.cleanup();
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { settleReviewContextsRepositorySelection } from "../../src/t609-review-contexts-cancellation-boundary";
import {
  ReviewContextsRepositorySelectionCancelled,
  resolveReviewContextsRepository,
} from "../../src/t609-review-contexts-repository";

test("T609-NR-004 preserves the existing provider projection for multi-root Quick Pick cancel and stale cancellation", async () => {
  const acceptedProjection = ["existing-context"];
  let clearCount = 0;
  let reportCount = 0;
  const boundary = {
    clear: () => { clearCount += 1; acceptedProjection.length = 0; },
    reportTerminalFailure: async () => { reportCount += 1; },
  };

  let cancellation: unknown;
  try {
    await resolveReviewContextsRepository({
      activeDocumentPath: undefined,
      openedDocumentPaths: [],
      knownRootPaths: [],
      workspaceFolderPaths: ["/workspace/one", "/workspace/two"],
      inspectRepository: async (rootPath) => ({
        kind: "repository" as const,
        repository: { rootPath, repositoryId: rootPath },
      }),
      requestSelection: async () => undefined,
    });
  } catch (error) {
    cancellation = error;
  }
  assert.ok(cancellation instanceof ReviewContextsRepositorySelectionCancelled);
  assert.equal(await settleReviewContextsRepositorySelection(cancellation, boundary), "cancelled");
  assert.deepEqual(acceptedProjection, ["existing-context"]);
  assert.equal(clearCount, 0);
  assert.equal(reportCount, 0);

  assert.equal(
    await settleReviewContextsRepositorySelection(new ReviewContextsRepositorySelectionCancelled(), boundary),
    "cancelled",
  );
  assert.deepEqual(acceptedProjection, ["existing-context"]);
  assert.equal(clearCount, 0);
  assert.equal(reportCount, 0);
});

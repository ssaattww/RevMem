import assert from "node:assert/strict";
import test from "node:test";

import { resolveReviewContextsRepository } from "../../src/t609-review-contexts-repository.js";

test("T609 Review Contexts resolves the sole opened Git workspace without an active editor", async () => {
  const repository = await resolveReviewContextsRepository({
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: [],
    workspaceFolderPaths: ["/workspace/repository"],
    inspectRepository: async (path) => path === "/workspace/repository"
      ? { kind: "repository", repository: { rootPath: path, repositoryId: "repository" } }
      : { kind: "not-repository" },
    requestSelection: async () => { throw new Error("one candidate must not open Quick Pick"); }
  });

  assert.deepEqual(repository, { rootPath: "/workspace/repository", repositoryId: "repository" });
});

test("T609 Review Contexts fails closed when multiple roots are cancelled", async () => {
  await assert.rejects(() => resolveReviewContextsRepository({
    activeDocumentPath: undefined,
    openedDocumentPaths: [],
    knownRootPaths: [],
    workspaceFolderPaths: ["/workspace/one", "/workspace/two"],
    inspectRepository: async (path) => ({ kind: "repository", repository: { rootPath: path, repositoryId: path } }),
    requestSelection: async () => undefined
  }), /cancelled/u);
});

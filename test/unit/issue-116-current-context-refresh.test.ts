import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCurrentContextRepositories,
  type RepositoryResolutionInspection,
} from "../../src/application/review-context/repository-resolution.js";
import { createOwnerProductFixture } from "../support/t405-owner-product-fixture.js";

const repository = (rootPath: string): RepositoryResolutionInspection => ({
  kind: "repository",
  repository: { rootPath, repositoryId: "fixture-repository" },
});

test("Issue #116 shares duplicate start paths and a returned canonical root within one Current Context generation", async () => {
  const inspected: string[] = [];
  const inspectRepository = async (startPath: string): Promise<RepositoryResolutionInspection> => {
    inspected.push(startPath);
    return repository("/workspace/repository");
  };
  const input = {
    activeDocumentPath: "/workspace/repository/src/example.ts",
    openedDocumentPaths: ["/workspace/repository/src/example.ts", "/workspace/repository/src/example.ts"],
    knownRootPaths: ["/workspace/repository"],
    workspaceFolderPaths: ["/workspace/repository"],
    inspectRepository,
  };

  const first = await resolveCurrentContextRepositories(input);
  assert.deepEqual(inspected, ["/workspace/repository/src/example.ts"]);
  assert.equal(first.length, 1);

  await resolveCurrentContextRepositories(input);
  assert.deepEqual(
    inspected,
    ["/workspace/repository/src/example.ts", "/workspace/repository/src/example.ts"],
    "a later Current Context generation must inspect again",
  );
});

test("Issue #116 does not infer an unexamined descendant from another returned root", async () => {
  const inspected: string[] = [];
  await resolveCurrentContextRepositories({
    activeDocumentPath: "/workspace/repository/src/active.ts",
    openedDocumentPaths: ["/workspace/repository/other/opened.ts"],
    knownRootPaths: [],
    workspaceFolderPaths: [],
    inspectRepository: async (startPath) => {
      inspected.push(startPath);
      return repository("/workspace/repository");
    },
  });
  assert.deepEqual(inspected, [
    "/workspace/repository/src/active.ts",
    "/workspace/repository/other/opened.ts",
  ]);
});

test("Issue #116 reuses accepted Current Context PR preparation for only the immediately dependent Review Contexts refresh", async () => {
  const fixture = await createOwnerProductFixture([52]);
  try {
    const local = [{
      context: {
        kind: "branch" as const,
        label: "main",
        headRevision: fixture.B,
        selection: {
          kind: "branch" as const,
          repositoryId: "github.com/ssaattww/revmem",
          repositoryRoot: fixture.repositoryRoot,
          branchRef: "refs/heads/main",
        },
      },
      progress: undefined,
    }];
    fixture.resetAcquisitionCalls();

    const candidates = await fixture.runtime.augmentCurrentContextCandidates(local);
    const selected = candidates.find((candidate) => candidate.context.selection?.kind === "pull-request");
    assert.ok(selected?.context.selection?.kind === "pull-request");
    assert.ok(fixture.runtime.acceptCurrentContextPreparation);
    fixture.runtime.acceptCurrentContextPreparation(selected.context.selection);
    await fixture.runtime.refresh();

    assert.deepEqual(fixture.acquisitionCalls, {
      localCandidates: 1,
      repositoryContexts: 1,
      lifecycle: 1,
      diffRuntime: 1,
      progress: 1,
    });

    fixture.resetAcquisitionCalls();
    await fixture.runtime.refresh();
    assert.deepEqual(fixture.acquisitionCalls, {
      localCandidates: 1,
      repositoryContexts: 1,
      lifecycle: 1,
      diffRuntime: 1,
      progress: 1,
    }, "an independent Review Contexts refresh must acquire fresh state");
  } finally {
    await fixture.dispose();
  }
});

test("Issue #116 discards a failed Current Context preparation and a later generation acquires fresh state", async () => {
  const fixture = await createOwnerProductFixture([52]);
  const local = [{
    context: {
      kind: "branch" as const,
      label: "main",
      headRevision: fixture.B,
      selection: {
        kind: "branch" as const,
        repositoryId: "github.com/ssaattww/revmem",
        repositoryRoot: fixture.repositoryRoot,
        branchRef: "refs/heads/main",
      },
    },
    progress: undefined,
  }];
  try {
    fixture.unavailable.add(52);
    await assert.rejects(() => fixture.runtime.augmentCurrentContextCandidates(local));

    fixture.unavailable.delete(52);
    fixture.resetAcquisitionCalls();
    const candidates = await fixture.runtime.augmentCurrentContextCandidates(local);
    const selected = candidates.find((candidate) => candidate.context.selection?.kind === "pull-request");
    assert.ok(selected?.context.selection?.kind === "pull-request");
    assert.ok(fixture.runtime.acceptCurrentContextPreparation);
    fixture.runtime.acceptCurrentContextPreparation(selected.context.selection);
    await fixture.runtime.refresh();
    assert.deepEqual(fixture.acquisitionCalls, {
      localCandidates: 1,
      repositoryContexts: 1,
      lifecycle: 1,
      diffRuntime: 1,
      progress: 1,
    });
  } finally {
    await fixture.dispose();
  }
});

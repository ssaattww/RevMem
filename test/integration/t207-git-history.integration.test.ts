import assert from "node:assert/strict";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import { DocumentReviewStateSessionProvider } from "../../src/adapters/document-review-state/index";
import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  resolveReviewStateStorageRoute,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import { WorkspaceReviewStateSessionProvider } from "../../src/adapters/workspace-review-state/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import { parseReviewHistoryEventLine } from "../../src/core/review-history/index";
import { markReviewedRanges } from "../../src/core/review-state/index";
import { createTemporaryDirectory } from "../support/temporary-directory";
import { createTemporaryGitRepository } from "../support/temporary-git-repository";

const occurredAt = "2026-08-02T02:00:00.000Z";

const lineCountOf = (content: string): number => {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split(/\r\n|\r|\n/u);
  return /\r\n|\r|\n$/u.test(content) ? lines.length - 1 : lines.length;
};

const descriptorFor = (
  repositoryPath: string,
  repositoryRelativePath: string,
  content: string,
  stableHash: NodeSha256StableHash
) => {
  const documentFsPath = path.join(repositoryPath, repositoryRelativePath);
  return {
    documentUri: {
      scheme: "file",
      authority: "",
      path: `/${documentFsPath.replaceAll("\\", "/")}`
    },
    documentFsPath,
    fileSystemPathSemantics: "windows" as const,
    lineCount: lineCountOf(content),
    contentHash: stableHash.digest(content)
  };
};

const createProvider = (
  storageUris: ReviewStateStorageUris,
  sessionId: string
) => {
  const stableHash = new NodeSha256StableHash();
  const repository = new FileSystemReviewStateRepository({ storageUris });
  const git = createNodeLocalGitAdapter({ timeoutMs: 5_000 });
  let nextEvent = 1;
  const historyRecorder = new ReviewHistoryRecorder({
    sessionId,
    createEventId: () => `${sessionId}-event-${nextEvent++}`,
    appender: new JsonlReviewHistoryStore({ storageUris })
  });
  const workspaceProvider = new WorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(stableHash),
    repository,
    now: () => new Date(occurredAt),
    historyRecorder
  });
  const provider = new DocumentReviewStateSessionProvider({
    gitInspector: git,
    gitRevisionSource: git,
    repository,
    workspaceProvider,
    stableHash,
    now: () => new Date(occurredAt),
    historyRecorder
  });
  return { provider, repository, stableHash, historyRecorder };
};

test("T207 preserves Git review state and JSONL history through edit, commit, branch, rename, delete, and restart", async () => {
  const gitRepository = await createTemporaryGitRepository();
  const storage = await createTemporaryDirectory("review-range-t207-state");
  const storageUris: ReviewStateStorageUris = {
    globalStorageUri: { fsPath: path.join(storage.path, "global") },
    storageUri: { fsPath: path.join(storage.path, "workspace") }
  };
  const fixturePath = path.join(gitRepository.path, "fixture.txt");
  const anchorPath = path.join(gitRepository.path, "anchor.txt");

  try {
    await writeFile(anchorPath, "anchor\n", "utf8");
    await gitRepository.runGit(["add", "anchor.txt"]);
    await gitRepository.runGit(["commit", "--message", "add mapping anchor"]);

    const first = createProvider(storageUris, "first-session");
    const originalContent = await readFile(fixturePath, "utf8");
    const mainInitial = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", originalContent, first.stableHash)
    );
    const initialMark = markReviewedRanges({
      contextState: mainInitial.contextState,
      globalState: mainInitial.globalState,
      target: mainInitial.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt
    });
    await mainInitial.committer.commit(initialMark);
    await first.historyRecorder.recordTransaction(initialMark, "integration-mark");

    const editedContent = "base\nedited\n";
    await writeFile(fixturePath, editedContent, "utf8");
    const afterEdit = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedContent, first.stableHash)
    );
    assert.equal(afterEdit.contextState.files[afterEdit.target.fileId], undefined);
    assert.equal(afterEdit.globalState.files[afterEdit.target.fileId], undefined);

    const editedMark = markReviewedRanges({
      contextState: afterEdit.contextState,
      globalState: afterEdit.globalState,
      target: afterEdit.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt
    });
    await afterEdit.committer.commit(editedMark);
    await first.historyRecorder.recordTransaction(editedMark, "integration-mark");
    await gitRepository.runGit(["add", "fixture.txt"]);
    await gitRepository.runGit(["commit", "--message", "edit fixture"]);
    const afterCommit = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedContent, first.stableHash)
    );
    assert.deepEqual(
      afterCommit.contextState.files[afterCommit.target.fileId]?.modifiedReviewed,
      [{ startLine: 0, endLineExclusive: 1 }]
    );

    await gitRepository.runGit(["checkout", "-b", "feature/t207-history"]);
    const featureInitial = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedContent, first.stableHash)
    );
    assert.notEqual(featureInitial.contextState.contextId, afterCommit.contextState.contextId);
    const featureMark = markReviewedRanges({
      contextState: featureInitial.contextState,
      globalState: featureInitial.globalState,
      target: featureInitial.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt
    });
    await featureInitial.committer.commit(featureMark);
    await first.historyRecorder.recordTransaction(featureMark, "integration-mark");

    const renamedPath = path.join(gitRepository.path, "renamed.txt");
    await rename(fixturePath, renamedPath);
    await gitRepository.runGit(["add", "--all"]);
    await gitRepository.runGit(["commit", "--message", "rename fixture"]);
    const afterRename = await first.provider.open(
      descriptorFor(gitRepository.path, "renamed.txt", editedContent, first.stableHash)
    );
    assert.equal(afterRename.target.fileId, featureInitial.target.fileId);
    assert.deepEqual(
      afterRename.contextState.files[afterRename.target.fileId]?.modifiedReviewed,
      [{ startLine: 0, endLineExclusive: 1 }]
    );

    await unlink(renamedPath);
    await gitRepository.runGit(["add", "--all"]);
    await gitRepository.runGit(["commit", "--message", "delete renamed fixture"]);
    const anchorContent = await readFile(anchorPath, "utf8");
    const afterDelete = await first.provider.open(
      descriptorFor(gitRepository.path, "anchor.txt", anchorContent, first.stableHash)
    );
    assert.equal(afterDelete.contextState.files[afterRename.target.fileId], undefined);
    assert.equal(afterDelete.globalState.files[afterRename.target.fileId], undefined);
    first.provider.dispose();

    const restarted = createProvider(storageUris, "restart-session");
    const restartedAnchor = await restarted.provider.open(
      descriptorFor(gitRepository.path, "anchor.txt", anchorContent, restarted.stableHash)
    );
    assert.equal(restartedAnchor.contextState.files[afterRename.target.fileId], undefined);
    assert.equal(restartedAnchor.globalState.files[afterRename.target.fileId], undefined);

    const historyTargets = [mainInitial, featureInitial].map((session) => ({
      kind: "git" as const,
      repositoryId: session.contextState.repositoryId,
      contextId: session.contextState.contextId
    }));
    const historyEvents = (
      await Promise.all(historyTargets.map(async (target) => {
        const route = resolveReviewStateStorageRoute(storageUris, target);
        const content = await readFile(
          path.join(route.historyDirectory, "events-2026-08.jsonl"),
          "utf8"
        );
        return content.trimEnd().split("\n").map(parseReviewHistoryEventLine);
      }))
    ).flat();
    assert.ok(historyEvents.some((event) => event.type === "invalidated-by-edit"));
    assert.ok(historyEvents.some((event) => event.type === "remapped-by-diff"));
    assert.ok(historyEvents.some((event) => event.type === "file-renamed"));
    assert.ok(historyEvents.some((event) => event.type === "file-deleted"));
    assert.ok(historyEvents.every((event) => event.sessionId !== ""));
    restarted.provider.dispose();
  } finally {
    await gitRepository.cleanup();
    await storage.cleanup();
  }
});

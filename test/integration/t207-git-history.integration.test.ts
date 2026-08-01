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
import {
  markReviewedRanges,
  unmarkReviewedRanges
} from "../../src/core/review-state/index";
import { createTemporaryDirectory } from "../support/temporary-directory";
import { createTemporaryGitRepository } from "../support/temporary-git-repository";

const occurredAt = "2026-08-02T02:00:00.000Z";

const lineCountOf = (content: string): number => content.split(/\r\n|\r|\n/u).length;

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

test("T207 preserves Git state and durable history through edit, commit, branch, rename, copy, delete, and restart", async () => {
  const gitRepository = await createTemporaryGitRepository();
  const storage = await createTemporaryDirectory("review-range-t207-state");
  const storageUris: ReviewStateStorageUris = {
    globalStorageUri: { fsPath: path.join(storage.path, "global") },
    storageUri: { fsPath: path.join(storage.path, "workspace") }
  };
  const fixturePath = path.join(gitRepository.path, "fixture.txt");
  const renamedPath = path.join(gitRepository.path, "renamed.txt");
  const copyPath = path.join(gitRepository.path, "copy.txt");
  const noTerminalPath = path.join(gitRepository.path, "no-terminal.txt");
  const emptyPath = path.join(gitRepository.path, "empty.txt");
  const anchorPath = path.join(gitRepository.path, "anchor.txt");
  const initialFixture = "stable\nchange\ntail\n";
  const editedFixture = "stable\nchanged\ntail\n";
  const noTerminalContent = "no terminal newline";
  const emptyContent = "";
  const anchorContent = "anchor\n";
  const allPhysicalFixtureRanges = [{ startLine: 0, endLineExclusive: 3 }];
  const mappedFixtureRanges = [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 3 }
  ];
  const featureFixtureRanges = [{ startLine: 1, endLineExclusive: 2 }];

  try {
    await writeFile(fixturePath, initialFixture, "utf8");
    await writeFile(anchorPath, anchorContent, "utf8");
    await writeFile(noTerminalPath, noTerminalContent, "utf8");
    await writeFile(emptyPath, emptyContent, "utf8");
    await gitRepository.runGit(["add", "fixture.txt", "anchor.txt", "no-terminal.txt", "empty.txt"]);
    await gitRepository.runGit(["commit", "--message", "add T207 fixtures"]);

    const first = createProvider(storageUris, "first-session");
    const mainInitial = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", initialFixture, first.stableHash)
    );
    const initialMark = markReviewedRanges({
      contextState: mainInitial.contextState,
      globalState: mainInitial.globalState,
      target: mainInitial.target,
      intervals: allPhysicalFixtureRanges,
      occurredAt
    });
    await mainInitial.committer.commit(initialMark);
    await first.historyRecorder.recordTransaction(initialMark, "integration-mark");

    const mainNoTerminal = await first.provider.open(
      descriptorFor(gitRepository.path, "no-terminal.txt", noTerminalContent, first.stableHash)
    );
    const noTerminalMark = markReviewedRanges({
      contextState: mainNoTerminal.contextState,
      globalState: mainNoTerminal.globalState,
      target: mainNoTerminal.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt
    });
    await mainNoTerminal.committer.commit(noTerminalMark);
    await first.historyRecorder.recordTransaction(noTerminalMark, "integration-mark");

    const mainEmpty = await first.provider.open(
      descriptorFor(gitRepository.path, "empty.txt", emptyContent, first.stableHash)
    );
    const emptyMark = markReviewedRanges({
      contextState: mainEmpty.contextState,
      globalState: mainEmpty.globalState,
      target: mainEmpty.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt
    });
    await mainEmpty.committer.commit(emptyMark);
    await first.historyRecorder.recordTransaction(emptyMark, "integration-mark");

    const mainAnchor = await first.provider.open(
      descriptorFor(gitRepository.path, "anchor.txt", anchorContent, first.stableHash)
    );
    const anchorMark = markReviewedRanges({
      contextState: mainAnchor.contextState,
      globalState: mainAnchor.globalState,
      target: mainAnchor.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt
    });
    await mainAnchor.committer.commit(anchorMark);
    await first.historyRecorder.recordTransaction(anchorMark, "integration-mark");

    await writeFile(fixturePath, editedFixture, "utf8");
    await gitRepository.runGit(["add", "fixture.txt"]);
    await gitRepository.runGit(["commit", "--message", "edit fixture"]);
    const mainAfterCommit = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedFixture, first.stableHash)
    );
    assert.deepEqual(
      mainAfterCommit.contextState.files[mainAfterCommit.target.fileId]?.modifiedReviewed,
      mappedFixtureRanges
    );
    assert.equal(mainAfterCommit.contextState.files[mainAfterCommit.target.fileId]?.lineCount, 4);

    const mainNoTerminalAfterCommit = await first.provider.open(
      descriptorFor(gitRepository.path, "no-terminal.txt", noTerminalContent, first.stableHash)
    );
    assert.deepEqual(
      mainNoTerminalAfterCommit.contextState.files[mainNoTerminalAfterCommit.target.fileId]?.modifiedReviewed,
      [{ startLine: 0, endLineExclusive: 1 }]
    );
    assert.equal(mainNoTerminalAfterCommit.contextState.files[mainNoTerminalAfterCommit.target.fileId]?.lineCount, 1);

    const mainEmptyAfterCommit = await first.provider.open(
      descriptorFor(gitRepository.path, "empty.txt", emptyContent, first.stableHash)
    );
    assert.deepEqual(
      mainEmptyAfterCommit.contextState.files[mainEmptyAfterCommit.target.fileId]?.modifiedReviewed,
      [{ startLine: 0, endLineExclusive: 1 }]
    );
    assert.equal(mainEmptyAfterCommit.contextState.files[mainEmptyAfterCommit.target.fileId]?.lineCount, 1);

    const mainRevision = await gitRepository.runGit(["rev-parse", "HEAD"]);

    await gitRepository.runGit(["checkout", "-b", "feature/t207-history"]);
    const featureInitial = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedFixture, first.stableHash)
    );
    assert.notEqual(featureInitial.contextState.contextId, mainAfterCommit.contextState.contextId);
    const featureMark = markReviewedRanges({
      contextState: featureInitial.contextState,
      globalState: featureInitial.globalState,
      target: featureInitial.target,
      intervals: featureFixtureRanges,
      occurredAt
    });
    await featureInitial.committer.commit(featureMark);
    await first.historyRecorder.recordTransaction(featureMark, "integration-mark");

    await gitRepository.runGit(["checkout", "main"]);
    const restoredMain = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedFixture, first.stableHash)
    );
    assert.equal(restoredMain.contextState.contextId, mainAfterCommit.contextState.contextId);
    assert.deepEqual(
      restoredMain.contextState.files[restoredMain.target.fileId]?.modifiedReviewed,
      mappedFixtureRanges
    );

    await gitRepository.runGit(["checkout", "feature/t207-history"]);
    const restoredFeature = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedFixture, first.stableHash)
    );
    assert.deepEqual(
      restoredFeature.contextState.files[restoredFeature.target.fileId]?.modifiedReviewed,
      featureFixtureRanges
    );

    await rename(fixturePath, renamedPath);
    await gitRepository.runGit(["add", "--all"]);
    await gitRepository.runGit(["commit", "--message", "rename fixture"]);
    const afterRename = await first.provider.open(
      descriptorFor(gitRepository.path, "renamed.txt", editedFixture, first.stableHash)
    );
    assert.equal(afterRename.target.fileId, featureInitial.target.fileId);
    assert.deepEqual(
      afterRename.contextState.files[afterRename.target.fileId]?.modifiedReviewed,
      featureFixtureRanges
    );
    const renameRevision = await gitRepository.runGit(["rev-parse", "HEAD"]);

    await writeFile(copyPath, editedFixture, "utf8");
    await gitRepository.runGit(["add", "copy.txt"]);
    await gitRepository.runGit(["commit", "--message", "copy renamed fixture"]);
    const afterCopy = await first.provider.open(
      descriptorFor(gitRepository.path, "copy.txt", editedFixture, first.stableHash)
    );
    assert.notEqual(afterCopy.target.fileId, afterRename.target.fileId);
    assert.deepEqual(afterCopy.contextState.files[afterCopy.target.fileId]?.modifiedReviewed, []);
    const copyRevision = await gitRepository.runGit(["rev-parse", "HEAD"]);

    await unlink(renamedPath);
    await gitRepository.runGit(["add", "--all"]);
    await gitRepository.runGit(["commit", "--message", "delete renamed fixture"]);
    const afterDelete = await first.provider.open(
      descriptorFor(gitRepository.path, "copy.txt", editedFixture, first.stableHash)
    );
    assert.equal(afterDelete.contextState.files[afterRename.target.fileId], undefined);
    assert.equal(afterDelete.globalState.files[afterRename.target.fileId], undefined);
    assert.deepEqual(afterDelete.contextState.files[afterCopy.target.fileId]?.modifiedReviewed, []);
    const deleteRevision = await gitRepository.runGit(["rev-parse", "HEAD"]);

    await gitRepository.runGit(["checkout", "main"]);
    const mainBeforeRestart = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedFixture, first.stableHash)
    );
    assert.deepEqual(
      mainBeforeRestart.contextState.files[mainBeforeRestart.target.fileId]?.modifiedReviewed,
      mappedFixtureRanges
    );

    const mainTarget = {
      kind: "git" as const,
      repositoryId: mainBeforeRestart.contextState.repositoryId,
      contextId: mainBeforeRestart.contextState.contextId
    };
    const legacyCommit = await first.repository.load(mainTarget);
    assert.ok(legacyCommit);
    const contextFixture = legacyCommit.contextState.files[mainBeforeRestart.target.fileId];
    assert.ok(contextFixture);
    const canonicalGlobal = {
      fileId: mainBeforeRestart.target.fileId,
      currentPath: contextFixture.currentPath,
      revisionId: contextFixture.revisionId,
      reviewed: contextFixture.modifiedReviewed,
      contentHash: contextFixture.contentHash,
      updatedAt: contextFixture.updatedAt
    };
    const legacyGlobalFileId = "legacy-global-fixture-id";
    const otherGlobalFiles = Object.fromEntries(
      Object.entries(legacyCommit.globalState.files).filter(
        ([fileId]) => fileId !== mainBeforeRestart.target.fileId
      )
    );
    await first.repository.commit({
      repositoryId: mainTarget.repositoryId,
      contextId: mainTarget.contextId,
      expected: {
        contextState: legacyCommit.contextState,
        globalState: legacyCommit.globalState
      },
      next: {
        contextState: legacyCommit.contextState,
        globalState: {
          ...legacyCommit.globalState,
          files: {
            ...otherGlobalFiles,
            [legacyGlobalFileId]: {
              ...canonicalGlobal,
              fileId: legacyGlobalFileId
            }
          }
        }
      }
    });

    const reconciledMain = await first.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedFixture, first.stableHash)
    );
    const reconciledGlobalFiles = Object.values(reconciledMain.globalState.files).filter(
      (file) => file.currentPath === "fixture.txt"
    );
    assert.deepEqual(reconciledGlobalFiles.map((file) => file.fileId), [reconciledMain.target.fileId]);
    assert.deepEqual(reconciledGlobalFiles[0]?.reviewed, mappedFixtureRanges);

    const terminalMark = markReviewedRanges({
      contextState: reconciledMain.contextState,
      globalState: reconciledMain.globalState,
      target: reconciledMain.target,
      intervals: [{ startLine: 3, endLineExclusive: 4 }],
      occurredAt
    });
    await reconciledMain.committer.commit(terminalMark);
    await first.historyRecorder.recordTransaction(terminalMark, "integration-mark");
    const terminalUnmark = unmarkReviewedRanges({
      contextState: terminalMark.next.contextState,
      globalState: terminalMark.next.globalState,
      target: reconciledMain.target,
      intervals: [{ startLine: 3, endLineExclusive: 4 }],
      occurredAt
    });
    await reconciledMain.committer.commit(terminalUnmark);
    await first.historyRecorder.recordTransaction(terminalUnmark, "integration-unmark");
    const persistedAfterReconciliation = await first.repository.load(mainTarget);
    assert.deepEqual(
      Object.entries(persistedAfterReconciliation?.globalState.files ?? {})
        .filter(([, file]) => file.currentPath === "fixture.txt")
        .map(([fileId]) => fileId),
      [reconciledMain.target.fileId]
    );
    assert.deepEqual(
      persistedAfterReconciliation?.globalState.files[reconciledMain.target.fileId]?.reviewed,
      mappedFixtureRanges
    );
    first.provider.dispose();

    const restarted = createProvider(storageUris, "restart-session");
    const restartedFixture = await restarted.provider.open(
      descriptorFor(gitRepository.path, "fixture.txt", editedFixture, restarted.stableHash)
    );
    assert.deepEqual(
      restartedFixture.contextState.files[restartedFixture.target.fileId]?.modifiedReviewed,
      mappedFixtureRanges
    );
    assert.equal(restartedFixture.contextState.files[restartedFixture.target.fileId]?.lineCount, 4);
    const persistedAfterRestart = await restarted.repository.load(mainTarget);
    assert.deepEqual(
      Object.entries(persistedAfterRestart?.globalState.files ?? {})
        .filter(([, file]) => file.currentPath === "fixture.txt")
        .map(([fileId]) => fileId),
      [restartedFixture.target.fileId]
    );
    assert.deepEqual(
      persistedAfterRestart?.globalState.files[restartedFixture.target.fileId]?.reviewed,
      mappedFixtureRanges
    );
    const restartedNoTerminal = await restarted.provider.open(
      descriptorFor(gitRepository.path, "no-terminal.txt", noTerminalContent, restarted.stableHash)
    );
    assert.deepEqual(
      restartedNoTerminal.contextState.files[restartedNoTerminal.target.fileId]?.modifiedReviewed,
      [{ startLine: 0, endLineExclusive: 1 }]
    );
    assert.equal(restartedNoTerminal.contextState.files[restartedNoTerminal.target.fileId]?.lineCount, 1);
    const restartedEmpty = await restarted.provider.open(
      descriptorFor(gitRepository.path, "empty.txt", emptyContent, restarted.stableHash)
    );
    assert.deepEqual(
      restartedEmpty.contextState.files[restartedEmpty.target.fileId]?.modifiedReviewed,
      [{ startLine: 0, endLineExclusive: 1 }]
    );
    assert.equal(restartedEmpty.contextState.files[restartedEmpty.target.fileId]?.lineCount, 1);

    const historyTarget = {
      kind: "git" as const,
      repositoryId: mainInitial.contextState.repositoryId,
      contextId: mainInitial.contextState.contextId
    };
    const historyRoute = resolveReviewStateStorageRoute(storageUris, historyTarget);
    const historyContent = await readFile(
      path.join(historyRoute.historyDirectory, "events-2026-08.jsonl"),
      "utf8"
    );
    const historyEvents = historyContent.trimEnd().split("\n").map(parseReviewHistoryEventLine);
    const hasFileEvent = (
      type: string,
      contextId: string,
      revisionId: string,
      filePath: string,
      previousRanges: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
      nextRanges: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
      reason: string
    ): boolean => historyEvents.some((event) =>
      event.type === type &&
      "filePath" in event &&
      event.contextId === contextId &&
      event.revisionId === revisionId &&
      event.filePath === filePath &&
      event.reason === reason &&
      JSON.stringify(event.previousRanges) === JSON.stringify(previousRanges) &&
      JSON.stringify(event.nextRanges) === JSON.stringify(nextRanges)
    );
    assert.ok(hasFileEvent(
      "remapped-by-diff", mainAfterCommit.contextState.contextId, mainRevision,
      "fixture.txt", allPhysicalFixtureRanges, mappedFixtureRanges, "git-revision-mapped"
    ));
    assert.ok(hasFileEvent(
      "marked-reviewed", featureInitial.contextState.contextId, mainRevision,
      "fixture.txt", [], featureFixtureRanges, "integration-mark"
    ));
    assert.ok(hasFileEvent(
      "file-renamed", featureInitial.contextState.contextId, renameRevision,
      "renamed.txt", featureFixtureRanges, featureFixtureRanges, "git-revision-mapped"
    ));
    assert.ok(hasFileEvent(
      "remapped-by-diff", featureInitial.contextState.contextId, copyRevision,
      "copy.txt", [], [], "git-revision-mapped"
    ));
    assert.ok(hasFileEvent(
      "file-deleted", featureInitial.contextState.contextId, deleteRevision,
      "renamed.txt", featureFixtureRanges, [], "git-revision-mapped"
    ));
    assert.ok(hasFileEvent(
      "marked-reviewed", mainBeforeRestart.contextState.contextId, mainRevision,
      "fixture.txt", mappedFixtureRanges,
      [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 4 }],
      "integration-mark"
    ));
    assert.ok(hasFileEvent(
      "unmarked-reviewed", mainBeforeRestart.contextState.contextId, mainRevision,
      "fixture.txt", [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 4 }],
      mappedFixtureRanges, "integration-unmark"
    ));
    restarted.provider.dispose();
  } finally {
    await gitRepository.cleanup();
    await storage.cleanup();
  }
});

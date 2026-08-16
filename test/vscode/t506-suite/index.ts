import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import * as vscode from "vscode";

const execFileAsync = promisify(execFile);
const PHASE_VARIABLE = "REVIEW_RANGE_TEST_PHASE";
const TAG_BASE_A = "t506-base-a";
const TAG_BASE_B = "t506-base-b";
const TAG_HEAD = "t506-head";

type TestPhase =
  | "mark-context-a"
  | "restore-context-b-unmark-global"
  | "restore-context-a";

interface PullRequestProgressTreeFile {
  readonly path: string;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly node: unknown;
}

interface ReviewFileStateSnapshot {
  readonly currentPath: string;
  readonly modifiedReviewed: readonly unknown[];
  readonly originalReviewedByDiff: Readonly<Record<string, readonly unknown[]>>;
}

interface GlobalFileStateSnapshot {
  readonly currentPath: string;
  readonly reviewed: readonly unknown[];
}

interface ReviewedIntervalSnapshot {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

interface GlobalUnderstandingFileSnapshot {
  readonly path: string;
  readonly reviewedNonEmptyLineCount: number;
  readonly totalNonEmptyLineCount: number;
  readonly progress: number;
}

interface ReviewRangeT506TestApi {
  initializeLocalBaseHeadRuntime(input: {
    readonly baseSha: string;
    readonly headSha: string;
  }): Promise<void>;
  getLocalBaseHeadTree(): {
    readonly reviewedLineCount: number;
    readonly totalLineCount: number;
    readonly files: readonly PullRequestProgressTreeFile[];
  };
  getLocalBaseHeadPersistence(): Promise<{
    readonly contextState: {
      readonly files: Readonly<Record<string, ReviewFileStateSnapshot>>;
    };
    readonly globalState: {
      readonly currentRevisionId: string;
      readonly files: Readonly<Record<string, GlobalFileStateSnapshot>>;
    };
  }>;
  getVisibleReviewedIntervals(documentUri: string): readonly ReviewedIntervalSnapshot[];
  refreshVisibleEditorDecorations(): Promise<void>;
  drainDocumentReviewEdits(): Promise<void>;
  getGlobalUnderstandingSnapshot(): Promise<{
    readonly progress: {
      readonly files: readonly GlobalUnderstandingFileSnapshot[];
    };
  } | undefined>;
  setLocalBaseHeadConfirmationAnswer(answer: boolean): void;
}

const within = async <Value>(label: string, operation: PromiseLike<Value>): Promise<Value> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<Value>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`T506 timed out: ${label}`)),
          10_000
        );
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const readPhase = (): TestPhase => {
  const phase = process.env[PHASE_VARIABLE];
  assert.ok(
    phase === "mark-context-a" ||
      phase === "restore-context-b-unmark-global" ||
      phase === "restore-context-a",
    `Unexpected T506 Extension Host phase: ${String(phase)}`
  );
  return phase;
};

const runGit = async (
  workspacePath: string,
  argumentsList: readonly string[]
): Promise<string> => {
  const { stdout } = await execFileAsync("git", [...argumentsList], {
    cwd: workspacePath,
    windowsHide: true
  });
  return stdout.trim();
};

const writeWorkspaceFile = (
  workspacePath: string,
  relativePath: string,
  content: string
): Thenable<void> => vscode.workspace.fs.writeFile(
  vscode.Uri.joinPath(vscode.Uri.file(workspacePath), relativePath),
  Buffer.from(content)
);

const createFixture = async (
  workspacePath: string
): Promise<{ readonly baseA: string; readonly baseB: string; readonly head: string }> => {
  await runGit(workspacePath, ["init", "--initial-branch=main"]);
  await runGit(workspacePath, ["config", "user.name", "Review Range T506"]);
  await runGit(workspacePath, ["config", "user.email", "t506@example.invalid"]);

  await writeWorkspaceFile(
    workspacePath,
    "review.ts",
    "const removed = 1;\nconst retained = 2;\n"
  );
  await runGit(workspacePath, ["add", "."]);
  await runGit(workspacePath, ["commit", "-m", "t506 base A"]);
  const baseA = await runGit(workspacePath, ["rev-parse", "HEAD"]);
  await runGit(workspacePath, ["tag", TAG_BASE_A, baseA]);

  await writeWorkspaceFile(
    workspacePath,
    "context-marker.ts",
    "export const contextMarker = true;\n"
  );
  await runGit(workspacePath, ["add", "."]);
  await runGit(workspacePath, ["commit", "-m", "t506 base B"]);
  const baseB = await runGit(workspacePath, ["rev-parse", "HEAD"]);
  await runGit(workspacePath, ["tag", TAG_BASE_B, baseB]);

  await writeWorkspaceFile(
    workspacePath,
    "review.ts",
    "const retained = 2;\nconst added = 3;\n"
  );
  await runGit(workspacePath, ["add", "."]);
  await runGit(workspacePath, ["commit", "-m", "t506 head"]);
  const head = await runGit(workspacePath, ["rev-parse", "HEAD"]);
  await runGit(workspacePath, ["tag", TAG_HEAD, head]);
  return { baseA, baseB, head };
};

const readFixture = async (
  workspacePath: string,
  phase: TestPhase
): Promise<{ readonly baseA: string; readonly baseB: string; readonly head: string }> => {
  if (phase === "mark-context-a") return createFixture(workspacePath);
  return {
    baseA: await runGit(workspacePath, ["rev-parse", TAG_BASE_A]),
    baseB: await runGit(workspacePath, ["rev-parse", TAG_BASE_B]),
    head: await runGit(workspacePath, ["rev-parse", TAG_HEAD])
  };
};

const reviewFile = (
  tree: ReturnType<ReviewRangeT506TestApi["getLocalBaseHeadTree"]>
): PullRequestProgressTreeFile => {
  const file = tree.files.find((candidate) => candidate.path === "review.ts");
  assert.ok(file, "T506 fixture must expose review.ts in PR Progress.");
  return file;
};

const reviewContextFile = (
  persistence: Awaited<ReturnType<ReviewRangeT506TestApi["getLocalBaseHeadPersistence"]>>
): ReviewFileStateSnapshot => {
  const file = Object.values(persistence.contextState.files).find(
    (candidate) => candidate.currentPath === "review.ts"
  );
  assert.ok(file, "T506 context persistence must contain review.ts.");
  return file;
};

const reviewGlobalFile = (
  persistence: Awaited<ReturnType<ReviewRangeT506TestApi["getLocalBaseHeadPersistence"]>>
): GlobalFileStateSnapshot => {
  const file = Object.values(persistence.globalState.files).find(
    (candidate) => candidate.currentPath === "review.ts"
  );
  assert.ok(file, "T506 Global persistence must contain review.ts.");
  return file;
};

const globalUnderstandingReviewFile = async (
  api: ReviewRangeT506TestApi
): Promise<GlobalUnderstandingFileSnapshot> => {
  const snapshot = await api.getGlobalUnderstandingSnapshot();
  assert.ok(snapshot, "T506 Global Understanding source must resolve the current repository.");
  const file = snapshot.progress.files.find((candidate) => candidate.path === "review.ts");
  assert.ok(file, "T506 Global Understanding must include review.ts.");
  return file;
};

const openReviewDiff = async (file: PullRequestProgressTreeFile): Promise<void> => {
  await within(
    "open PR Progress review file",
    vscode.commands.executeCommand("reviewRange.openPrProgressItem", file.node)
  );
  assert.ok(
    vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff,
    "T506 review file must open as a real diff tab."
  );
};

const openNormalReviewEditor = async (
  workspaceFolder: vscode.WorkspaceFolder
): Promise<vscode.TextEditor> => {
  const uri = vscode.Uri.joinPath(workspaceFolder.uri, "review.ts");
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document, { preview: false });
};

const expectedMappedIntervals: readonly ReviewedIntervalSnapshot[] = [
  { startLine: 0, endLineExclusive: 1 },
  { startLine: 2, endLineExclusive: 3 }
];

const assertMappedGlobalUnderstanding = async (
  api: ReviewRangeT506TestApi
): Promise<void> => {
  const file = await globalUnderstandingReviewFile(api);
  assert.equal(file.reviewedNonEmptyLineCount, 2);
  assert.equal(file.totalNonEmptyLineCount, 3);
  assert.equal(file.progress, 2 / 3);
};

const waitForMappedLiveEdit = async (api: ReviewRangeT506TestApi): Promise<void> => {
  await within(
    "persist mapped live edit and invalidated-by-edit history",
    api.drainDocumentReviewEdits()
  );
  await within("recalculate mapped Global Understanding", assertMappedGlobalUnderstanding(api));
};

const assertMappedNormalEditorAfterRestart = async (
  api: ReviewRangeT506TestApi,
  workspaceFolder: vscode.WorkspaceFolder
): Promise<void> => {
  const editor = await within(
    "open mapped normal editor after restart",
    openNormalReviewEditor(workspaceFolder)
  );
  await within(
    "refresh current context after restart",
    vscode.commands.executeCommand("reviewRange.refreshContext")
  );
  await assertMappedGlobalUnderstanding(api);
  await within("refresh mapped normal editor decorations", api.refreshVisibleEditorDecorations());
  assert.deepEqual(
    api.getVisibleReviewedIntervals(editor.document.uri.toString()),
    expectedMappedIntervals,
    "Normal-editor mapped ranges must survive an Extension Host restart."
  );
};

/** Exercises T506 multiple-context Global persistence and PR isolation through real Extension Host restarts. */
export async function run(): Promise<void> {
  const phase = readPhase();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "T506 requires one workspace folder.");
  const fixture = await within(
    "prepare Git fixture",
    readFixture(workspaceFolder.uri.fsPath, phase)
  );
  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host should load this extension.");
  const api = (await within("extension activation", extension.activate())) as ReviewRangeT506TestApi;
  api.setLocalBaseHeadConfirmationAnswer(true);

  if (phase === "mark-context-a") {
    await within(
      "initialize context A",
      api.initializeLocalBaseHeadRuntime({ baseSha: fixture.baseA, headSha: fixture.head })
    );
    const before = reviewFile(api.getLocalBaseHeadTree());
    assert.equal(before.reviewedLineCount, 0);
    assert.equal(before.totalLineCount, 2);
    await openReviewDiff(before);
    await within(
      "focus original side for context A",
      vscode.commands.executeCommand("workbench.action.compareEditor.focusSecondarySide")
    );
    await within(
      "mark context A file",
      vscode.commands.executeCommand("reviewRange.markFileReviewed")
    );

    const after = reviewFile(api.getLocalBaseHeadTree());
    assert.equal(after.reviewedLineCount, 2);
    const persistence = await api.getLocalBaseHeadPersistence();
    const contextFile = reviewContextFile(persistence);
    assert.ok(
      contextFile.modifiedReviewed.length > 0 ||
        Object.values(contextFile.originalReviewedByDiff).some((ranges) => ranges.length > 0),
      "Context A must persist its PR-local reviewed ranges."
    );
    assert.ok(
      reviewGlobalFile(persistence).reviewed.length > 0,
      "Context A mark must also persist owner-wide Global reviewed state."
    );

    const normalEditor = await within(
      "open production normal editor",
      openNormalReviewEditor(workspaceFolder)
    );
    await within(
      "select production current context",
      vscode.commands.executeCommand("reviewRange.refreshContext")
    );
    normalEditor.selections = [
      new vscode.Selection(0, 0, 0, 0),
      new vscode.Selection(1, 0, 1, 0)
    ];
    await within(
      "mark production normal-editor lines",
      vscode.commands.executeCommand("reviewRange.markSelectionReviewed")
    );
    await within("refresh initial normal-editor decorations", api.refreshVisibleEditorDecorations());
    assert.deepEqual(
      api.getVisibleReviewedIntervals(normalEditor.document.uri.toString()),
      [{ startLine: 0, endLineExclusive: 2 }],
      "The production normal editor must start with both non-empty lines reviewed."
    );
    const initialUnderstanding = await globalUnderstandingReviewFile(api);
    assert.equal(initialUnderstanding.reviewedNonEmptyLineCount, 2);
    assert.equal(initialUnderstanding.totalNonEmptyLineCount, 2);
    assert.equal(initialUnderstanding.progress, 1);

    await within(
      "insert an unreviewed normal-editor line",
      normalEditor.edit((edit) => {
        edit.insert(new vscode.Position(1, 0), "const inserted = 9;\n");
      })
    );
    await waitForMappedLiveEdit(api);
    await within("refresh edited normal-editor decorations", api.refreshVisibleEditorDecorations());
    assert.deepEqual(
      api.getVisibleReviewedIntervals(normalEditor.document.uri.toString()),
      expectedMappedIntervals,
      "A live edit must keep unchanged reviewed lines, shift the suffix, and leave the inserted line unreviewed."
    );
    assert.equal(
      await within("save edited normal editor", normalEditor.document.save()),
      true,
      "The mapped working-tree content must be saved for restart verification."
    );
    return;
  }

  if (phase === "restore-context-b-unmark-global") {
    await assertMappedNormalEditorAfterRestart(api, workspaceFolder);
    await within(
      "initialize context B",
      api.initializeLocalBaseHeadRuntime({ baseSha: fixture.baseB, headSha: fixture.head })
    );
    const before = reviewFile(api.getLocalBaseHeadTree());
    const persistence = await api.getLocalBaseHeadPersistence();
    const contextFile = reviewContextFile(persistence);
    assert.equal(contextFile.modifiedReviewed.length, 0);
    assert.ok(
      Object.values(contextFile.originalReviewedByDiff).every((ranges) => ranges.length === 0),
      "Context B must start without Context A's PR-local review state."
    );
    assert.ok(
      reviewGlobalFile(persistence).reviewed.length > 0,
      "Context B must restore owner-wide Global reviewed state from Context A."
    );
    assert.equal(
      before.reviewedLineCount,
      0,
      "Global state restored into Context B must not inflate PR Progress."
    );
    assert.equal(before.totalLineCount, 2);

    await openReviewDiff(before);
    await within(
      "focus modified side for context B",
      vscode.commands.executeCommand("workbench.action.compareEditor.focusPrimarySide")
    );
    await within(
      "unmark Global from context B",
      vscode.commands.executeCommand("reviewRange.unmarkFileReviewed")
    );
    const after = await api.getLocalBaseHeadPersistence();
    assert.equal(reviewContextFile(after).modifiedReviewed.length, 0);
    assert.ok(
      Object.values(reviewContextFile(after).originalReviewedByDiff)
        .every((ranges) => ranges.length === 0)
    );
    assert.equal(
      reviewGlobalFile(after).reviewed.length,
      0,
      "A Global-only unmark from Context B must clear the owner-wide Global range."
    );
    return;
  }

  await assertMappedNormalEditorAfterRestart(api, workspaceFolder);
  await within(
    "restore context A",
    api.initializeLocalBaseHeadRuntime({ baseSha: fixture.baseA, headSha: fixture.head })
  );
  const restoredTree = reviewFile(api.getLocalBaseHeadTree());
  assert.equal(
    restoredTree.reviewedLineCount,
    2,
    "Context A PR review state must survive restarts and Context B Global changes."
  );
  const restored = await api.getLocalBaseHeadPersistence();
  const contextFile = reviewContextFile(restored);
  assert.ok(
    contextFile.modifiedReviewed.length > 0 ||
      Object.values(contextFile.originalReviewedByDiff).some((ranges) => ranges.length > 0)
  );
  assert.equal(
    reviewGlobalFile(restored).reviewed.length,
    0,
    "Context A reload must observe the Global unmark performed from Context B."
  );
  assert.equal(restored.globalState.currentRevisionId, fixture.head);
}

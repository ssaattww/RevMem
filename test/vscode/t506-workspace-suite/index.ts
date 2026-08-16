import assert from "node:assert/strict";

import * as vscode from "vscode";

const PHASE_VARIABLE = "REVIEW_RANGE_TEST_PHASE";

type TestPhase = "workspace-mark-edit" | "workspace-restore";

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

interface ReviewRangeT506WorkspaceTestApi {
  getVisibleReviewedIntervals(documentUri: string): readonly ReviewedIntervalSnapshot[];
  refreshVisibleEditorDecorations(): Promise<void>;
  getGlobalUnderstandingSnapshot(): Promise<{
    readonly progress: {
      readonly files: readonly GlobalUnderstandingFileSnapshot[];
    };
  } | undefined>;
}

const within = async <Value>(label: string, operation: PromiseLike<Value>): Promise<Value> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<Value>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`T506 workspace timed out: ${label}`)),
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
    phase === "workspace-mark-edit" || phase === "workspace-restore",
    `Unexpected T506 workspace phase: ${String(phase)}`
  );
  return phase;
};

const workspaceFile = (workspaceFolder: vscode.WorkspaceFolder): vscode.Uri =>
  vscode.Uri.joinPath(workspaceFolder.uri, "workspace-review.ts");

const openEditor = async (
  workspaceFolder: vscode.WorkspaceFolder
): Promise<vscode.TextEditor> => {
  const document = await vscode.workspace.openTextDocument(workspaceFile(workspaceFolder));
  return vscode.window.showTextDocument(document, { preview: false });
};

const globalFile = async (
  api: ReviewRangeT506WorkspaceTestApi
): Promise<GlobalUnderstandingFileSnapshot> => {
  const snapshot = await api.getGlobalUnderstandingSnapshot();
  assert.ok(snapshot, "T506 workspace Global Understanding must resolve the workspace owner.");
  const file = snapshot.progress.files.find(
    (candidate) => candidate.path === "workspace-review.ts"
  );
  assert.ok(file, "T506 workspace Global Understanding must include workspace-review.ts.");
  return file;
};

const expectedMappedIntervals: readonly ReviewedIntervalSnapshot[] = [
  { startLine: 0, endLineExclusive: 1 },
  { startLine: 2, endLineExclusive: 3 }
];

const assertMappedState = async (
  api: ReviewRangeT506WorkspaceTestApi,
  editor: vscode.TextEditor
): Promise<void> => {
  const understanding = await globalFile(api);
  assert.equal(understanding.reviewedNonEmptyLineCount, 2);
  assert.equal(understanding.totalNonEmptyLineCount, 3);
  assert.equal(understanding.progress, 2 / 3);
  await within("refresh workspace decorations", api.refreshVisibleEditorDecorations());
  assert.deepEqual(
    api.getVisibleReviewedIntervals(editor.document.uri.toString()),
    expectedMappedIntervals,
    "Non-Git live edits must retain unchanged reviewed lines and leave the inserted line unreviewed."
  );
};

/** Exercises non-Git workspace live-edit mapping and restart through the real Extension Host. */
export async function run(): Promise<void> {
  const phase = readPhase();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "T506 workspace acceptance requires one workspace folder.");
  const uri = workspaceFile(workspaceFolder);

  if (phase === "workspace-mark-edit") {
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from("const first = 1;\nconst second = 2;", "utf8")
    );
  }

  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host should load this extension.");
  const api = (await within(
    "workspace extension activation",
    extension.activate()
  )) as ReviewRangeT506WorkspaceTestApi;
  const editor = await within("open non-Git workspace editor", openEditor(workspaceFolder));
  await within(
    "select non-Git workspace context",
    vscode.commands.executeCommand("reviewRange.refreshContext")
  );

  if (phase === "workspace-restore") {
    await assertMappedState(api, editor);
    return;
  }

  editor.selections = [
    new vscode.Selection(0, 0, 0, 0),
    new vscode.Selection(1, 0, 1, 0)
  ];
  await within(
    "mark non-Git workspace lines",
    vscode.commands.executeCommand("reviewRange.markSelectionReviewed")
  );
  await within("refresh initial workspace decorations", api.refreshVisibleEditorDecorations());
  assert.deepEqual(
    api.getVisibleReviewedIntervals(editor.document.uri.toString()),
    [{ startLine: 0, endLineExclusive: 2 }]
  );
  const before = await globalFile(api);
  assert.equal(before.reviewedNonEmptyLineCount, 2);
  assert.equal(before.totalNonEmptyLineCount, 2);
  assert.equal(before.progress, 1);

  assert.equal(
    await within(
      "insert non-Git workspace line",
      editor.edit((edit) => {
        edit.insert(new vscode.Position(1, 0), "const inserted = 9;\n");
      })
    ),
    true
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  await assertMappedState(api, editor);
  assert.equal(
    await within("save non-Git workspace edit", editor.document.save()),
    true
  );
}
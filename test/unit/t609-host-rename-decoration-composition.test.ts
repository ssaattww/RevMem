import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import { DocumentReviewStateSessionProvider, type DocumentEditorReviewDescriptor } from "../../src/adapters/document-review-state/index";
import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index";
import { DebouncedReviewStateRepository, FileSystemReviewStateRepository, JsonlReviewHistoryStore } from "../../src/adapters/state-repository/index";
import { createNormalEditorDecorationModelIncrementally } from "../../src/application/editor-decoration/index";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import { markReviewedRanges } from "../../src/core/review-state/index";
import { NormalEditorDecorationController, type NormalEditorDecorationHost } from "../../src/ui/normal-editor/index";
import { cleanupOwnedTemporaryDirectory } from "../vscode/owned-temporary-directory-cleanup";

const execFileAsync = promisify(execFile);
const phase = (phases: string[], name: string): void => { phases.push(name); };

interface Editor {
  readonly descriptor: DocumentEditorReviewDescriptor;
}

const descriptorFor = async (root: string, name: string, stableHash: NodeSha256StableHash): Promise<DocumentEditorReviewDescriptor> => {
  const documentFsPath = path.join(root, name);
  const text = await readFile(documentFsPath, "utf8");
  const uri = pathToFileURL(documentFsPath);
  return {
    documentUri: { scheme: uri.protocol.slice(0, -1), authority: "", path: uri.pathname, query: "", fragment: "" },
    documentFsPath,
    fileSystemPathSemantics: process.platform === "win32" ? "windows" : "posix",
    lineCount: text.split(/\r\n|\r|\n/u).length,
    contentHash: stableHash.digest(text)
  };
};

const initializeGit = async (root: string): Promise<void> => {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "review-range@example.invalid"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.name", "Review Range Test"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["add", "."], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["commit", "-m", "T609 composition fixture"], { cwd: root, windowsHide: true });
};

const recorder = (storageUris: { readonly globalStorageUri: { readonly fsPath: string } }, sessionId: string): ReviewHistoryRecorder =>
  new ReviewHistoryRecorder({
    sessionId,
    createEventId: (() => { let sequence = 0; return () => `${sessionId}-${++sequence}`; })(),
    appender: new JsonlReviewHistoryStore({ storageUris })
  });

test("T609 production rename decoration composition settles concurrent visible and explicit refreshes", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "review-range-vscode-t609-rename-"));
  const root = path.join(temporaryRoot, "repository");
  const storageRoot = path.join(temporaryRoot, "storage");
  const storageUris = { globalStorageUri: { fsPath: storageRoot } };
  const stableHash = new NodeSha256StableHash();
  const phases: string[] = [];
  let seedRepository: DebouncedReviewStateRepository | undefined;
  let hostRepository: DebouncedReviewStateRepository | undefined;
  let seedProvider: DocumentReviewStateSessionProvider | undefined;
  let hostProvider: DocumentReviewStateSessionProvider | undefined;
  let controller: NormalEditorDecorationController<Editor, { dispose(): void }> | undefined;

  try {
    await mkdir(root);
    await writeFile(path.join(root, "rename-source.txt"), "rename fixture\n", "utf8");
    await initializeGit(root);
    seedRepository = new DebouncedReviewStateRepository({ delegate: new FileSystemReviewStateRepository({ storageUris }) });
    seedProvider = new DocumentReviewStateSessionProvider({
      gitInspector: createNodeLocalGitAdapter(), repository: seedRepository, workspaceProvider: {} as never,
      stableHash, historyRecorder: recorder(storageUris, "t609-rename-seed"),
      gitMappingOptions: { ignoreWhitespaceChanges: true, ignoreEolChanges: true }
    });
    const initial = await seedProvider.open(await descriptorFor(root, "rename-source.txt", stableHash));
    const reviewed = markReviewedRanges({
      contextState: initial.contextState, globalState: initial.globalState, target: initial.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }], occurredAt: "2026-08-22T00:00:00.000Z"
    });
    await initial.committer.commit(reviewed);
    phase(phases, "seed-commit");
    seedProvider.dispose();
    await seedRepository.dispose();
    seedProvider = undefined;
    seedRepository = undefined;

    await rename(path.join(root, "rename-source.txt"), path.join(root, "renamed.txt"));
    await execFileAsync("git", ["add", "-A"], { cwd: root, windowsHide: true });
    await execFileAsync("git", ["commit", "-m", "rename"], { cwd: root, windowsHide: true });
    const expectedRevision = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true })).stdout.trim();
    const editor: Editor = { descriptor: await descriptorFor(root, "renamed.txt", stableHash) };
    hostRepository = new DebouncedReviewStateRepository({ delegate: new FileSystemReviewStateRepository({ storageUris }) });
    hostProvider = new DocumentReviewStateSessionProvider({
      gitInspector: createNodeLocalGitAdapter(), repository: hostRepository, workspaceProvider: {} as never,
      stableHash, historyRecorder: recorder(storageUris, "t609-rename-host"),
      gitMappingOptions: { ignoreWhitespaceChanges: true, ignoreEolChanges: true }
    });

    let visible: readonly Editor[] = [];
    let onVisible: (() => void | Promise<void>) | undefined;
    let applied: readonly { readonly interval: { readonly startLine: number; readonly endLineExclusive: number } }[] = [];
    const host: NormalEditorDecorationHost<Editor, { dispose(): void }> = {
      getVisibleEditors: () => visible,
      isDiffEditor: () => false,
      getSettings: () => ({ showGlobalReviewed: true, showGutterIcon: false, showOverviewRuler: false }),
      loadDecorations: async (candidate) => {
        phase(phases, "storage-load-start");
        const loaded = await hostProvider!.loadForDecoration(candidate.descriptor);
        phase(phases, "revision-map-commit-history-complete");
        assert.ok(loaded, "the renamed document must retain its persisted Git owner");
        const model = await createNormalEditorDecorationModelIncrementally({
          contextState: loaded.contextState, globalState: loaded.globalState, target: loaded.target, showGlobalReviewed: true
        }, { maxWorkItems: 1, yieldControl: () => undefined, isCurrent: () => true });
        phase(phases, "decoration-model-complete");
        return model ?? [];
      },
      createDecorationType: () => ({ dispose(): void {} }),
      setDecorations: async (_editor, _type, decorations) => {
        applied = decorations;
        phase(phases, "decoration-apply-complete");
      },
      onDidChangeVisibleEditors: (listener) => { onVisible = listener; return { dispose(): void {} }; },
      onDidChangeActiveEditor: () => ({ dispose(): void {} }),
      onDidChangeSettings: () => ({ dispose(): void {} }),
      showDecorationError: async (error) => { throw error; }
    };
    controller = new NormalEditorDecorationController(host, { maxDecorationsPerStage: 1, yieldControl: () => Promise.resolve() });
    await controller.start();
    visible = [editor];
    const eventRefresh = Promise.resolve(onVisible?.());
    const explicitRefresh = controller.refreshVisibleEditors();
    await Promise.all([eventRefresh, explicitRefresh]);
    await controller.drain();

    const target = await hostProvider.loadForDecoration(editor.descriptor);
    assert.equal(target?.target.revisionId, expectedRevision, "the persisted state must commit the renamed target revision");
    assert.deepEqual(applied.map((entry) => entry.interval), [{ startLine: 0, endLineExclusive: 1 }]);
    assert.ok(phases.includes("storage-load-start"));
    assert.ok(phases.includes("revision-map-commit-history-complete"));
    assert.ok(phases.includes("decoration-model-complete"));
    assert.ok(phases.includes("decoration-apply-complete"));
    const stateFiles = await readdir(storageRoot, { recursive: true });
    const historyFiles = stateFiles.filter((file) => typeof file === "string" && file.endsWith(".jsonl"));
    assert.ok(historyFiles.length > 0, "the production history recorder must persist the revision mapping");
    controller.dispose();
    controller = undefined;
  } finally {
    controller?.dispose();
    hostProvider?.dispose();
    seedProvider?.dispose();
    await hostRepository?.dispose();
    await seedRepository?.dispose();
    await cleanupOwnedTemporaryDirectory({
      rootPath: temporaryRoot,
      workerPath: path.join(__dirname, "../vscode/run-extension-host-cleanup-worker.js"),
      timeoutMs: 10_000,
      diagnosticDirectory: path.join(process.cwd(), "test-output", "vscode-launch-diagnostics"),
      redactPaths: [temporaryRoot, process.cwd()]
    });
  }
});

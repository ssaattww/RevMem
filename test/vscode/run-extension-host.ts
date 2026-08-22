import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import { DocumentReviewStateSessionProvider, type DocumentEditorReviewDescriptor } from "../../src/adapters/document-review-state/index";
import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index";
import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore
} from "../../src/adapters/state-repository/index";
import { markReviewedRanges, type ReviewStateTransaction } from "../../src/core/review-state/index";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import { createTemporaryDirectory, pathExists } from "../support/temporary-directory";
import { runOwnedExtensionHostLaunch } from "./owned-extension-host-launch";
import { cleanupOwnedTemporaryDirectory } from "./owned-temporary-directory-cleanup";

const execFileAsync = promisify(execFile);
const VS_CODE_TEST_VERSION = "1.130.0";
const testPhases = [
  "confirm",
  "restore-confirmed-and-unmark",
  "restore-unmarked"
] as const;
const t506Phases = [
  "mark-context-a",
  "restore-context-b-unmark-global",
  "restore-context-a"
] as const;
const t506WorkspacePhases = [
  "workspace-mark-edit",
  "workspace-restore"
] as const;
const t609Phases = ["single-root", "prepare", "restart-reopen"] as const;
// A clean runner must download the pinned VS Code archive before its first
// launch; keep that bounded separately from individual fixture operations.
const DEFAULT_LAUNCH_TIMEOUT_MS = 300_000;
const FIXTURE_CLEANUP_TIMEOUT_MS = 10_000;

const initializeGitRepository = async (root: string): Promise<void> => {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "review-range@example.invalid"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.name", "Review Range Test"], { cwd: root, windowsHide: true });
  // The Host fixture must commit the raw CRLF transition it later maps; a
  // developer's global autocrlf setting must not rewrite it during git add.
  await execFileAsync("git", ["config", "core.autocrlf", "false"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "core.eol", "lf"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["add", "."], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["commit", "-m", "T609 fixture"], { cwd: root, windowsHide: true });
};

const prepareT609Fixture = async (root: string): Promise<void> => {
  await mkdir(join(root, ".vscode"), { recursive: true });
  await Promise.all([
    writeFile(join(root, ".vscode", "settings.json"), `${JSON.stringify({
      "files.encoding": "shift_jis",
      "reviewRange.ignoreWhitespaceChanges": true,
      "reviewRange.ignoreEolChanges": true
    })}\n`, "utf8"),
    writeFile(join(root, "shift-jis.txt"), Buffer.from([0x82, 0xa0, 0x0a])),
    writeFile(join(root, "utf8-bom.txt"), Buffer.from([0xef, 0xbb, 0xbf, 0x62, 0x65, 0x74, 0x61, 0x0a])),
    writeFile(join(root, "invalid.txt"), Buffer.from([0xff, 0xfe, 0xfd])),
    writeFile(join(root, "rename-source.txt"), "rename fixture\n", "utf8"),
    writeFile(join(root, "whitespace.txt"), "whitespace fixture\n", "utf8"),
    writeFile(join(root, "eol.txt"), "eol fixture\n", "utf8")
  ]);
  await initializeGitRepository(root);
};

/** Advances the persisted Host fixture so the next Extension Host maps actual Git transitions. */
const advanceT609Fixture = async (root: string): Promise<void> => {
  await rename(join(root, "rename-source.txt"), join(root, "renamed.txt"));
  await Promise.all([
    writeFile(join(root, "new-file.txt"), "new fixture\n", "utf8"),
    writeFile(join(root, "whitespace.txt"), "whitespace  fixture\n", "utf8"),
    writeFile(join(root, "eol.txt"), "eol fixture\r\n", "utf8")
  ]);
  await execFileAsync("git", ["add", "-A"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["commit", "-m", "T609 Host mapping transitions"], { cwd: root, windowsHide: true });
};

const prepareT609SecondRoot = async (root: string): Promise<void> => {
  await writeFile(join(root, "second-root.txt"), "T609 second repository fixture\n", "utf8");
  await initializeGitRepository(root);
};

/** Seeds the initial Git-review ranges using the same repository/session path that the Host subsequently loads. */
const prepareT609InitialReviewState = async (root: string, userData: string): Promise<void> => {
  const storageUris = {
    globalStorageUri: { fsPath: join(userData, "User", "globalStorage", "taiga.review-range-tracker") }
  };
  const repository = new DebouncedReviewStateRepository({
    delegate: new FileSystemReviewStateRepository({ storageUris })
  });
  const historyRecorder = new ReviewHistoryRecorder({
    sessionId: "t609-runner-seed",
    createEventId: (() => {
      let sequence = 0;
      return () => `t609-runner-seed-${++sequence}`;
    })(),
    appender: new JsonlReviewHistoryStore({ storageUris })
  });
  const stableHash = new NodeSha256StableHash();
  const documentSessionProvider = new DocumentReviewStateSessionProvider({
    gitInspector: createNodeLocalGitAdapter(),
    repository,
    workspaceProvider: {} as never,
    stableHash,
    historyRecorder,
    gitMappingOptions: {
      ignoreWhitespaceChanges: true,
      ignoreEolChanges: true
    }
  });
  const descriptors = await Promise.all(["rename-source.txt", "whitespace.txt", "eol.txt"].map(async (name) => {
    const documentFsPath = join(root, name);
    const text = await readFile(documentFsPath, "utf8");
    const uri = pathToFileURL(documentFsPath);
    return {
      documentUri: { scheme: uri.protocol.slice(0, -1), authority: "", path: uri.pathname, query: "", fragment: "" },
      documentFsPath,
      fileSystemPathSemantics: process.platform === "win32" ? "windows" as const : "posix" as const,
      lineCount: text.split(/\r\n|\r|\n/u).length,
      contentHash: stableHash.digest(text)
    } satisfies DocumentEditorReviewDescriptor;
  }));
  try {
    const sessions = await Promise.all(descriptors.map((descriptor) => documentSessionProvider.open(descriptor)));
    const initial = sessions[0]!;
    if (initial.owner !== "git" || sessions.some((session) =>
      session.owner !== "git" ||
      session.contextState.repositoryId !== initial.contextState.repositoryId ||
      session.contextState.contextId !== initial.contextState.contextId ||
      JSON.stringify(session.contextState) !== JSON.stringify(initial.contextState) ||
      JSON.stringify(session.globalState) !== JSON.stringify(initial.globalState)
    )) {
      throw new Error("T609 runner seed requires one unchanged Git production snapshot.");
    }
    const expected = { contextState: initial.contextState, globalState: initial.globalState };
    let contextState: ReviewStateTransaction["next"]["contextState"] = expected.contextState;
    let globalState: ReviewStateTransaction["next"]["globalState"] = expected.globalState;
    let transaction: ReviewStateTransaction | undefined;
    for (const session of sessions) {
      transaction = markReviewedRanges({
        contextState,
        globalState,
        target: session.target,
        intervals: [{ startLine: 0, endLineExclusive: 1 }],
        occurredAt: "2026-08-22T00:00:00.000Z"
      });
      contextState = transaction.next.contextState;
      globalState = transaction.next.globalState;
    }
    if (transaction === undefined) throw new Error("T609 runner seed requires initial sessions.");
    const batchTransaction: ReviewStateTransaction = { ...transaction, expected, next: { contextState, globalState } };
    await initial.committer.commit(batchTransaction);
    await historyRecorder.recordTransaction(batchTransaction, "test-mapping-seed");
  } finally {
    documentSessionProvider.dispose();
    await repository.dispose();
  }
};

const launchTimeout = (): number => {
  const configured = process.env.REVIEW_RANGE_VSCODE_LAUNCH_TIMEOUT_MS;
  if (configured === undefined) return DEFAULT_LAUNCH_TIMEOUT_MS;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 100) {
    throw new RangeError("REVIEW_RANGE_VSCODE_LAUNCH_TIMEOUT_MS must be an integer of at least 100.");
  }
  return value;
};

async function main(): Promise<void> {
  const focusedT306 = process.argv.includes("--t306");
  const focusedT506 = process.argv.includes("--t506");
  const focusedT506SavedPullRequest = process.argv.includes("--t506-saved-pr");
  const focusedT609 = process.argv.includes("--t609");
  const focusedLifecycleRestore = process.argv.includes("--lifecycle-through-restore");
  const projectRoot = resolve(__dirname, "../../..");
  const temporaryDirectory = await createTemporaryDirectory("review-range-vscode");
  const workerPath = join(__dirname, "run-extension-host-launch-worker.js");
  const cleanupWorkerPath = join(__dirname, "run-extension-host-cleanup-worker.js");
  const launchArgsFor = (
    workspacePath: string,
    userDataPath: string,
    extensionsPath: string
  ): string[] => [
    workspacePath,
    "--user-data-dir",
    userDataPath,
    "--extensions-dir",
    extensionsPath,
    "--disable-extensions"
  ];
  const t306Paths = {
    workspace: join(temporaryDirectory.path, "t306-workspace"),
    userData: join(temporaryDirectory.path, "t306-user-data"),
    extensions: join(temporaryDirectory.path, "t306-extensions")
  };
  const t506Paths = {
    workspace: join(temporaryDirectory.path, "t506-workspace"),
    userData: join(temporaryDirectory.path, "t506-user-data"),
    extensions: join(temporaryDirectory.path, "t506-extensions")
  };
  const t506WorkspacePaths = {
    workspace: join(temporaryDirectory.path, "t506-non-git-workspace"),
    userData: join(temporaryDirectory.path, "t506-non-git-user-data"),
    extensions: join(temporaryDirectory.path, "t506-non-git-extensions")
  };
  const t302Paths = {
    workspace: join(temporaryDirectory.path, "t302-workspace"),
    userData: join(temporaryDirectory.path, "t302-user-data"),
    extensions: join(temporaryDirectory.path, "t302-extensions")
  };
  const lifecyclePaths = {
    workspace: join(temporaryDirectory.path, "lifecycle-workspace"),
    userData: join(temporaryDirectory.path, "lifecycle-user-data"),
    extensions: join(temporaryDirectory.path, "lifecycle-extensions")
  };
  const t609Paths = {
    workspace: join(temporaryDirectory.path, "t609-workspace"),
    additionalWorkspace: join(temporaryDirectory.path, "t609-second-root"),
    workspaceFile: join(temporaryDirectory.path, "t609.code-workspace"),
    userData: join(temporaryDirectory.path, "t609-user-data"),
    extensions: join(temporaryDirectory.path, "t609-extensions")
  };
  const launch = async (
    phase: string,
    paths: { readonly workspace: string; readonly userData: string; readonly extensions: string },
    extensionTestsPath: string,
    lifecyclePhase?: string
  ): Promise<void> => {
    const configurationPath = join(temporaryDirectory.path, `${phase}.launch.json`);
    await writeFile(configurationPath, `${JSON.stringify({
      cachePath: join(projectRoot, ".vscode-test"),
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath,
      launchArgs: launchArgsFor(paths.workspace, paths.userData, paths.extensions),
      version: VS_CODE_TEST_VERSION,
      ...(lifecyclePhase === undefined ? {} : { phase: lifecyclePhase })
    })}\n`, "utf8");
    await runOwnedExtensionHostLaunch({
      phase,
      workerPath,
      configurationPath,
      timeoutMs: launchTimeout(),
      diagnosticDirectory: join(projectRoot, "test-output", "vscode-launch-diagnostics"),
      redactPaths: [temporaryDirectory.path, projectRoot, paths.workspace, paths.userData, paths.extensions]
    });
  };

  try {
    await Promise.all([
      ...Object.values(t306Paths),
      ...Object.values(t506Paths),
      ...Object.values(t506WorkspacePaths),
      ...Object.values(t302Paths),
      ...Object.values(lifecyclePaths),
      t609Paths.workspace,
      t609Paths.additionalWorkspace,
      t609Paths.userData,
      t609Paths.extensions
    ].map((path) => mkdir(path)));
    if (focusedT609) {
      await prepareT609Fixture(t609Paths.workspace);
      await prepareT609SecondRoot(t609Paths.additionalWorkspace);
      await prepareT609InitialReviewState(t609Paths.workspace, t609Paths.userData);
      await writeFile(t609Paths.workspaceFile, `${JSON.stringify({
        folders: [
          { path: t609Paths.workspace },
          { path: t609Paths.additionalWorkspace }
        ],
        settings: {
          "files.encoding": "shift_jis",
          "reviewRange.ignoreWhitespaceChanges": true,
          "reviewRange.ignoreEolChanges": true
        }
      })}\n`, "utf8");
    }

    if (focusedT506 || focusedT506SavedPullRequest) {
      if (focusedT506SavedPullRequest) {
        await launch("t506-saved-pr-live-edit", t506Paths, join(__dirname, "t506-suite"), "saved-pr-live-edit");
        await launch("t506-saved-pr-restart", t506Paths, join(__dirname, "t506-suite"), "saved-pr-restart");
        return;
      }
      for (const phase of t506Phases) {
        await launch(`t506-${phase}`, t506Paths, join(__dirname, "t506-suite"), phase);
      }
      for (const phase of t506WorkspacePhases) {
        await launch(
          `t506-${phase}`,
          t506WorkspacePaths,
          join(__dirname, "t506-workspace-suite"),
          phase
        );
      }
      await execFileAsync(
        process.execPath,
        [
          "--test",
          join(__dirname, "../integration/t506-live-edit-concurrency.integration.test.js")
        ],
        { cwd: projectRoot, windowsHide: true }
      );
      return;
    }

    if (focusedT609) {
      const t609SingleRootLaunchPaths = {
        workspace: t609Paths.workspace,
        userData: t609Paths.userData,
        extensions: t609Paths.extensions
      };
      const t609LaunchPaths = {
        workspace: t609Paths.workspaceFile,
        userData: t609Paths.userData,
        extensions: t609Paths.extensions
      };
      for (const phase of t609Phases) {
        if (phase === "prepare") await advanceT609Fixture(t609Paths.workspace);
        await launch(
          `t609-${phase}`,
          phase === "single-root" ? t609SingleRootLaunchPaths : t609LaunchPaths,
          join(__dirname, "t609-suite"),
          phase
        );
      }
      return;
    }

    if (focusedLifecycleRestore) {
      for (const phase of testPhases.slice(0, 2)) {
        await launch(`lifecycle-${phase}`, lifecyclePaths, join(__dirname, "suite"), phase);
      }
      return;
    }

    await launch("t306", t306Paths, join(__dirname, "t306-suite"));

    if (focusedT306) return;

    await launch("t302", t302Paths, join(__dirname, "t302-suite"));

    for (const phase of testPhases) {
      await launch(`lifecycle-${phase}`, lifecyclePaths, join(__dirname, "suite"), phase);
    }
  } finally {
    await cleanupOwnedTemporaryDirectory({
      rootPath: temporaryDirectory.path,
      workerPath: cleanupWorkerPath,
      timeoutMs: FIXTURE_CLEANUP_TIMEOUT_MS,
      diagnosticDirectory: join(projectRoot, "test-output", "vscode-launch-diagnostics"),
      redactPaths: [temporaryDirectory.path, projectRoot]
    });
  }

  if (await pathExists(temporaryDirectory.path)) {
    throw new Error("VS Code test fixture cleanup failed.");
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

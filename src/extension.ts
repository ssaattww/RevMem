import * as vscode from "vscode";
import { randomUUID } from "node:crypto";

import { NodeSha256StableHash } from "./adapters/crypto/index";
import {
  DocumentReviewStateSessionProvider,
  type DocumentEditorReviewDescriptor
} from "./adapters/document-review-state/index";
import type { ReviewStateTransaction } from "./core/review-state/index";
import { ReviewFileExclusionConfigurationController } from "./adapters/file-exclusion/index";
import {
  createNodeLocalGitAdapter
} from "./adapters/local-git/index";
import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  resolveReviewStateStorageRoute
} from "./adapters/state-repository/index";
import { NodeNonGitSnapshotCodec, NodeNonGitSnapshotStorage } from "./adapters/non-git-snapshots/index";
import {
  SnapshotTrackingWorkspaceReviewStateSessionProvider,
  createWorkspaceRootRuntimeRegistry
} from "./adapters/workspace-review-state/index";
import { NonGitSnapshotTracker } from "./application/non-git-snapshots/index";
import { reportActiveStorageLockDiagnostic } from "./application/operation-feedback/index";
import {
  DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES,
  resolveConfiguredNonGitSnapshotLimits
} from "./application/non-git-snapshots/non-git-snapshot-settings";
import {
  createNormalEditorDecorationModelIncrementally,
  type NormalEditorReviewedDecoration
} from "./application/editor-decoration/index";
import { ReviewFileExclusionPolicyService } from "./application/file-exclusion/index";
import {
  NormalEditorReviewCommandService,
  type NormalEditorReviewStateSession
} from "./application/review-commands/index";
import { ReviewHistoryRecorder } from "./application/review-history/index";
import {
  resolveWorkspaceFolderMembership,
  WorkspaceIdentityService
} from "./application/workspace-identity/index";
import type { SelectedReviewContext } from "./application/review-context/index";
import type { RepositoryGlobalState, ReviewContextState } from "./core/contracts/index";
import type { PullRequestDiffSnapshot } from "./core/pr-progress/index";
import type { ReviewStateFileTarget } from "./core/review-state/index";
import {
  DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS,
  ReviewFileExclusionPolicy,
  type ReviewFileExclusionDecision
} from "./core/file-exclusion/index";
import {
  type PullRequestProgressTreeDiffTarget,
  type PullRequestProgressTreeFileNode
} from "./ui/pr-progress/index";
import {
  registerVscodePullRequestProgressTree,
  type VscodePullRequestProgressTreeDataProvider
} from "./ui/pr-progress/vscode-pull-request-progress-tree";
import {
  NormalEditorDecorationController,
  createRefreshingNormalEditorReviewCommandHandlers,
  registerNormalEditorReviewCommands,
  type NormalEditorCommandHost,
  type NormalEditorDecorationHost,
  type NormalEditorDecorationSettings,
  type NormalEditorDecorationWorkBudget
} from "./ui/normal-editor/index";
import { LocalBaseHeadRuntime } from "./t306-local-base-head-runtime";

const MARK_FILE_CONFIRMATION = "確認済みにする";
const UNMARK_FILE_CONFIRMATION = "すべて解除";
const REVIEWED_BACKGROUND_COLOR = "reviewRange.reviewedBackground";
const REVIEWED_OVERVIEW_RULER_COLOR = "reviewRange.reviewedOverviewRuler";
const DECORATION_CONFIGURATION_KEYS = [
  "reviewRange.showGlobalReviewed",
  "reviewRange.showGutterIcon",
  "reviewRange.showOverviewRuler"
] as const;
const FILESYSTEM_SCHEMES = new Set(["file", "vscode-remote"]);
const DECORATION_WORK_BUDGET: NormalEditorDecorationWorkBudget = Object.freeze({
  maxDecorationsPerStage: 128,
  yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0))
});
const HASH_CHARACTERS_PER_STAGE = 65_536;
const DOCUMENT_LINES_PER_STAGE = 128;

const workspaceSidePathSemantics = () =>
  process.platform === "win32" ? "windows" as const : "posix" as const;

/** Exact activation helper for bounded document extraction plus canonical hashing. */
export const hashNormalEditorDocumentIncrementally = async (
  input: {
    readonly lineCount: number;
    readonly lineAt: (line: number) => string;
    readonly eol: string;
    readonly isCurrent: () => boolean;
    readonly yieldControl: () => void | Promise<void>;
    readonly accountWorkBatch?: (entry: Readonly<{ kind: string; count: number }>) => void;
  },
  stableHash: Pick<NodeSha256StableHash, "digestFragmentsCooperatively">
): Promise<string | undefined> => {
  const fragments = async function* (): AsyncIterable<string> {
    for (let line = 0; line < input.lineCount; line += 1) {
      if (!input.isCurrent()) return;
      yield input.lineAt(line);
      if (line + 1 < input.lineCount) yield input.eol;
      if ((line + 1) % DOCUMENT_LINES_PER_STAGE === 0) {
        input.accountWorkBatch?.({ kind: "extracted-document-line", count: DOCUMENT_LINES_PER_STAGE });
        await input.yieldControl();
        if (!input.isCurrent()) return;
      }
    }
  };
  return await stableHash.digestFragmentsCooperatively(
    fragments(), HASH_CHARACTERS_PER_STAGE, input.yieldControl, input.isCurrent
  );
};

type ReviewDiffEditorCommandOperation =
  | "markSelectionReviewed"
  | "unmarkSelectionReviewed"
  | "markFileReviewed"
  | "unmarkFileReviewed";

/** Additional owner of canonical `review-range-diff` documents and commands. */
export interface ReviewDiffRuntimePort {
  ownsDocumentUri(uri: string): boolean;
  provideTextDocumentContent(uri: vscode.Uri): string | Promise<string>;
  invokeCommand(
    operation: ReviewDiffEditorCommandOperation,
    editor: vscode.TextEditor
  ): Promise<unknown>;
}

interface ReviewedIntervalSnapshot {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

interface FileExclusionPolicySnapshot {
  readonly revision: number;
  readonly userGlobs: readonly string[];
}

/** Production runtime boundary shared with Current Context composition. */
export interface ReviewRangeRuntimePort {
  /** 同一Extension Hostで共有するReview Stateのserialization owner。 */
  readonly reviewStateRepository: DebouncedReviewStateRepository;
  /** 同一Extension Hostで共有するReview Historyのserialization owner。 */
  readonly reviewHistoryRecorder: ReviewHistoryRecorder;
  /** Applies an explicit Current Context identity to commands and decorations. */
  setSelectedContext(selection: SelectedReviewContext | undefined): void;
  /** Applies the immutable current-PR diff used by normal-editor decoration evidence. */
  setCurrentPullRequestDiff(snapshot: Readonly<PullRequestDiffSnapshot> | undefined): void;
  /** Re-renders visible editors after a selected-context change. */
  refreshVisibleEditorDecorations(): Promise<void>;
  /** Subscribes UI projections that must be recalculated after review-state commands. */
  onDidChangeReviewState(listener: () => void): vscode.Disposable;
  /** Registers another canonical review-diff owner without registering a second URI scheme provider. */
  registerReviewDiffRuntime(runtime: ReviewDiffRuntimePort): vscode.Disposable;
}

interface ReviewRangeExtensionTestApi extends ReviewRangeRuntimePort {
  refreshVisibleEditorDecorations(): Promise<void>;
  drainVisibleEditorDecorations(): Promise<void>;
  /** Test-only direct path that preserves normal-editor command failures for Host diagnostics. */
  markNormalEditorSelectionForTest(editor: vscode.TextEditor): Promise<unknown>;
  /** Last public normal-editor command failure captured before headless UI presentation. */
  getNormalEditorCommandFailureForTest(): {
    readonly operation: string;
    readonly message: string;
  } | undefined;
  /** Test-only read-only snapshot of this Extension Host's observed document encoding hints. */
  getObservedEncodingHintsForTest(): readonly {
    readonly documentFsPath: string;
    readonly encodingHint?: string;
  }[];
  getVisibleReviewedIntervals(documentUri: string): readonly ReviewedIntervalSnapshot[];
  getFileExclusionPolicySnapshot(): FileExclusionPolicySnapshot;
  evaluateFileExclusion(path: string, isBinary?: boolean): ReviewFileExclusionDecision;
  initializeLocalBaseHeadRuntime(input: {
    readonly baseSha: string;
    readonly headSha: string;
  }): Promise<void>;
  getLocalBaseHeadTree(): {
    readonly reviewedLineCount: number;
    readonly totalLineCount: number;
    readonly files: readonly ({
      readonly path: string;
      readonly category: string;
      readonly reason?: string;
      readonly reviewedLineCount: number;
      readonly totalLineCount: number;
      readonly node: PullRequestProgressTreeFileNode;
    })[];
  };
  getLocalBaseHeadOpenedDiffs(): readonly {
    readonly original: string;
    readonly modified: string;
  }[];
  getLocalBaseHeadOpenedFiles(): readonly string[];
  getLocalBaseHeadPersistence(): ReturnType<LocalBaseHeadRuntime<vscode.Uri>["getPersistence"]>;
  setLocalBaseHeadConfirmationAnswer(answer: boolean): void;
}

interface ActiveExtensionRuntime {
  readonly persistence: DebouncedReviewStateRepository;
  readonly documentSessionProvider: DocumentReviewStateSessionProvider;
  readonly decorationController: NormalEditorDecorationController<
    vscode.TextEditor,
    vscode.TextEditorDecorationType
  >;
  readonly fileExclusionConfigurationController: ReviewFileExclusionConfigurationController;
}

let activeRuntime: ActiveExtensionRuntime | undefined;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isActiveDiffEditor = (): boolean =>
  vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof
  vscode.TabInputTextDiff;

const isVisibleDiffEditor = (editor: vscode.TextEditor): boolean => {
  const documentUri = editor.document.uri.toString();
  return !vscode.window.tabGroups.all.some((group) => {
    const input = group.activeTab?.input;
    return input instanceof vscode.TabInputText && input.uri.toString() === documentUri;
  });
};

const toResourceUri = (uri: vscode.Uri) => ({
  scheme: uri.scheme,
  authority: uri.authority,
  path: uri.path,
  query: uri.query,
  fragment: uri.fragment
});

const readDecorationSettings = (): NormalEditorDecorationSettings => {
  const configuration = vscode.workspace.getConfiguration("reviewRange");
  return {
    showGlobalReviewed: configuration.get("showGlobalReviewed", true),
    showGutterIcon: configuration.get("showGutterIcon", true),
    showOverviewRuler: configuration.get("showOverviewRuler", false)
  };
};

const createHoverMessage = (
  decoration: NormalEditorReviewedDecoration
): vscode.MarkdownString => {
  const hover = new vscode.MarkdownString(undefined, true);
  hover.isTrusted = false;
  hover.supportHtml = false;
  hover.appendMarkdown("**確認済み**  \n");
  hover.appendText(`Context: ${decoration.contextLabel}`);
  hover.appendMarkdown("  \n");
  hover.appendText(`Reviewed at: ${decoration.reviewedAt}`);
  hover.appendMarkdown("  \n");
  hover.appendText(`Global: ${decoration.globalActive ? "active" : "inactive"}`);
  return hover;
};

const toDecorationOptions = async (
  editor: vscode.TextEditor,
  decorations: readonly NormalEditorReviewedDecoration[],
  context: { readonly signal: AbortSignal; readonly isCurrent: () => boolean },
  workBudget: NormalEditorDecorationWorkBudget = DECORATION_WORK_BUDGET
): Promise<vscode.DecorationOptions[] | undefined> => {
  const options: vscode.DecorationOptions[] = [];
  for (let index = 0; index < decorations.length; index += 1) {
    if (context.signal.aborted || !context.isCurrent()) return undefined;
    const decoration = decorations[index]!;
    const lastLine = decoration.interval.endLineExclusive - 1;
    options.push({ range: new vscode.Range(new vscode.Position(decoration.interval.startLine, 0), editor.document.lineAt(lastLine).range.end), hoverMessage: createHoverMessage(decoration) });
    if ((index + 1) % workBudget.maxDecorationsPerStage === 0) {
      workBudget.accountWorkBatch?.({ kind: "projected-decoration-option", count: workBudget.maxDecorationsPerStage });
      await workBudget.yieldControl();
    }
  }
  return context.signal.aborted || !context.isCurrent() ? undefined : options;
};

/** Small activation seam: the same descriptor → state → cooperative model path used by VS Code. */
export interface NormalEditorDecorationActivationComposition<Editor, Descriptor> {
  readonly toDocumentDescriptor: (editor: Editor, isCurrent: () => boolean) => Promise<Descriptor | undefined>;
  readonly loadForDecoration: (descriptor: Descriptor, context: SelectedReviewContext | undefined) => Promise<{
    readonly contextState: ReviewContextState;
    readonly globalState: RepositoryGlobalState;
    readonly target: ReviewStateFileTarget;
    readonly currentPullRequestDiff?: Readonly<PullRequestDiffSnapshot>;
  } | undefined>;
  readonly selectedContext: () => SelectedReviewContext | undefined;
  readonly workBudget: NormalEditorDecorationWorkBudget;
}

export const createNormalEditorDecorationLoadHandler = <Editor, Descriptor>(
  composition: NormalEditorDecorationActivationComposition<Editor, Descriptor>
) => async (
  editor: Editor,
  showGlobalReviewed: boolean,
  loadContext: { readonly signal: AbortSignal; readonly isCurrent: () => boolean }
): Promise<readonly NormalEditorReviewedDecoration[]> => {
  if (!loadContext.isCurrent() || loadContext.signal.aborted) return [];
  const descriptor = await composition.toDocumentDescriptor(editor, () => loadContext.isCurrent() && !loadContext.signal.aborted);
  if (descriptor === undefined || !loadContext.isCurrent() || loadContext.signal.aborted) return [];
  const session = await composition.loadForDecoration(descriptor, composition.selectedContext());
  if (session === undefined || !loadContext.isCurrent() || loadContext.signal.aborted) return [];
  const model = await createNormalEditorDecorationModelIncrementally({
    contextState: session.contextState,
    globalState: session.globalState,
    target: session.target,
    ...(session.currentPullRequestDiff === undefined ? {} : { currentPullRequestDiff: session.currentPullRequestDiff }),
    showGlobalReviewed
  }, {
    maxWorkItems: composition.workBudget.maxDecorationsPerStage,
    yieldControl: composition.workBudget.yieldControl,
    accountWorkBatch: composition.workBudget.accountWorkBatch,
    isCurrent: () => loadContext.isCurrent() && !loadContext.signal.aborted
  });
  return model === undefined || !loadContext.isCurrent() || loadContext.signal.aborted ? [] : model;
};

/**
 * Creates the exact normal-editor decoration composition installed by activate().
 * Keeping this narrow factory separate lets the activation path retain its real
 * VS Code descriptor, state-provider, options, bookkeeping, and host-apply
 * boundaries while tests double only the VS Code host.
 */
export const createNormalEditorDecorationActivation = (dependencies: {
  readonly context: Pick<vscode.ExtensionContext, "extensionUri">;
  readonly documentSessionProvider: Pick<DocumentReviewStateSessionProvider, "loadForDecoration">;
  readonly selectedContext: () => SelectedReviewContext | undefined;
  readonly currentPullRequestDiff?: () => Readonly<PullRequestDiffSnapshot> | undefined;
  readonly reportError: (error: unknown) => void | Promise<void>;
  readonly workBudget?: NormalEditorDecorationWorkBudget;
}): {
  readonly controller: NormalEditorDecorationController<vscode.TextEditor, vscode.TextEditorDecorationType>;
  readonly toDocumentDescriptor: (editor: vscode.TextEditor, isCurrent?: () => boolean) => Promise<DocumentEditorReviewDescriptor | undefined>;
  /** Test-mode runtime query shares the production host bookkeeping ownership. */
  readonly appliedDecorations: ReadonlyMap<vscode.TextEditor, readonly NormalEditorReviewedDecoration[]>;
} => {
  const workBudget = dependencies.workBudget ?? DECORATION_WORK_BUDGET;
  const appliedDecorations = new Map<vscode.TextEditor, readonly NormalEditorReviewedDecoration[]>();
  const toDocumentDescriptor = async (
    editor: vscode.TextEditor,
    isCurrent: () => boolean = () => true
  ): Promise<DocumentEditorReviewDescriptor | undefined> => {
    const document = editor.document;
    const documentUri = document.uri;
    const version = document.version;
    const lineCount = document.lineCount;
    const stillCurrent = (): boolean => isCurrent() && editor.document === document && document.version === version;
    if (!FILESYSTEM_SCHEMES.has(documentUri.scheme)) {
      throw new Error("ローカルまたはRemoteの通常ファイルを開いてください。");
    }
    const membership = resolveWorkspaceFolderMembership({
      documentUri: toResourceUri(documentUri),
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        uri: toResourceUri(folder.uri), name: folder.name
      })),
      fileSystemPathSemantics: workspaceSidePathSemantics()
    });
    const workspace = membership === undefined
      ? undefined
      : {
          workspaceFolderUri: membership.workspaceFolder.uri,
          relativePath: membership.relativePath,
          displayName: membership.workspaceFolder.name
        };
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const contentHash = await hashNormalEditorDocumentIncrementally({
      lineCount,
      lineAt: (line) => document.lineAt(line).text,
      eol,
      isCurrent: stillCurrent,
      yieldControl: workBudget.yieldControl,
      accountWorkBatch: workBudget.accountWorkBatch
    }, new NodeSha256StableHash());
    if (contentHash === undefined || !stillCurrent()) return undefined;
    return {
      documentUri: toResourceUri(documentUri),
      documentFsPath: documentUri.fsPath,
      fileSystemPathSemantics: workspaceSidePathSemantics(),
      ...(workspace === undefined ? {} : { workspace }),
      lineCount,
      contentHash,
      ...(document.encoding.length === 0 ? {} : { encodingHint: document.encoding })
    };
  };
  const invokeListener = (listener: () => void | Promise<void>): void => {
    void Promise.resolve(listener()).catch(dependencies.reportError);
  };
  const loadDecorations = createNormalEditorDecorationLoadHandler({
    toDocumentDescriptor,
    loadForDecoration: async (descriptor, selected) => {
      const session = await dependencies.documentSessionProvider.loadForDecoration(descriptor, selected);
      const currentPullRequestDiff = dependencies.currentPullRequestDiff?.();
      return session === undefined ? undefined : {
        ...session,
        ...(currentPullRequestDiff === undefined
          ? {}
          : { currentPullRequestDiff })
      };
    },
    selectedContext: dependencies.selectedContext,
    workBudget
  });
  const host: NormalEditorDecorationHost<vscode.TextEditor, vscode.TextEditorDecorationType> = {
    getVisibleEditors: () => vscode.window.visibleTextEditors,
    isDiffEditor: (editor) => isVisibleDiffEditor(editor),
    getSettings: () => readDecorationSettings(),
    loadDecorations: async (editor, showGlobalReviewed, loadContext) =>
      FILESYSTEM_SCHEMES.has(editor.document.uri.scheme)
        ? loadDecorations(editor, showGlobalReviewed, loadContext)
        : [],
    createDecorationType: (settings) => {
      const options: vscode.DecorationRenderOptions = {
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor(REVIEWED_BACKGROUND_COLOR),
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
      };
      if (settings.showGutterIcon) {
        options.gutterIconPath = vscode.Uri.joinPath(dependencies.context.extensionUri, "media", "reviewed-gutter.svg");
        options.gutterIconSize = "contain";
      }
      if (settings.showOverviewRuler) {
        options.overviewRulerColor = new vscode.ThemeColor(REVIEWED_OVERVIEW_RULER_COLOR);
        options.overviewRulerLane = vscode.OverviewRulerLane.Right;
      }
      return vscode.window.createTextEditorDecorationType(options);
    },
    setDecorations: async (editor, decorationType, decorations, loadContext) => {
      const options = await toDecorationOptions(editor, decorations, loadContext, workBudget);
      if (options === undefined || loadContext.signal.aborted || !loadContext.isCurrent()) return;
      const applied: NormalEditorReviewedDecoration[] = [];
      for (let index = 0; index < decorations.length; index += 1) {
        if (loadContext.signal.aborted || !loadContext.isCurrent()) return;
        const decoration = decorations[index]!;
        applied.push({ ...decoration, interval: { ...decoration.interval } });
        if ((index + 1) % workBudget.maxDecorationsPerStage === 0) {
          workBudget.accountWorkBatch?.({ kind: "copied-applied-decoration", count: workBudget.maxDecorationsPerStage });
          await workBudget.yieldControl();
        }
      }
      if (loadContext.signal.aborted || !loadContext.isCurrent()) return;
      appliedDecorations.set(editor, applied);
      editor.setDecorations(decorationType, options);
    },
    onDidChangeVisibleEditors: (listener) => vscode.window.onDidChangeVisibleTextEditors(() => {
      for (const editor of appliedDecorations.keys()) {
        if (!vscode.window.visibleTextEditors.includes(editor)) appliedDecorations.delete(editor);
      }
      invokeListener(listener);
    }),
    onDidChangeActiveEditor: (listener) => vscode.window.onDidChangeActiveTextEditor(() => invokeListener(listener)),
    onDidChangeSettings: (listener) => vscode.workspace.onDidChangeConfiguration((event) => {
      if (DECORATION_CONFIGURATION_KEYS.some((key) => event.affectsConfiguration(key))) invokeListener(listener);
    }),
    onDidChangeDocument: (listener) => vscode.workspace.onDidChangeTextDocument((event) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === event.document) invokeListener(() => listener(editor));
      }
    }),
    showDecorationError: (error) => dependencies.reportError(error)
  };
  return {
    controller: new NormalEditorDecorationController(host, workBudget),
    toDocumentDescriptor,
    appliedDecorations
  };
};

/**
 * Shared command activation seam. It carries one immutable document generation
 * from descriptor acquisition through state I/O and the atomic commit boundary.
 */
export interface NormalEditorReviewCommandSessionComposition<Editor, Descriptor, Generation> {
  readonly captureGeneration: (editor: Editor) => Generation;
  readonly isCurrentGeneration: (editor: Editor, generation: Generation) => boolean;
  readonly toDocumentDescriptor: (editor: Editor) => Promise<Descriptor | undefined>;
  readonly openSession: (
    descriptor: Descriptor,
    selectedContext: SelectedReviewContext | undefined
  ) => Promise<NormalEditorReviewStateSession>;
  readonly selectedContext: () => SelectedReviewContext | undefined;
}

export const createNormalEditorReviewCommandSessionLoader = <Editor, Descriptor, Generation>(
  composition: NormalEditorReviewCommandSessionComposition<Editor, Descriptor, Generation>
) => async (editor: Editor): Promise<NormalEditorReviewStateSession> => {
  const generation = composition.captureGeneration(editor);
  const isCurrent = (): boolean => composition.isCurrentGeneration(editor, generation);
  const descriptor = await composition.toDocumentDescriptor(editor);
  if (descriptor === undefined || !isCurrent()) throw new Error("Document review command was superseded.");
  const session = await composition.openSession(descriptor, composition.selectedContext());
  if (!isCurrent()) throw new Error("Document review command was superseded.");
  return {
    ...session,
    isCurrent,
    committer: {
      commit: async (transaction: Readonly<ReviewStateTransaction>) => {
        if (!isCurrent()) throw new Error("Document review command was superseded.");
        await session.committer.commit(transaction);
      }
    }
  };
};

const uniqueVisibleIntervals = (
  documentUri: string,
  appliedDecorations: ReadonlyMap<
    vscode.TextEditor,
    readonly NormalEditorReviewedDecoration[]
  >
): readonly ReviewedIntervalSnapshot[] => {
  const intervals = new Map<string, ReviewedIntervalSnapshot>();

  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() !== documentUri) {
      continue;
    }
    for (const decoration of appliedDecorations.get(editor) ?? []) {
      const interval = {
        startLine: decoration.interval.startLine,
        endLineExclusive: decoration.interval.endLineExclusive
      };
      intervals.set(
        `${interval.startLine}:${interval.endLineExclusive}`,
        interval
      );
    }
  }

  return [...intervals.values()].sort(
    (left, right) =>
      left.startLine - right.startLine ||
      left.endLineExclusive - right.endLineExclusive
  );
};

/** Activates the Review Range Tracker extension. */
export function activate(
  context: vscode.ExtensionContext
): ReviewRangeRuntimePort | ReviewRangeExtensionTestApi {
  const reviewStateChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(reviewStateChanged);
  const additionalReviewDiffRuntimes = new Set<ReviewDiffRuntimePort>();
  const matchingAdditionalReviewDiffRuntime = (
    uri: string
  ): ReviewDiffRuntimePort | undefined =>
    [...additionalReviewDiffRuntimes].find((runtime) => runtime.ownsDocumentUri(uri));
  const stableHash = new NodeSha256StableHash();
  const fileExclusionPolicyService = new ReviewFileExclusionPolicyService();
  const fileExclusionConfigurationController =
    new ReviewFileExclusionConfigurationController({
      service: fileExclusionPolicyService,
      host: {
        readExcludeGlobs: () => [
          ...vscode.workspace.getConfiguration("reviewRange").get<readonly string[]>(
            "exclude",
            DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS
          )
        ],
        onDidChangeConfiguration: (listener) =>
          vscode.workspace.onDidChangeConfiguration((event) => {
            listener({
              affectsExcludeConfiguration: event.affectsConfiguration(
                "reviewRange.exclude"
              )
            });
          }),
        showConfigurationError: (error) => {
          void vscode.window.showErrorMessage(
            `除外設定を適用できませんでした: ${errorMessage(error)}`
          );
        }
      }
    });
  fileExclusionConfigurationController.start();
  const reportStorageLockDiagnostic = (diagnostic: { readonly kind: "timeout" | "failure" | "stale-recovered"; readonly operationId: string }): void => {
    reportActiveStorageLockDiagnostic(diagnostic);
  };

  const atomicRepository = new FileSystemReviewStateRepository({
    storageUris: {
      globalStorageUri: context.globalStorageUri,
      storageUri: context.storageUri
    },
    notifyStorageLockDiagnostic: reportStorageLockDiagnostic
  });
  const repository = new DebouncedReviewStateRepository({
    delegate: atomicRepository
  });
  const historyRecorder = new ReviewHistoryRecorder({
    sessionId: randomUUID(),
    createEventId: randomUUID,
    appender: new JsonlReviewHistoryStore({
      storageUris: {
        globalStorageUri: context.globalStorageUri,
        storageUri: context.storageUri
      },
      notifyStorageLockDiagnostic: reportStorageLockDiagnostic
    })
  });
  const workspaceStorageUris = {
    globalStorageUri: context.globalStorageUri,
    storageUri: context.storageUri
  };
  const workspaceIdentityService = new WorkspaceIdentityService(stableHash);
  const gitHistoryRewriteSnapshotTracker = new NonGitSnapshotTracker(
    new NodeNonGitSnapshotStorage({
      snapshotDirectory: resolveReviewStateStorageRoute(workspaceStorageUris, {
        kind: "workspace",
        repositoryId: "git-history-rewrite",
        contextId: "git-history-rewrite"
      }).snapshotDirectory,
      notifyStorageLockDiagnostic: reportStorageLockDiagnostic
    }),
    new NodeNonGitSnapshotCodec(),
    resolveConfiguredNonGitSnapshotLimits({
      maxSnapshotFileSizeBytes: vscode.workspace
        .getConfiguration("reviewRange")
        .get<number>("maxSnapshotFileSizeBytes", DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES)
    })
  );
  const workspaceSessionProvider = createWorkspaceRootRuntimeRegistry({
    identityService: workspaceIdentityService,
    historyRewriteSnapshotTracker: gitHistoryRewriteSnapshotTracker,
    factory: {
      create: (identity) => new SnapshotTrackingWorkspaceReviewStateSessionProvider({
        identityService: workspaceIdentityService,
        repository,
        historyRecorder,
        snapshotTracker: new NonGitSnapshotTracker(
          new NodeNonGitSnapshotStorage({
            snapshotDirectory: resolveReviewStateStorageRoute(workspaceStorageUris, {
              kind: "workspace",
              repositoryId: identity.repositoryId,
              contextId: identity.workspaceContextId
            }).snapshotDirectory,
            notifyStorageLockDiagnostic: reportStorageLockDiagnostic
          }),
          new NodeNonGitSnapshotCodec(),
          resolveConfiguredNonGitSnapshotLimits({
            maxSnapshotFileSizeBytes: vscode.workspace
              .getConfiguration("reviewRange")
              .get<number>("maxSnapshotFileSizeBytes", DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES)
          })
        ),
        resolveContent: (descriptor) => {
          const resource = descriptor.documentUri;
          return vscode.workspace.textDocuments.find((document) =>
            document.uri.scheme === resource.scheme && document.uri.authority === resource.authority && document.uri.path === resource.path
          )?.getText() ?? "";
        }
      })
    }
  });
  workspaceSessionProvider.reconcileWorkspaceRoots(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => toResourceUri(folder.uri)),
    workspaceSidePathSemantics()
  );
  context.subscriptions.push({ dispose: () => workspaceSessionProvider.dispose() });
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    workspaceSessionProvider.reconcileWorkspaceRoots(
      (vscode.workspace.workspaceFolders ?? []).map((folder) => toResourceUri(folder.uri)),
      workspaceSidePathSemantics()
    );
  }));
  const documentSessionProvider = new DocumentReviewStateSessionProvider({
    gitInspector: createNodeLocalGitAdapter({
      decodeWithHint: async (bytes, encoding) => vscode.workspace.decode(bytes, { encoding })
    }),
    repository,
    workspaceProvider: workspaceSessionProvider,
    stableHash,
    historyRecorder
  });
  let selectedContext: SelectedReviewContext | undefined;
  let currentPullRequestDiff: Readonly<PullRequestDiffSnapshot> | undefined;
  const reportDecorationError = async (error: unknown): Promise<void> => {
    await vscode.window.showErrorMessage(
      `確認済み装飾を更新できませんでした: ${errorMessage(error)}`
    );
  };
  const decorationActivation = createNormalEditorDecorationActivation({
    context,
    documentSessionProvider,
    selectedContext: () => selectedContext,
    currentPullRequestDiff: () => currentPullRequestDiff,
    reportError: reportDecorationError
  });
  const { toDocumentDescriptor, controller: decorationController, appliedDecorations } = decorationActivation;
  const openDocumentSession = createNormalEditorReviewCommandSessionLoader({
    captureGeneration: (editor: vscode.TextEditor) => ({ document: editor.document, version: editor.document.version }),
    isCurrentGeneration: (editor, generation) => editor.document === generation.document && editor.document.version === generation.version,
    toDocumentDescriptor,
    openSession: (descriptor, selected) => documentSessionProvider.open(descriptor, selected),
    selectedContext: () => selectedContext
  });
  const commandService = new NormalEditorReviewCommandService<vscode.TextEditor>({
    getLineCount: (editor) => editor.document.lineCount,
    getSelections: (editor) =>
      editor.selections.map((selection) => ({
        anchor: {
          line: selection.anchor.line,
          character: selection.anchor.character
        },
        active: {
          line: selection.active.line,
          character: selection.active.character
        }
      })),
    openSession: (editor) => openDocumentSession(editor),
    confirmWholeFileOperation: async (operation) => {
      if (operation === "mark-file-reviewed") {
        const result = await vscode.window.showWarningMessage(
          "このファイルの全行を確認済みにします。",
          { modal: true },
          MARK_FILE_CONFIRMATION
        );
        return result === MARK_FILE_CONFIRMATION;
      }

      const result = await vscode.window.showWarningMessage(
        "このファイルのすべての確認済み状態を解除します。",
        {
          modal: true,
          detail: "Global確認済み状態も解除されます。"
        },
        UNMARK_FILE_CONFIRMATION
      );
      return result === UNMARK_FILE_CONFIRMATION;
    },
    requestHistory: (transaction) => historyRecorder.recordTransaction(
      transaction,
      transaction.operation === "mark-ranges-reviewed" ||
        transaction.operation === "unmark-ranges-reviewed"
        ? "user-selection"
        : "user-file"
    )
  });
  const localBaseHeadCommandServiceReference: {
    current: {
      markSelectionReviewed(editor: vscode.TextEditor): Promise<unknown>;
      unmarkSelectionReviewed(editor: vscode.TextEditor): Promise<unknown>;
      markFileReviewed(editor: vscode.TextEditor): Promise<unknown>;
      unmarkFileReviewed(editor: vscode.TextEditor): Promise<unknown>;
    } | undefined;
  } = { current: undefined };
  let normalEditorCommandFailureForTest: {
    readonly operation: string;
    readonly message: string;
  } | undefined;
  const localBaseHeadTreeReference: {
    current: VscodePullRequestProgressTreeDataProvider | undefined;
  } = { current: undefined };
  let localBaseHeadConfirmationAnswer: boolean | undefined;
  const host: NormalEditorCommandHost<vscode.TextEditor> = {
    getActiveEditor: () => vscode.window.activeTextEditor,
    isDiffEditor: (editor) =>
      isActiveDiffEditor() || editor.document.uri.scheme === "review-range-diff",
    invokeDiffEditorCommand: async (operation, editor) => {
      const documentUri = editor.document.uri.toString(true);
      const additional = matchingAdditionalReviewDiffRuntime(documentUri);
      if (additional !== undefined) {
        const result = await additional.invokeCommand(operation, editor);
        if (result === "applied") reviewStateChanged.fire();
        return result;
      }
      const service = localBaseHeadCommandServiceReference.current;
      if (service === undefined || editor.document.uri.scheme !== "review-range-diff") {
        throw new Error("Review Range diff editor is not available.");
      }
      const result = await service[operation](editor);
      if (result === "applied") {
        localBaseHeadTreeReference.current?.refresh();
        reviewStateChanged.fire();
      }
      return result;
    },
    registerCommand: (commandId, handler) =>
      vscode.commands.registerCommand(commandId, handler),
    showNormalEditorRequired: async () => {
      await vscode.window.showWarningMessage(
        "通常エディタでローカルまたはRemoteのファイルを開いてください。"
      );
    },
    showCommandError: async (error) => {
      await vscode.window.showErrorMessage(
        `レビュー状態を更新できませんでした: ${errorMessage(error)}`
      );
    },
    ...(context.extensionMode === vscode.ExtensionMode.Test ? {
      captureCommandOperationErrorForTest: (operation: string, error: unknown) => {
        normalEditorCommandFailureForTest = {
          operation,
          message: errorMessage(error)
        };
      }
    } : {})
  };
  const registrations = registerNormalEditorReviewCommands(
    host,
    createRefreshingNormalEditorReviewCommandHandlers(
      {
        markSelectionReviewed: async (editor) => {
          const result = await commandService.markSelectionReviewed(editor);
          if (result === "applied") reviewStateChanged.fire();
          return result;
        },
        unmarkSelectionReviewed: async (editor) => {
          const result = await commandService.unmarkSelectionReviewed(editor);
          if (result === "applied") reviewStateChanged.fire();
          return result;
        },
        markFileReviewed: async (editor) => {
          const result = await commandService.markFileReviewed(editor);
          if (result === "applied") reviewStateChanged.fire();
          return result;
        },
        unmarkFileReviewed: async (editor) => {
          const result = await commandService.unmarkFileReviewed(editor);
          if (result === "applied") reviewStateChanged.fire();
          return result;
        }
      },
      decorationController
    )
  );
  context.subscriptions.push(
    fileExclusionConfigurationController,
    documentSessionProvider,
    decorationController,
    ...registrations
  );
  activeRuntime = {
    persistence: repository,
    documentSessionProvider,
    decorationController,
    fileExclusionConfigurationController
  };
  void decorationController.start().catch(reportDecorationError);

  const runtimePort: ReviewRangeRuntimePort = {
    reviewStateRepository: repository,
    reviewHistoryRecorder: historyRecorder,
    setSelectedContext: (selection) => {
      selectedContext = selection;
    },
    setCurrentPullRequestDiff: (snapshot) => {
      currentPullRequestDiff = snapshot;
    },
    refreshVisibleEditorDecorations: () =>
      decorationController.refreshVisibleEditors(),
    onDidChangeReviewState: (listener) =>
      reviewStateChanged.event(listener),
    registerReviewDiffRuntime: (runtime) => {
      additionalReviewDiffRuntimes.add(runtime);
      return new vscode.Disposable(() => additionalReviewDiffRuntimes.delete(runtime));
    }
  };

  const localBaseHeadRuntimeReference: {
    current: LocalBaseHeadRuntime<vscode.Uri> | undefined;
  } = { current: undefined };
  const openedLocalBaseHeadDiffs: {
    original: string;
    modified: string;
  }[] = [];
  const openedLocalBaseHeadFiles: string[] = [];
  const openLocalBaseHeadDiff = async (
    target: PullRequestProgressTreeDiffTarget
  ): Promise<void> => {
    const runtime = localBaseHeadRuntimeReference.current;
    if (runtime === undefined) {
      throw new Error("Local base/head runtime is not available.");
    }
    await runtime.diffController.openReviewDiff({
      contextId: target.contextId,
      fileSystemPathSemantics: target.fileSystemPathSemantics,
      original: target.original,
      modified: target.modified,
      title: target.file.path
    });
  };
  const openLocalBaseHeadFile = async (
    target: PullRequestProgressTreeDiffTarget
  ): Promise<void> => {
    const runtime = localBaseHeadRuntimeReference.current;
    if (runtime === undefined) {
      throw new Error("Local base/head runtime is not available.");
    }
    const uri = vscode.Uri.parse(runtime.createPresentFileDocumentUri(target), true);
    await vscode.commands.executeCommand("vscode.open", uri);
    openedLocalBaseHeadFiles.push(uri.toString(true));
  };
  const localBaseHeadRuntime = new LocalBaseHeadRuntime<vscode.Uri>({
    repository,
    historyRecorder,
    diffHost: {
      parseUri: (value) => vscode.Uri.parse(value, true),
      openDiff: async (original, modified, title) => {
        await vscode.commands.executeCommand(
          "vscode.diff",
          original,
          modified,
          title
        );
        openedLocalBaseHeadDiffs.push({
          original: original.toString(true),
          modified: modified.toString(true)
        });
      }
    },
    progressHost: {
      openDiff: openLocalBaseHeadDiff,
      openFile: openLocalBaseHeadFile
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({
      userGlobs: fileExclusionPolicyService.getUserGlobs()
    })
  });
  localBaseHeadRuntimeReference.current = localBaseHeadRuntime;
  const localBaseHeadCommandService = localBaseHeadRuntime.createCommandService<vscode.TextEditor>({
    getSide: (editor) => localBaseHeadRuntime.sideForDiffDocumentUri(
      editor.document.uri.toString(true)
    ),
    getLineCount: (editor) => editor.document.lineCount,
    getSelections: (editor) => editor.selections.map((selection) => ({
      anchor: {
        line: selection.anchor.line,
        character: selection.anchor.character
      },
      active: {
        line: selection.active.line,
        character: selection.active.character
      }
    })),
    fileIdFor: (editor) => localBaseHeadRuntime.fileIdForDiffDocumentUri(
      editor.document.uri.toString(true)
    ),
    confirmWholeFileOperation: async (operation) => {
      if (context.extensionMode === vscode.ExtensionMode.Test &&
        localBaseHeadConfirmationAnswer !== undefined) {
        return localBaseHeadConfirmationAnswer;
      }
      if (operation === "mark-file-reviewed") {
        const result = await vscode.window.showWarningMessage(
          "このファイルの全行を確認済みにします。",
          { modal: true },
          MARK_FILE_CONFIRMATION
        );
        return result === MARK_FILE_CONFIRMATION;
      }
      const result = await vscode.window.showWarningMessage(
        "このファイルのすべての確認済み状態を解除します。",
        { modal: true, detail: "Global確認済み状態も解除されます。" },
        UNMARK_FILE_CONFIRMATION
      );
      return result === UNMARK_FILE_CONFIRMATION;
    }
  });
  localBaseHeadCommandServiceReference.current = localBaseHeadCommandService;
  localBaseHeadTreeReference.current = registerVscodePullRequestProgressTree(
    context,
    localBaseHeadRuntime.progress,
    async (error) => {
      await vscode.window.showErrorMessage(
        `PR Progressを開けませんでした: ${errorMessage(error)}`
      );
    }
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "review-range-diff",
      {
        provideTextDocumentContent: (uri) => {
          const additional = matchingAdditionalReviewDiffRuntime(uri.toString(true));
          return additional === undefined
            ? localBaseHeadRuntime.documentContentProvider.provideTextDocumentContent(uri)
            : additional.provideTextDocumentContent(uri);
        }
      }
    )
  );

  const initializeLocalBaseHeadRuntime = async (
    input: { readonly baseSha: string; readonly headSha: string }
  ): Promise<void> => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder === undefined) {
      throw new Error("T306 acceptance requires one local workspace folder.");
    }
    await localBaseHeadRuntime.initialize({
      workspaceRoot: workspaceFolder.uri.fsPath,
      baseSha: input.baseSha,
      headSha: input.headSha
    });
    localBaseHeadTreeReference.current?.refresh();
  };

  const localBaseHeadTree = (): {
    readonly reviewedLineCount: number;
    readonly totalLineCount: number;
    readonly files: readonly ({
      readonly path: string;
      readonly category: string;
      readonly reason?: string;
      readonly reviewedLineCount: number;
      readonly totalLineCount: number;
      readonly node: PullRequestProgressTreeFileNode;
    })[];
  } => {
    const tree = localBaseHeadTreeReference.current;
    if (tree === undefined) throw new Error("PR Progress Tree is not available.");
    const files = tree.getChildren()
      .flatMap((category) => tree.getChildren(category))
      .filter((node): node is PullRequestProgressTreeFileNode => node.kind === "file")
      .map((node) => ({
        path: node.path,
        category: node.category,
        ...(node.reason === undefined ? {} : { reason: node.reason }),
        reviewedLineCount: node.reviewedLineCount,
        totalLineCount: node.totalLineCount,
        node
      }));
    const progress = localBaseHeadRuntime.progress.getEffectiveProgress();
    return {
      reviewedLineCount: progress.reviewedLineCount,
      totalLineCount: progress.totalLineCount,
      files
    };
  };

  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    return runtimePort;
  }

  return {
    ...runtimePort,
    drainVisibleEditorDecorations: () => decorationController.drain(),
    markNormalEditorSelectionForTest: (editor: vscode.TextEditor) =>
      commandService.markSelectionReviewed(editor),
    getNormalEditorCommandFailureForTest: () => normalEditorCommandFailureForTest,
    getObservedEncodingHintsForTest: () => documentSessionProvider.observedEncodingHintsSnapshot(),
    getVisibleReviewedIntervals: (documentUri) =>
      uniqueVisibleIntervals(documentUri, appliedDecorations),
    getFileExclusionPolicySnapshot: () => ({
      revision: fileExclusionPolicyService.getRevision(),
      userGlobs: fileExclusionPolicyService.getUserGlobs()
    }),
    evaluateFileExclusion: (path, isBinary = false) =>
      fileExclusionPolicyService.evaluate({ path, isBinary }),
    initializeLocalBaseHeadRuntime,
    getLocalBaseHeadTree: localBaseHeadTree,
    getLocalBaseHeadOpenedDiffs: () => openedLocalBaseHeadDiffs.map((diff) => ({ ...diff })),
    getLocalBaseHeadOpenedFiles: () => [...openedLocalBaseHeadFiles],
    getLocalBaseHeadPersistence: () => localBaseHeadRuntime.getPersistence(),
    setLocalBaseHeadConfirmationAnswer: (answer) => {
      localBaseHeadConfirmationAnswer = answer;
    }
  };
}

/** Flushes pending state and releases runtime resources during Extension Host teardown. */
export async function deactivate(): Promise<void> {
  const runtime = activeRuntime;
  activeRuntime = undefined;
  if (runtime === undefined) {
    return;
  }

  runtime.fileExclusionConfigurationController.dispose();
  runtime.decorationController.dispose();
  runtime.documentSessionProvider.dispose();
  await runtime.persistence.dispose();
}

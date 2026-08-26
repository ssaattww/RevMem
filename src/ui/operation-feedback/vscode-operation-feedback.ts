import * as vscode from "vscode";

import {
  formatOperationLogEntry,
  formatOperationProgress,
  type OperationActivity,
  type OperationDiagnosticDetail,
  type OperationFeedbackHost,
  type OperationLogEntry,
  type OperationProgress,
} from "../../application/operation-feedback/index";

export const REVIEW_RANGE_OUTPUT_CHANNEL_NAME = "Review Range";

/** VS Code adapter for shared operation status and Output diagnostics. */
export class VscodeOperationFeedbackHost
implements OperationFeedbackHost, vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel(
    REVIEW_RANGE_OUTPUT_CHANNEL_NAME
  );
  private readonly status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    101
  );
  private readonly diagnosticTriggerSubscriptions: vscode.Disposable[];
  private pendingGlobalDetail: OperationDiagnosticDetail | undefined;

  /** Creates the shared VS Code surfaces with an optional immutable Test-mode log observer. */
  public constructor(private readonly onAppendLogForTest?: (entry: OperationLogEntry) => void) {
    this.status.name = "Review Range Activity";
    const remember = (reason: string, document: vscode.TextDocument): void => {
      if (!this.isDetailedDiagnosticsEnabled()) return;
      if (document.uri.scheme !== "file" && document.uri.scheme !== "vscode-remote") return;
      this.pendingGlobalDetail = { reason, target: document.uri.fsPath, phase: "global-refresh-trigger" };
    };
    this.diagnosticTriggerSubscriptions = [
      vscode.workspace.onDidOpenTextDocument((document) => remember("document-opened", document)),
      vscode.workspace.onDidChangeTextDocument((event) => remember("document-changed", event.document)),
      vscode.workspace.onDidSaveTextDocument((document) => remember("document-saved", document)),
      vscode.workspace.onDidCloseTextDocument((document) => remember("document-closed", document)),
    ];
  }

  public takeOperationStartDetail(label: string): OperationDiagnosticDetail | undefined {
    if (label !== "Global理解率を再計算") return undefined;
    const detail = this.pendingGlobalDetail;
    this.pendingGlobalDetail = undefined;
    return detail;
  }

  public isDetailedDiagnosticsEnabled(): boolean {
    return vscode.workspace.getConfiguration("reviewRange.diagnostics").get("detailed", false);
  }

  public showBusy(
    label: string,
    activeCount: number,
    progress?: OperationProgress,
    activities?: readonly OperationActivity[],
  ): void {
    const progressText = progress === undefined ? undefined : formatOperationProgress(progress);
    this.status.text = `$(sync~spin) Review Range: ${label}${progressText === undefined ? "" : ` · ${progressText}`}`;
    const activityText = activeCount === 1
      ? "Review Rangeが処理を実行しています。"
      : `Review Rangeが${activeCount}件の処理を実行しています。`;
    const detailLines = this.isDetailedDiagnosticsEnabled() && activities !== undefined
      ? activities.map((activity) => `#${activity.id} ${activity.label}${activity.detail?.phase === undefined ? "" : ` [${activity.detail.phase}]`}${activity.detail?.target === undefined ? "" : ` — ${activity.detail.target}`}`)
      : [];
    this.status.tooltip = [
      activityText,
      ...(progressText === undefined ? [] : [`進捗: ${progressText}`]),
      ...detailLines
    ].join("\n");
    this.status.show();
  }

  public clearBusy(): void {
    this.status.text = "";
    this.status.tooltip = undefined;
    this.status.hide();
  }

  public appendLog(entry: OperationLogEntry): void {
    this.output.appendLine(formatOperationLogEntry(entry));
    this.onAppendLogForTest?.({ ...entry });
  }

  public revealLog(): void {
    this.output.show(true);
  }

  public dispose(): void {
    for (const subscription of this.diagnosticTriggerSubscriptions) subscription.dispose();
    this.status.dispose();
    this.output.dispose();
  }
}

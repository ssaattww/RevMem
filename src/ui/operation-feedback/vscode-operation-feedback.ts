import * as vscode from "vscode";

import {
  formatOperationLogEntry,
  formatOperationProgress,
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

  /** Creates the shared VS Code surfaces with an optional immutable Test-mode log observer. */
  public constructor(private readonly onAppendLogForTest?: (entry: OperationLogEntry) => void) {
    this.status.name = "Review Range Activity";
  }

  public showBusy(
    label: string,
    activeCount: number,
    progress?: OperationProgress,
  ): void {
    const progressText = progress === undefined ? undefined : formatOperationProgress(progress);
    this.status.text = `$(sync~spin) Review Range: ${label}${progressText === undefined ? "" : ` · ${progressText}`}`;
    const activityText = activeCount === 1
      ? "Review Rangeが処理を実行しています。"
      : `Review Rangeが${activeCount}件の処理を実行しています。`;
    this.status.tooltip = progressText === undefined
      ? activityText
      : `${activityText}\n進捗: ${progressText}`;
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
    this.status.dispose();
    this.output.dispose();
  }
}

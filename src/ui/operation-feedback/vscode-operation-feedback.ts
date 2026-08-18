import * as vscode from "vscode";

import {
  formatOperationLogEntry,
  type OperationFeedbackHost,
  type OperationLogEntry
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

  public constructor() {
    this.status.name = "Review Range Activity";
  }

  public showBusy(label: string, activeCount: number): void {
    this.status.text = `$(sync~spin) Review Range: ${label}`;
    this.status.tooltip = activeCount === 1
      ? "Review Rangeが処理を実行しています。"
      : `Review Rangeが${activeCount}件の処理を実行しています。`;
    this.status.show();
  }

  public clearBusy(): void {
    this.status.text = "";
    this.status.tooltip = undefined;
    this.status.hide();
  }

  public appendLog(entry: OperationLogEntry): void {
    this.output.appendLine(formatOperationLogEntry(entry));
  }

  public revealLog(): void {
    this.output.show(true);
  }

  public dispose(): void {
    this.status.dispose();
    this.output.dispose();
  }
}

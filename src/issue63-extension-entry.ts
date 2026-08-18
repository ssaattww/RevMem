import * as vscode from "vscode";

import {
  OperationFeedback,
  setActiveOperationFeedback
} from "./application/operation-feedback/index";
import {
  activate as activateReviewRange,
  deactivate as deactivateReviewRange
} from "./t305-extension";
import { VscodeOperationFeedbackHost } from "./ui/operation-feedback/index";

let feedbackHost: VscodeOperationFeedbackHost | undefined;

/** Activates Review Range with shared operation status and Output diagnostics. */
export async function activate(context: vscode.ExtensionContext): Promise<unknown> {
  const host = new VscodeOperationFeedbackHost();
  feedbackHost = host;
  context.subscriptions.push(host);
  const feedback = new OperationFeedback(host);
  setActiveOperationFeedback(feedback);
  try {
    return await feedback.run("拡張機能を初期化", () => activateReviewRange(context));
  } catch (error) {
    setActiveOperationFeedback(undefined);
    throw error;
  }
}

/** Deactivates Review Range after clearing the shared feedback binding. */
export async function deactivate(): Promise<void> {
  try {
    await deactivateReviewRange();
  } finally {
    setActiveOperationFeedback(undefined);
    feedbackHost = undefined;
  }
}

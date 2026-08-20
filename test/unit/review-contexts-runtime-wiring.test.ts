import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OperationDiagnosticError,
  OperationFeedback,
  type OperationFeedbackHost,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index.js";

const REVIEW_CONTEXT_COMMANDS = [
  "reviewRange.refreshReviewContexts",
  "reviewRange.redetectPullRequest",
  "reviewRange.reconnectGitHub",
  "reviewRange.refreshReviewContextCache",
  "reviewRange.toggleReviewContextLayer",
  "reviewRange.hideReviewContext",
  "reviewRange.openReviewContextDiff",
] as const;

class FakeOperationFeedbackHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];

  public showBusy(): void {}
  public clearBusy(): void {}
  public appendLog(entry: OperationLogEntry): void {
    this.logs.push(entry);
  }
  public revealLog(): void {}
}

test("T405 contributes Review Contexts activation, commands, and menus", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    activationEvents: string[];
    contributes: {
      commands: Array<{ command: string }>;
      menus: Record<string, Array<{ command: string; when?: string }>>;
    };
  };

  assert.ok(manifest.activationEvents.includes("onView:reviewRange.reviewContexts"));
  for (const command of REVIEW_CONTEXT_COMMANDS) {
    assert.ok(
      manifest.contributes.commands.some((entry) => entry.command === command),
      `missing contributed command ${command}`,
    );
  }

  const titleCommands = new Set(
    (manifest.contributes.menus["view/title"] ?? [])
      .filter((entry) => entry.when?.includes("reviewRange.reviewContexts") === true)
      .map((entry) => entry.command),
  );
  assert.deepEqual(titleCommands, new Set([
    "reviewRange.refreshReviewContexts",
    "reviewRange.redetectPullRequest",
    "reviewRange.reconnectGitHub",
  ]));

  const itemCommands = new Set(
    (manifest.contributes.menus["view/item/context"] ?? [])
      .filter((entry) => entry.when?.includes("reviewRange.reviewContexts") === true)
      .map((entry) => entry.command),
  );
  for (const command of [
    "reviewRange.openReviewContextDiff",
    "reviewRange.refreshReviewContextCache",
    "reviewRange.toggleReviewContextLayer",
    "reviewRange.hideReviewContext",
  ]) assert.ok(itemCommands.has(command), `missing Review Contexts item command ${command}`);
});

test("T405 production entry delegates Review Contexts composition to the T405 runtime boundary", async () => {
  const entry = await readFile("src/t305-extension.ts", "utf8");
  const composition = await readFile("src/t405-review-contexts-runtime.ts", "utf8");
  assert.match(entry, /registerT405ReviewContextsRuntime/u);
  assert.match(composition, /registerReviewContextsRuntime/u);
  assert.match(composition, /ReviewContextsController/u);
});

test("Issue #57 maps an existing owner-wide Global revision before publishing a new PR context", async () => {
  const composition = await readFile("src/t405-review-contexts-runtime.ts", "utf8");

  assert.match(composition, /GitContextRevisionMapper/u);
  assert.match(composition, /currentGlobalForNewPullRequest[\s\S]*\.map\(/u);
  assert.doesNotMatch(
    composition,
    /現在のGlobal stateをPR headへ安全に対応付けできません/u,
  );
});

test("Issue #63 wires streamed Git output, operation status, and Output diagnostics", async () => {
  const globalRuntime = await readFile(
    "src/ui/global-understanding/vscode-global-understanding-runtime.ts",
    "utf8",
  );
  const reviewContextsUi = await readFile(
    "src/ui/review-contexts/vscode-review-contexts-runtime.ts",
    "utf8",
  );
  const normalCommands = await readFile(
    "src/ui/normal-editor/review-command-registration.ts",
    "utf8",
  );
  const pullRequestRuntime = await readFile(
    "src/t405-pull-request-review-runtime.ts",
    "utf8",
  );
  const operationUi = await readFile(
    "src/ui/operation-feedback/vscode-operation-feedback.ts",
    "utf8",
  );
  const gitExecutor = await readFile(
    "src/adapters/local-git/node-git-command-executor.ts",
    "utf8",
  );

  assert.match(globalRuntime, /new VscodeOperationFeedbackHost/u);
  assert.match(globalRuntime, /setActiveOperationFeedback/u);
  assert.match(globalRuntime, /Global理解率を再計算/u);
  assert.match(pullRequestRuntime, /PR進捗を計算/u);
  assert.match(normalCommands, /ファイル全体を確認済みにする/u);
  assert.match(normalCommands, /runWithActiveOperationFeedback/u);
  assert.match(reviewContextsUi, /Review Contextsを更新/u);
  assert.match(reviewContextsUi, /runWithActiveOperationFeedback/u);
  assert.match(operationUi, /createOutputChannel/u);
  assert.match(operationUi, /createStatusBarItem/u);
  assert.match(gitExecutor, /\bspawn\(/u);
  assert.doesNotMatch(gitExecutor, /\bexecFile\(/u);
});

test("Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics", async () => {
  const composition = await readFile("src/t405-review-contexts-runtime.ts", "utf8");

  assert.match(composition, /reportActiveOperationFailure/u);
  assert.match(
    composition,
    /result\.kind !== "acquired"[\s\S]{0,700}reportActiveOperationFailure\("PR進捗を取得"/u,
  );
  assert.match(
    composition,
    /catch \(error\)[\s\S]{0,300}reportActiveOperationFailure\("PR進捗を取得"/u,
  );
});

test("R65-005 preserves safe PR progress acquisition attempts and final cause", async () => {
  const composition = await readFile("src/t405-review-contexts-runtime.ts", "utf8");

  assert.match(
    composition,
    /new OperationDiagnosticError\(\{[\s\S]{0,220}code: "PR_PROGRESS_UNAVAILABLE"[\s\S]{0,220}attempts: result\.attempts/u,
  );
  assert.doesNotMatch(
    composition,
    /new Error\(`PR progress is unavailable: \$\{attempts/u,
  );

  const host = new FakeOperationFeedbackHost();
  const feedback = new OperationFeedback(host, () => 123);
  const failure = new OperationDiagnosticError({
    code: "PR_PROGRESS_UNAVAILABLE",
    attempts: [
      { source: "local-git", reason: "missing-revision" },
      { source: "github-patch", reason: "network" },
    ],
  });
  failure.message = "Customer Payroll Dashboard";

  feedback.reportFailure("PR進捗を取得", failure);

  const terminal = host.logs[0];
  assert.equal(terminal?.event, "failed");
  assert.equal(terminal?.errorName, "OperationDiagnosticError");
  assert.equal(
    terminal?.message,
    "PR_PROGRESS_UNAVAILABLE attempts=local-git:missing-revision -> github-patch:network; final=github-patch:network",
  );
  assert.doesNotMatch(terminal?.message ?? "", /Customer Payroll Dashboard/u);
});

test("T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure", async () => {
  const reviewContextsUi = await readFile(
    "src/ui/review-contexts/vscode-review-contexts-runtime.ts",
    "utf8",
  );

  assert.match(reviewContextsUi, /const runOperation = async/u);
  assert.match(reviewContextsUi, /retry = false/u);
  assert.match(reviewContextsUi, /provider\.clear\(\)[\s\S]{0,240}formatOperationFailureForUser/u);
  assert.match(reviewContextsUi, /openReviewContextDiff[\s\S]{0,500}runOperation/u);
  assert.doesNotMatch(
    reviewContextsUi,
    /runWithActiveOperationFeedback\([\s\S]{0,140}\(\) => report\(/u,
  );
});

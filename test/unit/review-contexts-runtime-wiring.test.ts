import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const REVIEW_CONTEXT_COMMANDS = [
  "reviewRange.refreshReviewContexts",
  "reviewRange.redetectPullRequest",
  "reviewRange.reconnectGitHub",
  "reviewRange.refreshReviewContextCache",
  "reviewRange.toggleReviewContextLayer",
  "reviewRange.hideReviewContext",
  "reviewRange.openReviewContextDiff",
] as const;

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
  const entry = await readFile("src/t305-extension.ts", "utf8");
  const composition = await readFile("src/t405-review-contexts-runtime.ts", "utf8");
  const reviewContextsUi = await readFile(
    "src/ui/review-contexts/vscode-review-contexts-runtime.ts",
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

  assert.match(entry, /new VscodeOperationFeedbackHost/u);
  assert.match(entry, /new OperationFeedback/u);
  assert.match(entry, /Global理解率を再計算/u);
  assert.match(composition, /PR進捗を計算/u);
  assert.match(composition, /result\.kind !== "acquired"[\s\S]*throw new Error/u);
  assert.match(reviewContextsUi, /runOperation/u);
  assert.match(reviewContextsUi, /Review Contextsを更新/u);
  assert.match(operationUi, /createOutputChannel/u);
  assert.match(operationUi, /createStatusBarItem/u);
  assert.match(gitExecutor, /\bspawn\(/u);
  assert.doesNotMatch(gitExecutor, /\bexecFile\(/u);
});

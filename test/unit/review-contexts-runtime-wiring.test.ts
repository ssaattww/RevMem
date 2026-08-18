import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RuntimeOperationDiagnostics
} from "../../src/application/runtime-diagnostics/index.js";

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

test("operation diagnostics logs success and failure while updating processing status", async () => {
  const output: string[] = [];
  const statuses: Array<string | undefined> = [];
  const times = [0, 125, 1_000, 1_350];
  const diagnostics = new RuntimeOperationDiagnostics({
    appendLine: (line) => output.push(line),
    setStatus: (status) => statuses.push(status),
    now: () => times.shift() ?? 1_350,
  });

  assert.equal(
    await diagnostics.run("PR差分を取得中", async () => "acquired"),
    "acquired",
  );
  const failure = new Error("private repository authentication failed");
  await assert.rejects(
    diagnostics.run("PR進捗を計算中", async () => {
      throw failure;
    }),
    (error: unknown) => error === failure,
  );

  assert.deepEqual(statuses, [
    "PR差分を取得中",
    undefined,
    "PR進捗を計算中",
    undefined,
  ]);
  assert.match(output[0]!, /\[START\] PR差分を取得中/u);
  assert.match(output[1]!, /\[DONE\] PR差分を取得中 durationMs=125/u);
  assert.match(output[2]!, /\[START\] PR進捗を計算中/u);
  assert.match(output[3]!, /\[ERROR\] PR進捗を計算中 durationMs=350/u);
  assert.match(output[3]!, /private repository authentication failed/u);
});

test("production wiring shares one Review Range Output channel and processing status across major operations", async () => {
  const entry = await readFile("src/t305-extension.ts", "utf8");
  const base = await readFile("src/extension.ts", "utf8");
  const reviewContexts = await readFile("src/t405-review-contexts-runtime.ts", "utf8");
  const adapter = await readFile(
    "src/ui/runtime-diagnostics/vscode-runtime-operation-diagnostics.ts",
    "utf8",
  );

  assert.match(entry, /createVscodeRuntimeOperationDiagnostics/u);
  assert.match(entry, /activateBaseExtension\(context, diagnostics\)/u);
  assert.match(
    entry,
    /createNodeLocalGitAdapter\(\{[\s\S]*?onDiagnostic:[\s\S]*?diagnostics\.log/u,
  );
  assert.match(entry, /diagnostics\.run\("Global理解率を計算中"/u);
  assert.match(base, /diagnostics\.run\("レビュー状態を更新中"/u);
  assert.match(reviewContexts, /diagnostics\.logError\("PR Progress"/u);
  assert.match(adapter, /createOutputChannel\("Review Range"\)/u);
  assert.match(adapter, /\$\(sync~spin\)/u);
});

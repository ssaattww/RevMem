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

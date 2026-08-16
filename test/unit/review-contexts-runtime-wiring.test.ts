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

test("T405 contributes Review Contexts activation, commands, menus, and closed PR layer default", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    activationEvents: string[];
    contributes: {
      commands: Array<{ command: string }>;
      menus: Record<string, Array<{ command: string; when?: string }>>;
      configuration: { properties: Record<string, { default?: unknown }> };
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

  assert.equal(
    manifest.contributes.configuration.properties["reviewRange.closedPullRequestLayerDefault"]?.default,
    false,
  );
});

test("T405 production entry registers the Review Contexts runtime", async () => {
  const source = await readFile("src/t305-extension.ts", "utf8");
  assert.match(source, /registerReviewContextsRuntime/u);
  assert.match(source, /reviewRange\.reviewContexts/u);
  assert.match(source, /ReviewContextsController/u);
});

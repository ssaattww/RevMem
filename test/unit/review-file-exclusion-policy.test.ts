import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS,
  ReviewFileExclusionPolicy,
  type ReviewFileExclusionCandidate
} from "../../src/core/file-exclusion/index";
import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/index";

const candidate = (path: string, isBinary = false): ReviewFileExclusionCandidate => ({ path, isBinary });
const expectedDefaultGlobs = ["**/.git/**","**/node_modules/**","**/bin/**","**/obj/**","**/dist/**","**/build/**"] as const;

test("default exclusion globs match the design contract in stable order", () => {
  assert.deepEqual(DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS, expectedDefaultGlobs);
});

test("every default glob excludes root and nested generated directories with a reason", () => {
  const policy = new ReviewFileExclusionPolicy();
  const cases = [[".git/config","**/.git/**"],["packages/app/.git/config","**/.git/**"],["node_modules/pkg/index.js","**/node_modules/**"],["packages/app/node_modules/pkg/index.js","**/node_modules/**"],["bin/app.dll","**/bin/**"],["src/bin/app.dll","**/bin/**"],["obj/cache.json","**/obj/**"],["src/obj/cache.json","**/obj/**"],["dist/index.js","**/dist/**"],["packages/app/dist/index.js","**/dist/**"],["build/output.txt","**/build/**"],["packages/app/build/output.txt","**/build/**"]] as const;
  for (const [path, pattern] of cases) {
    assert.deepEqual(policy.evaluate(candidate(path)), { excluded: true, normalizedPath: path, reason: { kind: "default-glob", pattern } });
  }
  assert.deepEqual(policy.evaluate(candidate("src/binocular/index.ts")), { excluded: false, normalizedPath: "src/binocular/index.ts" });
});

test("repository-relative paths are normalized without changing Git case semantics", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: ["src/**/*.generated.ts"] });
  assert.deepEqual(policy.evaluate(candidate(".\\src\\models\\item.generated.ts")), { excluded: true, normalizedPath: "src/models/item.generated.ts", reason: { kind: "user-glob", pattern: "src/**/*.generated.ts" } });
  assert.deepEqual(policy.evaluate(candidate("Src/models/item.generated.ts")), { excluded: false, normalizedPath: "Src/models/item.generated.ts" });
});

test("binary exclusion has deterministic priority over path globs", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: ["**/*.png"] });
  assert.deepEqual(policy.evaluate(candidate("dist/logo.png", true)), { excluded: true, normalizedPath: "dist/logo.png", reason: { kind: "binary" } });
});

test("default globs have deterministic priority over overlapping user globs", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: ["**/dist/**", "**/*.js"] });
  assert.deepEqual(policy.evaluate(candidate("dist/index.js")), { excluded: true, normalizedPath: "dist/index.js", reason: { kind: "default-glob", pattern: "**/dist/**" } });
});

test("user globs support basename, recursive, question, class, and brace patterns", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: ["package-lock.json", "**/*.generated.{ts,tsx}", "src/**/fixture?.[jt]s"] });
  for (const path of ["package-lock.json","packages/app/package-lock.json","src/model.generated.ts","src/deep/model.generated.tsx","src/fixture1.js","src/deep/fixtureA.ts"]) assert.equal(policy.evaluate(candidate(path)).excluded, true, path);
  for (const path of ["package.json","src/model.generated.cs","src/fixture12.js","test/fixture1.js"]) assert.equal(policy.evaluate(candidate(path)).excluded, false, path);
});

test("user glob normalization removes blanks and semantic duplicates", () => {
  const input = ["  **\\generated\\**  ", "**/generated/**", "", "   "];
  const policy = new ReviewFileExclusionPolicy({ userGlobs: input });
  input[0] = "**/*.ts";
  assert.deepEqual(policy.getUserGlobs(), ["**/generated/**"]);
  assert.deepEqual(policy.evaluate(candidate("src/generated/file.ts")), { excluded: true, normalizedPath: "src/generated/file.ts", reason: { kind: "user-glob", pattern: "**/generated/**" } });
  assert.equal(policy.evaluate(candidate("src/ordinary/file.ts")).excluded, false);
});

test("policy rejects non-repository paths and unsupported negated globs", () => {
  assert.throws(() => new ReviewFileExclusionPolicy({ userGlobs: ["!**/*.ts"] }), /negated glob/i);
  const policy = new ReviewFileExclusionPolicy();
  for (const path of ["../outside.ts", "/absolute.ts", "C:/absolute.ts", "src/\u0000bad.ts"]) assert.throws(() => policy.evaluate(candidate(path)), /repository-relative path/i);
});

test("the first matching glob provides a deterministic exclusion reason", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: ["**/*.generated.ts", "src/**"] });
  assert.deepEqual(policy.evaluate(candidate("src/model.generated.ts")), { excluded: true, normalizedPath: "src/model.generated.ts", reason: { kind: "user-glob", pattern: "**/*.generated.ts" } });
});

test("settings updates replace the shared policy and notify only on semantic changes", () => {
  const service = new ReviewFileExclusionPolicyService();
  const events: Array<{ readonly revision: number; readonly userGlobs: readonly string[] }> = [];
  const disposable = service.onDidChange((event) => events.push(event));
  assert.equal(service.evaluate(candidate("src/file.generated.ts")).excluded, false);
  assert.equal(service.updateUserGlobs([" **\\*.generated.ts "]), true);
  assert.equal(service.evaluate(candidate("src/file.generated.ts")).excluded, true);
  assert.equal(service.updateUserGlobs(["**/*.generated.ts", ""]), false);
  assert.deepEqual(events, [{ revision: 1, userGlobs: ["**/*.generated.ts"] }]);
  disposable.dispose();
  assert.equal(service.updateUserGlobs(["**/*.min.js"]), true);
  assert.equal(events.length, 1);
});

test("change events and getters expose detached snapshots", () => {
  const service = new ReviewFileExclusionPolicyService();
  const configured = ["**/*.generated.ts"];
  let observed: readonly string[] | undefined;
  service.onDidChange((event) => { observed = event.userGlobs; });
  service.updateUserGlobs(configured);
  configured[0] = "**/*.js";
  const returned = service.getUserGlobs() as string[];
  returned[0] = "**/*.cs";
  assert.deepEqual(observed, ["**/*.generated.ts"]);
  assert.deepEqual(service.getUserGlobs(), ["**/*.generated.ts"]);
  assert.equal(service.evaluate(candidate("src/file.generated.ts")).excluded, true);
});

test("PR and Global consumers can reuse one service and receive identical decisions", () => {
  const service = new ReviewFileExclusionPolicyService({ userGlobs: ["**/*.generated.ts"] });
  const changedFile = candidate("src/file.generated.ts");
  const prProgressDecision = service.evaluate(changedFile);
  const globalEnumerationDecision = service.evaluate(changedFile);
  assert.deepEqual(prProgressDecision, globalEnumerationDecision);
  assert.deepEqual(prProgressDecision, { excluded: true, normalizedPath: "src/file.generated.ts", reason: { kind: "user-glob", pattern: "**/*.generated.ts" } });
});

test("package manifest exposes the designed reviewRange.exclude default", () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { contributes: { configuration: { properties: Record<string, { readonly type: string; readonly default: unknown }> } } };
  assert.deepEqual(manifest.contributes.configuration.properties["reviewRange.exclude"], { type: "array", items: { type: "string" }, default: expectedDefaultGlobs, description: "PR進捗とGlobal理解率の集計対象から除外するファイルglobです。" });
});

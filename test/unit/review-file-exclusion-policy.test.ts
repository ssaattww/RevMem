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

test("omitted options use manifest defaults while an explicit empty setting re-includes configurable defaults", () => {
  const defaultPolicy = new ReviewFileExclusionPolicy();
  const explicitEmptyPolicy = new ReviewFileExclusionPolicy({ userGlobs: [] });
  const defaultService = new ReviewFileExclusionPolicyService();
  const explicitEmptyService = new ReviewFileExclusionPolicyService({ userGlobs: [] });

  assert.deepEqual(defaultPolicy.getUserGlobs(), ["**/node_modules/**", "**/bin/**", "**/obj/**", "**/dist/**", "**/build/**"]);
  assert.deepEqual(defaultPolicy.evaluate(candidate("dist/index.js")), {
    excluded: true,
    normalizedPath: "dist/index.js",
    reason: { kind: "default-glob", pattern: "**/dist/**" }
  });
  assert.deepEqual(defaultService.getUserGlobs(), defaultPolicy.getUserGlobs());
  assert.deepEqual(defaultService.evaluate(candidate("dist/index.js")), defaultPolicy.evaluate(candidate("dist/index.js")));
  assert.deepEqual(explicitEmptyPolicy.evaluate(candidate("dist/index.js")), {
    excluded: false,
    normalizedPath: "dist/index.js"
  });
  assert.deepEqual(explicitEmptyPolicy.evaluate(candidate(".git/config")), {
    excluded: true,
    normalizedPath: ".git/config",
    reason: { kind: "default-glob", pattern: "**/.git/**" }
  });
  assert.deepEqual(explicitEmptyService.evaluate(candidate("dist/index.js")), explicitEmptyPolicy.evaluate(candidate("dist/index.js")));
});

test("every default glob excludes root and nested generated directories with a reason", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS });
  const cases = [[".git/config","**/.git/**"],["packages/app/.git/config","**/.git/**"],["node_modules/pkg/index.js","**/node_modules/**"],["packages/app/node_modules/pkg/index.js","**/node_modules/**"],["bin/app.dll","**/bin/**"],["src/bin/app.dll","**/bin/**"],["obj/cache.json","**/obj/**"],["src/obj/cache.json","**/obj/**"],["dist/index.js","**/dist/**"],["packages/app/dist/index.js","**/dist/**"],["build/output.txt","**/build/**"],["packages/app/build/output.txt","**/build/**"]] as const;
  for (const [path, pattern] of cases) {
    assert.deepEqual(policy.evaluate(candidate(path)), { excluded: true, normalizedPath: path, reason: { kind: "default-glob", pattern } });
  }
  assert.deepEqual(policy.evaluate(candidate("src/binocular/index.ts")), { excluded: false, normalizedPath: "src/binocular/index.ts" });
});

test("an empty effective setting retains only binary and .git exclusion", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: [] });

  assert.deepEqual(policy.evaluate(candidate(".git/config")), {
    excluded: true,
    normalizedPath: ".git/config",
    reason: { kind: "default-glob", pattern: "**/.git/**" }
  });
  assert.deepEqual(policy.evaluate(candidate("dist/index.js")), {
    excluded: false,
    normalizedPath: "dist/index.js"
  });
  assert.deepEqual(policy.evaluate(candidate("node_modules/pkg/index.js")), {
    excluded: false,
    normalizedPath: "node_modules/pkg/index.js"
  });
  assert.deepEqual(policy.evaluate(candidate("dist/logo.png", true)), {
    excluded: true,
    normalizedPath: "dist/logo.png",
    reason: { kind: "binary" }
  });
});

test("repository-relative Git paths normalize slash segments without changing case", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: ["src/**/*.generated.ts"] });
  assert.deepEqual(policy.evaluate(candidate("./src//models/item.generated.ts")), { excluded: true, normalizedPath: "src/models/item.generated.ts", reason: { kind: "user-glob", pattern: "src/**/*.generated.ts" } });
  assert.deepEqual(policy.evaluate(candidate("Src/models/item.generated.ts")), { excluded: false, normalizedPath: "Src/models/item.generated.ts" });
});

test("Git paths preserve POSIX backslashes instead of treating them as separators", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: ["a/b.ts"] });
  assert.deepEqual(policy.evaluate(candidate("a\\b.ts")), { excluded: false, normalizedPath: "a\\b.ts" });
  assert.deepEqual(policy.evaluate(candidate("a/b.ts")), { excluded: true, normalizedPath: "a/b.ts", reason: { kind: "user-glob", pattern: "a/b.ts" } });
  assert.deepEqual(policy.evaluate(candidate("src\\dist\\file.ts")), { excluded: false, normalizedPath: "src\\dist\\file.ts" });
});

test("single glob backslashes remain separators and doubled backslashes match literal POSIX names", () => {
  const separatorPolicy = new ReviewFileExclusionPolicy({ userGlobs: ["src\\generated\\*.ts"] });
  assert.deepEqual(separatorPolicy.getUserGlobs(), ["src/generated/*.ts"]);
  assert.equal(separatorPolicy.evaluate(candidate("src/generated/file.ts")).excluded, true);

  const literalPolicy = new ReviewFileExclusionPolicy({ userGlobs: ["a\\\\b.ts"] });
  assert.deepEqual(literalPolicy.getUserGlobs(), ["a\\\\b.ts"]);
  assert.deepEqual(literalPolicy.evaluate(candidate("a\\b.ts")), {
    excluded: true,
    normalizedPath: "a\\b.ts",
    reason: { kind: "user-glob", pattern: "a\\\\b.ts" }
  });
  assert.deepEqual(literalPolicy.evaluate(candidate("a/b.ts")), {
    excluded: false,
    normalizedPath: "a/b.ts"
  });
});

test("canonical literal snapshots round-trip without changing decisions or reasons", () => {
  const source = new ReviewFileExclusionPolicy({ userGlobs: ["a\\\\b.ts"] });
  const snapshot = source.getUserGlobs();
  const replayed = new ReviewFileExclusionPolicy({ userGlobs: snapshot });

  assert.deepEqual(snapshot, ["a\\\\b.ts"]);
  assert.deepEqual(replayed.getUserGlobs(), snapshot);
  assert.deepEqual(replayed.evaluate(candidate("a\\b.ts")), source.evaluate(candidate("a\\b.ts")));
  assert.deepEqual(replayed.evaluate(candidate("a/b.ts")), source.evaluate(candidate("a/b.ts")));
});

test("binary exclusion has deterministic priority over path globs", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: ["**/*.png"] });
  assert.deepEqual(policy.evaluate(candidate("dist/logo.png", true)), { excluded: true, normalizedPath: "dist/logo.png", reason: { kind: "binary" } });
});

test("default globs have deterministic priority over overlapping user globs", () => {
  const policy = new ReviewFileExclusionPolicy({
    userGlobs: [...DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS, "**/*.js"]
  });
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

test("glob configuration rejects excessive pattern count and length", () => {
  const tooMany = Array.from({ length: 257 }, (_, index) => `generated-${index}.ts`);
  assert.throws(() => new ReviewFileExclusionPolicy({ userGlobs: tooMany }), /too many exclusion globs/i);
  assert.throws(() => new ReviewFileExclusionPolicy({ userGlobs: ["a".repeat(1025)] }), /exclusion glob is too long/i);
});

test("brace expansion rejects configurations above the compiled expression limit", () => {
  const exponential = `${"{a,b}".repeat(11)}.ts`;
  assert.throws(() => new ReviewFileExclusionPolicy({ userGlobs: [exponential] }), /expansion limit/i);
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

test("service getters and event snapshots can be replayed without revising a literal policy", () => {
  const literal = ["a\\\\b.ts"];
  const service = new ReviewFileExclusionPolicyService({ userGlobs: literal });
  const observed: Array<{ readonly revision: number; readonly userGlobs: readonly string[] }> = [];
  service.onDidChange((event) => observed.push(event));

  assert.equal(service.updateUserGlobs(service.getUserGlobs()), false);
  assert.equal(service.getRevision(), 0);
  assert.deepEqual(service.evaluate(candidate("a\\b.ts")), {
    excluded: true,
    normalizedPath: "a\\b.ts",
    reason: { kind: "user-glob", pattern: "a\\\\b.ts" }
  });

  const eventSource = new ReviewFileExclusionPolicyService();
  let emitted: readonly string[] | undefined;
  eventSource.onDidChange((event) => { emitted = event.userGlobs; });
  assert.equal(eventSource.updateUserGlobs(literal), true);
  const replayed = new ReviewFileExclusionPolicyService({ userGlobs: emitted! });
  assert.equal(replayed.updateUserGlobs(emitted!), false);
  assert.deepEqual(replayed.evaluate(candidate("a\\b.ts")), service.evaluate(candidate("a\\b.ts")));
  assert.deepEqual(observed, []);
});

test("adding or removing the always-excluded .git glob does not revise the policy", () => {
  const service = new ReviewFileExclusionPolicyService();
  const events: number[] = [];
  service.onDidChange(({ revision }) => events.push(revision));
  const snapshot = service.getUserGlobs();

  assert.equal(service.updateUserGlobs(["**/.git/**", ...snapshot]), false);
  assert.equal(service.updateUserGlobs(snapshot), false);
  assert.equal(service.getRevision(), 0);
  assert.deepEqual(events, []);
  assert.deepEqual(service.evaluate(candidate(".git/config")), {
    excluded: true,
    normalizedPath: ".git/config",
    reason: { kind: "default-glob", pattern: "**/.git/**" }
  });
});

test("reordering overlapping effective globs revises the policy when the decisive reason changes", () => {
  const service = new ReviewFileExclusionPolicyService({ userGlobs: ["**/*.ts", "src/**"] });
  const events: Array<{ readonly revision: number; readonly userGlobs: readonly string[] }> = [];
  service.onDidChange((event) => events.push(event));

  assert.deepEqual(service.evaluate(candidate("src/file.ts")), {
    excluded: true,
    normalizedPath: "src/file.ts",
    reason: { kind: "user-glob", pattern: "**/*.ts" }
  });
  assert.equal(service.updateUserGlobs(["src/**", "**/*.ts"]), true);
  assert.deepEqual(service.evaluate(candidate("src/file.ts")), {
    excluded: true,
    normalizedPath: "src/file.ts",
    reason: { kind: "user-glob", pattern: "src/**" }
  });
  assert.deepEqual(events, [{ revision: 1, userGlobs: ["src/**", "**/*.ts"] }]);
});

test("removing a manifest default changes the effective decision, revision, and notification", () => {
  const service = new ReviewFileExclusionPolicyService({
    userGlobs: DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS
  });
  const events: Array<{ readonly revision: number; readonly userGlobs: readonly string[] }> = [];
  service.onDidChange((event) => events.push(event));

  assert.equal(service.evaluate(candidate("dist/index.js")).excluded, true);
  assert.equal(service.updateUserGlobs(["**/.git/**", "**/node_modules/**", "**/bin/**", "**/obj/**", "**/build/**"]), true);
  assert.deepEqual(service.evaluate(candidate("dist/index.js")), {
    excluded: false,
    normalizedPath: "dist/index.js"
  });
  assert.equal(service.getRevision(), 1);
  assert.deepEqual(events, [{
    revision: 1,
    userGlobs: ["**/node_modules/**", "**/bin/**", "**/obj/**", "**/build/**"]
  }]);
});

test("blank, duplicate, and equivalent separator spellings do not notify for the same policy snapshot", () => {
  const service = new ReviewFileExclusionPolicyService({ userGlobs: ["**/generated/**"] });
  const events: number[] = [];
  service.onDidChange(({ revision }) => events.push(revision));

  assert.equal(service.updateUserGlobs(["  **\\generated\\**  ", "**/generated/**", "", "   "]), false);
  assert.equal(service.getRevision(), 0);
  assert.deepEqual(events, []);
});

test("literal backslash syntax cannot bypass pattern, length, brace, or expression limits", () => {
  assert.throws(
    () => new ReviewFileExclusionPolicy({ userGlobs: Array.from({ length: 257 }, (_, index) => `a\\\\${index}.ts`) }),
    /too many exclusion globs/i
  );
  assert.throws(
    () => new ReviewFileExclusionPolicy({ userGlobs: [`a${"\\\\".repeat(512)}b`] }),
    /too long/i
  );
  assert.throws(
    () => new ReviewFileExclusionPolicy({ userGlobs: [`a\\\\${"{a,b}".repeat(11)}.ts`] }),
    /expansion limit/i
  );
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
  assert.deepEqual(manifest.contributes.configuration.properties["reviewRange.exclude"], { type: "array", items: { type: "string" }, default: expectedDefaultGlobs, description: "PR進捗とGlobal理解率の集計対象から除外するファイルglobです。有効な配列は既定値を上書きし、空配列ではbinaryと.git以外を再包含できます。単一backslashはseparator、literal backslashは二重backslashで指定します（settings.jsonでは \"a\\\\\\\\b.ts\"）。" });
});

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const resolver = path.join(root, "tools/resolve-ci-vsix-version.mjs");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const sourceFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(target) : entry.name.endsWith(".ts") ? [target] : [];
});

const relocatedModules = [
  "composition/extension.ts",
  "composition/current-context/git-candidates.ts",
  "composition/global-understanding/create-source.ts",
  "composition/global-understanding/workspace-source.ts",
  "composition/local-git/base-head-runtime.ts",
  "composition/pull-request/review-runtime.ts",
  "composition/pull-request/review-runtime-base.ts",
  "composition/review-contexts/runtime.ts",
  "composition/review-contexts/new-pull-request-global.ts",
  "composition/review-contexts/pull-request-owner-synchronization.ts",
  "application/global-understanding/document-open-lifecycle.ts",
  "application/global-understanding/startup-documents.ts",
  "application/review-commands/pull-request-review-projection-notifier.ts",
  "application/review-commands/pull-request-review-projection-sync.ts",
  "application/review-contexts/repository-resolution.ts",
  "application/review-contexts/repository-selection.ts",
  "application/review-contexts/repository-selection-cancellation.ts",
  "ui/current-context/candidate-identity.ts",
  "ui/current-context/dependent-projection-refresh.ts",
  "ui/pr-progress/repository-working-tree-file-target.ts"
];

test("production modules use responsibility names, not task-number filenames", () => {
  const invalid = sourceFiles(path.join(root, "src"))
    .filter((file) => /^t-?\d{3}(?:-|\.)/iu.test(path.basename(file)))
    .map((file) => path.relative(root, file));
  assert.deepEqual(invalid, [], "task-number production files must be moved and renamed");
  for (const module of relocatedModules) assert.ok(existsSync(path.join(root, "src", module)), module);
});

test("the packaged activation entry point names the production composition root", () => {
  assert.equal(JSON.parse(read("package.json")).main, "./dist/composition/extension.js");
  const activation = read("src/composition/extension.ts");
  assert.match(activation, /export (?:async )?function activate\b/u);
  assert.match(activation, /export (?:async )?function deactivate\b/u);
});

test("relocated production imports resolve and inner layers do not import composition", () => {
  for (const file of sourceFiles(path.join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    const modules = text.matchAll(/\b(?:from\s*|import\s*\(|require(?:\.resolve)?\s*\()\s*["'](\.[A-Za-z0-9_./-]+)["']/gu);
    for (const [, specifier] of modules) {
      const target = path.resolve(path.dirname(file), specifier.replace(/\.js$/u, ""));
      assert.ok([target, `${target}.ts`, path.join(target, "index.ts")].some(existsSync), `${file}: ${specifier}`);
      const sourceLayer = path.relative(path.join(root, "src"), file).split(path.sep)[0];
      const targetLayer = path.relative(path.join(root, "src"), target).split(path.sep)[0];
      if (["core", "application", "adapters", "ui"].includes(sourceLayer)) {
        assert.notEqual(targetLayer, "composition", `${file} must not import the composition root`);
      }
    }
  }
});

function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "revmem-ci-version-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "CI version contract");
  git("config", "user.email", "ci-version@example.invalid");
  const commit = (name, file = "change.txt", content = name) => {
    writeFileSync(path.join(cwd, file), content);
    git("add", ".");
    git("commit", "-m", name);
    return git("rev-parse", "HEAD");
  };
  const base = commit("main release", "package.json", '{"version":"0.0.1-pre"}\n');
  git("tag", "0.1.52-pre");
  git("checkout", "-b", "feature");
  const head = commit("branch manifest must not determine base version", "package.json", '{"version":"99.9.9"}\n');
  const run = (baseSha = base, headSha = head, extra = []) => spawnSync(process.execPath,
    [resolver, baseSha, headSha, ...extra], { cwd, encoding: "utf8" });
  const resolve = (baseSha = base, headSha = head) => {
    const result = run(baseSha, headSha);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { cwd, git, commit, base, head, run, resolve };
}

test("CI version uses the branch-point release tag and exactly seven PR HEAD characters", (t) => {
  const f = fixture(t);
  const result = f.resolve();
  assert.equal(result.baseSha, f.base);
  assert.equal(result.headSha, f.head);
  assert.equal(result.baseVersion, "0.1.52-pre");
  assert.equal(result.packageVersion, `0.1.52-pre+${f.head.slice(0, 7)}`);
  assert.equal(result.shortSha, f.head.slice(0, 7));
  assert.equal(readFileSync(path.join(f.cwd, "package.json"), "utf8"), '{"version":"99.9.9"}\n');
});

test("advancing main and unrelated higher tags do not change an existing branch's base version", (t) => {
  const f = fixture(t);
  f.git("checkout", "main");
  const main = f.commit("new main revision");
  f.git("tag", "9.9.9-pre");
  f.git("checkout", "feature");
  const result = f.resolve(main);
  assert.equal(result.baseSha, f.base);
  assert.equal(result.packageVersion, `0.1.52-pre+${f.head.slice(0, 7)}`);
});

test("annotated v-prefixed stable main tags are supported", (t) => {
  const f = fixture(t);
  f.git("tag", "-d", "0.1.52-pre");
  f.git("tag", "-a", "v1.2.3", f.base, "-m", "stable release");
  assert.equal(f.resolve().packageVersion, `1.2.3+${f.head.slice(0, 7)}`);
});

test("a stable version wins over prerelease tags on the same branch-point commit", (t) => {
  const f = fixture(t);
  f.git("tag", "v0.1.52", f.base);
  assert.equal(f.resolve().baseVersion, "0.1.52");
});

test("missing base tags fail instead of using the PR manifest or an unrelated release", (t) => {
  const f = fixture(t);
  f.git("tag", "-d", "0.1.52-pre");
  f.git("tag", "9.9.9-pre", f.head);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No version tag on main branch point/u);
});

test("invalid release tags do not provide version evidence", (t) => {
  const f = fixture(t);
  f.git("tag", "-d", "0.1.52-pre");
  for (const tag of ["v01.2.3", "1.2.3-pre.01", "release-not-a-version"]) f.git("tag", tag, f.base);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No version tag on main branch point/u);
});

test("a synthetic merge checkout is rejected rather than mislabeled with the PR HEAD", (t) => {
  const f = fixture(t);
  f.git("checkout", "main");
  const main = f.commit("main advances");
  f.git("merge", "--no-ff", "feature", "-m", "synthetic merge");
  const result = f.run(main);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Checkout HEAD does not match PR HEAD/u);
});

test("abbreviated or non-hex input SHAs are rejected", (t) => {
  const f = fixture(t);
  for (const sha of [f.head.slice(0, 7), "--help", "z".repeat(40)]) {
    const result = f.run(f.base, sha);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /full 40-character hexadecimal SHA/u);
  }
});

test("numeric and leading-zero short hashes remain valid build metadata", async () => {
  const { formatCiVersion } = await import(new URL("../../tools/resolve-ci-vsix-version.mjs", import.meta.url));
  for (const short of ["0000123", "1234567", "abcdef1"]) {
    assert.equal(formatCiVersion("0.1.52-pre", short + "a".repeat(33)), `0.1.52-pre+${short}`);
  }
});

test("metadata and GitHub outputs preserve the exact source and version identity", (t) => {
  const f = fixture(t);
  const output = path.join(f.cwd, "github-output.txt");
  const metadata = path.join(f.cwd, "version.json");
  const result = spawnSync(process.execPath, [resolver, f.base, f.head, metadata], {
    cwd: f.cwd, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(metadata, "utf8")), JSON.parse(result.stdout));
  const outputs = readFileSync(output, "utf8");
  assert.ok(outputs.includes(`package_version=0.1.52-pre+${f.head.slice(0, 7)}\n`));
  assert.ok(outputs.includes(`head_sha=${f.head}\n`));
  assert.ok(outputs.includes(`base_sha=${f.base}\n`));
});

test("CI tests and packages the PR HEAD, passes the resolved version, and preserves diagnostics", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /node tools\/run-ci-command\.mjs test-tooling node --test test\/tooling\/\*\.test\.mjs/u);
  assert.match(workflow, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(workflow, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(workflow, /node tools\/run-ci-command\.mjs ci-vsix-version node tools\/resolve-ci-vsix-version\.mjs/u);
  assert.match(workflow, /PACKAGE_VERSION: \$\{\{ steps\.ci-version\.outputs\.package_version \}\}/u);
  assert.match(workflow, /node tools\/run-ci-command\.mjs package-vsix npm run package -- "\$PACKAGE_VERSION" --no-git-tag-version --no-update-package-json/u);
  assert.match(workflow, /review-range-user-validation-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(workflow, /node tools\/run-ci-command\.mjs verify-vsix/u);
  assert.match(workflow, /Upload failure diagnostics[\s\S]*?if: failure\(\)/u);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const readProjectFile = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

test("release metadata fixes the first prerelease version in package and lockfile", () => {
  const manifest = JSON.parse(readProjectFile("package.json")) as { version: string };
  const lockfile = JSON.parse(readProjectFile("package-lock.json")) as {
    version: string;
    packages: Record<string, { version?: string }>;
  };

  assert.equal(manifest.version, "0.0.1-pre");
  assert.equal(lockfile.version, "0.0.1-pre");
  assert.equal(lockfile.packages[""].version, "0.0.1-pre");
});

test("release workflow follows SSC triggers, permissions, and checkout structure", () => {
  const workflowPath = ".github/workflows/release-vsix.yml";
  assert.equal(existsSync(resolve(process.cwd(), workflowPath)), true);
  const workflow = readProjectFile(workflowPath);

  assert.match(workflow, /release:\s*[\s\S]*?types:\s*[\s\S]*?- published/);
  assert.match(workflow, /push:\s*[\s\S]*?branches:\s*[\s\S]*?- main/);
  assert.match(workflow, /workflow_dispatch:\s*[\s\S]*?package_version:/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /pull-requests:\s*read/);
  assert.match(workflow, /name: Checkout[\s\S]*?fetch-depth:\s*0/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run test:unit/);
  assert.match(workflow, /npm run test:vscode/);
});

test("release workflow resolves versions like SSC and packages a dynamic VSIX asset", () => {
  const workflow = readProjectFile(".github/workflows/release-vsix.yml");

  assert.match(workflow, /manual_version="\$\{\{ github\.event\.inputs\.package_version \}\}"/);
  assert.match(workflow, /\[\[ "\$event_name" == "release" \]\]/);
  assert.match(workflow, /\[\[ "\$event_name" == "push" && "\$ref_name" == "main" \]\]/);
  assert.match(workflow, /\$\{version_prefix\}-ci\.\$\{GITHUB_RUN_NUMBER\}/);
  assert.match(workflow, /latest_stable_tag=.*\^\(v\)\?\[0-9\]/);
  assert.match(workflow, /latest_prerelease_tag=.*-pre\$/);
  assert.match(workflow, /base_version="\$\{base_version%-pre\}"[\s\S]*?commits_since_base=1/);
  assert.doesNotMatch(workflow, /git rev-list --count "\$\{latest_prerelease_tag\}\.\.HEAD"/);
  assert.match(workflow, /asset_name="review-range-tracker-\$\{package_version\}\.vsix"/);
  assert.match(workflow, /--no-git-tag-version/);
  assert.match(workflow, /--no-update-package-json/);
  assert.match(workflow, /\[\[ "\$package_version" == \*-\* \]\]/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /gh release create "\$tag" "\$asset_path"/);
});

test("release workflow uploads to existing release/manual targets and skips duplicate assets", () => {
  const workflow = readProjectFile(".github/workflows/release-vsix.yml");

  assert.match(workflow, /github\.event_name == 'release' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.event\.release\.tag_name/);
  assert.match(workflow, /gh release view "\$release_tag"/);
  assert.match(workflow, /select\(\.name == \$asset\)/);
  assert.match(workflow, /GitHub Release asset already exists/);
  assert.match(workflow, /GitHub pre-release already exists: \$tag/);
  assert.doesNotMatch(workflow, /RELEASE_VERSION|RELEASE_TAG|ASSET_NAME|ASSET_PATH|concurrency:|remote_main_commit|git worktree|Release metadata does not match/);
});

test("workflow resolver increments one patch from the latest prerelease tag without backfilling commits", () => {
  const workflow = readProjectFile(".github/workflows/release-vsix.yml");
  const stepStart = workflow.indexOf("      - name: Resolve package version\n");
  assert.notEqual(stepStart, -1);
  const scriptStart = workflow.indexOf("        run: |\n", stepStart);
  const nextStep = workflow.indexOf("\n      - name:", scriptStart);
  assert.notEqual(scriptStart, -1);
  assert.notEqual(nextStep, -1);
  const resolver = workflow
    .slice(scriptStart + "        run: |\n".length, nextStep)
    .replace(/^ {10}/gm, "");
  const fixture = mkdtempSync(join(tmpdir(), "release-vsix-contract-"));
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
  };
  const resolveVersion = (): string => {
    const output = join(fixture, "github-output");
    const script = resolver
      .replaceAll("${{ steps.package.outputs.version_seed_manifest }}", "package.json")
      .replaceAll("${{ github.event.inputs.package_version }}", "")
      .replaceAll("${{ github.event_name }}", "push")
      .replaceAll("${{ github.ref_name }}", "main")
      .replaceAll("${{ github.event.release.tag_name }}", "")
      .replaceAll("${{ github.event.release.prerelease }}", "false");
    const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
    execFileSync(bash, ["-c", script], {
      cwd: fixture,
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_RUN_NUMBER: "99" },
      stdio: "pipe"
    });
    return readFileSync(output, "utf8").trim().split(/\r?\n/).at(-1)!.replace("package_version=", "");
  };

  try {
    writeFileSync(join(fixture, "package.json"), '{"version":"0.0.1-pre"}\n');
    git("init", "--initial-branch=main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Release contract test");
    git("add", "package.json");
    git("commit", "-m", "initial");
    git("tag", "0.0.1-pre");
    for (const subject of ["T201", "T202"]) {
      writeFileSync(join(fixture, `${subject}.txt`), "fixture\n");
      git("add", ".");
      git("commit", "-m", subject);
    }
    assert.equal(resolveVersion(), "0.0.2-pre");
    git("tag", "0.0.2-pre");
    writeFileSync(join(fixture, "T109.txt"), "fixture\n");
    git("add", ".");
    git("commit", "-m", "T109");
    assert.equal(resolveVersion(), "0.0.3-pre");
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test("README documents only the currently implemented extension behavior", () => {
  const readme = readProjectFile("README.md");

  for (const heading of [
    "## 現状できること",
    "## インストール方法",
    "## 使い方",
    "## 現在の制限",
    "## 設定",
    "## 開発・検証"
  ]) {
    assert.match(readme, new RegExp(heading));
  }

  assert.match(readme, /VS Code 1\.125\.0 以上/);
  assert.match(readme, /review-range-tracker-<version>\.vsix/);
  assert.match(readme, /0\.0\.1-pre/);
  assert.match(readme, /diff editor/);
  assert.match(readme, /GitHub PR/);
  assert.match(readme, /reviewRange\.showGlobalReviewed/);
  assert.match(readme, /npm run test:unit/);
});

test("VSIX packaging excludes generated release artifacts", () => {
  const ignore = readProjectFile(".vscodeignore");

  assert.match(ignore, /^artifacts\/\*\*$/m);
  assert.match(ignore, /^\*\.vsix$/m);
});

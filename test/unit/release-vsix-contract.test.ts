import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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

test("release workflow creates the fixed prerelease from main pushes and can be run manually", () => {
  const workflowPath = ".github/workflows/release-vsix.yml";
  assert.equal(existsSync(resolve(process.cwd(), workflowPath)), true);
  const workflow = readProjectFile(workflowPath);

  assert.match(workflow, /push:\s*[\s\S]*?branches:\s*\[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run test:unit/);
  assert.match(workflow, /RELEASE_VERSION:\s*0\.0\.1-pre/);
  assert.match(workflow, /RELEASE_TAG:\s*0\.0\.1-pre/);
  assert.match(workflow, /ASSET_NAME:\s*review-range-tracker-0\.0\.1-pre\.vsix/);
  assert.match(workflow, /--pre-release/);
  assert.match(workflow, /gh release create[\s\S]*?--prerelease/);
  assert.match(workflow, /concurrency:[\s\S]*?release-0\.0\.1-pre/);
});

test("release workflow handles reruns without overwriting inconsistent releases", () => {
  const workflow = readProjectFile(".github/workflows/release-vsix.yml");

  assert.match(workflow, /gh release view/);
  assert.match(workflow, /tagName/);
  assert.match(workflow, /isPrerelease/);
  assert.match(workflow, /assets/);
  assert.match(workflow, /Release metadata does not match/);
  assert.match(workflow, /Release already has the expected asset; skipping/);
  assert.match(workflow, /git rev-list -n 1/);
  assert.match(workflow, /git worktree add --detach/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /Refusing to attach a VSIX built from the current HEAD/);
});

test("release workflow permits manual publication only from the current remote main commit", () => {
  const workflow = readProjectFile(".github/workflows/release-vsix.yml");

  assert.match(workflow, /git fetch origin main/);
  assert.match(workflow, /remote_main_commit="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /if \[\[ "\$GITHUB_SHA" != "\$remote_main_commit" \]\]; then/);
  assert.match(workflow, /Refusing to publish from a ref that is not the latest remote main commit/);
});

test("release workflow accepts an existing Release only when its asset set is exactly the fixed VSIX", () => {
  const workflow = readProjectFile(".github/workflows/release-vsix.yml");

  assert.match(workflow, /asset_count="\$\(jq '\.assets \| length' <<<"\$release_json"\)"/);
  assert.match(
    workflow,
    /if \[\[ "\$expected_asset_count" == "1" && "\$asset_count" == "1" \]\]; then/
  );
  assert.match(
    workflow,
    /if \[\[ "\$expected_asset_count" != "0" \|\| "\$asset_count" != "0" \]\]; then[\s\S]*?Release asset set does not match the fixed prerelease contract/
  );
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
  assert.match(readme, /review-range-tracker-0\.0\.1-pre\.vsix/);
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

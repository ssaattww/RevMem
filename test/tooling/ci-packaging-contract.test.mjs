import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

test("CI builds the PR HEAD and fetches history before resolving the main branch point", () => {
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /CI_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(workflow, /CI_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(workflow, /node tools\/run-ci-command\.mjs ci-vsix-version node tools\/resolve-ci-vsix-version\.mjs --head "\$CI_HEAD_SHA" --base "\$CI_BASE_SHA"/u);
});

test("CI uses the resolved version in the VSIX and filenames without modifying tracked manifests", () => {
  assert.match(workflow, /PACKAGE_VERSION: \$\{\{ steps\.ci-version\.outputs\.version \}\}/u);
  assert.match(workflow, /package_args=\("\$PACKAGE_VERSION" "--no-git-tag-version" "--no-update-package-json"/u);
  assert.match(workflow, /review-range-tracker-\$\{PACKAGE_VERSION\}\.vsix/u);
  assert.match(workflow, /review-range-tracker-\$\{PACKAGE_VERSION\}-source\.zip/u);
  assert.match(workflow, /review-range-user-validation-\$\{\{ steps\.ci-version\.outputs\.version \}\}/u);
  assert.doesNotMatch(workflow, /review-range-tracker-\$\{GITHUB_SHA\}/u);
  assert.match(workflow, /git diff --exit-code -- package\.json package-lock\.json/u);
});

test("new regression tests and packaging diagnostics are wired into the required gate", () => {
  assert.equal(manifest.scripts["test:tooling"], "node --test test/tooling/*.test.mjs");
  assert.match(manifest.scripts["test:unit"], /npm run test:tooling/u);
  assert.match(workflow, /node tools\/run-ci-command\.mjs ci-vsix-package npm run package/u);
  assert.match(workflow, /node tools\/run-ci-command\.mjs ci-source-archive git archive/u);
  assert.match(workflow, /- name: Upload failure diagnostics[\s\S]*?if: failure\(\)[\s\S]*?test-output\//u);
});

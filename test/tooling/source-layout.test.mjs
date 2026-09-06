import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedModules = [
  "composition/extension.ts",
  "composition/current-context/git-context-inspection.ts",
  "composition/global-understanding/global-understanding-composition.ts",
  "application/global-understanding/document-open-lifecycle.ts",
  "application/global-understanding/startup-document-observation.ts",
  "application/review-context/projection-refresh.ts",
  "application/repository-path/repository-root-uri.ts",
  "composition/local-git/local-base-head-runtime.ts",
  "composition/pull-request/new-pull-request-global-composition.ts",
  "composition/pull-request/owner-pull-request-synchronization.ts",
  "application/review-contexts/pull-request-review-projection-notifier.ts",
  "application/review-contexts/pull-request-review-projection-sync.ts",
  "composition/pull-request/pull-request-review-runtime-base.ts",
  "composition/pull-request/pull-request-review-runtime.ts",
  "composition/review-contexts/review-contexts-runtime.ts",
  "ui/current-context/root-scoped-candidate-identity.ts",
  "composition/global-understanding/global-understanding-source.ts",
  "application/review-context/repository-resolution.ts",
  "application/review-contexts/repository-selection-cancellation.ts",
  "application/review-contexts/repository-selection.ts",
];

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

test("production modules use responsibility names, not task-number filenames", () => {
  const taskFiles = files(path.join(root, "src"))
    .filter((file) => /^t-?\d+[-.]/iu.test(path.basename(file)))
    .map((file) => path.relative(root, file));
  assert.deepEqual(taskFiles, []);
});

test("runtime composition and reusable policies are placed in their owning folders", () => {
  for (const module of expectedModules) {
    assert.ok(existsSync(path.join(root, "src", module)), `missing src/${module}`);
  }
});

test("the extension entry point targets the renamed production composition", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.main, "./dist/composition/extension.js");
});

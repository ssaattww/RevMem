import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createTemporaryDirectory, pathExists } from "../support/temporary-directory";
import { runOwnedExtensionHostLaunch } from "../vscode/owned-extension-host-launch";
import { cleanupOwnedTemporaryDirectory } from "../vscode/owned-temporary-directory-cleanup";

const cleanupWorkerPath = join(__dirname, "../vscode/run-extension-host-cleanup-worker.js");

test("owned fixture cleanup removes only its supplied temporary root", async () => {
  const temporary = await createTemporaryDirectory("review-range-vscode-owned-fixture-cleanup");
  const diagnostics = await createTemporaryDirectory("owned-fixture-cleanup-diagnostics");
  try {
    await writeFile(join(temporary.path, "fixture.txt"), "fixture", "utf8");

    await cleanupOwnedTemporaryDirectory({
      rootPath: temporary.path,
      workerPath: cleanupWorkerPath,
      timeoutMs: 2_000,
      diagnosticDirectory: diagnostics.path,
      redactPaths: [temporary.path]
    });

    assert.equal(await pathExists(temporary.path), false);
  } finally {
    await diagnostics.cleanup();
  }
});

test("owned fixture cleanup records a private timeout instead of waiting for a stalled cleanup worker", async () => {
  const temporary = await createTemporaryDirectory("review-range-vscode-owned-fixture-cleanup-hang");
  const workerPath = join(temporary.path, "cleanup-hang-worker.cjs");
  const diagnosticsRoot = await createTemporaryDirectory("owned-fixture-cleanup-hang-diagnostics");
  const diagnosticDirectory = join(diagnosticsRoot.path, "diagnostics");
  try {
    await writeFile(workerPath, "setInterval(() => {}, 1000);\n", "utf8");
    await assert.rejects(
      cleanupOwnedTemporaryDirectory({
        rootPath: temporary.path,
        workerPath,
        timeoutMs: 250,
        diagnosticDirectory,
        redactPaths: [temporary.path]
      }),
      /timed-out/u
    );
    const diagnosticFiles = await readdir(diagnosticDirectory);
    assert.equal(diagnosticFiles.length, 1);
    const diagnostics = await readFile(join(diagnosticDirectory, diagnosticFiles[0]!), "utf8");
    assert.match(diagnostics, /"status": "timed-out"/u);
    assert.match(diagnostics, /"termination": "requested"/u);
    assert.doesNotMatch(diagnostics, new RegExp(temporary.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  } finally {
    await temporary.cleanup();
    await diagnosticsRoot.cleanup();
  }
  assert.equal(await pathExists(temporary.path), false);
});

test("parent fixture cleanup guard rejects temporary root, workspace, nested, and non-fixture paths", async () => {
  const fixture = await createTemporaryDirectory("review-range-vscode-parent-guard");
  const nonFixture = await createTemporaryDirectory("owned-fixture-cleanup-non-fixture");
  const diagnostics = await createTemporaryDirectory("owned-fixture-cleanup-guard-diagnostics");
  try {
    for (const rootPath of [tmpdir(), process.cwd(), join(fixture.path, "workspace"), nonFixture.path]) {
      await assert.rejects(
        cleanupOwnedTemporaryDirectory({
          rootPath,
          workerPath: cleanupWorkerPath,
          timeoutMs: 2_000,
          diagnosticDirectory: diagnostics.path,
          redactPaths: [fixture.path, nonFixture.path]
        }),
        /must be one direct review-range-vscode fixture directory/u
      );
    }
    assert.equal(await pathExists(fixture.path), true);
    assert.equal(await pathExists(nonFixture.path), true);
  } finally {
    await fixture.cleanup();
    await nonFixture.cleanup();
    await diagnostics.cleanup();
  }
});

test("cleanup worker independently rejects a non-fixture root before recursive removal", async () => {
  const temporary = await createTemporaryDirectory("owned-fixture-cleanup-worker-guard");
  const diagnostics = await createTemporaryDirectory("owned-fixture-cleanup-worker-guard-diagnostics");
  try {
    await writeFile(join(temporary.path, "must-remain.txt"), "fixture", "utf8");
    await assert.rejects(
      runOwnedExtensionHostLaunch({
        phase: "cleanup-worker-guard",
        workerPath: cleanupWorkerPath,
        workerArguments: [temporary.path],
        timeoutMs: 2_000,
        diagnosticDirectory: diagnostics.path,
        redactPaths: [temporary.path]
      }),
      /failed/u
    );
    assert.equal(await pathExists(temporary.path), true);
    assert.equal(await pathExists(join(temporary.path, "must-remain.txt")), true);
    const diagnosticFiles = await readdir(diagnostics.path);
    assert.equal(diagnosticFiles.length, 1);
    const diagnostic = await readFile(join(diagnostics.path, diagnosticFiles[0]!), "utf8");
    assert.match(diagnostic, /must be one direct review-range-vscode fixture directory/u);
  } finally {
    await temporary.cleanup();
    await diagnostics.cleanup();
  }
});

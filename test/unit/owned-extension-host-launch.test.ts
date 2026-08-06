import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTemporaryDirectory, pathExists } from "../support/temporary-directory";
import { runOwnedExtensionHostLaunch } from "../vscode/owned-extension-host-launch";

const waitFor = async (condition: () => Promise<boolean>, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for process termination.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
};

const processIsGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
};

test("owned Extension Host launch bounds an intentional process-tree hang and preserves redacted diagnostics", async () => {
  const temporary = await createTemporaryDirectory("owned-extension-host-launch");
  const workerPath = join(temporary.path, "hang-worker.cjs");
  const nestedPidPath = join(temporary.path, "nested.pid");
  const diagnosticDirectory = join(temporary.path, "diagnostics");
  try {
    await writeFile(workerPath, [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      `const nested = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);`,
      `writeFileSync(${JSON.stringify(nestedPidPath)}, String(nested.pid));`,
      "setInterval(() => {}, 1000);"
    ].join("\n"), "utf8");

    await assert.rejects(
      runOwnedExtensionHostLaunch({
        phase: "intentional-hang",
        workerPath,
        configurationPath: join(temporary.path, "configuration.json"),
        timeoutMs: 250,
        diagnosticDirectory,
        redactPaths: [temporary.path]
      }),
      /timed-out/u
    );

    const nestedPid = Number(await readFile(nestedPidPath, "utf8"));
    await waitFor(async () => processIsGone(nestedPid), 2_000);
    const diagnosticFiles = await readdir(diagnosticDirectory);
    assert.equal(diagnosticFiles.length, 1);
    const diagnostics = await readFile(join(diagnosticDirectory, diagnosticFiles[0]!), "utf8");
    assert.match(diagnostics, /"status": "timed-out"/u);
    assert.match(diagnostics, /"termination": "requested"/u);
    assert.doesNotMatch(diagnostics, new RegExp(temporary.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  } finally {
    await temporary.cleanup();
  }
  assert.equal(await pathExists(temporary.path), false, "The owned fixture must be cleaned after a timeout.");
});

test("owned Extension Host launch records finite worker failures without treating them as success", async () => {
  const temporary = await createTemporaryDirectory("owned-extension-host-failure");
  const workerPath = join(temporary.path, "failure-worker.cjs");
  const diagnosticDirectory = join(temporary.path, "diagnostics");
  try {
    await writeFile(workerPath, "process.exit(7);\n", "utf8");
    await assert.rejects(
      runOwnedExtensionHostLaunch({
        phase: "intentional-failure",
        workerPath,
        configurationPath: join(temporary.path, "configuration.json"),
        timeoutMs: 1_000,
        diagnosticDirectory,
        redactPaths: [temporary.path]
      }),
      /failed/u
    );
  } finally {
    await temporary.cleanup();
  }
  assert.equal(await pathExists(temporary.path), false);
});

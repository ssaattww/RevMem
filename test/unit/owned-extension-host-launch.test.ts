import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { createTemporaryDirectory, pathExists } from "../support/temporary-directory";
import { createWorkerOutputCapture, runOwnedExtensionHostLaunch } from "../vscode/owned-extension-host-launch";

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
    assert.match(diagnostics, /"ownedWorkerPid": \d+/u);
    assert.match(diagnostics, /"ownedExtensionHostPids": \[\]/u);
    assert.match(diagnostics, /"termination": "requested"/u);
    assert.doesNotMatch(diagnostics, new RegExp(temporary.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  } finally {
    await temporary.cleanup();
  }
  assert.equal(await pathExists(temporary.path), false, "The owned fixture must be cleaned after a timeout.");
});

test("owned Extension Host launch fails and terminates its tree when success is reported before worker close", async () => {
  const temporary = await createTemporaryDirectory("owned-extension-host-success-without-close");
  const workerPath = join(temporary.path, "success-without-close-worker.cjs");
  const nestedPidPath = join(temporary.path, "nested.pid");
  const diagnosticDirectory = join(temporary.path, "diagnostics");
  try {
    await writeFile(workerPath, [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      `const nested = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);`,
      `writeFileSync(${JSON.stringify(nestedPidPath)}, String(nested.pid));`,
      "process.send({ kind: 'succeeded' });",
      "setInterval(() => {}, 1000);"
    ].join("\n"), "utf8");

    await assert.rejects(
      runOwnedExtensionHostLaunch({
        phase: "success-without-close",
        workerPath,
        configurationPath: join(temporary.path, "configuration.json"),
        timeoutMs: 1_000,
        diagnosticDirectory,
        redactPaths: [temporary.path]
      }),
      /failed/u
    );

    const nestedPid = Number(await readFile(nestedPidPath, "utf8"));
    await waitFor(async () => processIsGone(nestedPid), 2_000);
    const diagnosticFiles = await readdir(diagnosticDirectory);
    assert.equal(diagnosticFiles.length, 1);
    const diagnostics = await readFile(join(diagnosticDirectory, diagnosticFiles[0]!), "utf8");
    assert.match(diagnostics, /"status": "failed"/u);
    assert.match(diagnostics, /reported success but did not close/u);
    assert.match(diagnostics, /"termination": "requested"/u);
  } finally {
    await temporary.cleanup();
  }
  assert.equal(await pathExists(temporary.path), false, "The success-without-close fixture must be cleaned.");
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

test("owned Extension Host launch keeps redacted UTF-8 log ends within the diagnostic cap", async () => {
  const temporary = await createTemporaryDirectory("owned-extension-host-long-diagnostics");
  const workerPath = join(temporary.path, "long-failure-worker.cjs");
  const diagnosticDirectory = join(temporary.path, "diagnostics");
  const stdoutTail = "T306_FAILURE_STDOUT 日本語🙂";
  const stderrTail = "T306_FAILURE_STDERR 日本語🙂";
  try {
    await writeFile(workerPath, [
      "const secret = " + JSON.stringify(temporary.path) + ";",
      "const split = Buffer.from('🙂');",
      "const middle = '中'.repeat(20_000);",
      "process.stdout.write(Buffer.concat([Buffer.from('stdout-head 日本語🙂 ' + secret + '\\n'), split.subarray(0, 2)]));",
      "process.stderr.write(Buffer.concat([Buffer.from('stderr-head 日本語🙂 ' + secret + '\\n'), split.subarray(0, 2)]));",
      "setImmediate(() => {",
      "  process.stdout.write(Buffer.concat([split.subarray(2), Buffer.from('\\n' + middle + '\\n" + stdoutTail + "')]));",
      "  process.stderr.write(Buffer.concat([split.subarray(2), Buffer.from('\\n' + middle + '\\n" + stderrTail + "')]));",
      "  process.exitCode = 7;",
      "  process.disconnect();",
      "});"
    ].join("\n"), "utf8");

    await assert.rejects(
      runOwnedExtensionHostLaunch({
        phase: "long-failure",
        workerPath,
        configurationPath: join(temporary.path, "configuration.json"),
        timeoutMs: 2_000,
        diagnosticDirectory,
        redactPaths: [temporary.path]
      }),
      /failed/u
    );

    const diagnosticFiles = await readdir(diagnosticDirectory);
    assert.equal(diagnosticFiles.length, 1);
    const diagnostics = JSON.parse(
      await readFile(join(diagnosticDirectory, diagnosticFiles[0]!), "utf8")
    ) as {
      readonly status: string;
      readonly exitCode: number | null;
      readonly signal: string | null;
      readonly stdout: string;
      readonly stderr: string;
    };
    for (const output of [diagnostics.stdout, diagnostics.stderr]) {
      assert.ok(output.length <= 16_384);
      assert.match(output, /<truncated middle>/u);
      assert.match(output, /日本語🙂/u);
      assert.doesNotMatch(output, new RegExp(temporary.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    }
    assert.match(diagnostics.stdout, /^stdout-head 日本語🙂 <redacted-path>/u);
    assert.ok(diagnostics.stdout.endsWith(stdoutTail));
    assert.match(diagnostics.stderr, /^stderr-head 日本語🙂 <redacted-path>/u);
    assert.ok(diagnostics.stderr.endsWith(stderrTail));
    assert.equal(diagnostics.status, "failed");
    assert.equal(diagnostics.exitCode, 7);
    assert.equal(diagnostics.signal, null);
  } finally {
    await temporary.cleanup();
  }
  assert.equal(await pathExists(temporary.path), false);
});


test("worker output capture finalizes split UTF-8 and ignores later bytes", () => {
  const stream = new PassThrough();
  const capture = createWorkerOutputCapture(stream);
  stream.write(Buffer.from([0xf0, 0x9f]));
  stream.write(Buffer.from([0x99, 0x82]));

  const snapshot = capture();
  stream.write(Buffer.from("/private/path T306_LATE_FAILURE"));
  assert.equal(snapshot, "🙂");
  assert.equal(capture(), snapshot);
  stream.destroy();
});

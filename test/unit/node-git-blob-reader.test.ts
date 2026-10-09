import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  GitCommandFailedError,
  NodeGitBlobReader
} from "../../src/adapters/local-git/index";
import { createTemporaryDirectory } from "../support/temporary-directory";

const blobObjectId = "abcdef0123456789abcdef0123456789abcdef01";

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const writeFakeGit = async (
  directory: string,
  scriptBody: string,
  processIdPath?: string,
): Promise<string> => {
  const scriptPath = path.join(directory, "fake-git.cjs");
  const executablePath = path.join(directory, "fake-git");
  await writeFile(scriptPath, scriptBody, "utf8");
  await writeFile(
    executablePath,
    `#!/bin/sh\n${processIdPath === undefined ? "" : `printf '%s' "$$" > ${shellQuote(processIdPath)}\n`}exec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"\n`,
    "utf8"
  );
  await chmod(executablePath, 0o755);
  return executablePath;
};

const waitForFile = async (filePath: string, description: string): Promise<string> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const processExists = (processId: number): boolean => {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
};

const waitForProcessExit = async (processId: number): Promise<void> => {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    if (!processExists(processId)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Expected fixture child ${processId} to exit within the cleanup bound`);
};

const killOwnedFixtureChild = async (processId: number | undefined): Promise<void> => {
  if (processId === undefined || !processExists(processId)) return;
  process.kill(processId, "SIGKILL");
  await waitForProcessExit(processId);
};

test("blob timeout waits for process close and preserves partial stdout and stderr", async (context) => {
  if (process.platform === "win32") {
    context.skip("Signal lifecycle fixture uses POSIX SIGTERM semantics.");
    return;
  }

  const temporaryDirectory = await createTemporaryDirectory(
    "review-range-blob-timeout"
  );

  try {
    const executablePath = await writeFakeGit(
      temporaryDirectory.path,
      `
process.stdout.write("partial stdout");
process.stderr.write("partial stderr");
process.on("SIGTERM", () => {
  setTimeout(() => {
    process.stderr.write("\\nshutdown complete");
    process.exit(143);
  }, 80);
});
setInterval(() => {}, 1_000);
`
    );

    const reader = new NodeGitBlobReader({
      executable: executablePath,
      timeoutMs: 1_000
    });

    await assert.rejects(
      reader.readBlob(temporaryDirectory.path, blobObjectId),
      (error: unknown) => {
        assert.ok(error instanceof GitCommandFailedError);
        assert.equal(error.result.exitCode, -1);
        assert.equal(error.result.stdout, "partial stdout");
        assert.match(error.result.stderr, /partial stderr/u);
        assert.match(error.result.stderr, /timed out after 1000 ms/u);
        assert.match(error.result.stderr, /shutdown complete/u);
        return true;
      }
    );
  } finally {
    await temporaryDirectory.cleanup();
  }
});

test("blob timeout escalates to SIGKILL when the process ignores SIGTERM", async (context) => {
  if (process.platform === "win32") {
    context.skip("Signal escalation fixture uses POSIX signals.");
    return;
  }

  const temporaryDirectory = await createTemporaryDirectory(
    "review-range-blob-timeout-escalation"
  );

  try {
    const executablePath = await writeFakeGit(
      temporaryDirectory.path,
      `
process.stdout.write("escalation stdout");
process.stderr.write("escalation stderr");
process.on("SIGTERM", () => {
  process.stderr.write("\\nignored SIGTERM");
});
setTimeout(() => {
  process.stderr.write("\\nnatural fallback exit");
  process.exit(0);
}, 5_000);
`
    );

    const reader = new NodeGitBlobReader({
      executable: executablePath,
      timeoutMs: 1_000,
      terminationGraceMs: 200
    });

    await assert.rejects(
      reader.readBlob(temporaryDirectory.path, blobObjectId),
      (error: unknown) => {
        assert.ok(error instanceof GitCommandFailedError);
        assert.equal(error.result.exitCode, -1);
        assert.equal(error.result.stdout, "escalation stdout");
        assert.match(error.result.stderr, /escalation stderr/u);
        assert.match(error.result.stderr, /ignored SIGTERM/u);
        assert.match(error.result.stderr, /timed out after 1000 ms/u);
        assert.match(error.result.stderr, /SIGKILL/u);
        assert.doesNotMatch(error.result.stderr, /natural fallback exit/u);
        return true;
      }
    );
  } finally {
    await temporaryDirectory.cleanup();
  }
});

test("blob abort escalates to SIGKILL when the owned process ignores SIGTERM", async (context) => {
  if (process.platform === "win32") {
    context.skip("Signal escalation fixture uses POSIX SIGTERM semantics.");
    return;
  }

  const temporaryDirectory = await createTemporaryDirectory("review-range-blob-abort-escalation");
  const processIdPath = path.join(temporaryDirectory.path, "child-pid");
  const readyPath = path.join(temporaryDirectory.path, "child-ready");
  const termPath = path.join(temporaryDirectory.path, "term-received");
  let processId: number | undefined;

  try {
    const executablePath = await writeFakeGit(
      temporaryDirectory.path,
      `
process.on("SIGTERM", () => require("node:fs").writeFileSync(${JSON.stringify(termPath)}, "term"));
require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready");
setInterval(() => {}, 1_000);
`,
      processIdPath,
    );
    const reader = new NodeGitBlobReader({ timeoutMs: 5_000, terminationGraceMs: 100, executable: executablePath });
    const controller = new AbortController();
    const running = reader.readBlob(temporaryDirectory.path, blobObjectId, undefined, controller.signal);
    processId = Number(await waitForFile(processIdPath, "fixture child PID"));
    await waitForFile(readyPath, "fixture child signal handler");

    controller.abort();

    await assert.rejects(running, { name: "AbortError" });
    await waitForFile(termPath, "fixture child to receive SIGTERM");
    await waitForProcessExit(processId);
  } finally {
    await killOwnedFixtureChild(processId);
    await temporaryDirectory.cleanup();
  }
});

test("blob abort during timeout termination keeps the existing SIGKILL escalation", async (context) => {
  if (process.platform === "win32") {
    context.skip("Signal escalation fixture uses POSIX SIGTERM semantics.");
    return;
  }

  const temporaryDirectory = await createTemporaryDirectory("review-range-blob-timeout-abort");
  const processIdPath = path.join(temporaryDirectory.path, "child-pid");
  const readyPath = path.join(temporaryDirectory.path, "child-ready");
  const termPath = path.join(temporaryDirectory.path, "term-received");
  let processId: number | undefined;

  try {
    const executablePath = await writeFakeGit(
      temporaryDirectory.path,
      `
process.on("SIGTERM", () => require("node:fs").writeFileSync(${JSON.stringify(termPath)}, "term"));
require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready");
setInterval(() => {}, 1_000);
`,
      processIdPath,
    );
    const reader = new NodeGitBlobReader({ timeoutMs: 1_000, terminationGraceMs: 500, executable: executablePath });
    const controller = new AbortController();
    const running = reader.readBlob(temporaryDirectory.path, blobObjectId, undefined, controller.signal);
    processId = Number(await waitForFile(processIdPath, "fixture child PID"));
    await waitForFile(readyPath, "fixture child signal handler");
    await waitForFile(termPath, "timeout to send SIGTERM");

    controller.abort();

    await assert.rejects(running, { name: "AbortError" });
    await waitForProcessExit(processId);
  } finally {
    await killOwnedFixtureChild(processId);
    await temporaryDirectory.cleanup();
  }
});

test("blob abort waits for bounded cleanup when SIGTERM closes the child", async (context) => {
  if (process.platform === "win32") {
    context.skip("Signal lifecycle fixture uses POSIX SIGTERM semantics.");
    return;
  }

  const temporaryDirectory = await createTemporaryDirectory("review-range-blob-abort-close");
  const processIdPath = path.join(temporaryDirectory.path, "child-pid");
  const readyPath = path.join(temporaryDirectory.path, "child-ready");
  let processId: number | undefined;

  try {
    const executablePath = await writeFakeGit(
      temporaryDirectory.path,
      `
process.on("SIGTERM", () => process.exit(143));
require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready");
setInterval(() => {}, 1_000);
`,
      processIdPath,
    );
    const reader = new NodeGitBlobReader({ timeoutMs: 5_000, terminationGraceMs: 200, executable: executablePath });
    const controller = new AbortController();
    const running = reader.readBlob(temporaryDirectory.path, blobObjectId, undefined, controller.signal);
    processId = Number(await waitForFile(processIdPath, "fixture child PID"));
    await waitForFile(readyPath, "fixture child signal handler");

    controller.abort();

    await assert.rejects(running, { name: "AbortError" });
    await waitForProcessExit(processId);
  } finally {
    await killOwnedFixtureChild(processId);
    await temporaryDirectory.cleanup();
  }
});

test("blob abort racing with a spawn error remains an AbortError", async () => {
  const temporaryDirectory = await createTemporaryDirectory("review-range-blob-abort-spawn-error");
  try {
    const reader = new NodeGitBlobReader({ executable: path.join(temporaryDirectory.path, "missing-git") });
    const controller = new AbortController();
    const running = reader.readBlob(temporaryDirectory.path, blobObjectId, undefined, controller.signal);
    controller.abort();

    await assert.rejects(running, { name: "AbortError" });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  } finally {
    await temporaryDirectory.cleanup();
  }
});

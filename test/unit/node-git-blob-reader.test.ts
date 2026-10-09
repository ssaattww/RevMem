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

const safeFixtureProcessId = (value: string): number | undefined => {
  const normalized = value.trim();
  if (!/^[0-9]+$/u.test(normalized)) return undefined;
  const processId = Number(normalized);
  return Number.isSafeInteger(processId) && processId > 1 ? processId : undefined;
};
const assertOwnedProcessId = (processId: number): void => {
  if (!Number.isSafeInteger(processId) || processId <= 1) {
    throw new RangeError("Fixture child PID must be a positive safe integer greater than 1");
  }
};

const writeFakeGit = async (
  directory: string,
  scriptBody: string,
  processIdPath?: string,
): Promise<string> => {
  const scriptPath = path.join(directory, "fake-git.cjs");
  const executablePath = path.join(directory, "fake-git");
  const processIdTempPath = processIdPath === undefined ? undefined : `${processIdPath}.tmp`;
  const processIdPrelude = processIdTempPath === undefined || processIdPath === undefined
    ? ""
    : `const fixtureFs = require("node:fs");\nfixtureFs.writeFileSync(${JSON.stringify(processIdTempPath)}, String(process.pid));\nfixtureFs.renameSync(${JSON.stringify(processIdTempPath)}, ${JSON.stringify(processIdPath)});\n`;
  await writeFile(scriptPath, `${processIdPrelude}${scriptBody}`, "utf8");
  await writeFile(
    executablePath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"\n`,
    "utf8"
  );
  await chmod(executablePath, 0o755);
  return executablePath;
};

const waitForFile = async (
  filePath: string,
  description: string,
  assertReadPending?: () => void,
): Promise<string> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    assertReadPending?.();
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const waitForOwnedProcessId = async (filePath: string, assertReadPending: () => void): Promise<number> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    assertReadPending();
    try {
      const processId = safeFixtureProcessId(await readFile(filePath, "utf8"));
      if (processId !== undefined) return processId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for a complete, safe fixture child PID");
};

const recoverOwnedProcessId = async (filePath: string): Promise<number | undefined> => {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    try {
      const processId = safeFixtureProcessId(await readFile(filePath, "utf8"));
      if (processId !== undefined) return processId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
};

const watchReadSettlement = (running: Promise<Uint8Array>): (() => void) => {
  let settlement: { readonly error: unknown } | undefined;
  void running.then(
    () => { settlement = { error: new Error("Git blob read resolved before fixture readiness") }; },
    (error: unknown) => { settlement = { error }; },
  );
  return () => {
    if (settlement !== undefined) {
      throw new Error("Git blob read settled before fixture readiness", { cause: settlement.error });
    }
  };
};

const processExists = (processId: number): boolean => {
  assertOwnedProcessId(processId);
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
  if (processId === undefined) return;
  assertOwnedProcessId(processId);
  if (!processExists(processId)) return;
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
  let running: Promise<Uint8Array> | undefined;
  const controller = new AbortController();

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
    running = reader.readBlob(temporaryDirectory.path, blobObjectId, undefined, controller.signal);
    const assertReadPending = watchReadSettlement(running);
    processId = await waitForOwnedProcessId(processIdPath, assertReadPending);
    await waitForFile(readyPath, "fixture child signal handler", assertReadPending);

    controller.abort();

    await assert.rejects(running, { name: "AbortError" });
    await waitForFile(termPath, "fixture child to receive SIGTERM");
    await waitForProcessExit(processId);
  } finally {
    if (!controller.signal.aborted) controller.abort();
    await running?.catch(() => undefined);
    await killOwnedFixtureChild(processId ?? await recoverOwnedProcessId(processIdPath));
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
  let running: Promise<Uint8Array> | undefined;
  const controller = new AbortController();

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
    running = reader.readBlob(temporaryDirectory.path, blobObjectId, undefined, controller.signal);
    const assertReadPending = watchReadSettlement(running);
    processId = await waitForOwnedProcessId(processIdPath, assertReadPending);
    await waitForFile(readyPath, "fixture child signal handler", assertReadPending);
    await waitForFile(termPath, "timeout to send SIGTERM");

    controller.abort();

    await assert.rejects(running, { name: "AbortError" });
    await waitForProcessExit(processId);
  } finally {
    if (!controller.signal.aborted) controller.abort();
    await running?.catch(() => undefined);
    await killOwnedFixtureChild(processId ?? await recoverOwnedProcessId(processIdPath));
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
  let running: Promise<Uint8Array> | undefined;
  const controller = new AbortController();

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
    running = reader.readBlob(temporaryDirectory.path, blobObjectId, undefined, controller.signal);
    const assertReadPending = watchReadSettlement(running);
    processId = await waitForOwnedProcessId(processIdPath, assertReadPending);
    await waitForFile(readyPath, "fixture child signal handler", assertReadPending);

    controller.abort();

    await assert.rejects(running, { name: "AbortError" });
    await waitForProcessExit(processId);
  } finally {
    if (!controller.signal.aborted) controller.abort();
    await running?.catch(() => undefined);
    await killOwnedFixtureChild(processId ?? await recoverOwnedProcessId(processIdPath));
    await temporaryDirectory.cleanup();
  }
});

test("fixture child PID validation rejects process-group and invalid IDs", () => {
  for (const value of ["", "0", "1", "-1", "1.5", "Infinity", "NaN", "9007199254740992", "12x"]) {
    assert.equal(safeFixtureProcessId(value), undefined, `must reject ${JSON.stringify(value)}`);
  }
  assert.equal(safeFixtureProcessId("12345\n"), 12345);
  for (const processId of [0, 1, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.throws(() => processExists(processId), /greater than 1/u);
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

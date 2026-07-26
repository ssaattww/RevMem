import assert from "node:assert/strict";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  GitCommandFailedError,
  NodeGitBlobReader
} from "../../src/adapters/local-git/index";
import { createTemporaryDirectory } from "../support/temporary-directory";

const blobObjectId = "abcdef0123456789abcdef0123456789abcdef01";

const writeFakeGit = async (
  directory: string,
  scriptBody: string
): Promise<string> => {
  const scriptPath = path.join(directory, "fake-git.cjs");
  const executablePath = path.join(directory, "fake-git");
  await writeFile(scriptPath, scriptBody, "utf8");
  await writeFile(
    executablePath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"\n`,
    "utf8"
  );
  await chmod(executablePath, 0o755);
  return executablePath;
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
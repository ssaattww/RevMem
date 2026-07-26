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

test("blob timeout waits for process close and preserves partial stdout and stderr", async (context) => {
  if (process.platform === "win32") {
    context.skip("Signal lifecycle fixture uses POSIX SIGTERM semantics.");
    return;
  }

  const temporaryDirectory = await createTemporaryDirectory(
    "review-range-blob-timeout"
  );
  const scriptPath = path.join(temporaryDirectory.path, "fake-git.cjs");
  const executablePath = path.join(temporaryDirectory.path, "fake-git");

  try {
    await writeFile(
      scriptPath,
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
`,
      "utf8"
    );
    await writeFile(
      executablePath,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"\n`,
      "utf8"
    );
    await chmod(executablePath, 0o755);

    const reader = new NodeGitBlobReader({
      executable: executablePath,
      timeoutMs: 40
    });
    const startedAt = Date.now();

    await assert.rejects(
      reader.readBlob(temporaryDirectory.path, blobObjectId),
      (error: unknown) => {
        assert.ok(error instanceof GitCommandFailedError);
        assert.equal(error.result.exitCode, -1);
        assert.equal(error.result.stdout, "partial stdout");
        assert.match(error.result.stderr, /partial stderr/u);
        assert.match(error.result.stderr, /timed out after 40 ms/u);
        assert.match(error.result.stderr, /shutdown complete/u);
        assert.ok(
          Date.now() - startedAt >= 90,
          "Timeout failure must wait for the child close lifecycle."
        );
        return true;
      }
    );
  } finally {
    await temporaryDirectory.cleanup();
  }
});

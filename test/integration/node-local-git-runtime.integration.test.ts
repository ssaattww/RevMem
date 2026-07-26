import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index";
import { createTemporaryDirectory } from "../support/temporary-directory";

const commitObjectId = "0123456789abcdef0123456789abcdef01234567";
const blobObjectId = "abcdef0123456789abcdef0123456789abcdef01";

test("node Local Git runtime uses one configured executable for metadata and blob content", async (context) => {
  if (process.platform === "win32") {
    context.skip("Portable executable fixture uses a POSIX shell wrapper.");
    return;
  }

  const temporaryDirectory = await createTemporaryDirectory("review-range-portable-git");
  const scriptPath = path.join(temporaryDirectory.path, "fake-git.cjs");
  const executablePath = path.join(temporaryDirectory.path, "portable-git");
  const logPath = path.join(temporaryDirectory.path, "git-invocations.jsonl");
  const previousPath = process.env.PATH;

  try {
    const fakeGitScript = `
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
const commit = ${JSON.stringify(commitObjectId)};
const blob = ${JSON.stringify(blobObjectId)};
if (args.join(" ") === "rev-parse --verify --quiet " + commit + "^{commit}") {
  process.stdout.write(commit + "\\n");
} else if (
  args[0] === "ls-tree" &&
  args[1] === "--full-tree" &&
  args[2] === "-z" &&
  args[3] === commit &&
  args[4] === "--" &&
  args[5] === ":(literal)fixture.txt"
) {
  process.stdout.write("100644 blob " + blob + "\\tfixture.txt\\0");
} else if (args.join(" ") === "cat-file blob " + blob) {
  process.stdout.write("portable content\\n");
} else {
  process.stderr.write("unexpected fake Git invocation: " + JSON.stringify(args));
  process.exitCode = 2;
}
`;
    const wrapper = `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"\n`;
    await writeFile(scriptPath, fakeGitScript, "utf8");
    await writeFile(executablePath, wrapper, "utf8");
    await chmod(executablePath, 0o755);

    process.env.PATH = "";
    const adapter = createNodeLocalGitAdapter({
      executable: executablePath,
      timeoutMs: 5_000
    });

    assert.deepEqual(
      await adapter.readTextFileAtRevision(
        temporaryDirectory.path,
        commitObjectId,
        "fixture.txt",
        "posix"
      ),
      { kind: "found", content: "portable content\n" }
    );

    const invocations = (await readFile(logPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    assert.deepEqual(invocations, [
      ["rev-parse", "--verify", "--quiet", `${commitObjectId}^{commit}`],
      [
        "ls-tree",
        "--full-tree",
        "-z",
        commitObjectId,
        "--",
        ":(literal)fixture.txt"
      ],
      ["cat-file", "blob", blobObjectId]
    ]);
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    await temporaryDirectory.cleanup();
  }
});

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runTests } from "@vscode/test-electron";

import { createTemporaryDirectory, pathExists } from "../support/temporary-directory";

const VS_CODE_TEST_VERSION = "1.130.0";
const TEST_PHASE_ENVIRONMENT_VARIABLE = "REVIEW_RANGE_TEST_PHASE";
const testPhases = [
  "confirm",
  "restore-confirmed-and-unmark",
  "restore-unmarked"
] as const;

async function main(): Promise<void> {
  const projectRoot = resolve(__dirname, "../../..");
  const temporaryDirectory = await createTemporaryDirectory("review-range-vscode");
  const workspacePath = join(temporaryDirectory.path, "workspace");
  const userDataPath = join(temporaryDirectory.path, "user-data");
  const extensionsPath = join(temporaryDirectory.path, "extensions");

  try {
    await Promise.all([mkdir(workspacePath), mkdir(userDataPath), mkdir(extensionsPath)]);

    for (const phase of testPhases) {
      process.env[TEST_PHASE_ENVIRONMENT_VARIABLE] = phase;
      await runTests({
        cachePath: join(projectRoot, ".vscode-test"),
        extensionDevelopmentPath: projectRoot,
        extensionTestsPath: join(__dirname, "suite"),
        launchArgs: [
          workspacePath,
          "--user-data-dir",
          userDataPath,
          "--extensions-dir",
          extensionsPath,
          "--disable-extensions"
        ],
        version: VS_CODE_TEST_VERSION
      });
    }
  } finally {
    delete process.env[TEST_PHASE_ENVIRONMENT_VARIABLE];
    await temporaryDirectory.cleanup();
  }

  if (await pathExists(temporaryDirectory.path)) {
    throw new Error("VS Code test fixture cleanup failed.");
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

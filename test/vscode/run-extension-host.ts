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
  const focusedT306 = process.argv.includes("--t306");
  const projectRoot = resolve(__dirname, "../../..");
  const temporaryDirectory = await createTemporaryDirectory("review-range-vscode");
  const launchArgsFor = (
    workspacePath: string,
    userDataPath: string,
    extensionsPath: string
  ): string[] => [
    workspacePath,
    "--user-data-dir",
    userDataPath,
    "--extensions-dir",
    extensionsPath,
    "--disable-extensions"
  ];
  const t306Paths = {
    workspace: join(temporaryDirectory.path, "t306-workspace"),
    userData: join(temporaryDirectory.path, "t306-user-data"),
    extensions: join(temporaryDirectory.path, "t306-extensions")
  };
  const t302Paths = {
    workspace: join(temporaryDirectory.path, "t302-workspace"),
    userData: join(temporaryDirectory.path, "t302-user-data"),
    extensions: join(temporaryDirectory.path, "t302-extensions")
  };
  const lifecyclePaths = {
    workspace: join(temporaryDirectory.path, "lifecycle-workspace"),
    userData: join(temporaryDirectory.path, "lifecycle-user-data"),
    extensions: join(temporaryDirectory.path, "lifecycle-extensions")
  };

  try {
    await Promise.all([
      ...Object.values(t306Paths),
      ...Object.values(t302Paths),
      ...Object.values(lifecyclePaths)
    ].map((path) => mkdir(path)));

    await runTests({
      cachePath: join(projectRoot, ".vscode-test"),
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath: join(__dirname, "t306-suite"),
      launchArgs: launchArgsFor(
        t306Paths.workspace,
        t306Paths.userData,
        t306Paths.extensions
      ),
      version: VS_CODE_TEST_VERSION
    });

    if (focusedT306) return;

    await runTests({
      cachePath: join(projectRoot, ".vscode-test"),
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath: join(__dirname, "t302-suite"),
      launchArgs: launchArgsFor(
        t302Paths.workspace,
        t302Paths.userData,
        t302Paths.extensions
      ),
      version: VS_CODE_TEST_VERSION
    });

    for (const phase of testPhases) {
      process.env[TEST_PHASE_ENVIRONMENT_VARIABLE] = phase;
      await runTests({
        cachePath: join(projectRoot, ".vscode-test"),
        extensionDevelopmentPath: projectRoot,
        extensionTestsPath: join(__dirname, "suite"),
        launchArgs: launchArgsFor(
          lifecyclePaths.workspace,
          lifecyclePaths.userData,
          lifecyclePaths.extensions
        ),
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

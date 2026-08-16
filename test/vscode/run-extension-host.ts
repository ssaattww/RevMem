import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createTemporaryDirectory, pathExists } from "../support/temporary-directory";
import { runOwnedExtensionHostLaunch } from "./owned-extension-host-launch";
import { cleanupOwnedTemporaryDirectory } from "./owned-temporary-directory-cleanup";

const VS_CODE_TEST_VERSION = "1.130.0";
const testPhases = [
  "confirm",
  "restore-confirmed-and-unmark",
  "restore-unmarked"
] as const;
const t506Phases = [
  "mark-context-a",
  "restore-context-b-unmark-global",
  "restore-context-a"
] as const;
const DEFAULT_LAUNCH_TIMEOUT_MS = 120_000;
const FIXTURE_CLEANUP_TIMEOUT_MS = 10_000;

const launchTimeout = (): number => {
  const configured = process.env.REVIEW_RANGE_VSCODE_LAUNCH_TIMEOUT_MS;
  if (configured === undefined) return DEFAULT_LAUNCH_TIMEOUT_MS;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 100) {
    throw new RangeError("REVIEW_RANGE_VSCODE_LAUNCH_TIMEOUT_MS must be an integer of at least 100.");
  }
  return value;
};

async function main(): Promise<void> {
  const focusedT306 = process.argv.includes("--t306");
  const focusedT506 = process.argv.includes("--t506");
  const projectRoot = resolve(__dirname, "../../..");
  const temporaryDirectory = await createTemporaryDirectory("review-range-vscode");
  const workerPath = join(__dirname, "run-extension-host-launch-worker.js");
  const cleanupWorkerPath = join(__dirname, "run-extension-host-cleanup-worker.js");
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
  const t506Paths = {
    workspace: join(temporaryDirectory.path, "t506-workspace"),
    userData: join(temporaryDirectory.path, "t506-user-data"),
    extensions: join(temporaryDirectory.path, "t506-extensions")
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
  const launch = async (
    phase: string,
    paths: { readonly workspace: string; readonly userData: string; readonly extensions: string },
    extensionTestsPath: string,
    lifecyclePhase?: string
  ): Promise<void> => {
    const configurationPath = join(temporaryDirectory.path, `${phase}.launch.json`);
    await writeFile(configurationPath, `${JSON.stringify({
      cachePath: join(projectRoot, ".vscode-test"),
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath,
      launchArgs: launchArgsFor(paths.workspace, paths.userData, paths.extensions),
      version: VS_CODE_TEST_VERSION,
      ...(lifecyclePhase === undefined ? {} : { phase: lifecyclePhase })
    })}\n`, "utf8");
    await runOwnedExtensionHostLaunch({
      phase,
      workerPath,
      configurationPath,
      timeoutMs: launchTimeout(),
      diagnosticDirectory: join(projectRoot, "test-output", "vscode-launch-diagnostics"),
      redactPaths: [temporaryDirectory.path, projectRoot, paths.workspace, paths.userData, paths.extensions]
    });
  };

  try {
    await Promise.all([
      ...Object.values(t306Paths),
      ...Object.values(t506Paths),
      ...Object.values(t302Paths),
      ...Object.values(lifecyclePaths)
    ].map((path) => mkdir(path)));

    if (focusedT506) {
      for (const phase of t506Phases) {
        await launch(`t506-${phase}`, t506Paths, join(__dirname, "t506-suite"), phase);
      }
      return;
    }

    await launch("t306", t306Paths, join(__dirname, "t306-suite"));

    if (focusedT306) return;

    await launch("t302", t302Paths, join(__dirname, "t302-suite"));

    for (const phase of testPhases) {
      await launch(`lifecycle-${phase}`, lifecyclePaths, join(__dirname, "suite"), phase);
    }
  } finally {
    await cleanupOwnedTemporaryDirectory({
      rootPath: temporaryDirectory.path,
      workerPath: cleanupWorkerPath,
      timeoutMs: FIXTURE_CLEANUP_TIMEOUT_MS,
      diagnosticDirectory: join(projectRoot, "test-output", "vscode-launch-diagnostics"),
      redactPaths: [temporaryDirectory.path, projectRoot]
    });
  }

  if (await pathExists(temporaryDirectory.path)) {
    throw new Error("VS Code test fixture cleanup failed.");
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

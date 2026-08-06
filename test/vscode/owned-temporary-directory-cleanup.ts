import { isAbsolute, relative } from "node:path";

import { pathExists } from "../support/temporary-directory";
import { runOwnedExtensionHostLaunch } from "./owned-extension-host-launch";
import { requireOwnedTemporaryDirectoryRoot } from "./owned-temporary-directory-root";

/** Bounds removal of one exact test fixture root in a separately owned worker. */
export const cleanupOwnedTemporaryDirectory = async (input: {
  readonly rootPath: string;
  readonly workerPath: string;
  readonly timeoutMs: number;
  readonly diagnosticDirectory: string;
  readonly redactPaths: readonly string[];
}): Promise<void> => {
  const rootPath = await requireOwnedTemporaryDirectoryRoot(input.rootPath);
  const diagnosticRelativePath = relative(rootPath, input.diagnosticDirectory);
  if (
    diagnosticRelativePath.length === 0 ||
    (!diagnosticRelativePath.startsWith("..") && !isAbsolute(diagnosticRelativePath))
  ) {
    throw new Error("Owned temporary-directory cleanup diagnostics must be outside its root.");
  }
  await runOwnedExtensionHostLaunch({
    phase: "vscode-fixture-cleanup",
    workerPath: input.workerPath,
    workerArguments: [rootPath],
    timeoutMs: input.timeoutMs,
    diagnosticDirectory: input.diagnosticDirectory,
    redactPaths: input.redactPaths
  });
  if (await pathExists(rootPath)) {
    throw new Error("Owned temporary-directory cleanup reported success without removing its root.");
  }
};

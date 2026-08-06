import { readFile } from "node:fs/promises";

import { runTests } from "@vscode/test-electron";

interface ExtensionHostWorkerConfiguration {
  readonly cachePath: string;
  readonly extensionDevelopmentPath: string;
  readonly extensionTestsPath: string;
  readonly launchArgs: readonly string[];
  readonly version: string;
  readonly phase?: string;
}

const configurationPath = process.env.REVIEW_RANGE_EXTENSION_HOST_LAUNCH_CONFIG;

const send = async (message: { readonly kind: "succeeded" | "failed"; readonly error?: string }): Promise<void> => {
  if (process.send === undefined) return;
  await new Promise<void>((resolveSend) => {
    process.send!(message, () => resolveSend());
  });
};

const main = async (): Promise<void> => {
  if (configurationPath === undefined) throw new Error("Extension Host worker configuration is missing.");
  const configuration = JSON.parse(await readFile(configurationPath, "utf8")) as ExtensionHostWorkerConfiguration;
  if (configuration.phase !== undefined) process.env.REVIEW_RANGE_TEST_PHASE = configuration.phase;
  await runTests({
    cachePath: configuration.cachePath,
    extensionDevelopmentPath: configuration.extensionDevelopmentPath,
    extensionTestsPath: configuration.extensionTestsPath,
    launchArgs: [...configuration.launchArgs],
    version: configuration.version
  });
};

void main().then(
  async () => {
    await send({ kind: "succeeded" });
    process.disconnect?.();
  },
  async (error: unknown) => {
    await send({ kind: "failed", error: error instanceof Error ? error.message : String(error) });
    await new Promise<void>(() => undefined);
  }
);

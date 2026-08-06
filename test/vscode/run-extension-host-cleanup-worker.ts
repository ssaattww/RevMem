import { access, rm } from "node:fs/promises";

import { requireOwnedTemporaryDirectoryRoot } from "./owned-temporary-directory-root";

const rootPath = process.argv[2];

const send = async (message: { readonly kind: "succeeded" | "failed"; readonly error?: string }): Promise<void> => {
  if (process.send === undefined) return;
  await new Promise<void>((resolveSend) => {
    process.send!(message, () => resolveSend());
  });
};

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

const main = async (): Promise<void> => {
  const ownedRootPath = await requireOwnedTemporaryDirectoryRoot(rootPath);
  await rm(ownedRootPath, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: 100
  });
  try {
    await access(ownedRootPath);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error("Owned temporary-directory cleanup did not remove its root.");
};

void main().then(
  async () => {
    await send({ kind: "succeeded" });
    process.disconnect?.();
  },
  async (error: unknown) => {
    await send({
      kind: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
    await new Promise<void>(() => undefined);
  }
);

import type { GitBlobReader } from "../../src/adapters/local-git/index";

/** Blob boundary for tests that exercise metadata-only Local Git behavior. */
export const unreachableGitBlobReader: GitBlobReader = {
  async readBlob(): Promise<Uint8Array> {
    throw new Error("Git blob reader must not be used by this metadata-only test");
  }
};

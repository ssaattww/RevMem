import { createHash } from "node:crypto";

import type { StableHash } from "../../application/workspace-identity/index";

/**
 * Node Extension Host adapter that provides deterministic SHA-256 identities.
 */
export class NodeSha256StableHash implements StableHash {
  /**
   * Hashes UTF-8 text to lowercase hexadecimal SHA-256.
   */
  public digest(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }
}

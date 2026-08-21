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

  /**
   * Hashes large editor text in bounded deterministic character stages.
   * Returning `undefined` fences a superseded decoration request before state lookup.
   */
  public async digestCooperatively(
    value: string,
    maxCharactersPerStage: number,
    yieldControl: () => void | Promise<void>,
    isCurrent: () => boolean,
    accountWork?: (characterCount: number) => void
  ): Promise<string | undefined> {
    if (!Number.isSafeInteger(maxCharactersPerStage) || maxCharactersPerStage <= 0) {
      throw new RangeError("maxCharactersPerStage must be a positive integer.");
    }
    const hash = createHash("sha256");
    for (let start = 0; start < value.length; start += maxCharactersPerStage) {
      if (!isCurrent()) return undefined;
      const end = Math.min(start + maxCharactersPerStage, value.length);
      hash.update(value.slice(start, end), "utf8");
      accountWork?.(end - start);
      if (end < value.length) {
        await yieldControl();
        if (!isCurrent()) return undefined;
      }
    }
    return isCurrent() ? hash.digest("hex") : undefined;
  }
}

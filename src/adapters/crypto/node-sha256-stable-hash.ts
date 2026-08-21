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
    for (let start = 0; start < value.length;) {
      if (!isCurrent()) return undefined;
      let end = Math.min(start + maxCharactersPerStage, value.length);
      // Node encodes each update independently, so a surrogate pair must not
      // cross a stage boundary or the cooperative digest changes its identity.
      if (end < value.length && end > start && /[\uD800-\uDBFF]/u.test(value.charAt(end - 1)) && /[\uDC00-\uDFFF]/u.test(value.charAt(end))) end -= 1;
      if (end === start) end = Math.min(start + 2, value.length);
      hash.update(value.slice(start, end), "utf8");
      accountWork?.(end - start);
      if (end < value.length) {
        await yieldControl();
        if (!isCurrent()) return undefined;
      }
      start = end;
    }
    return isCurrent() ? hash.digest("hex") : undefined;
  }

  /** Hashes document fragments without first materializing one large string. */
  public async digestFragmentsCooperatively(
    fragments: Iterable<string> | AsyncIterable<string>,
    maxCharactersPerStage: number,
    yieldControl: () => void | Promise<void>,
    isCurrent: () => boolean,
    accountWork?: (characterCount: number) => void
  ): Promise<string | undefined> {
    if (!Number.isSafeInteger(maxCharactersPerStage) || maxCharactersPerStage <= 0) throw new RangeError("maxCharactersPerStage must be a positive integer.");
    const hash = createHash("sha256");
    let carried = "";
    let stageCharacters = 0;
    const update = async (fragment: string, final: boolean): Promise<boolean> => {
      let start = 0;
      while (start < fragment.length) {
        if (!isCurrent()) return false;
        const capacity = maxCharactersPerStage - stageCharacters;
        let end = Math.min(start + capacity, fragment.length);
        const holdsTrailingHighSurrogate = !final && end === fragment.length && /[\uD800-\uDBFF]/u.test(fragment.charAt(end - 1));
        if (holdsTrailingHighSurrogate) { carried = fragment.slice(end - 1); end -= 1; }
        if (holdsTrailingHighSurrogate && end === start) return true;
        if (end < fragment.length && end > start && /[\uD800-\uDBFF]/u.test(fragment.charAt(end - 1)) && /[\uDC00-\uDFFF]/u.test(fragment.charAt(end))) end -= 1;
        if (end === start) end = Math.min(start + 2, fragment.length);
        hash.update(fragment.slice(start, end), "utf8");
        stageCharacters += end - start; accountWork?.(end - start); start = holdsTrailingHighSurrogate ? fragment.length : end;
        if (stageCharacters >= maxCharactersPerStage) {
          stageCharacters = 0;
          await yieldControl();
          if (!isCurrent()) return false;
        }
      }
      return true;
    };
    for await (const fragment of fragments) {
      const value = carried + fragment;
      carried = "";
      if (value.length > 0 && !await update(value, false)) return undefined;
    }
    if (carried.length > 0 && !await update(carried, true)) return undefined;
    return isCurrent() ? hash.digest("hex") : undefined;
  }
}

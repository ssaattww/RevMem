import type { RangeMappingOptions } from "../../core/range-mapping/index";

/** Validates the two live-edit settings read at the VS Code composition boundary. */
export const resolveReviewRangeMappingOptions = (input: Readonly<{
  ignoreWhitespaceChanges: unknown;
  ignoreEolChanges: unknown;
}>): Readonly<RangeMappingOptions> => ({
  ignoreWhitespaceChanges: input.ignoreWhitespaceChanges === true,
  ignoreEolChanges: input.ignoreEolChanges === true
});

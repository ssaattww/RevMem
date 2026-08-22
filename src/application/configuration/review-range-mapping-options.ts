import type { RangeMappingOptions } from "../../core/range-mapping/index";

/** Validates the two live-edit settings read at the VS Code composition boundary. */
export const resolveReviewRangeMappingOptions = (input: Readonly<{
  ignoreWhitespaceChanges: unknown;
  ignoreEolChanges: unknown;
}>): Readonly<RangeMappingOptions> => ({
  ignoreWhitespaceChanges: input.ignoreWhitespaceChanges === true,
  ignoreEolChanges: input.ignoreEolChanges === true
});

/** Minimal configuration reader used by all VS Code mapping composition paths. */
export interface ReviewRangeMappingConfiguration {
  get<T>(section: string): T | undefined;
}

/** Reads and validates the shared mapping settings at the VS Code boundary. */
export const readReviewRangeMappingOptions = (
  configuration: ReviewRangeMappingConfiguration
): Readonly<RangeMappingOptions> => {
  return resolveReviewRangeMappingOptions({
    ignoreWhitespaceChanges: configuration.get<unknown>("ignoreWhitespaceChanges"),
    ignoreEolChanges: configuration.get<unknown>("ignoreEolChanges")
  });
};

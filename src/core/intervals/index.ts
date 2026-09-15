/** Public pure interval operations used by review-state and mapping services. */
export {
  findLineIntervalContainingLine,
  lineIntervalLength,
  normalizeLineInterval,
  normalizeLineIntervals,
  subtractLineIntervals
} from "./line-intervals";

/** Public immutable document line-count and EOF-newline contract. */
export {
  deriveDocumentLineContract,
  type DocumentLineContract,
  type RevisionDocumentText,
  type TerminalNewline
} from "./document-line-contract";

/** Public VS Code-independent selection conversion contracts and operation. */
export {
  selectionsToLineIntervals,
  type TextPosition,
  type TextSelection
} from "./selections";

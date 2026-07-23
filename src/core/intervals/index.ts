/** Public pure interval operations used by review-state and mapping services. */
export {
  findLineIntervalContainingLine,
  lineIntervalLength,
  normalizeLineInterval,
  normalizeLineIntervals,
  subtractLineIntervals
} from "./line-intervals";

/** Public VS Code-independent selection conversion contracts and operation. */
export {
  selectionsToLineIntervals,
  type TextPosition,
  type TextSelection
} from "./selections";

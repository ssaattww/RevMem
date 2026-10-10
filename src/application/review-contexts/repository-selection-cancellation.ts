import { ReviewContextsRepositorySelectionCancelled } from "./repository-selection";

export type ReviewContextsCancellationOutcome = "cancelled" | "terminal";

export interface ReviewContextsCancellationBoundary {
  clear(): void;
  reportTerminalFailure(): Promise<void>;
}

/** Keeps an explicit repository-picker cancellation from clearing an accepted projection. */
export const settleReviewContextsRepositorySelection = async (
  error: unknown,
  boundary: ReviewContextsCancellationBoundary,
): Promise<ReviewContextsCancellationOutcome> => {
  if (
    error instanceof ReviewContextsRepositorySelectionCancelled ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "OperationCancelledError"))
  ) return "cancelled";
  boundary.clear();
  await boundary.reportTerminalFailure();
  return "terminal";
};

import { ReviewContextsRepositorySelectionCancelled } from "./t609-review-contexts-repository";

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
  if (error instanceof ReviewContextsRepositorySelectionCancelled) return "cancelled";
  boundary.clear();
  await boundary.reportTerminalFailure();
  return "terminal";
};

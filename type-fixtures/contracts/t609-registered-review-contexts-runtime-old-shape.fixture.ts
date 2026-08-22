import type { RegisteredReviewContextsRuntime } from "../../src/ui/review-contexts";

/** A consumer implementation compiled before Test-only projection snapshots were introduced. */
const legacyRuntime: RegisteredReviewContextsRuntime = {
  refresh: async () => undefined,
  refreshWithErrorBoundary: async () => undefined,
  dispose: () => undefined,
};

void legacyRuntime;

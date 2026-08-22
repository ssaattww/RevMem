import type { RegisteredT405ReviewContextsRuntime } from "../../src/t405-review-contexts-runtime";

/** A consumer implementation compiled before Test-only cancellation snapshots were introduced. */
const legacyRuntime: RegisteredT405ReviewContextsRuntime = {
  refresh: async () => undefined,
  refreshWithErrorBoundary: async () => undefined,
  dispose: () => undefined,
  augmentCurrentContextCandidates: async (candidates) => candidates,
};

void legacyRuntime;

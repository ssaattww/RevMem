import type { GitContextRevisionMappingResult } from "../../src/application/review-context";
import type { RepositoryGlobalState, ReviewContextState } from "../../src/core/contracts";

/** A consumer compiled against the public result shape before optional diagnostics were added. */
const legacyConsumerResult: GitContextRevisionMappingResult = {
  contextState: {} as ReviewContextState,
  globalState: {} as RepositoryGlobalState,
  unresolvedFileIds: [],
};

void legacyConsumerResult;

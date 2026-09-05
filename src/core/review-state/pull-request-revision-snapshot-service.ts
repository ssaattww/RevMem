import {
  captureImmutableRevisionSnapshots as captureBase,
  type CaptureImmutableRevisionSnapshotsInput,
} from "./revision-snapshot-service";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const captureImmutableRevisionSnapshots = (
  input: CaptureImmutableRevisionSnapshotsInput,
): { readonly contextState: import("../contracts/index").ReviewContextState; readonly globalState: import("../contracts/index").RepositoryGlobalState } => {
  if (input.globalState.currentRevisionId === input.revisionId) return captureBase(input);
  if (input.contextState.kind !== "pull-request" || input.contextState.pullRequest?.headSha !== input.revisionId) {
    return captureBase(input);
  }
  const snapshot = input.globalState.revisionSnapshots?.[input.revisionId];
  if (snapshot === undefined) return captureBase(input);
  const projected = captureBase({
    ...input,
    globalState: {
      ...clone(input.globalState),
      currentRevisionId: input.revisionId,
      files: clone(snapshot.files),
      updatedAt: snapshot.updatedAt,
    },
  });
  return {
    contextState: projected.contextState,
    globalState: {
      ...clone(input.globalState),
      revisionSnapshots: {
        ...clone(input.globalState.revisionSnapshots ?? {}),
        [input.revisionId]: clone(projected.globalState.revisionSnapshots![input.revisionId]!),
      },
    },
  };
};

export type { CaptureImmutableRevisionSnapshotsInput };

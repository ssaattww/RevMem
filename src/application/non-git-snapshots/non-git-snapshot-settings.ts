import type { NonGitSnapshotLimits } from "./index";

export const DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOTS = 128;
const DEFAULT_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export interface ConfiguredNonGitSnapshotSettings {
  readonly maxSnapshotFileSizeBytes: number;
}

const requirePositiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
};

/** Converts the user-facing snapshot file-size setting to the tracker limits contract. */
export const resolveConfiguredNonGitSnapshotLimits = (
  settings: ConfiguredNonGitSnapshotSettings
): NonGitSnapshotLimits => ({
  maxSnapshots: DEFAULT_MAX_SNAPSHOTS,
  maxCompressedBytes: requirePositiveSafeInteger(
    settings.maxSnapshotFileSizeBytes,
    "maxSnapshotFileSizeBytes"
  ),
  retentionMs: DEFAULT_RETENTION_MILLISECONDS
});

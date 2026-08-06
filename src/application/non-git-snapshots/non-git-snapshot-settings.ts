import type { NonGitSnapshotLimits } from "./index";

export const DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOTS = 128;
export const DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES =
  DEFAULT_MAX_SNAPSHOTS * DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES;
const DEFAULT_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export interface ConfiguredNonGitSnapshotSettings {
  readonly maxSnapshotFileSizeBytes: unknown;
}

const resolvePositiveSafeInteger = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;

/** Converts the user-facing per-snapshot limit while retaining an independent aggregate budget. */
export const resolveConfiguredNonGitSnapshotLimits = (
  settings: ConfiguredNonGitSnapshotSettings
): NonGitSnapshotLimits => ({
  maxSnapshots: DEFAULT_MAX_SNAPSHOTS,
  maxSnapshotCompressedBytes: resolvePositiveSafeInteger(
    settings.maxSnapshotFileSizeBytes,
    DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES
  ),
  maxTotalCompressedBytes: DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES,
  retentionMs: DEFAULT_RETENTION_MILLISECONDS
});

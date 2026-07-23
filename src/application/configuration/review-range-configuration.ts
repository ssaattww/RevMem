/**
 * Enables one optional decoration category.
 */
export interface ReviewRangeDecorationConfiguration {
  /** Whether this optional decoration category is rendered. */
  enabled: boolean;
}

/**
 * Optional decoration categories controlled by configuration.
 */
export interface ReviewRangeDecorationsConfiguration {
  /** Decoration options for ranges invalidated by a detected change. */
  changed: ReviewRangeDecorationConfiguration;
  /** Decoration options for ranges whose mapping certainty is unresolved. */
  unresolved: ReviewRangeDecorationConfiguration;
}

/**
 * Configuration values consumed by the application layer, independent of the
 * configuration API that supplies them.
 */
export interface ReviewRangeConfiguration {
  /** Whether currently valid repository-wide Global ranges are displayed. */
  showGlobalReviewed: boolean;
  /** Whether whitespace-only changes are ignored during range mapping. */
  ignoreWhitespaceChanges: boolean;
  /** Whether end-of-line-only changes are ignored during range mapping. */
  ignoreEolChanges: boolean;
  /** Whether reviewed ranges receive a gutter icon. */
  showGutterIcon: boolean;
  /** Whether reviewed ranges receive an overview-ruler marker. */
  showOverviewRuler: boolean;
  /** Glob patterns excluded from review and Global-progress calculation. */
  exclude: string[];
  /** Maximum snapshot payload size in bytes; default is 5 MiB. */
  maxSnapshotFileSizeBytes: number;
  /** History retention in days; `0` retains history indefinitely. */
  historyRetentionDays: number;
  /** Whether closed pull-request layers are visible by default. */
  closedPullRequestLayerDefault: boolean;
  /** Optional visual treatment for detailed non-default internal states. */
  decorations: ReviewRangeDecorationsConfiguration;
}

/**
 * Stable VS Code configuration keys for each application configuration field.
 */
export interface ReviewRangeConfigurationKeys {
  /** Key for the Global-range visibility setting. */
  showGlobalReviewed: "reviewRange.showGlobalReviewed";
  /** Key for the whitespace-change mapping setting. */
  ignoreWhitespaceChanges: "reviewRange.ignoreWhitespaceChanges";
  /** Key for the end-of-line-change mapping setting. */
  ignoreEolChanges: "reviewRange.ignoreEolChanges";
  /** Key for the gutter-icon visibility setting. */
  showGutterIcon: "reviewRange.showGutterIcon";
  /** Key for the overview-ruler visibility setting. */
  showOverviewRuler: "reviewRange.showOverviewRuler";
  /** Key for the excluded-path glob setting. */
  exclude: "reviewRange.exclude";
  /** Key for the maximum snapshot-size setting. */
  maxSnapshotFileSizeBytes: "reviewRange.maxSnapshotFileSizeBytes";
  /** Key for the history-retention setting, where zero is indefinite. */
  historyRetentionDays: "reviewRange.historyRetentionDays";
  /** Key for the default closed-pull-request layer visibility setting. */
  closedPullRequestLayerDefault: "reviewRange.closedPullRequestLayerDefault";
  /** Key for enabling changed-range decorations. */
  decorationsChangedEnabled: "reviewRange.decorations.changed.enabled";
  /** Key for enabling unresolved-range decorations. */
  decorationsUnresolvedEnabled: "reviewRange.decorations.unresolved.enabled";
}

/**
 * Maps the application configuration fields to their stable VS Code setting keys.
 */
export const REVIEW_RANGE_CONFIGURATION_KEYS = {
  showGlobalReviewed: "reviewRange.showGlobalReviewed",
  ignoreWhitespaceChanges: "reviewRange.ignoreWhitespaceChanges",
  ignoreEolChanges: "reviewRange.ignoreEolChanges",
  showGutterIcon: "reviewRange.showGutterIcon",
  showOverviewRuler: "reviewRange.showOverviewRuler",
  exclude: "reviewRange.exclude",
  maxSnapshotFileSizeBytes: "reviewRange.maxSnapshotFileSizeBytes",
  historyRetentionDays: "reviewRange.historyRetentionDays",
  closedPullRequestLayerDefault: "reviewRange.closedPullRequestLayerDefault",
  decorationsChangedEnabled: "reviewRange.decorations.changed.enabled",
  decorationsUnresolvedEnabled: "reviewRange.decorations.unresolved.enabled"
} as const satisfies ReviewRangeConfigurationKeys;

/**
 * Initial configuration defaults from design chapter 15. A retention value of
 * zero represents indefinite history retention.
 */
export const DEFAULT_REVIEW_RANGE_CONFIGURATION: Readonly<ReviewRangeConfiguration> = {
  showGlobalReviewed: true,
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: false,
  showGutterIcon: true,
  showOverviewRuler: false,
  exclude: [
    "**/.git/**",
    "**/node_modules/**",
    "**/bin/**",
    "**/obj/**",
    "**/dist/**",
    "**/build/**"
  ],
  maxSnapshotFileSizeBytes: 5_242_880,
  historyRetentionDays: 0,
  closedPullRequestLayerDefault: false,
  decorations: {
    changed: {
      enabled: false
    },
    unresolved: {
      enabled: false
    }
  }
};

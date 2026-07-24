import type { ReviewFileExclusionPolicyService } from "../../application/file-exclusion/index";

/** Minimal disposable returned by the VS Code configuration event adapter. */
export interface ReviewFileExclusionConfigurationDisposable {
  dispose(): void;
}

/** Platform-neutral projection of one VS Code configuration change. */
export interface ReviewFileExclusionConfigurationChangeEvent {
  readonly affectsExcludeConfiguration: boolean;
}

/** VS Code configuration boundary consumed by the exclusion-policy controller. */
export interface ReviewFileExclusionConfigurationHost {
  /** Reads the effective `reviewRange.exclude` value including manifest/workspace overrides. */
  readExcludeGlobs(): readonly string[];
  /** Subscribes to configuration changes and identifies whether `reviewRange.exclude` changed. */
  onDidChangeConfiguration(
    listener: (event: Readonly<ReviewFileExclusionConfigurationChangeEvent>) => void
  ): ReviewFileExclusionConfigurationDisposable;
  /** Reports an invalid exclusion configuration while preserving the last valid policy. */
  showConfigurationError(error: unknown): void;
}

/** Constructor options for the VS Code exclusion configuration controller. */
export interface ReviewFileExclusionConfigurationControllerOptions {
  readonly service: ReviewFileExclusionPolicyService;
  readonly host: ReviewFileExclusionConfigurationHost;
}

/**
 * Connects the effective VS Code exclusion setting to the shared application policy.
 *
 * The controller reads the setting during activation, reacts only to relevant configuration
 * changes, relies on the service to suppress semantic no-ops, and disposes the platform event
 * subscription during extension deactivation. Invalid settings do not replace the last valid
 * policy snapshot.
 */
export class ReviewFileExclusionConfigurationController
  implements ReviewFileExclusionConfigurationDisposable {
  private subscription: ReviewFileExclusionConfigurationDisposable | undefined;
  private started = false;
  private disposed = false;

  public constructor(
    private readonly options: ReviewFileExclusionConfigurationControllerOptions
  ) {}

  /** Subscribes to VS Code settings and applies the initial effective exclusion value. */
  public start(): void {
    if (this.disposed) {
      throw new Error("A disposed exclusion configuration controller cannot be started.");
    }
    if (this.started) {
      return;
    }

    this.started = true;
    this.subscription = this.options.host.onDidChangeConfiguration((event) => {
      if (!event.affectsExcludeConfiguration || this.disposed) {
        return;
      }
      this.applyCurrentConfiguration();
    });
    this.applyCurrentConfiguration();
  }

  /** Disposes the VS Code configuration subscription. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.subscription?.dispose();
    this.subscription = undefined;
  }

  private applyCurrentConfiguration(): void {
    try {
      this.options.service.updateUserGlobs(this.options.host.readExcludeGlobs());
    } catch (error) {
      this.options.host.showConfigurationError(error);
    }
  }
}

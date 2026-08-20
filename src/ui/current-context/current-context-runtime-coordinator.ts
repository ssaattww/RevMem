import type { CurrentContextUiController } from "./current-context-ui-controller";
import type { SelectedReviewContext } from "../../application/review-context/index";

export interface CurrentContextDependentRefresher {
  /** Sets the identity that command and decoration consumers must use. */
  setSelectedContext?(selection: SelectedReviewContext | undefined): void;
  refreshDependents(): void | Promise<void>;
}

/** Coordinates context commands so UI state is applied before dependent views refresh. */
export class CurrentContextRuntimeCoordinator {
  public constructor(
    private readonly controller: CurrentContextUiController,
    private readonly dependentRefresher: CurrentContextDependentRefresher
  ) {}

  public async refresh(signal?: AbortSignal): Promise<void> {
    const result = await this.controller.refresh(signal);
    if (result.stale) {
      return;
    }
    this.dependentRefresher.setSelectedContext?.(result.snapshot?.context.selection);
    await this.dependentRefresher.refreshDependents();
  }

  public async selectContext(signal?: AbortSignal): Promise<void> {
    const selection = await this.controller.selectContext(signal);
    if (selection === undefined) {
      return;
    }
    this.dependentRefresher.setSelectedContext?.(selection.context.selection);
    await this.dependentRefresher.refreshDependents();
  }

  /** Contains background refresh failures so activation and editor events cannot reject unobserved. */
  public async refreshWithErrorBoundary(
    report: (error: unknown) => void | Promise<void>
  ): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.controller.failClosed();
      await report(error);
    }
  }
}

import type { CurrentContextUiController } from "./current-context-ui-controller";

export interface CurrentContextDependentRefresher {
  refreshDependents(): void | Promise<void>;
}

/** Coordinates context commands so UI state is applied before dependent views refresh. */
export class CurrentContextRuntimeCoordinator {
  public constructor(
    private readonly controller: CurrentContextUiController,
    private readonly dependentRefresher: CurrentContextDependentRefresher
  ) {}

  public async refresh(): Promise<void> {
    await this.controller.refresh();
    await this.dependentRefresher.refreshDependents();
  }

  public async selectContext(): Promise<void> {
    await this.controller.selectContext();
    await this.dependentRefresher.refreshDependents();
  }
}

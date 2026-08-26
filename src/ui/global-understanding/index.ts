export {
  createGlobalUnderstandingTreeModel,
  createGlobalUnderstandingTreeModelIncrementally,
  formatGlobalUnderstandingStatusBar,
  GlobalLayerToggleController,
  GlobalUnderstandingRefreshController
} from "./global-understanding-ui-model";

export {
  GlobalUnderstandingRefreshCoalescer,
  cancelPendingGlobalUnderstandingRefreshes,
  takeLatestPendingGlobalUnderstandingDetail,
} from "./issue-90-global-refresh";

export type {
  GlobalLayerToggleHost,
  GlobalUnderstandingRefreshCoalescerHost as LegacyGlobalUnderstandingRefreshCoalescerHost,
  GlobalUnderstandingRefreshHost,
  GlobalUnderstandingRefreshSource,
  GlobalUnderstandingDiagnosticsNode,
  GlobalUnderstandingFolderNode,
  GlobalUnderstandingFolderSnapshot,
  GlobalUnderstandingFileNode,
  GlobalUnderstandingStatusBarModel,
  GlobalUnderstandingSummaryNode,
  GlobalUnderstandingTreeModel,
  GlobalUnderstandingTreeStagingOptions,
  GlobalUnderstandingTreeSnapshot
} from "./global-understanding-ui-model";
export type { GlobalUnderstandingRefreshCoalescerHost } from "./issue-90-global-refresh";

import { reportActiveOperationDetail } from "../../application/operation-feedback/index";
import { registerGlobalUnderstandingRuntime as registerBaseGlobalUnderstandingRuntime } from "./vscode-global-understanding-runtime";
import {
  cancelPendingGlobalUnderstandingRefreshes,
  takeLatestPendingGlobalUnderstandingDetail,
} from "./issue-90-global-refresh";

export {
  GLOBAL_UNDERSTANDING_VIEW_ID,
  REFRESH_GLOBAL_UNDERSTANDING_COMMAND_ID,
  TOGGLE_GLOBAL_LAYER_COMMAND_ID,
  START_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID,
  STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID,
  RESUME_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID,
} from "./vscode-global-understanding-runtime";

export const registerGlobalUnderstandingRuntime = (
  ...args: Parameters<typeof registerBaseGlobalUnderstandingRuntime>
): ReturnType<typeof registerBaseGlobalUnderstandingRuntime> => {
  const runtime = registerBaseGlobalUnderstandingRuntime(...args);
  const refresh = runtime.refresh.bind(runtime);
  const refreshWithErrorBoundary = runtime.refreshWithErrorBoundary.bind(runtime);
  return {
    ...runtime,
    refresh: async () => {
      const detail = takeLatestPendingGlobalUnderstandingDetail();
      cancelPendingGlobalUnderstandingRefreshes();
      const pendingRefresh = refresh();
      if (detail !== undefined) reportActiveOperationDetail(detail);
      return pendingRefresh;
    },
    refreshWithErrorBoundary: async () => {
      const detail = takeLatestPendingGlobalUnderstandingDetail();
      cancelPendingGlobalUnderstandingRefreshes();
      const pendingRefresh = refreshWithErrorBoundary();
      if (detail !== undefined) reportActiveOperationDetail(detail);
      return pendingRefresh;
    },
  };
};

export type {
  GlobalUnderstandingRuntimeDependencies,
  GlobalUnderstandingRuntimeSource,
  RegisteredGlobalUnderstandingRuntime
} from "./vscode-global-understanding-runtime";

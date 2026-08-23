import { reportActiveOperationFailure } from "./application/operation-feedback/index";

/** Dependencies for one production document-open Global Understanding lifecycle. */
export interface T305GlobalUnderstandingDocumentOpenDependencies {
  /** Starts or observes the canonical folder owned by the selected context. */
  readonly observe: () => Promise<void>;
  /** Coalesces the normal successful refresh. */
  readonly requestRefresh: () => void;
  /** Publishes a fail-closed snapshot after a source or storage error. */
  readonly refreshAfterFailure: () => Promise<void>;
  /** Shows only the generic UI message; raw details stay in shared Output. */
  readonly showGenericError: (message: string) => PromiseLike<unknown> | unknown;
}

/** Runs the actual T305 open lifecycle and keeps raw failures inside shared Output. */
export const observeGlobalUnderstandingDocumentOpen = async (
  dependencies: T305GlobalUnderstandingDocumentOpenDependencies
): Promise<"completed" | "error"> => {
  try {
    await dependencies.observe();
    dependencies.requestRefresh();
    return "completed";
  } catch (error) {
    reportActiveOperationFailure("Global Understanding folder open", error);
    await dependencies.refreshAfterFailure();
    await dependencies.showGenericError("Global Understanding folderを開始できませんでした。詳細は Review Range Output を確認してください。");
    return "error";
  }
};

/** Returns true only for filesystem events already owned by an active folder scope. */
export const shouldRefreshGlobalUnderstandingFolderEntry = (
  scheme: string,
  filesystemPath: string,
  isActiveFolderEntry: (filesystemPath: string) => boolean
): boolean => (scheme === "file" || scheme === "vscode-remote") && isActiveFolderEntry(filesystemPath);

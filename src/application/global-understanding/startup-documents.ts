/** Minimal document shape used by the activation startup-open composition. */
export interface T305StartupGlobalUnderstandingDocument {
  /** True after VS Code has closed the document and it must not be observed. */
  readonly isClosed: boolean;
  /** URI scheme used to reject non-workspace document providers. */
  readonly uri: { readonly scheme: string };
}

/** Observes activation-time documents through the production open path, then coalesces one refresh. */
export const observeStartupGlobalUnderstandingDocuments = async <T extends T305StartupGlobalUnderstandingDocument>(
  documents: readonly T[],
  observe: (document: T) => Promise<void>,
  refresh: () => Promise<void>
): Promise<void> => {
  await Promise.all(documents.filter((document) => !document.isClosed && (document.uri.scheme === "file" || document.uri.scheme === "vscode-remote")).map(observe));
  await refresh();
};

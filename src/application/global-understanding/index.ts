/** Background Global-understanding recalculation application API. */
export {
  GlobalUnderstandingBackgroundRecalculator,
  InMemoryGlobalUnderstandingProgressCache
} from "./global-understanding-background-recalculator";

export {
  FolderUnderstandingScopeController
} from "./folder-understanding-scope-controller";

export type {
  FolderUnderstandingScopeState,
  FolderUnderstandingScopeSnapshot,
  FolderUnderstandingStoppedStore,
  FolderUnderstandingTotal
} from "./folder-understanding-scope-controller";

export type {
  GlobalUnderstandingBackgroundRecalculatorDependencies,
  GlobalUnderstandingFileLoadOptions,
  GlobalUnderstandingFileSource,
  GlobalUnderstandingProgressCache,
  GlobalUnderstandingRecalculationInput,
  GlobalUnderstandingRecalculationProgress,
  IncludedGlobalUnderstandingFile,
  LoadedGlobalUnderstandingFile
} from "./global-understanding-background-recalculator";

export type {
  GlobalUnderstandingCalculationWorkOptions,
  GlobalUnderstandingEvidenceKey
} from "./cooperative-global-understanding-calculation";

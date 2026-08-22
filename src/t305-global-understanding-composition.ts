import { NodeFolderUnderstandingStoppedStore } from "./adapters/state-repository/node-folder-understanding-stopped-store";
import { FolderUnderstandingScopeController } from "./application/global-understanding/index";
import {
  T505GlobalUnderstandingSource,
  type T505GlobalUnderstandingSourceDependencies
} from "./t505-global-understanding-source";

/** Dependencies supplied by the T305 extension composition root. */
export interface T305GlobalUnderstandingCompositionDependencies extends T505GlobalUnderstandingSourceDependencies {
  /** Filesystem path of the VS Code global storage URI. */
  readonly globalStoragePath: string;
}

/**
 * Builds the exported production T305 Global Understanding composition.
 *
 * Only stopped scope markers cross a restart boundary; file evidence and active
 * scope state remain owned by the runtime source.
 */
export const createT305GlobalUnderstandingSource = (
  dependencies: T305GlobalUnderstandingCompositionDependencies
): T505GlobalUnderstandingSource => new T505GlobalUnderstandingSource({
  ...dependencies,
  folderScopes: new FolderUnderstandingScopeController(
    new NodeFolderUnderstandingStoppedStore(dependencies.globalStoragePath)
  )
});

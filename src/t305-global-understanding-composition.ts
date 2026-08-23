import { NodeFolderUnderstandingStoppedStore } from "./adapters/state-repository/node-folder-understanding-stopped-store";
import type { StorageRootLockDiagnostic } from "./adapters/state-repository/index";
import { FolderUnderstandingScopeController, type FolderUnderstandingStoppedStore } from "./application/global-understanding/index";
import {
  T505GlobalUnderstandingSource,
  type T505GlobalUnderstandingSourceDependencies
} from "./t505-global-understanding-source";

/** Dependencies supplied by the T305 extension composition root. */
export interface T305GlobalUnderstandingCompositionDependencies extends T505GlobalUnderstandingSourceDependencies {
  /** Filesystem path of the VS Code global storage URI. */
  readonly globalStoragePath: string;
  /** Routes storage lease recovery diagnostics to the shared Review Range Output. */
  readonly notifyStorageLockDiagnostic?: (diagnostic: StorageRootLockDiagnostic) => void | Promise<void>;
  /** Test composition may inject the actual Node-backed marker store with a deterministic fault boundary. */
  readonly folderStoppedStore?: FolderUnderstandingStoppedStore;
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
    dependencies.folderStoppedStore ?? new NodeFolderUnderstandingStoppedStore(dependencies.globalStoragePath, {
      notifyStorageLockDiagnostic: dependencies.notifyStorageLockDiagnostic
    })
  )
});

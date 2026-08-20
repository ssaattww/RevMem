import type {
  FileSystemPathSemantics,
  ResourceUri,
  WorkspaceIdentity,
  WorkspaceIdentityService
} from "../../application/workspace-identity/index";
import type {
  WorkspaceEditorReviewDescriptor,
  WorkspaceNormalEditorDecorationState,
  WorkspaceNormalEditorReviewStateSession,
  SnapshotAwareWorkspaceReviewStateSessionProviderPort
} from "./workspace-review-state-session-provider";
import type { NonGitSnapshotTracker } from "../../application/non-git-snapshots/index";
import type { ReviewStateTransaction } from "../../core/review-state/index";

/** Root-local workspace runtime that may release resources when its folder leaves the workspace. */
export interface WorkspaceRootRuntime extends SnapshotAwareWorkspaceReviewStateSessionProviderPort {
  /** Releases only resources owned by this workspace root. */
  dispose?(): void;
}

/** Creates the state, history, and snapshot runtime for one canonical workspace root. */
export interface WorkspaceRootRuntimeFactory {
  create(identity: WorkspaceIdentity): WorkspaceRootRuntime;
}

/** Dependencies of the workspace-side root registry shared by activation and focused composition tests. */
export interface WorkspaceRootRuntimeRegistryOptions {
  readonly identityService: WorkspaceIdentityService;
  readonly factory: WorkspaceRootRuntimeFactory;
  /** Stable Git history-rewrite tracker retained independently from root-local workspace runtimes. */
  readonly historyRewriteSnapshotTracker: NonGitSnapshotTracker;
}

/**
 * Selects one root-local non-Git runtime per workspace identity and disposes
 * runtimes whose roots are removed from the active workspace folders.
 */
export class WorkspaceRootRuntimeRegistry
  implements SnapshotAwareWorkspaceReviewStateSessionProviderPort {
  private readonly runtimes = new Map<string, WorkspaceRootRuntime>();
  private readonly activeGenerations = new Map<string, number>();

  public constructor(private readonly options: WorkspaceRootRuntimeRegistryOptions) {}

  /** T602 production capability retained through the workspace-provider wrapper. */
  public get historyRewriteSnapshotTracker(): NonGitSnapshotTracker {
    return this.options.historyRewriteSnapshotTracker;
  }

  public async open(
    descriptor: WorkspaceEditorReviewDescriptor
  ): Promise<WorkspaceNormalEditorReviewStateSession> {
    const selected = this.runtimeFor(descriptor);
    const session = await selected.runtime.open(descriptor);
    this.assertCurrent(selected);
    return session;
  }

  public async loadForDecoration(
    descriptor: WorkspaceEditorReviewDescriptor
  ): Promise<WorkspaceNormalEditorDecorationState | undefined> {
    const selected = this.runtimeFor(descriptor);
    const state = await selected.runtime.loadForDecoration(descriptor);
    this.assertCurrent(selected);
    return state;
  }

  /** Delegates a workspace transaction to its selected root's snapshot-aware committer. */
  public async commitWithSnapshot(
    descriptor: WorkspaceEditorReviewDescriptor,
    transaction: Readonly<ReviewStateTransaction>,
    commitState: () => Promise<void>
  ): Promise<void> {
    const selected = this.runtimeFor(descriptor);
    await selected.runtime.commitWithSnapshot(descriptor, transaction, async () => {
      this.assertCurrent(selected);
      await commitState();
      this.assertCurrent(selected);
    });
    this.assertCurrent(selected);
  }

  /** Disposes root runtimes no longer represented by workspace-side folder URIs. */
  public reconcileWorkspaceRoots(
    workspaceRoots: readonly ResourceUri[],
    fileSystemPathSemantics: FileSystemPathSemantics
  ): void {
    const active = new Set(workspaceRoots.flatMap((workspaceFolderUri) => {
      try {
        return [this.options.identityService.resolve({
          workspaceFolderUri,
          documentUri: { ...workspaceFolderUri, path: `${workspaceFolderUri.path}/.revmem-root` },
          fileSystemPathSemantics,
          relativePath: ".revmem-root"
        }).canonicalWorkspaceUri];
      } catch {
        return [];
      }
    }));
    for (const key of active) if (!this.activeGenerations.has(key)) this.activeGenerations.set(key, 1);
    for (const key of [...this.activeGenerations.keys()]) if (!active.has(key)) {
      this.activeGenerations.delete(key);
      this.runtimes.get(key)?.dispose?.();
      this.runtimes.delete(key);
    }
  }

  public dispose(): void {
    for (const runtime of this.runtimes.values()) runtime.dispose?.();
    this.runtimes.clear();
    this.activeGenerations.clear();
  }

  public get size(): number {
    return this.runtimes.size;
  }

  private runtimeFor(descriptor: WorkspaceEditorReviewDescriptor): { readonly key: string; readonly generation: number; readonly runtime: WorkspaceRootRuntime } {
    const identity = this.options.identityService.resolve({
      workspaceFolderUri: descriptor.workspaceFolderUri,
      documentUri: descriptor.documentUri,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      relativePath: descriptor.relativePath
    });
    const key = identity.canonicalWorkspaceUri;
    const generation = this.activeGenerations.get(key);
    if (generation === undefined) throw new Error("Workspace root is inactive.");
    const existing = this.runtimes.get(key);
    if (existing !== undefined) return { key, generation, runtime: existing };
    const runtime = this.options.factory.create(identity);
    this.runtimes.set(key, runtime);
    return { key, generation, runtime };
  }

  private assertCurrent(selected: { readonly key: string; readonly generation: number }): void {
    if (this.activeGenerations.get(selected.key) !== selected.generation) throw new Error("Workspace root is inactive.");
  }
}

/** Builds the workspace-side registry used by Extension Host activation and focused composition tests. */
export const createWorkspaceRootRuntimeRegistry = (
  options: WorkspaceRootRuntimeRegistryOptions
): WorkspaceRootRuntimeRegistry => new WorkspaceRootRuntimeRegistry(options);

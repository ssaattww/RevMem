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

  public constructor(private readonly options: WorkspaceRootRuntimeRegistryOptions) {}

  /** T602 production capability retained through the workspace-provider wrapper. */
  public get historyRewriteSnapshotTracker(): NonGitSnapshotTracker {
    return this.options.historyRewriteSnapshotTracker;
  }

  public open(
    descriptor: WorkspaceEditorReviewDescriptor
  ): Promise<WorkspaceNormalEditorReviewStateSession> {
    return this.runtimeFor(descriptor).open(descriptor);
  }

  public loadForDecoration(
    descriptor: WorkspaceEditorReviewDescriptor
  ): Promise<WorkspaceNormalEditorDecorationState | undefined> {
    return this.runtimeFor(descriptor).loadForDecoration(descriptor);
  }

  /** Delegates a workspace transaction to its selected root's snapshot-aware committer. */
  public async commitWithSnapshot(
    descriptor: WorkspaceEditorReviewDescriptor,
    transaction: Readonly<ReviewStateTransaction>,
    commitState: () => Promise<void>
  ): Promise<void> {
    const runtime = this.runtimeFor(descriptor);
    await runtime.commitWithSnapshot(descriptor, transaction, commitState);
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
    for (const [key, runtime] of this.runtimes) {
      if (!active.has(key)) {
        runtime.dispose?.();
        this.runtimes.delete(key);
      }
    }
  }

  public dispose(): void {
    for (const runtime of this.runtimes.values()) runtime.dispose?.();
    this.runtimes.clear();
  }

  public get size(): number {
    return this.runtimes.size;
  }

  private runtimeFor(descriptor: WorkspaceEditorReviewDescriptor): WorkspaceRootRuntime {
    const identity = this.options.identityService.resolve({
      workspaceFolderUri: descriptor.workspaceFolderUri,
      documentUri: descriptor.documentUri,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      relativePath: descriptor.relativePath
    });
    const existing = this.runtimes.get(identity.canonicalWorkspaceUri);
    if (existing !== undefined) return existing;
    const runtime = this.options.factory.create(identity);
    this.runtimes.set(identity.canonicalWorkspaceUri, runtime);
    return runtime;
  }
}

/** Builds the workspace-side registry used by Extension Host activation and focused composition tests. */
export const createWorkspaceRootRuntimeRegistry = (
  options: WorkspaceRootRuntimeRegistryOptions
): WorkspaceRootRuntimeRegistry => new WorkspaceRootRuntimeRegistry(options);

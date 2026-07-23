import type {
  RepositoryGlobalState,
  ReviewContextState
} from "../../core/contracts/index";
import {
  FileSystemReviewStateRepository as AtomicFileSystemReviewStateRepository
} from "./file-system-review-state-repository";
import type {
  FileSystemReviewStateRepositoryOptions,
  ReviewStateCommit,
  ReviewStateRepositoryTarget
} from "./contracts";
import { resolveReviewStateStorageRoute } from "./storage-router";

const cloneContextState = (state: ReviewContextState): ReviewContextState =>
  JSON.parse(JSON.stringify(state)) as ReviewContextState;

const cloneGlobalState = (state: RepositoryGlobalState): RepositoryGlobalState =>
  JSON.parse(JSON.stringify(state)) as RepositoryGlobalState;

const cloneCommit = (commit: ReviewStateCommit): ReviewStateCommit => ({
  schemaVersion: commit.schemaVersion,
  contextState: cloneContextState(commit.contextState),
  globalState: cloneGlobalState(commit.globalState)
});

/**
 * Public filesystem repository that keeps one repository-wide Global state in
 * memory even when several context states are loaded or saved independently.
 */
export class FileSystemReviewStateRepository {
  private readonly atomicRepository: AtomicFileSystemReviewStateRepository;
  private readonly currentGlobalByStorageRoot = new Map<
    string,
    RepositoryGlobalState
  >();

  public constructor(
    private readonly options: FileSystemReviewStateRepositoryOptions
  ) {
    this.atomicRepository = new AtomicFileSystemReviewStateRepository(options);
  }

  public getCurrent(
    target: ReviewStateRepositoryTarget
  ): ReviewStateCommit | undefined {
    const current = this.atomicRepository.getCurrent(target);
    if (current === undefined) {
      return undefined;
    }

    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    const repositoryGlobal = this.currentGlobalByStorageRoot.get(route.rootPath);

    return cloneCommit({
      ...current,
      globalState: repositoryGlobal ?? current.globalState
    });
  }

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const loaded = await this.atomicRepository.load(target);
    if (loaded === undefined) {
      return undefined;
    }

    this.recordRepositoryGlobal(target, loaded.globalState);
    return this.getCurrent(target);
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    await this.atomicRepository.save(target, commit);
    this.recordRepositoryGlobal(target, commit.globalState);
  }

  private recordRepositoryGlobal(
    target: ReviewStateRepositoryTarget,
    globalState: RepositoryGlobalState
  ): void {
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    this.currentGlobalByStorageRoot.set(
      route.rootPath,
      cloneGlobalState(globalState)
    );
  }
}

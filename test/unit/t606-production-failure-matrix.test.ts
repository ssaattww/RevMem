import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GitCommandFailedError,
  GitExecutableNotFoundError,
  LocalGitAdapter,
  NodeGitCommandExecutor,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult,
} from "../../src/adapters/local-git/index";
import {
  FileSystemReviewStateRepository,
  type AtomicTextFileStore,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
} from "../../src/adapters/state-repository/index";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../src/core/contracts/index";

const sha = "a".repeat(40);

class PlannedGitExecutor implements GitCommandExecutor {
  private readonly planned: Array<GitCommandResult | Error>;

  public constructor(results: readonly (GitCommandResult | Error)[]) {
    this.planned = [...results];
  }

  public async execute(invocation: GitCommandInvocation): Promise<GitCommandResult> {
    void invocation;
    const next = this.planned.shift();
    assert.ok(next, "the production adapter must invoke the planned Git boundary");
    if (next instanceof Error) throw next;
    return next;
  }
}

class FaultInjectingAtomicStore implements AtomicTextFileStore {
  private readonly files = new Map<string, string>();
  public failureCode: "ENOSPC" | "EACCES" | undefined;
  public readonly writes: string[] = [];

  public async readText(filePath: string): Promise<string | undefined> {
    return this.files.get(filePath);
  }

  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    this.writes.push(filePath);
    if (this.failureCode !== undefined) {
      throw Object.assign(new Error(`${this.failureCode} while flushing/replacing state`), {
        code: this.failureCode,
      });
    }
    this.files.set(filePath, content);
  }
}

const target: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: "github.com/example/t606",
  contextId: "branch:refs/heads/main",
};

const commit = (updatedAt: string): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: target.contextId,
    kind: "branch",
    repositoryId: target.repositoryId,
    displayName: "main",
    branch: { refName: "refs/heads/main", headRevision: sha },
    files: {},
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt,
  },
  globalState: {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: target.repositoryId,
    currentRevisionId: sha,
    files: {},
    updatedAt,
  },
});

test("T606 runs Git executable-missing, nonzero, corruption, and safe.directory outcomes through the LocalGitAdapter boundary", async () => {
  const unavailable = await new LocalGitAdapter(
    new PlannedGitExecutor([new GitExecutableNotFoundError("missing-git")]),
    { readBlob: async () => new Uint8Array() },
  ).inspectRepository("/workspace/repository");
  assert.deepEqual(unavailable, { kind: "git-unavailable", executable: "missing-git" });

  for (const stderr of [
    "fatal: detected dubious ownership in repository",
    "fatal: object database is corrupt",
  ]) {
    const adapter = new LocalGitAdapter(
      new PlannedGitExecutor([{ exitCode: 128, stdout: "", stderr }]),
      { readBlob: async () => new Uint8Array() },
    );
    await assert.rejects(
      () => adapter.readTextFileAtRevision("/workspace/repository", sha, "src/file.ts", "posix"),
      (error: unknown) => error instanceof GitCommandFailedError && error.result.exitCode === 128 && error.result.stderr === stderr,
    );
  }
});

test("T606 runs the production Git executor timeout boundary and preserves its stable timeout result", async () => {
  const executor = new NodeGitCommandExecutor({ executable: process.execPath, timeoutMs: 25 });
  await assert.rejects(
    () => executor.execute({ argumentsList: ["-e", "setTimeout(() => {}, 10_000)"] }),
    (error: unknown) => error instanceof GitCommandFailedError && error.result.exitCode === -1 && /timed out after 25 ms/u.test(error.result.stderr),
  );
});

test("T606 preserves the last published repository state when the production persistence adapter sees ENOSPC or EACCES during flush/replace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "revmem-t606-storage-"));
  try {
    for (const failureCode of ["ENOSPC", "EACCES"] as const) {
      const store = new FaultInjectingAtomicStore();
      const failures: unknown[] = [];
      const repository = new FileSystemReviewStateRepository({
        storageUris: { globalStorageUri: { fsPath: root } },
        atomicFileStore: store,
        notifyPersistenceFailure: (failure) => { failures.push(failure.error); },
      });
      const baseline = commit("2026-08-20T00:00:00.000Z");
      await repository.save(target, baseline);
      const writesBeforeFailure = store.writes.length;
      store.failureCode = failureCode;

      await assert.rejects(
        () => repository.save(target, commit("2026-08-20T00:00:01.000Z")),
        (error: unknown) => error instanceof Error && error.message.includes(failureCode),
      );
      assert.ok(store.writes.length > writesBeforeFailure, "the production repository reached the atomic flush/replace port");
      assert.equal(
        ((failures[0] as Error & { cause?: NodeJS.ErrnoException } | undefined)?.cause)?.code,
        failureCode,
      );

      const restarted = new FileSystemReviewStateRepository({
        storageUris: { globalStorageUri: { fsPath: root } },
        atomicFileStore: store,
      });
      assert.deepEqual(await restarted.load(target), baseline, "a failed publication cannot replace the prior committed state");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

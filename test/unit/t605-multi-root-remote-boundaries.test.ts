import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import { DocumentReviewStateSessionProvider } from "../../src/adapters/document-review-state/index";
import {
  NodeNonGitSnapshotCodec,
  NodeNonGitSnapshotStorage
} from "../../src/adapters/non-git-snapshots/index";
import {
  FileSystemReviewStateRepository,
  resolveReviewStateStorageRoute,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import {
  resolveWorkspaceResourceEligibility,
  resolveWorkspaceFolderMembership,
  WorkspaceIdentityService
} from "../../src/application/workspace-identity/index";
import { NonGitSnapshotTracker } from "../../src/application/non-git-snapshots/index";
import {
  currentContextCandidateKey,
  resolveUniqueRepositoryRoot
} from "../../src/t405-root-scoped-candidate-identity";
import {
  SnapshotTrackingWorkspaceReviewStateSessionProvider,
  createWorkspaceRootRuntimeRegistry
} from "../../src/adapters/workspace-review-state/index";
import { markReviewedRanges, unmarkReviewedRanges } from "../../src/core/review-state/index";

const hash = new NodeSha256StableHash();

test("T605 chooses exactly the longest matching multi-root URI and preserves remote authority", () => {
  const membership = resolveWorkspaceFolderMembership({
    documentUri: { scheme: "vscode-remote", authority: "ssh-remote+alpha", path: "/work/repo/packages/a/src/file.ts" },
    workspaceFolders: [
      { uri: { scheme: "vscode-remote", authority: "ssh-remote+alpha", path: "/work/repo" }, name: "same" },
      { uri: { scheme: "vscode-remote", authority: "ssh-remote+alpha", path: "/work/repo/packages/a" }, name: "same" },
      { uri: { scheme: "vscode-remote", authority: "dev-container+beta", path: "/work/repo/packages/a" }, name: "same" }
    ],
    fileSystemPathSemantics: "posix"
  });

  assert.deepEqual(membership, {
    workspaceFolder: { uri: { scheme: "vscode-remote", authority: "ssh-remote+alpha", path: "/work/repo/packages/a" }, name: "same" },
    relativePath: "src/file.ts"
  });
});

test("T605 fails closed for URI boundaries and separates workspace storage roots", () => {
  const folders = [
    { uri: { scheme: "vscode-remote", authority: "codespaces+one", path: "/work/repo" }, name: "repo" },
    { uri: { scheme: "vscode-remote", authority: "codespaces+two", path: "/work/repo" }, name: "repo" }
  ];
  assert.equal(resolveWorkspaceFolderMembership({
    documentUri: { scheme: "untitled", path: "/work/repo/file.ts" },
    workspaceFolders: folders,
    fileSystemPathSemantics: "posix"
  }), undefined);
  assert.equal(resolveWorkspaceFolderMembership({
    documentUri: { scheme: "vscode-remote", authority: "codespaces+one", path: "/outside/file.ts" },
    workspaceFolders: folders,
    fileSystemPathSemantics: "posix"
  }), undefined);
  assert.equal(resolveWorkspaceFolderMembership({
    documentUri: { scheme: "vscode-remote", authority: "codespaces+one", path: "/work/repo/file.ts", query: "rev=1" },
    workspaceFolders: folders,
    fileSystemPathSemantics: "posix"
  }), undefined);

  const identities = folders.map((folder) => new WorkspaceIdentityService(hash).resolve({
    workspaceFolderUri: folder.uri,
    documentUri: { ...folder.uri, path: `${folder.uri.path}/file.ts` },
    fileSystemPathSemantics: "posix",
    relativePath: "file.ts"
  }));
  const routes = identities.map((identity) => resolveReviewStateStorageRoute({
    globalStorageUri: { fsPath: path.resolve("/state/global") },
    storageUri: { fsPath: path.resolve("/state/workspace") }
  }, { kind: "workspace", repositoryId: identity.repositoryId, contextId: identity.workspaceContextId }));

  assert.notEqual(routes[0].rootPath, routes[1].rootPath);
  assert.match(routes[0].rootPath, /workspaces/u);
});

test("T605 root registry retains typed snapshot and Git-rewrite capabilities", () => {
  const identityService = new WorkspaceIdentityService(hash);
  const tracker = new NonGitSnapshotTracker(
    new NodeNonGitSnapshotStorage({ snapshotDirectory: path.resolve("/state/history-rewrite/snapshots") }),
    new NodeNonGitSnapshotCodec(),
    { maxSnapshots: 2, maxCompressedBytes: 1024, retentionMs: 1_000 }
  );
  const registry = createWorkspaceRootRuntimeRegistry({
    identityService,
    historyRewriteSnapshotTracker: tracker,
    factory: { create: () => ({
      open: async () => { throw new Error("not used"); },
      loadForDecoration: async () => undefined,
      commitWithSnapshot: async () => undefined
    }) }
  });
  assert.equal(registry.historyRewriteSnapshotTracker, tracker);
  assert.equal(typeof registry.commitWithSnapshot, "function");
});

test("T605 IFR001 rejects delayed open, load, and commit from a removed and re-added root generation", async () => {
  const identityService = new WorkspaceIdentityService(hash);
  const root = { scheme: "vscode-remote", authority: "ssh-remote+t605", path: "/remote/generation" };
  const descriptor = {
    workspaceFolderUri: root,
    documentUri: { ...root, path: "/remote/generation/src/file.ts" },
    fileSystemPathSemantics: "posix" as const,
    relativePath: "src/file.ts",
    workspaceDisplayName: "generation",
    lineCount: 1,
    contentHash: hash.digest("generation\n")
  };
  let releaseOpen!: () => void;
  let releaseLoad!: () => void;
  let releaseCommit!: () => void;
  const opened = new Promise<void>((resolve) => { releaseOpen = resolve; });
  const loaded = new Promise<void>((resolve) => { releaseLoad = resolve; });
  const committed = new Promise<void>((resolve) => { releaseCommit = resolve; });
  let created = 0;
  const published: string[] = [];
  const registry = createWorkspaceRootRuntimeRegistry({
    identityService,
    historyRewriteSnapshotTracker: {} as never,
    factory: {
      create: () => {
        const generation = ++created;
        return {
          open: async () => {
            if (generation === 1) await opened;
            return {} as never;
          },
          loadForDecoration: async () => {
            if (generation === 1) await loaded;
            return undefined;
          },
          commitWithSnapshot: async (_descriptor, _transaction, commitState) => {
            if (generation === 1) await committed;
            await commitState();
          }
        };
      }
    }
  });
  registry.reconcileWorkspaceRoots([root], "posix");
  const staleOpen = registry.open(descriptor);
  const staleLoad = registry.loadForDecoration(descriptor);
  const staleCommit = registry.commitWithSnapshot(descriptor, {} as never, async () => {
    published.push("stale");
  });
  registry.reconcileWorkspaceRoots([], "posix");
  registry.reconcileWorkspaceRoots([root], "posix");
  releaseOpen();
  releaseLoad();
  releaseCommit();
  await assert.rejects(staleOpen, /Workspace root is inactive/u);
  await assert.rejects(staleLoad, /Workspace root is inactive/u);
  await assert.rejects(staleCommit, /Workspace root is inactive/u);
  assert.deepEqual(published, []);
  await registry.open(descriptor);
  assert.equal(created, 2);
});

test("T605 IFR002 applies one URI eligibility boundary before descriptor routing", async () => {
  const folders = [{
    uri: { scheme: "vscode-remote", authority: "ssh-remote+t605", path: "/remote/root" },
    name: "root"
  }];
  assert.equal(resolveWorkspaceResourceEligibility({
    documentUri: folders[0].uri,
    workspaceFolders: folders,
    fileSystemPathSemantics: "posix"
  })?.relativePath, undefined);
  const provider = new DocumentReviewStateSessionProvider({
    gitInspector: { inspectRepository: async () => { throw new Error("descriptor validation must run first"); } },
    repository: {} as never,
    workspaceProvider: {} as never,
    stableHash: hash
  });
  const descriptor = (documentUri: { readonly scheme: string; readonly authority?: string; readonly path: string; readonly query?: string; readonly fragment?: string }) => ({
    documentUri,
    documentFsPath: documentUri.path,
    fileSystemPathSemantics: "posix" as const,
    workspace: { workspaceFolderUri: folders[0].uri, relativePath: "src/file.ts", displayName: "root" },
    lineCount: 1,
    contentHash: hash.digest("file\n")
  });
  await assert.rejects(
    provider.open(descriptor({ ...folders[0].uri, path: "/remote/root/src/file.ts", query: "git=1" })),
    /URI query|eligible member/u
  );
  await assert.rejects(
    provider.open(descriptor({ scheme: "vscode-vfs", authority: "virtual", path: "/remote/root/src/file.ts" })),
    /filesystem-backed scheme/u
  );
  await assert.rejects(
    provider.open(descriptor({ scheme: "untitled", path: "/remote/root/src/file.ts" })),
    /filesystem-backed scheme/u
  );
  await assert.rejects(
    provider.open(descriptor({ ...folders[0].uri, path: "/outside/file.ts" })),
    /eligible member/u
  );
});

test("T605 keeps same-repository roots distinct for Current Context and PR acquisition", () => {
  const branch = (repositoryRoot: string) => ({
    context: {
      kind: "branch" as const,
      label: "main",
      headRevision: "a".repeat(40),
      selection: {
        kind: "branch" as const,
        repositoryId: "github.com/example/shared",
        repositoryRoot,
        branchRef: "refs/heads/main"
      }
    },
    progress: undefined
  });
  const rootA = branch("/work/root-a");
  const rootB = branch("/work/root-b");
  assert.notEqual(currentContextCandidateKey(rootA), currentContextCandidateKey(rootB));
  assert.equal(resolveUniqueRepositoryRoot(["/work/root-a", "/work/root-b"]), undefined);
  assert.equal(resolveUniqueRepositoryRoot(["/work/root-a"]), "/work/root-a");
});

const workspaceDocument = (
  root: string,
  fileName: string,
  contentHash: string
) => ({
  documentUri: { scheme: "vscode-remote", authority: "ssh-remote+t605", path: `${root}/${fileName}` },
  documentFsPath: `${root}/${fileName}`,
  fileSystemPathSemantics: "posix" as const,
  workspace: {
    workspaceFolderUri: { scheme: "vscode-remote", authority: "ssh-remote+t605", path: root },
    relativePath: fileName,
    displayName: root
  },
  lineCount: 3,
  contentHash
});

/** Exercises the actual workspace wrapper used by activation, including persistence and restart recovery. */
test("T605 concrete root composition commits snapshots through reconciliation and survives root-scoped restart", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "review-range-t605-"));
  const storageUris: ReviewStateStorageUris = {
    globalStorageUri: { fsPath: path.join(temporaryRoot, "global") },
    storageUri: { fsPath: path.join(temporaryRoot, "workspace") }
  };
  const identityService = new WorkspaceIdentityService(hash);
  const descriptor = workspaceDocument("/remote/root-a", "src/example.ts", hash.digest("alpha\nbeta\ngamma\n"));
  const trackers = new Map<string, NonGitSnapshotTracker>();
  const createWorkspaceProvider = (repository: FileSystemReviewStateRepository) => {
    const registry = createWorkspaceRootRuntimeRegistry({
      identityService,
      historyRewriteSnapshotTracker: new NonGitSnapshotTracker(
        new NodeNonGitSnapshotStorage({
          snapshotDirectory: resolveReviewStateStorageRoute(storageUris, {
            kind: "workspace",
            repositoryId: "git-history-rewrite",
            contextId: "git-history-rewrite"
          }).snapshotDirectory
        }),
        new NodeNonGitSnapshotCodec(),
        { maxSnapshots: 8, maxCompressedBytes: 1_024 * 1_024, retentionMs: 60_000 }
      ),
      factory: {
        create: (identity) => {
          const snapshotTracker = new NonGitSnapshotTracker(
            new NodeNonGitSnapshotStorage({
              snapshotDirectory: resolveReviewStateStorageRoute(storageUris, {
                kind: "workspace",
                repositoryId: identity.repositoryId,
                contextId: identity.workspaceContextId
              }).snapshotDirectory
            }),
            new NodeNonGitSnapshotCodec(),
            { maxSnapshots: 8, maxCompressedBytes: 1_024 * 1_024, retentionMs: 60_000 }
          );
          trackers.set(identity.canonicalWorkspaceUri, snapshotTracker);
          return new SnapshotTrackingWorkspaceReviewStateSessionProvider({
            identityService,
            repository,
            snapshotTracker,
            resolveContent: () => "alpha\nbeta\ngamma\n",
            now: () => new Date("2026-08-20T00:00:00.000Z")
          });
        }
      }
    });
    registry.reconcileWorkspaceRoots([descriptor.workspace.workspaceFolderUri], "posix");
    return registry;
  };
  const createDocumentProvider = (repository: FileSystemReviewStateRepository) => {
    const workspaceProvider = createWorkspaceProvider(repository);
    return {
      workspaceProvider,
      provider: new DocumentReviewStateSessionProvider({
      gitInspector: { inspectRepository: async () => ({ kind: "not-repository" as const, gitVersion: "test" }) },
      repository,
      workspaceProvider,
      stableHash: hash,
      now: () => new Date("2026-08-20T00:00:00.000Z")
      })
    };
  };

  try {
    const repository = new FileSystemReviewStateRepository({ storageUris });
    const { provider, workspaceProvider } = createDocumentProvider(repository);
    const opened = await provider.open(descriptor);
    assert.equal(opened.owner, "workspace");
    const marked = markReviewedRanges({
      contextState: opened.contextState,
      globalState: opened.globalState,
      target: opened.target,
      intervals: [{ startLine: 0, endLineExclusive: 2 }],
      occurredAt: "2026-08-20T00:00:00.000Z"
    });
    await opened.committer.commit(marked);
    const canonicalRoot = identityService.resolve({
      workspaceFolderUri: descriptor.workspace.workspaceFolderUri,
      documentUri: descriptor.documentUri,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      relativePath: descriptor.workspace.relativePath
    }).canonicalWorkspaceUri;
    const tracker = trackers.get(canonicalRoot);
    assert.ok(tracker);
    assert.notEqual(await tracker.latestSnapshotId(opened.contextState.contextId, opened.target.fileId), undefined);
    const decoration = await provider.loadForDecoration(descriptor);
    assert.deepEqual(decoration?.contextState.files[opened.target.fileId]?.modifiedReviewed, [
      { startLine: 0, endLineExclusive: 2 }
    ]);
    workspaceProvider.reconcileWorkspaceRoots([
      descriptor.workspace.workspaceFolderUri,
      { scheme: "vscode-remote", authority: "ssh-remote+t605", path: "/remote/root-b" }
    ], "posix");
    await workspaceProvider.open({
      workspaceFolderUri: { scheme: "vscode-remote", authority: "ssh-remote+t605", path: "/remote/root-b" },
      documentUri: { scheme: "vscode-remote", authority: "ssh-remote+t605", path: "/remote/root-b/src/other.ts" },
      fileSystemPathSemantics: "posix",
      relativePath: "src/other.ts",
      workspaceDisplayName: "root-b",
      lineCount: 1,
      contentHash: hash.digest("other\n")
    });
    assert.equal(workspaceProvider.size, 2);
    workspaceProvider.reconcileWorkspaceRoots([
      { scheme: "vscode-remote", authority: "ssh-remote+t605", path: "/remote/root-b" }
    ], "posix");
    assert.equal(workspaceProvider.size, 1);
    workspaceProvider.dispose();
    assert.equal(workspaceProvider.size, 0);

    const { runPersistenceStartupMigration } = await import("../../src/adapters/persistence-startup-migration.js");
    await runPersistenceStartupMigration({ storageUris });
    const restartedRepository = new FileSystemReviewStateRepository({ storageUris });
    const { provider: restartedProvider } = createDocumentProvider(restartedRepository);
    const reopened = await restartedProvider.open(descriptor);
    assert.deepEqual(reopened.contextState.files[reopened.target.fileId]?.modifiedReviewed, [
      { startLine: 0, endLineExclusive: 2 }
    ]);
    const unmarked = unmarkReviewedRanges({
      contextState: reopened.contextState,
      globalState: reopened.globalState,
      target: reopened.target,
      intervals: [{ startLine: 0, endLineExclusive: 2 }],
      occurredAt: "2026-08-20T00:00:01.000Z"
    });
    await reopened.committer.commit(unmarked);
    assert.deepEqual(
      (await restartedProvider.loadForDecoration(descriptor))?.contextState.files[reopened.target.fileId]?.modifiedReviewed,
      []
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

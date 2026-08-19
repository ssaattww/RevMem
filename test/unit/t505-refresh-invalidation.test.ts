import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/review-file-exclusion-policy-service";
import { T505GlobalUnderstandingSource } from "../../src/t505-global-understanding-source";
import {
  createGlobalUnderstandingTreeModel,
  GlobalUnderstandingRefreshCoalescer,
  GlobalUnderstandingRefreshController,
  type GlobalUnderstandingTreeSnapshot
} from "../../src/ui/global-understanding/global-understanding-ui-model";

const snapshot: GlobalUnderstandingTreeSnapshot = {
  progress: {
    reviewedNonEmptyLineCount: 0,
    totalNonEmptyLineCount: 0,
    progress: 1,
    files: []
  },
  excludedFileCount: 0,
  prunedExcludedDirectoryCount: 0
};

test("T505-R005 requesting a debounced refresh immediately invalidates the in-flight generation", async () => {
  let rejectInFlight: ((reason: Error) => void) | undefined;
  const events: string[] = [];
  const controller = new GlobalUnderstandingRefreshController(
    {
      recalculate: () => new Promise((_, reject) => {
        rejectInFlight = reject;
      })
    },
    {
      show: () => events.push("show"),
      clear: () => events.push("clear")
    }
  );
  const inFlight = controller.refresh();
  const coalescer = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => controller.invalidate(),
    schedule: () => 1,
    cancel: () => undefined,
    run: () => undefined
  });

  coalescer.request();
  rejectInFlight?.(new Error("stale after edit"));

  assert.equal(await inFlight, undefined);
  assert.deepEqual(events, []);
  coalescer.dispose();
  void snapshot;
});

test("PR69-R001 Global snapshot pins a working-tree open target to the producing owner", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-pr69-r001-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryA = path.join(root, "repository-a");
  const repositoryB = path.join(root, "repository-b");
  for (const repositoryRoot of [repositoryA, repositoryB]) {
    await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
    await writeFile(path.join(repositoryRoot, "src", "shared.ts"), "export const value = 1;\n", "utf8");
  }

  const source = new T505GlobalUnderstandingSource({
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global-storage") },
      storageUri: { fsPath: path.join(root, "workspace-storage") }
    },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: (owner) => [{
      path: "src/shared.ts",
      revisionId: owner.currentRevisionId,
      lineCount: 2,
      nonEmptyLines: [0],
      contentHash: `hash:${owner.target.repositoryId}`,
      cacheKey: `open:${owner.target.repositoryId}:${owner.currentRevisionId}`
    }],
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined
  });
  const setBranch = (repositoryId: string, repositoryRoot: string, headRevision: string): void => {
    source.setContext({
      context: {
        kind: "branch",
        label: "main",
        detail: repositoryRoot,
        headRevision,
        selection: {
          kind: "branch",
          repositoryId,
          repositoryRoot,
          branchRef: "refs/heads/main"
        }
      },
      progress: undefined
    });
  };

  setBranch("repository-a", repositoryA, "revision-a");
  const snapshotA = await source.recalculate();
  assert.ok(snapshotA);
  const target = (snapshotA as GlobalUnderstandingTreeSnapshot & {
    readonly fileOpenTargets?: readonly [{
      readonly kind: string;
      readonly repositoryId: string;
      readonly contextId: string;
      readonly revisionId: string;
      readonly repositoryPath: string;
      readonly filePath?: string;
    }];
  }).fileOpenTargets?.[0];
  assert.deepEqual(target, {
    kind: "working-tree",
    repositoryId: "repository-a",
    contextId: "global-understanding:repository-a",
    revisionId: "revision-a",
    repositoryPath: "src/shared.ts",
    filePath: path.join(repositoryA, "src", "shared.ts")
  });

  setBranch("repository-b", repositoryB, "revision-b");
  assert.equal(
    target?.filePath,
    path.join(repositoryA, "src", "shared.ts"),
    "A rendered node must not be rebound to repository B when Current Context changes."
  );
});

test("PR69-R001 PR Global snapshot pins immutable HEAD identity even when the file is absent locally", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-pr69-r001-pr-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  await mkdir(repositoryRoot, { recursive: true });
  const headRevision = "b".repeat(40);
  const source = new T505GlobalUnderstandingSource({
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global-storage") },
      storageUri: { fsPath: path.join(root, "workspace-storage") }
    },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readPullRequestHeadFiles: async () => [{
      path: "src/added.ts",
      revisionId: headRevision,
      content: "export const added = true;\n"
    }],
    readOpenDocuments: () => [],
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined
  });
  source.setContext({
    context: {
      kind: "pull-request",
      label: "#69",
      detail: "PR HEAD",
      baseRevision: "a".repeat(40),
      headRevision,
      selection: {
        kind: "pull-request",
        repositoryId: "repository-pr",
        repositoryRoot,
        contextId: "github-pr:repository-pr#69",
        pullRequestNumber: 69,
        headRevision
      }
    },
    progress: undefined
  });

  const snapshotPr = await source.recalculate();
  assert.ok(snapshotPr);
  assert.equal(snapshotPr.progress.files[0]?.path, "src/added.ts");
  const target = (snapshotPr as GlobalUnderstandingTreeSnapshot & {
    readonly fileOpenTargets?: readonly [{
      readonly kind: string;
      readonly repositoryId: string;
      readonly contextId: string;
      readonly revisionId: string;
      readonly repositoryPath: string;
      readonly fileSystemPathSemantics?: string;
    }];
  }).fileOpenTargets?.[0];
  assert.deepEqual(target, {
    kind: "pull-request-head",
    repositoryId: "repository-pr",
    contextId: "github-pr:repository-pr#69",
    revisionId: headRevision,
    repositoryPath: "src/added.ts",
    fileSystemPathSemantics: "posix"
  });
});

test("PR69-R001 stale Global nodes are rejected and PR69-R003 open failures use the dedicated reporter", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-pr69-open-controller-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await writeFile(path.join(repositoryRoot, "src", "a.ts"), "a\n", "utf8");
  const source = new T505GlobalUnderstandingSource({
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global-storage") },
      storageUri: { fsPath: path.join(root, "workspace-storage") }
    },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: (owner) => [{
      path: "src/a.ts",
      revisionId: owner.currentRevisionId,
      lineCount: 2,
      nonEmptyLines: [0],
      contentHash: "hash-a",
      cacheKey: "open-a"
    }],
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined
  });
  source.setContext({
    context: {
      kind: "branch",
      label: "main",
      detail: repositoryRoot,
      headRevision: "revision-a",
      selection: {
        kind: "branch",
        repositoryId: "repository-a",
        repositoryRoot,
        branchRef: "refs/heads/main"
      }
    },
    progress: undefined
  });
  const sourceSnapshot = await source.recalculate();
  assert.ok(sourceSnapshot);
  const model = createGlobalUnderstandingTreeModel(sourceSnapshot);
  const module = await import("../../src/ui/global-understanding/global-understanding-ui-model.js");
  const Controller = (module as unknown as {
    readonly GlobalUnderstandingFileOpenController?: new (host: {
      readonly openFile: (target: unknown) => Promise<void>;
      readonly reportOpenError: (error: unknown) => Promise<void>;
    }) => {
      replaceModel(model: ReturnType<typeof createGlobalUnderstandingTreeModel>): void;
      clear(): void;
      open(node: ReturnType<typeof createGlobalUnderstandingTreeModel>["files"][number]): Promise<void>;
    };
  }).GlobalUnderstandingFileOpenController;
  assert.equal(typeof Controller, "function");

  const opened: unknown[] = [];
  const errors: unknown[] = [];
  const controller = new Controller!({
    openFile: async (target) => { opened.push(target); },
    reportOpenError: async (error) => { errors.push(error); }
  });
  controller.replaceModel(model);
  const node = model.files[0]!;
  await controller.open(node);
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0], node.openTarget);

  controller.clear();
  await controller.open(node);
  assert.equal(opened.length, 1, "A stale node must not reach the file-open host.");
  assert.match(String(errors.at(-1)), /stale|current/i);

  const openFailures: unknown[] = [];
  const failing = new Controller!({
    openFile: async () => { throw new Error("permission denied"); },
    reportOpenError: async (error) => { openFailures.push(error); }
  });
  failing.replaceModel(model);
  await failing.open(node);
  assert.equal(openFailures.length, 1);
  assert.match(String(openFailures[0]), /permission denied/u);

  const formatter = (module as unknown as {
    readonly formatGlobalUnderstandingFileOpenError?: (error: unknown) => string;
  }).formatGlobalUnderstandingFileOpenError;
  assert.equal(typeof formatter, "function");
  assert.equal(
    formatter!(new Error("permission denied")),
    "Global のファイルを開けませんでした: permission denied"
  );
});
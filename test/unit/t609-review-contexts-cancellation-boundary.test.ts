import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";

import { settleReviewContextsRepositorySelection } from "../../src/t609-review-contexts-cancellation-boundary";
import {
  ReviewContextsRepositorySelectionCancelled,
  resolveReviewContextsRepository,
} from "../../src/t609-review-contexts-repository";

const runtimeRequire = createRequire(__filename);

const loadReviewContextsRuntime = () => {
  const commands = new Map<string, (...argumentsList: unknown[]) => Promise<unknown>>();
  const fakeVscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0 },
    window: { createTreeView: () => ({ dispose: () => undefined }) },
    commands: {
      registerCommand: (id: string, callback: (...argumentsList: unknown[]) => Promise<unknown>) => {
        commands.set(id, callback);
        return { dispose: () => undefined };
      },
    },
  };
  const moduleLoader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = (request, parent, isMain) => request === "vscode"
    ? fakeVscode : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  delete runtimeRequire.cache[modulePath];
  const runtime = runtimeRequire(modulePath) as typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  moduleLoader._load = originalLoad;
  return { commands, runtime };
};

test("T609-NR-004 preserves the existing provider projection for multi-root Quick Pick cancel and stale cancellation", async () => {
  const acceptedProjection = ["existing-context"];
  let clearCount = 0;
  let reportCount = 0;
  const boundary = {
    clear: () => { clearCount += 1; acceptedProjection.length = 0; },
    reportTerminalFailure: async () => { reportCount += 1; },
  };

  let cancellation: unknown;
  try {
    await resolveReviewContextsRepository({
      activeDocumentPath: undefined,
      openedDocumentPaths: [],
      knownRootPaths: [],
      workspaceFolderPaths: ["/workspace/one", "/workspace/two"],
      inspectRepository: async (rootPath) => ({
        kind: "repository" as const,
        repository: { rootPath, repositoryId: rootPath },
      }),
      requestSelection: async () => undefined,
    });
  } catch (error) {
    cancellation = error;
  }
  assert.ok(cancellation instanceof ReviewContextsRepositorySelectionCancelled);
  assert.equal(await settleReviewContextsRepositorySelection(cancellation, boundary), "cancelled");
  assert.deepEqual(acceptedProjection, ["existing-context"]);
  assert.equal(clearCount, 0);
  assert.equal(reportCount, 0);

  assert.equal(
    await settleReviewContextsRepositorySelection(new ReviewContextsRepositorySelectionCancelled(), boundary),
    "cancelled",
  );
  assert.deepEqual(acceptedProjection, ["existing-context"]);
  assert.equal(clearCount, 0);
  assert.equal(reportCount, 0);
});

test("T609-NR-004 cancel and stale typed outcomes run one command without terminal reporting, clear, or post-cancel refresh", async () => {
  for (const selection of ["cancel", "stale"] as const) {
    const { commands, runtime } = loadReviewContextsRuntime();
    let loads = 0;
    let redetects = 0;
    const terminalErrors: unknown[] = [];
    const registered = runtime.registerReviewContextsRuntime({ subscriptions: [] } as never, {
      source: { load: async () => {
        loads += 1;
        return [{ label: "accepted", context: { contextId: "accepted", kind: "branch" } }] as never;
      } },
      controller: {
        redetectPullRequest: async () => {
          redetects += 1;
          throw new ReviewContextsRepositorySelectionCancelled();
        },
      } as never,
      refreshDecorations: async () => undefined,
      reportError: async (error) => { terminalErrors.push(error); },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const loadsBeforeCancellation = loads;

    await commands.get("reviewRange.redetectPullRequest")!();

    assert.equal(redetects, 1, `${selection} runs the T405 command exactly once`);
    assert.equal(loads, loadsBeforeCancellation, `${selection} must not start a post-cancel provider refresh`);
    assert.equal(terminalErrors.length, 0, `${selection} must not report a terminal failure`);
    const projection = registered.getProjectionSnapshotForTest?.();
    assert.ok(projection, `${selection} Test-only projection snapshot must be available`);
    assert.deepEqual(
      projection.map((item) => item.context.contextId),
      ["accepted"],
      `${selection} must not clear the accepted provider projection`,
    );
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  CurrentContextRuntimeCoordinator,
  CurrentContextUiController,
  currentContextSelectionKey,
  type CurrentContextUiHost,
  type CurrentContextUiSnapshot
} from "../../src/ui/current-context/index";

const pullRequestSnapshot: CurrentContextUiSnapshot = {
  context: {
    kind: "pull-request",
    label: "#42",
    detail: "Improve context UI",
    baseRevision: "1111111111111111111111111111111111111111",
    headRevision: "2222222222222222222222222222222222222222"
  },
  progress: {
    reviewedLineCount: 20,
    totalLineCount: 40,
    progress: 0.5
  }
};

test("pull request, branch, and workspace labels are projected consistently", () => {
  const host = createHost();
  const controller = new CurrentContextUiController(host);

  controller.update(pullRequestSnapshot);
  assert.equal(host.contextLabel, "PR #42");
  assert.equal(host.contextDescription, "Improve context UI");
  assert.equal(host.statusText, "$(git-pull-request) PR #42: 50%");

  controller.update({
    context: { kind: "branch", label: "feature/t305", detail: "local branch" },
    progress: { reviewedLineCount: 3, totalLineCount: 4, progress: 0.75 }
  });
  assert.equal(host.contextLabel, "Branch: feature/t305");
  assert.equal(host.statusText, "$(git-branch) feature/t305: 75%");

  controller.update({
    context: { kind: "workspace", label: "sample-workspace" },
    progress: undefined
  });
  assert.equal(host.contextLabel, "Workspace: sample-workspace");
  assert.equal(host.statusText, "$(folder) sample-workspace");
});

test("branch selection identity remains stable when HEAD advances", () => {
  const before: CurrentContextUiSnapshot = {
    context: {
      kind: "branch",
      label: "feature/t305-context-ui",
      detail: "/repo",
      headRevision: "1111111111111111111111111111111111111111"
    },
    progress: undefined
  };
  const after: CurrentContextUiSnapshot = {
    context: {
      kind: "branch",
      label: "feature/t305-context-ui",
      detail: "/repo",
      headRevision: "2222222222222222222222222222222222222222"
    },
    progress: undefined
  };

  assert.equal(currentContextSelectionKey(before), currentContextSelectionKey(after));
});

test("select applies the authoritative selected snapshot", async () => {
  const events: string[] = [];
  const selected: CurrentContextUiSnapshot = {
    context: { kind: "branch", label: "selected", detail: "/repo" },
    progress: { reviewedLineCount: 8, totalLineCount: 10, progress: 0.8 }
  };
  const host = createHost(events);
  const controller = new CurrentContextUiController(host, {
    recompute: async () => pullRequestSnapshot,
    selectContext: async () => {
      events.push("select");
      return selected;
    }
  });

  await controller.selectContext();

  assert.deepEqual(events, [
    "select",
    "tree:Branch: selected",
    "status:$(git-branch) selected: 80%"
  ]);
});

test("runtime coordinator refreshes dependents after selected UI is applied", async () => {
  const events: string[] = [];
  const controller = new CurrentContextUiController(createHost(events), {
    recompute: async () => pullRequestSnapshot,
    selectContext: async () => ({
      context: { kind: "workspace", label: "chosen" },
      progress: undefined
    })
  });
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    refreshDependents: () => {
      events.push("dependents");
    }
  });

  await coordinator.selectContext();

  assert.deepEqual(events, [
    "tree:Workspace: chosen",
    "status:$(folder) chosen",
    "dependents"
  ]);
});

test("refresh ignores stale asynchronous snapshots", async () => {
  let resolveFirst!: (snapshot: CurrentContextUiSnapshot) => void;
  const first = new Promise<CurrentContextUiSnapshot>((resolve) => {
    resolveFirst = resolve;
  });
  const host = createHost();
  let calls = 0;
  const controller = new CurrentContextUiController(host, {
    recompute: async () => ++calls === 1
      ? first
      : { context: { kind: "branch", label: "new" }, progress: undefined },
    selectContext: async () => undefined
  });

  const staleRefresh = controller.refresh();
  await controller.refresh();
  resolveFirst({ context: { kind: "branch", label: "old" }, progress: undefined });
  await staleRefresh;

  assert.equal(host.contextLabel, "Branch: new");
});

const createHost = (events: string[] = []): CurrentContextUiHost & {
  contextLabel?: string;
  contextDescription?: string;
  statusText?: string;
} => ({
  setCurrentContext(item) {
    this.contextLabel = item.label;
    this.contextDescription = item.description;
    events.push(`tree:${item.label}`);
  },
  setStatusBar(item) {
    this.statusText = item.text;
    events.push(`status:${item.text}`);
  }
});

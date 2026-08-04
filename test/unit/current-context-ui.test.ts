import assert from "node:assert/strict";
import test from "node:test";

import {
  CurrentContextUiController,
  type CurrentContextUiHost,
  type CurrentContextUiSnapshot
} from "../../src/ui/current-context/index";

const pullRequestSnapshot: CurrentContextUiSnapshot = {
  context: {
    kind: "pull-request",
    label: "PR #42",
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

test("refresh and select commands recompute one snapshot and synchronize tree and status", async () => {
  const events: string[] = [];
  const snapshots: CurrentContextUiSnapshot[] = [
    pullRequestSnapshot,
    {
      context: { kind: "branch", label: "main" },
      progress: { reviewedLineCount: 8, totalLineCount: 10, progress: 0.8 }
    }
  ];
  const host = createHost(events);
  const controller = new CurrentContextUiController(host, {
    recompute: async () => snapshots.shift(),
    selectContext: async () => {
      events.push("select");
      return { kind: "branch", label: "selected" };
    }
  });

  await controller.refresh();
  assert.deepEqual(events, ["tree:PR #42", "status:$(git-pull-request) PR #42: 50%"]);

  events.length = 0;
  await controller.selectContext();
  assert.deepEqual(events, ["select", "tree:Branch: main", "status:$(git-branch) main: 80%"]);
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

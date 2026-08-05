import assert from "node:assert/strict";
import test from "node:test";

import {
  CurrentContextRuntimeCoordinator,
  CurrentContextCandidateSelection,
  CurrentContextRuntimeComposition,
  CurrentContextUiController,
  currentContextSelectionKey,
  type CurrentContextUiHost,
  type CurrentContextUiSnapshot
} from "../../src/ui/current-context/index";

const branchSnapshot = (
  label: string,
  branchRef: string
): CurrentContextUiSnapshot => ({
  context: {
    kind: "branch",
    label,
    detail: "/repo",
    selection: {
      kind: "branch",
      repositoryId: "repo",
      repositoryRoot: "/repo",
      branchRef
    }
  },
  progress: undefined
});

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

test("selected context identity is applied to the review runtime before decorations refresh", async () => {
  const events: string[] = [];
  const selection = {
    kind: "workspace" as const,
    workspaceFolderUri: { scheme: "file", authority: "", path: "/workspace" }
  };
  const controller = new CurrentContextUiController(createHost(events), {
    recompute: async () => undefined,
    selectContext: async () => ({
      context: { kind: "workspace", label: "chosen", selection },
      progress: undefined
    } as CurrentContextUiSnapshot)
  });
  const refresher = {
    setSelectedContext: (value: typeof selection | undefined) => {
      events.push(`selection:${value?.kind ?? "automatic"}`);
    },
    refreshDependents: () => {
      events.push("dependents");
    }
  };
  const coordinator = new CurrentContextRuntimeCoordinator(controller, refresher);

  await coordinator.selectContext();

  assert.deepEqual(events, [
    "tree:Workspace: chosen",
    "status:$(folder) chosen",
    "selection:workspace",
    "dependents"
  ]);
});

test("refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh", async () => {
  const events: string[] = [];
  const oldSelection = {
    kind: "branch" as const,
    repositoryId: "repo",
    repositoryRoot: "/repo",
    branchRef: "refs/heads/old"
  };
  const fallbackSelection = {
    kind: "workspace" as const,
    workspaceFolderUri: { scheme: "file", authority: "", path: "/workspace" }
  };
  let current: CurrentContextUiSnapshot = {
    context: { kind: "branch", label: "old", selection: oldSelection },
    progress: undefined
  };
  const controller = new CurrentContextUiController(createHost(events), {
    recompute: async () => current,
    selectContext: async () => current
  });
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    setSelectedContext: (selection) => {
      events.push(`selection:${selection?.kind}:${selection?.kind === "branch" ? selection.branchRef : "workspace"}`);
    },
    refreshDependents: () => {
      events.push("dependents");
    }
  });

  await coordinator.selectContext();
  current = {
    context: { kind: "workspace", label: "fallback", selection: fallbackSelection },
    progress: undefined
  };
  await coordinator.refresh();

  assert.deepEqual(events, [
    "tree:Branch: old",
    "status:$(git-branch) old",
    "selection:branch:refs/heads/old",
    "dependents",
    "tree:Workspace: fallback",
    "status:$(folder) fallback",
    "selection:workspace:workspace",
    "dependents"
  ]);
});

test("production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities", async () => {
  const selection = new CurrentContextCandidateSelection();
  const oldBranch = branchSnapshot("old", "refs/heads/old");
  const newBranch = branchSnapshot("new", "refs/heads/new");
  const workspace: CurrentContextUiSnapshot = {
    context: {
      kind: "workspace",
      label: "fallback",
      selection: {
        kind: "workspace",
        workspaceFolderUri: { scheme: "file", authority: "", path: "/workspace" }
      }
    },
    progress: undefined
  };
  const detached: CurrentContextUiSnapshot = {
    context: {
      kind: "branch",
      label: "0123456789ab",
      selection: {
        kind: "detached",
        repositoryId: "other-repo",
        repositoryRoot: "/other",
        headRevision: "0123456789abcdef0123456789abcdef01234567"
      }
    },
    progress: undefined
  };
  const quickPickCalls: string[] = [];

  const selected = await selection.select([oldBranch, workspace], async (candidates) => {
    quickPickCalls.push(candidates.map((candidate) => candidate.context.label).join(","));
    return candidates[0];
  });
  assert.equal(selected, oldBranch);
  selection.acceptExplicit(selected);
  assert.equal(selection.resolve([newBranch, workspace], newBranch), newBranch);
  assert.equal(selection.resolve([workspace], workspace), workspace);

  const detachedSelection = await selection.select(
    [detached, workspace],
    async (candidates) => candidates[0]
  );
  assert.notEqual(detachedSelection, undefined);
  if (detachedSelection === undefined) {
    throw new Error("The test Quick Pick must return its detached candidate.");
  }
  selection.acceptExplicit(detachedSelection);
  assert.equal(selection.resolve([detached, workspace], workspace)?.context.selection?.kind, "detached");
  assert.deepEqual(quickPickCalls, ["old,fallback"]);
});

test("a stale candidate resolution cannot clear a newer explicit selection", async () => {
  const selection = new CurrentContextCandidateSelection();
  const selected = branchSnapshot("selected", "refs/heads/selected");
  const fallback = branchSnapshot("fallback", "refs/heads/fallback");

  selection.acceptExplicit(selected);
  assert.equal(selection.resolve([fallback], fallback), fallback);
  assert.equal(
    selection.resolve([selected, fallback], fallback),
    selected,
    "A resolution not accepted by the UI must not discard the explicit selection."
  );
});

test("a stale Quick Pick completion cannot replace the accepted explicit selection", async () => {
  const events: string[] = [];
  const selection = new CurrentContextCandidateSelection();
  const accepted = branchSnapshot("accepted", "refs/heads/accepted");
  const stale = branchSnapshot("stale", "refs/heads/stale");
  let resolveStale!: (snapshot: CurrentContextUiSnapshot) => void;
  const stalePick = new Promise<CurrentContextUiSnapshot>((resolve) => {
    resolveStale = resolve;
  });
  let selects = 0;
  let candidates = [stale];
  const composition = new CurrentContextRuntimeComposition(selection, {
    enumerateCandidates: async () => candidates,
    resolveFallback: async (available) => available[0],
    requestSelection: async () => {
      selects += 1;
      return selects === 1 ? stalePick : accepted;
    }
  });
  const controller = new CurrentContextUiController(createHost(events), {
    recompute: () => composition.recompute(),
    selectContext: () => composition.selectContext(),
    acceptRecomputed: (snapshot) => composition.acceptRecomputed(snapshot),
    acceptExplicit: (snapshot) => composition.acceptExplicit(snapshot)
  });
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    setSelectedContext: (snapshot) => {
      events.push(`runtime:${snapshot?.kind === "branch" ? snapshot.branchRef : "automatic"}`);
    },
    refreshDependents: () => {
      events.push("dependents");
    }
  });

  const staleCommand = coordinator.selectContext();
  candidates = [accepted];
  await coordinator.selectContext();
  resolveStale(stale);
  await staleCommand;
  candidates = [accepted, stale];
  await coordinator.refresh();

  assert.deepEqual(events, [
    "tree:Branch: accepted",
    "status:$(git-branch) accepted",
    "runtime:refs/heads/accepted",
    "dependents",
    "tree:Branch: accepted",
    "status:$(git-branch) accepted",
    "runtime:refs/heads/accepted",
    "dependents"
  ]);
});

test("an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery", async () => {
  const events: string[] = [];
  const selected = branchSnapshot("selected", "refs/heads/selected");
  const recovered = branchSnapshot("recovered", "refs/heads/recovered");
  const selection = new CurrentContextCandidateSelection();
  let candidates: CurrentContextUiSnapshot[] = [selected];
  const host = createHost(events);
  const composition = new CurrentContextRuntimeComposition(selection, {
    enumerateCandidates: async () => candidates,
    resolveFallback: async (available) => available[0],
    requestSelection: async (available) => available[0]
  });
  const controller = new CurrentContextUiController(host, {
    recompute: () => composition.recompute(),
    selectContext: () => composition.selectContext(),
    acceptRecomputed: (snapshot) => composition.acceptRecomputed(snapshot),
    acceptExplicit: (snapshot) => composition.acceptExplicit(snapshot)
  });
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    setSelectedContext: (snapshot) => {
      events.push(`runtime:${snapshot?.kind === "branch" ? snapshot.branchRef : "automatic"}`);
    },
    refreshDependents: () => {
      events.push("dependents");
    }
  });

  await coordinator.selectContext();
  candidates = [];
  await coordinator.refresh();
  assert.equal(host.contextLabel, undefined);
  assert.equal(host.statusText, undefined);
  candidates = [recovered];
  await coordinator.refresh();

  assert.deepEqual(events, [
    "tree:Branch: selected",
    "status:$(git-branch) selected",
    "runtime:refs/heads/selected",
    "dependents",
    "tree:clear",
    "status:clear",
    "runtime:automatic",
    "dependents",
    "tree:Branch: recovered",
    "status:$(git-branch) recovered",
    "runtime:refs/heads/recovered",
    "dependents"
  ]);
});

test("production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned", async () => {
  const events: string[] = [];
  const candidateSelection = new CurrentContextCandidateSelection();
  const oldBranch = branchSnapshot("old", "refs/heads/old");
  const newBranch = branchSnapshot("new", "refs/heads/new");
  const detached: CurrentContextUiSnapshot = {
    context: {
      kind: "branch",
      label: "other detached",
      selection: {
        kind: "detached",
        repositoryId: "other",
        repositoryRoot: "/other",
        headRevision: "0123456789abcdef0123456789abcdef01234567"
      }
    },
    progress: undefined
  };
  let candidates = [oldBranch];
  const composition = new CurrentContextRuntimeComposition(candidateSelection, {
    enumerateCandidates: async () => candidates,
    resolveFallback: async (available) => available[0],
    requestSelection: async (available) => available[0]
  });
  const controller = new CurrentContextUiController(createHost(events), {
    recompute: () => composition.recompute(),
    selectContext: () => composition.selectContext(),
    acceptRecomputed: (snapshot) => composition.acceptRecomputed(snapshot),
    acceptExplicit: (snapshot) => composition.acceptExplicit(snapshot)
  });
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    setSelectedContext: (selection) => {
      events.push(`runtime:${selection?.kind}:${selection?.kind === "branch"
        ? selection.branchRef
        : selection?.kind === "detached" ? selection.repositoryRoot : "automatic"}`);
    },
    refreshDependents: () => {
      events.push("command-and-decoration-refresh");
    }
  });

  await coordinator.selectContext();
  candidates = [newBranch];
  await coordinator.refresh();
  candidates = [detached];
  await coordinator.selectContext();

  assert.deepEqual(events, [
    "tree:Branch: old",
    "status:$(git-branch) old",
    "runtime:branch:refs/heads/old",
    "command-and-decoration-refresh",
    "tree:Branch: new",
    "status:$(git-branch) new",
    "runtime:branch:refs/heads/new",
    "command-and-decoration-refresh",
    "tree:Branch: other detached",
    "status:$(git-branch) other detached",
    "runtime:detached:/other",
    "command-and-decoration-refresh"
  ]);
});

test("Git refresh failures are reported instead of escaping fire-and-forget activation and editor events", async () => {
  const controller = new CurrentContextUiController(createHost(), {
    recompute: async () => {
      throw new Error("Git inspection failed for /workspace");
    },
    selectContext: async () => undefined
  });
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    refreshDependents: () => undefined
  });
  const reported: string[] = [];

  await (coordinator as unknown as {
    refreshWithErrorBoundary(report: (error: unknown) => void): Promise<void>;
  }).refreshWithErrorBoundary((error) => {
    reported.push(error instanceof Error ? error.message : String(error));
  });

  assert.deepEqual(reported, ["Git inspection failed for /workspace"]);
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
  },
  clearCurrentContext() {
    this.contextLabel = undefined;
    this.contextDescription = undefined;
    events.push("tree:clear");
  },
  clearStatusBar() {
    this.statusText = undefined;
    events.push("status:clear");
  }
});

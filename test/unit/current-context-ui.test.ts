import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index";
import {
  gitCurrentContextSnapshot,
  inspectCurrentContextDocument,
  isNonGitCurrentContextWorkspace
} from "../../src/t305-current-context-git";
import {
  CurrentContextRuntimeCoordinator,
  CurrentContextCandidateSelection,
  CurrentContextRuntimeComposition,
  CurrentContextUiController,
  currentContextSelectionKey,
  type CurrentContextUiHost,
  type CurrentContextUiSnapshot
} from "../../src/ui/current-context/index";
import { createTemporaryGitRepository } from "../support/temporary-git-repository";

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

test("T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does", async () => {
  const first = branchSnapshot("first", "refs/heads/first");
  const second = branchSnapshot("second", "refs/heads/second");
  let quickPickCalls = 0;
  const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
    enumerateCandidates: async () => [first, second],
    resolveFallback: async () => undefined,
    requestSelection: async (available) => {
      quickPickCalls += 1;
      return available[0];
    }
  });

  assert.deepEqual(
    await composition.recompute(undefined, undefined, { allowInteraction: false }),
    { kind: "unresolved" },
    "activation and active-editor refresh must retain the accepted state when multiple roots remain"
  );
  assert.equal(quickPickCalls, 0, "background recompute must not invoke the Quick Pick port");
  assert.equal(
    await composition.recompute(undefined, undefined, { allowInteraction: true }),
    first,
    "the explicit refresh command remains the user-interactive selection path"
  );
  assert.equal(quickPickCalls, 1);
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

test("production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership", async () => {
  const repository = await createTemporaryGitRepository();
  const git = createNodeLocalGitAdapter();
  const documentFsPath = path.join(repository.path, "fixture.txt");
  const events: string[] = [];

  try {
    assert.equal(await isNonGitCurrentContextWorkspace(git, repository.path), false);
    const branchInspection = await inspectCurrentContextDocument(git, documentFsPath);
    assert.equal(branchInspection.kind, "repository");
    if (branchInspection.kind !== "repository") {
      throw new Error("The temporary Git file must resolve to its repository.");
    }
    const branch = gitCurrentContextSnapshot(branchInspection.repository);
    assert.equal(branch.context.selection?.kind, "branch");

    let candidates = [branch];
    const composition = new CurrentContextRuntimeComposition(
      new CurrentContextCandidateSelection(),
      {
        enumerateCandidates: async () => candidates,
        resolveFallback: async (available) => available[0],
        requestSelection: async (available) => available[0]
      }
    );
    const controller = new CurrentContextUiController(createHost(events), {
      recompute: () => composition.recompute(),
      selectContext: () => composition.selectContext(),
      acceptRecomputed: (snapshot) => composition.acceptRecomputed(snapshot),
      acceptExplicit: (snapshot) => composition.acceptExplicit(snapshot)
    });
    const coordinator = new CurrentContextRuntimeCoordinator(controller, {
      setSelectedContext: (selection) => {
        events.push(`runtime:${selection?.kind === "branch"
          ? selection.branchRef
          : selection?.kind === "detached" ? selection.headRevision : "automatic"}`);
      },
      refreshDependents: () => {
        events.push("dependents");
      }
    });

    await coordinator.refresh();
    await repository.runGit(["checkout", "--detach", repository.headCommit]);
    const detachedInspection = await inspectCurrentContextDocument(git, documentFsPath);
    assert.equal(detachedInspection.kind, "repository");
    if (detachedInspection.kind !== "repository") {
      throw new Error("The detached temporary Git file must resolve to its repository.");
    }
    const detached = gitCurrentContextSnapshot(detachedInspection.repository);
    assert.equal(detached.context.selection?.kind, "detached");
    candidates = [detached];
    await coordinator.refresh();

    assert.deepEqual(events, [
      "tree:Branch: main",
      "status:$(git-branch) main",
      "runtime:refs/heads/main",
      "dependents",
      `tree:Branch: ${repository.headCommit.slice(0, 12)}`,
      `status:$(git-branch) ${repository.headCommit.slice(0, 12)}`,
      `runtime:${repository.headCommit}`,
      "dependents"
    ]);
  } finally {
    await repository.cleanup();
  }
});

test("Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned", async () => {
  const events: string[] = [];
  const unavailableGit = {
    inspectRepository: async () => ({
      kind: "git-unavailable" as const,
      executable: "git"
    })
  };
  const workspace: CurrentContextUiSnapshot = {
    context: {
      kind: "workspace",
      label: "fallback workspace",
      selection: {
        kind: "workspace",
        workspaceFolderUri: { scheme: "file", authority: "", path: "/workspace" }
      }
    },
    progress: undefined
  };
  assert.equal(await isNonGitCurrentContextWorkspace(unavailableGit, "/workspace"), true);
  const composition = new CurrentContextRuntimeComposition(
    new CurrentContextCandidateSelection(),
    {
      enumerateCandidates: async () => [workspace],
      resolveFallback: async (available) => available[0],
      requestSelection: async (available) => available[0]
    }
  );
  const controller = new CurrentContextUiController(createHost(events), {
    recompute: () => composition.recompute(),
    selectContext: () => composition.selectContext(),
    acceptRecomputed: (snapshot) => composition.acceptRecomputed(snapshot),
    acceptExplicit: (snapshot) => composition.acceptExplicit(snapshot)
  });
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    setSelectedContext: (selection) => {
      events.push(`runtime:${selection?.kind ?? "automatic"}`);
    },
    refreshDependents: () => {
      events.push("dependents");
    }
  });

  await coordinator.refresh();

  assert.deepEqual(events, [
    "tree:Workspace: fallback workspace",
    "status:$(folder) fallback workspace",
    "runtime:workspace",
    "dependents"
  ]);
});

test("unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate", async () => {
  const failure = new Error("permission denied while inspecting /workspace");
  await assert.rejects(
    isNonGitCurrentContextWorkspace(
      { inspectRepository: async () => { throw failure; } },
      "/workspace"
    ),
    failure
  );
});

test("a Quick Pick choice is not committed when its candidate inventory changes without another controller generation", async () => {
  const oldBranch = branchSnapshot("old", "refs/heads/old");
  const newBranch = branchSnapshot("new", "refs/heads/new");
  const detached: CurrentContextUiSnapshot = {
    context: {
      kind: "branch",
      label: "0123456789ab",
      selection: {
        kind: "detached",
        repositoryId: "repo",
        repositoryRoot: "/repo",
        headRevision: "0123456789abcdef0123456789abcdef01234567"
      }
    },
    progress: undefined
  };

  for (const nextCandidates of [[newBranch], [detached], []] as const) {
    const events: string[] = [];
    let candidates: readonly CurrentContextUiSnapshot[] = [oldBranch];
    let resolvePick!: (snapshot: CurrentContextUiSnapshot) => void;
    const pendingPick = new Promise<CurrentContextUiSnapshot>((resolve) => {
      resolvePick = resolve;
    });
    const composition = new CurrentContextRuntimeComposition(
      new CurrentContextCandidateSelection(),
      {
        enumerateCandidates: async () => candidates,
        resolveFallback: async (available) => available[0],
        requestSelection: async () => pendingPick
      }
    );
    const controller = new CurrentContextUiController(createHost(events), {
      recompute: () => composition.recompute(),
      selectContext: () => composition.selectContext(),
      acceptRecomputed: (snapshot) => composition.acceptRecomputed(snapshot),
      acceptExplicit: (snapshot) => composition.acceptExplicit(snapshot)
    });
    const coordinator = new CurrentContextRuntimeCoordinator(controller, {
      setSelectedContext: (selection) => {
        events.push(`runtime:${selection?.kind ?? "automatic"}`);
      },
      refreshDependents: () => {
        events.push("dependents");
      }
    });

    const pendingCommand = coordinator.selectContext();
    candidates = nextCandidates;
    resolvePick(oldBranch);
    await pendingCommand;

    assert.deepEqual(
      events,
      [],
      "A changed or disappeared inventory must not apply the old Quick Pick result."
    );
  }
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

test("T606 never retries a Current Context Quick Pick selection after a retryable failure", async () => {
  let selections = 0;
  const controller = new CurrentContextUiController(createHost(), {
    recompute: async () => undefined,
    selectContext: async () => {
      selections += 1;
      throw Object.assign(new Error("selection transport failed"), { code: "ECONNRESET" });
    },
  });
  await assert.rejects(() => controller.selectContext(), /selection transport failed/u);
  assert.equal(selections, 1);
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

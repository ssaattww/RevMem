import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/review-file-exclusion-policy-service";
import { T505GlobalUnderstandingSource } from "../../src/t505-global-understanding-source";
import {
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

test("Issue #67 resolves Global file items against the selected context repository root", () => {
  const source = new T505GlobalUnderstandingSource({
    storageUris: {
      globalStorageUri: { fsPath: path.join("tmp", "review-range-global") },
      storageUri: { fsPath: path.join("tmp", "review-range-workspace") }
    },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined
  });
  const repositoryRoot = path.join("tmp", "repository");
  source.setContext({
    context: {
      kind: "branch",
      label: "main",
      detail: repositoryRoot,
      headRevision: "revision-67",
      selection: {
        kind: "branch",
        repositoryId: "repository-67",
        repositoryRoot,
        branchRef: "refs/heads/main"
      }
    },
    progress: undefined
  });

  assert.equal(
    source.resolveCurrentFilePath("src/example.ts"),
    path.join(repositoryRoot, "src", "example.ts")
  );
  assert.throws(
    () => source.resolveCurrentFilePath("../outside.ts"),
    /repository-relative|relative path|outside|parent/u
  );
});

test("Issue #67 keeps PR Progress clickable and wires Global file clicks to its open command", async () => {
  const [prRuntime, globalRuntime] = await Promise.all([
    readFile("src/ui/pr-progress/vscode-pull-request-progress-tree.ts", "utf8"),
    readFile("src/ui/global-understanding/vscode-global-understanding-runtime.ts", "utf8")
  ]);

  assert.match(
    prRuntime,
    /item\.command\s*=\s*\{[\s\S]*?command:\s*OPEN_PULL_REQUEST_PROGRESS_ITEM_COMMAND_ID[\s\S]*?arguments:\s*\[node\]/u
  );
  assert.match(
    globalRuntime,
    /OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID\s*=\s*[\s\S]*?"reviewRange\.openGlobalUnderstandingFile"/u
  );
  assert.match(
    globalRuntime,
    /case\s+"file"[\s\S]*?item\.command\s*=\s*\{[\s\S]*?command:\s*OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID[\s\S]*?arguments:\s*\[node\.path\]/u
  );
  assert.match(
    globalRuntime,
    /registerCommand\([\s\S]*?OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID[\s\S]*?dependencies\.openFile\(repositoryPath\)/u
  );
});

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SNAPSHOT_SERVICE = r'''import type {
  FileReviewState,
  GlobalFileReviewState,
  RepositoryGlobalRevisionSnapshot,
  RepositoryGlobalState,
  ReviewContextRevisionSnapshot,
  ReviewContextState
} from "../contracts/index";
import { normalizeLineIntervals } from "../intervals/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const requireRevisionId = (value: string, name: string): void => {
  if (value.trim().length === 0) throw new Error(`${name} must be a non-empty immutable revision ID.`);
};

const requireTimestamp = (value: string, name: string): void => {
  if (value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be an ISO 8601 timestamp.`);
  }
};

const requireCanonicalIntervals = (
  intervals: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
  lineCount: number | undefined,
  name: string
): void => {
  const normalized = normalizeLineIntervals(intervals);
  if (JSON.stringify(normalized) !== JSON.stringify(intervals)) {
    throw new Error(`${name} must contain canonical normalized intervals.`);
  }
  if (lineCount !== undefined && normalized.some((range) => range.endLineExclusive > lineCount)) {
    throw new Error(`${name} exceeds the snapshot file line count.`);
  }
};

const validateContextFiles = (
  files: Readonly<Record<string, Readonly<FileReviewState>>>,
  revisionId: string,
  name: string
): void => {
  const paths = new Set<string>();
  for (const [fileId, file] of Object.entries(files)) {
    if (file.fileId !== fileId) throw new Error(`${name} file key and fileId must match.`);
    if (file.currentPath.trim().length === 0 || paths.has(file.currentPath)) {
      throw new Error(`${name} file paths must be non-empty and unique.`);
    }
    paths.add(file.currentPath);
    if (file.revisionId !== revisionId) throw new Error(`${name} file revision must match the snapshot revision.`);
    if (!Number.isSafeInteger(file.lineCount) || file.lineCount < 0) {
      throw new Error(`${name} file lineCount must be a non-negative safe integer.`);
    }
    requireCanonicalIntervals(file.modifiedReviewed, file.lineCount, `${name}.modifiedReviewed`);
    for (const [diffId, ranges] of Object.entries(file.originalReviewedByDiff)) {
      if (diffId.trim().length === 0) throw new Error(`${name} original diff ID must not be empty.`);
      requireCanonicalIntervals(ranges, undefined, `${name}.originalReviewedByDiff`);
    }
    if (file.contentHash !== undefined && file.contentHash.trim().length === 0) {
      throw new Error(`${name} contentHash must not be empty.`);
    }
    requireTimestamp(file.updatedAt, `${name}.updatedAt`);
  }
};

const validateGlobalFiles = (
  files: Readonly<Record<string, Readonly<GlobalFileReviewState>>>,
  revisionId: string,
  name: string
): void => {
  const paths = new Set<string>();
  for (const [fileId, file] of Object.entries(files)) {
    if (file.fileId !== fileId) throw new Error(`${name} file key and fileId must match.`);
    if (file.currentPath.trim().length === 0 || paths.has(file.currentPath)) {
      throw new Error(`${name} file paths must be non-empty and unique.`);
    }
    paths.add(file.currentPath);
    if (file.revisionId !== revisionId) throw new Error(`${name} file revision must match the snapshot revision.`);
    requireCanonicalIntervals(file.reviewed, undefined, `${name}.reviewed`);
    if (file.contentHash !== undefined && file.contentHash.trim().length === 0) {
      throw new Error(`${name} contentHash must not be empty.`);
    }
    requireTimestamp(file.updatedAt, `${name}.updatedAt`);
  }
};

const isPullRequestState = (state: Readonly<ReviewContextState>): boolean =>
  state.kind === "pull-request" && state.pullRequest !== undefined;

/** Synchronizes the authoritative current PR state into revision-keyed Context and Global snapshots. */
export const synchronizeCurrentRevisionSnapshots = (input: {
  readonly contextState: Readonly<ReviewContextState>;
  readonly globalState: Readonly<RepositoryGlobalState>;
  readonly revisionId: string;
  readonly updatedAt: string;
}): { readonly contextState: ReviewContextState; readonly globalState: RepositoryGlobalState } => {
  if (!isPullRequestState(input.contextState)) {
    return {
      contextState: clone(input.contextState),
      globalState: clone(input.globalState)
    };
  }
  requireRevisionId(input.revisionId, "revisionId");
  if (input.contextState.pullRequest?.headSha !== input.revisionId) {
    throw new Error("Pull-request HEAD must match the snapshot revision.");
  }
  if (input.globalState.currentRevisionId !== input.revisionId) {
    throw new Error("Global current revision must match the snapshot revision.");
  }
  requireTimestamp(input.updatedAt, "updatedAt");
  validateContextFiles(input.contextState.files, input.revisionId, "Context current files");
  validateGlobalFiles(input.globalState.files, input.revisionId, "Global current files");

  const contextSnapshot: ReviewContextRevisionSnapshot = {
    schemaVersion: input.contextState.schemaVersion,
    revisionId: input.revisionId,
    files: clone(input.contextState.files),
    updatedAt: input.updatedAt
  };
  const globalSnapshot: RepositoryGlobalRevisionSnapshot = {
    schemaVersion: input.globalState.schemaVersion,
    revisionId: input.revisionId,
    files: clone(input.globalState.files),
    updatedAt: input.updatedAt
  };
  return {
    contextState: {
      ...clone(input.contextState),
      revisionSnapshots: {
        ...clone(input.contextState.revisionSnapshots ?? {}),
        [input.revisionId]: contextSnapshot
      }
    },
    globalState: {
      ...clone(input.globalState),
      revisionSnapshots: {
        ...clone(input.globalState.revisionSnapshots ?? {}),
        [input.revisionId]: globalSnapshot
      }
    }
  };
};

/** Returns a validated clone of an exact Context revision snapshot, or undefined on a true miss. */
export const restoreContextRevisionSnapshotFiles = (
  state: Readonly<ReviewContextState>,
  revisionId: string
): Record<string, FileReviewState> | undefined => {
  requireRevisionId(revisionId, "revisionId");
  const snapshot = state.revisionSnapshots?.[revisionId];
  if (snapshot === undefined) return undefined;
  if (snapshot.schemaVersion !== state.schemaVersion) throw new Error("Context revision snapshot schema must match current state.");
  if (snapshot.revisionId !== revisionId) throw new Error("Context revision snapshot revision key does not match its payload.");
  requireTimestamp(snapshot.updatedAt, "Context revision snapshot updatedAt");
  validateContextFiles(snapshot.files, revisionId, "Context revision snapshot");
  return clone(snapshot.files);
};

/** Returns a validated clone of an exact Global revision snapshot, or undefined on a true miss. */
export const restoreGlobalRevisionSnapshotFiles = (
  state: Readonly<RepositoryGlobalState>,
  revisionId: string
): Record<string, GlobalFileReviewState> | undefined => {
  requireRevisionId(revisionId, "revisionId");
  const snapshot = state.revisionSnapshots?.[revisionId];
  if (snapshot === undefined) return undefined;
  if (snapshot.schemaVersion !== state.schemaVersion) throw new Error("Global revision snapshot schema must match current state.");
  if (snapshot.revisionId !== revisionId) throw new Error("Global revision snapshot revision key does not match its payload.");
  requireTimestamp(snapshot.updatedAt, "Global revision snapshot updatedAt");
  validateGlobalFiles(snapshot.files, revisionId, "Global revision snapshot");
  return clone(snapshot.files);
};
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one occurrence, found {count}")
    return text.replace(old, new, 1)


def update_test() -> None:
    path = ROOT / "test/unit/immutable-revision-review-snapshot.test.ts"
    text = path.read_text(encoding="utf-8")
    old = '''  const transaction = unmarkReviewedRanges({
    contextState: states.contextState,
    globalState: states.globalState,
    target: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: A,
      lineCount: 3
    },
    intervals: [{ startLine: 1, endLineExclusive: 2 }],
    occurredAt: "2026-08-31T00:03:00.000Z"
  });

  assert.deepEqual(
    transaction.next.contextState.revisionSnapshots?.[A]?.files.file?.modifiedReviewed,
'''
    new = '''  const transaction = unmarkReviewedRanges({
    contextState: states.contextState,
    globalState: states.globalState,
    target: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: A,
      lineCount: 3
    },
    intervals: [{ startLine: 1, endLineExclusive: 2 }],
    occurredAt: "2026-08-31T00:03:00.000Z"
  });
  const synchronized = synchronizeCurrentRevisionSnapshots({
    contextState: transaction.next.contextState,
    globalState: transaction.next.globalState,
    revisionId: A,
    updatedAt: "2026-08-31T00:03:00.000Z"
  });

  assert.deepEqual(
    synchronized.contextState.revisionSnapshots?.[A]?.files.file?.modifiedReviewed,
'''
    if old in text:
        text = text.replace(old, new, 1)
        text = text.replace(
            "transaction.next.globalState.revisionSnapshots?.[A]?.files.file?.reviewed",
            "synchronized.globalState.revisionSnapshots?.[A]?.files.file?.reviewed",
            1,
        )
        text = text.replace(
            "transaction.next.contextState.revisionSnapshots?.[B]?.files.file?.modifiedReviewed",
            "synchronized.contextState.revisionSnapshots?.[B]?.files.file?.modifiedReviewed",
            1,
        )

    old = '''  const transaction = markReviewedRanges({
    contextState: context,
    globalState: global,
    target: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: A,
      lineCount: 3
    },
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt: "2026-08-31T00:05:00.000Z"
  });

  assert.deepEqual(
    transaction.next.contextState.revisionSnapshots?.[A]?.files.file?.modifiedReviewed,
'''
    new = '''  const transaction = markReviewedRanges({
    contextState: context,
    globalState: global,
    target: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: A,
      lineCount: 3
    },
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt: "2026-08-31T00:05:00.000Z"
  });
  const synchronized = synchronizeCurrentRevisionSnapshots({
    contextState: transaction.next.contextState,
    globalState: transaction.next.globalState,
    revisionId: A,
    updatedAt: "2026-08-31T00:05:00.000Z"
  });

  assert.deepEqual(
    synchronized.contextState.revisionSnapshots?.[A]?.files.file?.modifiedReviewed,
'''
    if old in text:
        text = text.replace(old, new, 1)
        text = text.replace(
            "transaction.next.contextState.revisionSnapshots?.[C]?.files.file?.modifiedReviewed",
            "synchronized.contextState.revisionSnapshots?.[C]?.files.file?.modifiedReviewed",
            1,
        )
    path.write_text(text, encoding="utf-8")


def update_runtime_commit_boundary() -> None:
    path = ROOT / "src/t405-pull-request-review-runtime-base.ts"
    text = path.read_text(encoding="utf-8")
    old_import = 'import type { ReviewStateTransaction } from "./core/review-state/index";'
    new_import = 'import {\n  synchronizeCurrentRevisionSnapshots,\n  type ReviewStateTransaction\n} from "./core/review-state/index";'
    if old_import in text:
        text = text.replace(old_import, new_import, 1)
    elif "synchronizeCurrentRevisionSnapshots" not in text:
        raise RuntimeError("review state import was not found")

    old_commit = '''        await this.options.repository.commit(transaction);
'''
    new_commit = '''        const synchronized = synchronizeCurrentRevisionSnapshots({
          contextState: transaction.next.contextState,
          globalState: transaction.next.globalState,
          revisionId: registration.snapshot.headSha,
          updatedAt: transaction.next.contextState.updatedAt
        });
        await this.options.repository.commit({
          ...transaction,
          next: synchronized
        });
'''
    if new_commit not in text:
        text = replace_once(text, old_commit, new_commit, "PR command snapshot write-through")
    path.write_text(text, encoding="utf-8")


def restore_core_service() -> None:
    import subprocess

    content = subprocess.check_output(
        ["git", "show", "origin/main:src/core/review-state/review-state-service.ts"],
        cwd=ROOT,
        text=True,
    )
    (ROOT / "src/core/review-state/review-state-service.ts").write_text(content, encoding="utf-8")


def update_design_wording() -> None:
    path = ROOT / "doc/design/immutable-revision-review-snapshots.md"
    text = path.read_text(encoding="utf-8")
    old = '''現在revision上で確認済みまたは確認済み解除が成功した場合、1回のatomic transactionで次を更新する。

1. 現在のContext `files`
2. 現在のGlobal `files`
3. Context `revisionSnapshots[currentRevision]`
4. Global `revisionSnapshots[currentRevision]`

Original側だけの操作でGlobalが変化しない場合も、Contextの現在revision snapshotは同じtransaction内で更新する。no-op、cancel、stale拒否、永続化失敗ではsnapshotを更新しない。
'''
    new = '''PR diff上の確認済みまたは確認済み解除が成功した場合、PR runtimeの永続化境界で現在のContext/Global `files`と対応するrevision snapshotを同じatomic transactionへwrite-throughする。Original側だけの操作でGlobal rangeが変化しない場合も、Context/Globalのcurrent revision snapshotは同じcommit内容から同期する。no-op、cancel、stale拒否、永続化失敗ではsnapshotを更新しない。

通常editor等の別経路でcurrent stateが更新された場合も、revision遷移前のsource snapshot同期を必須とする。このためexact revisionを離れる時点で、そのrevisionの最後に確定したContext/Global状態が必ずsnapshotへ保存される。coreの汎用range transactionへPR固有snapshot更新を混入させない。
'''
    if old in text:
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")


def main() -> None:
    restore_core_service()
    module = ROOT / "src/core/review-state/revision-snapshot-service.ts"
    module.write_text(SNAPSHOT_SERVICE, encoding="utf-8")
    update_test()
    update_runtime_commit_boundary()
    update_design_wording()


if __name__ == "__main__":
    main()

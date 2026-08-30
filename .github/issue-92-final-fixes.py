from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STABLE_HEAD = "7937dbf758054783250dfe7d54df559d262201c2"


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one occurrence, found {count}")
    return text.replace(old, new, 1)


def ensure_design() -> None:
    main = ROOT / "doc/design/vscode-review-range-tracker-design.md"
    text = main.read_text(encoding="utf-8")
    if "設計書 rev9" not in text:
        run("python", ".github/issue-92-revision-snapshot-worker.py")
        text = main.read_text(encoding="utf-8")
    old = """現在revisionで確認または解除が成功した場合、現在のContext/Global stateと対応するrevision snapshotを同じatomic transactionで更新する。失敗、cancel、no-op、stale operationではsnapshotを変更しない。
"""
    new = """PR diff上の確認または解除は、PR runtimeの永続化境界で現在のContext/Global stateと対応するrevision snapshotを同じatomic transactionへwrite-throughする。通常editor等の別経路でcurrent stateが更新された場合は、revision遷移前にsource revision snapshotへ同期する。失敗、cancel、no-op、stale operationではsnapshotを変更しない。
"""
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise RuntimeError("main design snapshot update boundary was not found")
    main.write_text(text, encoding="utf-8")


def ensure_option_b() -> None:
    module = ROOT / "src/application/review-commands/original-selection-review-plan.ts"
    service = ROOT / "src/application/review-commands/diff-editor-review-command-service.ts"
    runtime = ROOT / "src/t405-pull-request-review-runtime-base.ts"
    package = ROOT / "package.json"
    ready = (
        module.exists()
        and "buildOriginalSideLineProjection" in module.read_text(encoding="utf-8")
        and "createOriginalSelectionReviewPlan" in module.read_text(encoding="utf-8")
        and "commitTransactionSequence" in service.read_text(encoding="utf-8")
        and "originalToModifiedLineMappings:" in runtime.read_text(encoding="utf-8")
    )
    if not ready:
        run("python", ".github/issue-92-option-b-repair.py")

    text = package.read_text(encoding="utf-8")
    parsed = json.loads(text)
    items = parsed["contributes"]["menus"]["editor/context"]
    if len(items) != 7:
        raise RuntimeError(f"editor/context must remain at 7 entries, found {len(items)}")
    for command in (
        "reviewRange.markSelectionReviewed",
        "reviewRange.unmarkSelectionReviewed",
        "reviewRange.markFileReviewed",
        "reviewRange.unmarkFileReviewed",
    ):
        matching = [item for item in items if item.get("command") == command]
        if len(matching) != 1:
            raise RuntimeError(f"{command} must have exactly one editor/context contribution")
        when = matching[0].get("when", "")
        if "isInDiffEditor" not in when or "reviewRange.prProgressDiffReviewActions" not in when:
            raise RuntimeError(f"{command} is not scoped to PR Progress diff tabs")


def ensure_snapshot_test() -> bool:
    path = ROOT / "test/unit/immutable-revision-review-snapshot.test.ts"
    if path.exists():
        return False
    run("python", ".github/issue-92-revision-snapshot-implementation.py", "tests")
    return True


def ensure_snapshot_implementation() -> None:
    service = ROOT / "src/core/review-state/revision-snapshot-service.ts"
    mapper = ROOT / "src/application/github-pr-context/immutable-pull-request-revision-mapper.ts"
    contracts = ROOT / "src/core/contracts/review-state.ts"
    context_store = ROOT / "src/application/github-pr-context/github-pull-request-context-layer-store.ts"
    ready = (
        service.exists()
        and "restoreContextRevisionSnapshotFiles" in service.read_text(encoding="utf-8")
        and "restoreContextRevisionSnapshotFiles" in mapper.read_text(encoding="utf-8")
        and "ReviewContextRevisionSnapshot" in contracts.read_text(encoding="utf-8")
        and "PullRequestRevisionMappingDisposition" in context_store.read_text(encoding="utf-8")
    )
    if not ready:
        run("python", ".github/issue-92-revision-snapshot-implementation.py", "implementation")
    run("python", ".github/issue-92-revision-snapshot-correction.py")

    stable_core = subprocess.check_output(
        ["git", "show", f"{STABLE_HEAD}:src/core/review-state/review-state-service.ts"],
        cwd=ROOT,
        text=True,
    )
    (ROOT / "src/core/review-state/review-state-service.ts").write_text(stable_core, encoding="utf-8")

    mapper_text = mapper.read_text(encoding="utf-8")
    base_marker = "if (baseOnlyTransition) {"
    start = mapper_text.index(base_marker)
    end = mapper_text.index("    const restoredContextFiles", start)
    block = mapper_text[start:end]
    block = block.replace('return withDisposition(synchronized, "restored");', 'return withDisposition(synchronized, "mapped");')
    mapper_text = mapper_text[:start] + block + mapper_text[end:]
    mapper.write_text(mapper_text, encoding="utf-8")


def ensure_package_test_registration() -> None:
    package = ROOT / "package.json"
    text = package.read_text(encoding="utf-8")
    entries = [
        "test-dist/test/unit/original-diff-selection-projection.test.js",
        "test-dist/test/unit/issue-92-pr-progress-selection-review.test.js",
        "test-dist/test/unit/immutable-revision-review-snapshot.test.js",
    ]
    anchor = "test-dist/test/unit/diff-editor-review-command-service.test.js"
    for entry in entries:
        if entry not in text:
            if anchor not in text:
                raise RuntimeError("package test:unit anchor was not found")
            text = text.replace(anchor, f"{anchor} {entry}", 1)
    package.write_text(text, encoding="utf-8")


def ensure_design_contract_test() -> None:
    path = ROOT / "test/unit/design-document-structure.test.ts"
    text = path.read_text(encoding="utf-8")
    text = text.replace("設計書 rev8", "設計書 rev9")
    path.write_text(text, encoding="utf-8")


def add_snapshot_storage_contract_test() -> None:
    path = ROOT / "test/unit/immutable-revision-review-snapshot.test.ts"
    text = path.read_text(encoding="utf-8")
    marker = 'test("revision snapshots survive canonical JSON persistence without recursive state", () => {'
    if marker in text:
        return
    addition = r'''

test("revision snapshots survive canonical JSON persistence without recursive state", () => {
  const state = snapshotAt(contextState(A), globalState(A), A, "2026-08-31T00:01:00.000Z");
  const encoded = JSON.stringify(state);
  const decoded = JSON.parse(encoded) as typeof state;

  assert.deepEqual(decoded.contextState.revisionSnapshots?.[A]?.files.file?.modifiedReviewed, full);
  assert.deepEqual(decoded.globalState.revisionSnapshots?.[A]?.files.file?.reviewed, full);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      decoded.contextState.revisionSnapshots?.[A] ?? {},
      "revisionSnapshots"
    ),
    false
  );
});
'''
    path.write_text(text.rstrip() + addition + "\n", encoding="utf-8")


def main() -> None:
    ensure_design()
    ensure_option_b()
    ensure_snapshot_implementation()
    ensure_package_test_registration()
    ensure_design_contract_test()
    add_snapshot_storage_contract_test()


if __name__ == "__main__":
    main()

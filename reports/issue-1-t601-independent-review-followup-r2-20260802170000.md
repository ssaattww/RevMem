# T601 Independent Review Follow-up R2

## Scope

- Pull Request: #33
- Task: T601
- Finding: `T601-IFR-003` High only
- Source closure verification: `reports/issue-1-t601-independent-fix-verification-20260802163000.md`
- Boundary: no new review perspective, normal-review rerun, commit, push, PR mutation, or merge.

## Closure implementation

- `SnapshotTrackingWorkspaceReviewStateSessionProvider.open()` now treats the latest generation as the sole evidence source. It invalidates the pointer before replacing any state, clears the current file's Context and Global ranges, then applies only a successful mapped result and publishes the replacement snapshot.
- Missing pointers and `missing`/`corrupt`/`expired`/`ambiguous` mapping results therefore persist and return an empty current-file review state; they cannot republish a same-content persisted reviewed base state.
- A successful map with an empty reviewed range also replaces existing base evidence with empty evidence rather than retaining or unioning it.
- `loadForDecoration()` follows the same replace-not-union rule without persistence: it clears current-file Context/Global evidence first, then applies only a successful non-empty latest mapping. Invalid or absent latest evidence returns no reviewed decoration.
- Existing `commitWithSnapshot()` retains its pre-commit pointer invalidation. Thus command snapshot publication failures after unmark remain fail-closed.

## Regression evidence

- Added provider-level sibling coverage for each latest-generation failure mode with a same-content persisted reviewed base:
  - pointer missing;
  - latest bytes corrupt;
  - latest generation expired.
- Each sibling asserts both `loadForDecoration()` and `open()` return empty Context and Global ranges, and that `open()` publishes an authoritative empty replacement generation.
- Existing tests retain post-unmark publish-failure coverage, successful empty-generation publication, persistent adapter restart, and changed-content remapping coverage.

## Validation

- `npm run test:t601`: pass, 17 tests.
- `npm run test:vscode`: the run covering the fail-closed replacement behavior passed, including confirm, restart restoration, unmark, and second restart. A repeat after the final pointer-invalidation ordering hardening exceeded the 120-second local command limit without emitting a test assertion or diagnostic; this is held as the existing non-product Windows Extension Host/test-environment instability (Issue #28). The focused provider regression suite covers that ordering directly.
- `npm run compile`: pass.
- `npm run lint`: pass.
- `npm run validate:architecture`: pass.
- `npm run validate:architecture:negative`: pass with expected 11 violations.
- `git diff --check`: pass.
- Markdown wording lint remains `unsupported`: repository-local `tools/lint/` and `lint:md` wiring are absent. No lint configuration was changed.

## Next action

The same independent reviewer verifies closure of `T601-IFR-003` only against the next implementation HEAD. Issue #28 and T607 performance remain held and are outside this closure scope.

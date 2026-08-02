# T601 Independent Review Follow-up

## Scope

- Pull Request: #33
- Task: T601
- Reviewed finding source: `reports/issue-1-t601-independent-final-review-20260802093000.md`
- Base integration: latest `origin/main` was integrated by `51204a0`; `package.json` retains both T207 and T601 focused-suite wiring.
- Normal review: already completed. This follow-up does not rerun it; the next reviewer action is the same independent reviewer closing only `T601-IFR-001` through `T601-IFR-006`.

## Finding closure implementation

### T601-IFR-001 — persistent production snapshot route

- Added `NodeNonGitSnapshotStorage` and `NodeNonGitSnapshotCodec` under `src/adapters/non-git-snapshots/`.
- `src/extension.ts` now constructs the local extension-storage snapshot adapter from the workspace storage route and injects it into `SnapshotTrackingWorkspaceReviewStateSessionProvider`.
- The document/reconciliation path preserves snapshot generation publication for normal commands; the Extension Host lifecycle covers production composition, ordinary decoration reads, restart restoration, unmark, and a second restart.
- `test/unit/node-non-git-snapshot-storage.test.ts` recreates the storage adapter and restores a mapped range from the durable authoritative generation.

### T601-IFR-002 — EOL-aware evidence

- Mapping evidence retains CRLF, LF, CR, terminal-newline, and empty-content state rather than discarding terminators before LCS.
- Focused cases cover CRLF-to-LF, CR-to-LF, terminal newline removal, and empty-to-newline changes. Changed physical lines are not inherited as reviewed.

### T601-IFR-003 — authoritative latest generation

- Snapshot lookup now reads only the workspace/file latest-generation pointer; it never scans older entries after missing, corrupt, expired, or unreadable latest evidence.
- A state transition invalidates that pointer before state commit, then publishes the replacement generation only after the state commit. A publish failure leaves the file unreviewed rather than resurrecting an older range.
- Focused tests cover corrupt/missing/expired snapshots, retention cleanup, successful unmark publication, and save failure after unmark.

### T601-IFR-004 — current-main integration

- Branch HEAD includes `51204a0` (`merge: latest main into T601 follow-up`) and has merge-base `a738019` with `origin/main`.
- T207 and T601 scripts remain wired. T207 focused validation passes.

### T601-IFR-005 — truthful tracking and detailed evidence

- `tasks/tasks-status.md` and `tasks/phases-status.md` now identify PR #33/T601 as in progress, record this follow-up, and state the remaining closure-only independent review/CI gate.
- The stale normal review record remains historical evidence; normal review is not repeated.

### T601-IFR-006 — application/runtime boundary

- `src/application/non-git-snapshots/` now owns only runtime-neutral codec/storage ports and mapping use cases.
- Node compression, SHA-256, Buffer, and filesystem persistence live in the new adapter.
- Architecture validation rejects application imports of snapshot runtime modules; the negative fixture raises the expected 11 violations.

## Validation

- `npm run compile`: pass.
- `npm run lint`: pass.
- `npm run typecheck:contracts`: pass.
- `npm run test:t601`: pass (15 tests).
- `npm run test:t206`, `npm run test:t207`, `npm run test:t302`, `npm run test:t303`, `npm run test:t501`: pass.
- `npm run validate:architecture` and `npm run validate:architecture:negative`: pass.
- `npm run test:vscode`: pass; its confirm, restore-confirmed-and-unmark, and restore-unmarked Extension Host phases passed.
- `npm run test:unit` and `npm run test:git` were attempted. The broader concurrent Windows run hit pre-existing temporary-directory cleanup `EBUSY` failures; the focused T207 run passed. This is held as the existing non-product Windows test-environment issue (Issue #28), not treated as a T601 product failure.
- Markdown wording: `tools/lint/` and `lint:md` wiring are absent, so focused/full Markdown lint is `unsupported`; the repository tracking policy records Markdown lint as outside this task completion gate.

## Held items and next action

- Held: Issue #28 Windows POSIX/temporary-directory portability and T607-owned large-document LCS performance.
- No new review perspective is requested. The same independent reviewer must verify only the six listed finding identities against the next implementation HEAD.

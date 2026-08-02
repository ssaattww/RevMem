# T304 Independent Review Follow-up

## Scope and identity

This follow-up addresses only `T304-IFR-P1` (high), `T304-IFR-P2` (medium),
`T304-IFR-P3` (medium), and `T304-IFR-P4` (medium) from
`reports/issue-1-t304-independent-final-review-20260803062100.md`.

- Reviewed implementation HEAD: `4217d3efd3267093de6a31a9cbaab1d364363e22`
- Working branch: `task/t304-pr-progress-tree`
- No commit, push, PR update, or merge was performed in this follow-up.
- No new product behavior or unrelated cleanup was added.

## Implemented follow-up

### T304-IFR-P1 — immutable Tree identity

`PullRequestProgressTreeDataProvider` now deep-freezes exposed file nodes, their
reviewability, raw source record, diff target, nested file record, and both diff sides.
Each `select()` call creates a new frozen detached target for the host and another
detached result target, so host-side mutation cannot alter provider-owned identity or a
later selection.

The T304 regression mutates every exposed node/target identity field and has the host
attempt a target mutation. It verifies that both selections retain the original context,
paths, revisions, source record, and category identity.

### T304-IFR-P2 — public contract migration record

`Design/BreakingChanges.md` records the `"empty"` revision source and the
`ReviewDiffDocumentDescriptor` / `ReviewDiffEditorSideInput` union migration. The
contract fixture consumes both union members through public barrels and preserves the
external-content-source restriction to the Git-commit member.

### T304-IFR-P3 — tracking synchronization

`tasks/tasks-status.md` now records T304 as in progress with its completed implementation
and the remaining normal verification, commit/push, exact-head CI, and fresh independent
final-review work. `tasks/phases-status.md` records the same P3 state and this report.

### T304-IFR-P4 — one repository reservation and external metadata handoff

The repository handoff now names exactly
`reports/issue-1-t304-independent-final-review-20260803062100.md`, which is the actual
reserved report path. The parent must update PR #38's external body only after committing
and pushing this follow-up: replace the stale submission HEAD with that new commit's full
SHA and replace stale CI references with completed successful runs whose `head_sha` equals
that new SHA. The body must retain the same reserved report path. No future SHA or run ID
is invented in this repository report.

## Validation record

- TDD Red: `npm run test:t304` failed before the provider fix because mutation of a current
  node did not throw; 18 passed and the new immutable-identity regression failed.
- TDD Green: `npm run test:t304` passed after the provider fix; 19 passed.
- `npm run build`, `npm run typecheck:contracts`, `npm run lint`,
  `npm run validate:architecture`, and `npm run validate:architecture:negative` passed.
- `npm run test:git` passed (33 passed, 3 platform skips), `npm run test:github` passed
  (13 passed), and `npm run test:vscode` passed.
- `npm test` reached the unit suite and failed only on the known Issue #28 Windows Git
  ownership/reconciliation limitation: 382 passed, 19 failed, and 2 skipped, all with
  `document path is outside the resolved Git working tree`. Because the aggregate script
  stops at unit failure, its Git, GitHub, and Extension Host stages were executed separately
  above and passed.
- The standards check found no changed public/protected API requiring new documentation;
  the production change is internal runtime freezing/detachment and existing public JSDoc
  already identifies the target contract as immutable.
- Markdown focused lint is `unsupported`: this repository has no `tools/lint/` configuration
  and no `lint:md` script. No whitelist, terminology, or target configuration was changed.
- `git diff --check` passed. The parent must obtain matching CI for the post-commit HEAD;
  the existing `4217d3e...` CI cannot be reused for this changed tree.

## Held environment items

Issue #28 Windows ownership/reconciliation unit failures and Issue #36 local Extension
Host timing are environment-held items. They are outside these four findings and are not
treated as successful local validation.

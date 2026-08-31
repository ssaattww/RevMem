# PR #94 exact-head CI follow-up 1 normal verification

## Scope

CI run 33399940419 の4 Unit failure修正差分。

- Review mode: same-reviewer bounded normal verification of exact-head CI follow-up 1
- Base: `883ddd4d60ed643b381c4afd76929af61f27bac1`
- Reviewed immutable HEAD: `7aa2d4e946b131124191067fc995894f1c48587f`
- Reviewed range: `883ddd4d60ed643b381c4afd76929af61f27bac1..7aa2d4e946b131124191067fc995894f1c48587f`
- Coverage boundary: Issue #66 line-count fixture synchronization, T303 validated original projection fixtures, and T404 base-only transition behavior. No fresh whole-PR or independent review was performed.

## Findings

### PR94-CI1-NR-001 — High — required

- Origin: new finding in exact-head CI follow-up 1 normal verification.
- Location: `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts:176-204`.
- Description: base-only invalidation is placed after the full immutable-snapshot hit early return. `captureImmutableRevisionSnapshots` first creates target-head snapshots from the current state. When a PR has Context files but an empty Global file set, `snapshotEvidence` can validate both the Context snapshot and the empty Global snapshot without `newFiles`, so `restored.context` and `restored.global` are both hits. The mapper returns at `:176-195` before computing `baseOnlyTransition` at `:201-204`; `invalidateOriginalReviewedByDiff` at `:210` is never called.
- Evidence: a focused emitted-code reproduction used a base-only `A/B -> C/B` transition, one Context file with old `A..B` original ranges, an empty Global state, and empty base-only evidence. The result was `mappingDisposition: "restored"` and retained `originalReviewedByDiff[A..B]`, while the modified ranges remained present. The new test at `test/unit/t404-review-followup-r3.test.ts:44-52` does not cover this branch because its non-empty Global state makes target snapshot evidence unavailable and reaches the later base-only branch.
- Impact: changing only the PR base can preserve reviewed original-side ranges that belong to the previous base, causing the new comparison to present stale reviewed state. The returned `restored` disposition also causes `GitHubPullRequestContextStateService` to publish `exact-revision-snapshot-restored` history for a transition that skipped the required base-dependent invalidation, and the stale ranges are captured into the replacement snapshot.
- Required action: make base-only handling take precedence over the full-hit return, or apply the original-range invalidation in every full/mixed/miss base-only path. Add an actual mapper/service fixture with non-empty Context and empty Global state that verifies modified ranges remain bounded and unchanged, all old-base original ranges are cleared in both current state and the captured snapshot, Global state remains valid, and the committed history disposition reflects the completed transition.

### Checked without finding

- Issue #66 fixture — `checked_no_finding`: changing `CONTENT` from `"new\n"` to `"new"` synchronizes the immutable content with declared `lineCount: 1`. The canonical Windows path, legacy file identity, persisted content hash, normal-editor lookup, and PR-progress production composition assertions remain intact; this does not weaken the path-identity coverage.
- T303 fixtures — `checked_no_finding`: `originalToModifiedLineMappings` now explicitly identifies surviving original lines, while `originalDeletionIntervals` remains the authority for deleted lines. The strengthened assertion proves a surviving original selection projects into `modifiedReviewed`, and a spanning selection stores only deletions in `originalReviewedByDiff`. The deleted-only PR fixture deliberately supplies an empty validated mapping and preserves canonical `base..head` progress behavior.
- Scope/configuration — `checked_no_finding`: the delta contains no package, workflow, performance, Host, or public-API change. The added helper is module-private and documented.

## Validation

- `npm run compile:test` — PASS (run once at reviewed HEAD).
- `node --test test-dist/test/unit/issue-66-global-pr-progress.test.js test-dist/test/unit/t303-review-followup.test.js test-dist/test/unit/t404-review-followup-r3.test.js` — PASS: 18 passed, 0 failed (run once).
- Narrow finding proof — reproduced after the compile against emitted code without changing the worktree: base-only transition with one Context file and zero Global files returned `{"mappingDisposition":"restored","originalReviewedByDiff":{"A..B":[{"startLine":0,"endLineExclusive":2}]},"modifiedReviewed":[{"startLine":0,"endLineExclusive":3}],"globalFileCount":0}` (full SHA pair abbreviated here only inside the evidence value).
- Coverage dispositions:
  - Issue #66 line-count/path fixture: `checked_no_finding`.
  - T303 validated mapping/deletion projection: `checked_no_finding`.
  - T404 base-only modified/original/snapshot/history contract: `checked_finding` (PR94-CI1-NR-001).
  - Changed report and direct dependencies: `checked_no_finding` apart from the finding above.
  - Exact-head CI: `held`; no CI wait was authorized for this bounded verification.
  - Full/default, Host, performance, and `test:t607`: `not_applicable` to the authorized validation slice and deliberately not run.
- No verdict-blocking in-scope area remains unexplored. HEAD remained `7aa2d4e946b131124191067fc995894f1c48587f`; the only working-tree delta after validation is this reserved report.

## Verdict

`fail`

Reviewed HEAD `7aa2d4e946b131124191067fc995894f1c48587f` retains one required High finding, PR94-CI1-NR-001. There is no user-confirmation-required gap. Exact-head CI is held, but it is not the reason for failure; the reproduced production correctness defect is blocking. Fix only the base-only full-hit ordering/invalidation path and its actual empty-Global snapshot/history fixture, then return to the same reviewer for finding-limited verification.

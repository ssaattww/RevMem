# Issue #84 / PR #85 review follow-up implementation report

- Generated: 2026-08-24T20:17:00+09:00
- Repository: `ssaattww/RevMem`
- PR: #85
- Branch: `fix/issue-84-pr-progress-diagnostics`
- Base: `main` (`4535c2a3836c032cd7efaeaddbb543bedfcdb528`)
- Reviewed finding source HEAD: `3b46423aeef7ac62780d09b7ddfb2f838724043d`
- Final technical implementation HEAD: `7c4566526cddfaaa6aa4329f502092a3eb28bd4d`
- Verification capability: `remote_ci_only`
- Merge: not performed

## Purpose and scope

This follow-up addresses only the three findings from the normal review of PR #85: `PR85-NR-001`, `PR85-NR-002`, and `PR85-NR-003`. No unrelated cleanup or redesign was performed.

Authoritative behavior remains Issue #84 and design rev7 sections 16.3.1, 16.7, and 16.10: PR Progress must not bootstrap after failed Review Context acquisition/registration; long Review Context work must emit privacy-safe count progress while acquisition is running; PR-file progress must belong to the PR Progress operation that owns the work.

## Diagnostic workflow confirmation

Before implementation, `.github/workflows/ci.yml` was confirmed to retain the failure diagnostic path. A failing run uploads test output plus generated/source/test/environment/config context. The TDD RED run below produced artifact `9512424405`, confirming the diagnostic path remained usable.

## TDD evidence

Regression coverage was added before the production fixes and connected to the default unit-suite entry point.

RED evidence:

- HEAD: `549af56094cd44978325c68afabe531420c0ad45`
- CI run: `32706411741`
- Result: Unit tests failed with exactly the three newly added follow-up regressions while the preceding build/typecheck/architecture/lint gates passed.
- Failures:
  - `PR85-NR-001 skips PR Progress when Review Contexts registration fails`
  - `PR85-NR-002 exposes Review Contexts stage progress before acquisition completes`
  - `PR85-NR-003 keeps PR-file progress owned by the PR Progress operation`
- Failure diagnostic artifact: `9512424405` (`ci-failure-diagnostics-32706411741-1`)

## Finding dispositions

### PR85-NR-001 — High — addressed

Cause: `refreshCurrentContextDependents` retained the Review Contexts exception but still unconditionally invoked selected PR Progress.

Change: PR Progress refresh is now skipped whenever Review Contexts acquisition/registration fails, while the intended independent decoration/Global refresh isolation is preserved.

Regression evidence: the new test asserts `refreshPullRequestProgress` is not invoked after a Review Contexts failure.

### PR85-NR-002 — High — addressed

Cause: repository and pull-request-context progress was emitted only after `source.load` and `publishLoaded` completed, so a blocked acquisition exposed only a generic START lifecycle entry.

Change:

- Review Contexts reports privacy-safe zero-count progress when acquisition starts.
- The T405 acquisition path advances anonymous repository and PR-context counts as actual owners/contexts are enumerated.
- Only allowlisted stages and numeric counts are reported; repository paths, file names, source text, and PR titles are not used in the progress payload.

Regression evidence: the blocked-acquisition test observes repository progress before `source.load` resolves.

### PR85-NR-003 — Medium — addressed

Cause: PR-file progress reporting dropped the explicit `OperationFeedbackContext`, allowing the no-context fallback to attach progress to the most recently started overlapping operation. Shared reads could also advance PR-file progress outside the owning PR Progress activation.

Change:

- PR-file progress is forwarded with the explicit PR Progress feedback context.
- External/shared `getProgress` reads no longer cause unrelated Review Contexts or Global work to own/advance the PR-file counter.
- Only reads performed inside the owning PR Progress activation contribute to that progress lifecycle.

Regression evidence: the overlapping-operation test asserts that `pull-request-files` progress remains under the PR Progress label and never under Global work.

## Additional compatibility correction

After the production changes, current-head CI reached T606 and failed because one pre-existing T606 assertion required the operation event list to contain only `started/succeeded/failed`. The new Issue #84 contract intentionally introduces `progress` events.

The T606 regression was updated without weakening its terminal lifecycle contract: it still checks START/OK/ERROR ordering and additionally verifies that progress belongs to the Review Contexts operation. No production behavior was changed to satisfy the old assertion.

## Changed files in this follow-up

- `test/unit/issue-84-pr85-review-followup.test.ts` — three finding-specific RED/Green regressions.
- `test/unit/core-contracts.test.ts` — connects the follow-up suite to the default unit gate.
- `src/t305-projection-refresh.ts` — fail-closed PR Progress bootstrap ordering.
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts` — acquisition-start progress reporting.
- `src/t405-review-contexts-runtime.ts` — in-flight anonymous repository/PR-context count reporting.
- `src/t405-pull-request-review-runtime.ts` — explicit PR Progress context ownership and read-scope isolation for PR-file progress.
- `test/unit/t606-failure-policy-retry-diagnostics.test.ts` — aligns the existing lifecycle assertion with the newly supported PROGRESS event while preserving terminal checks.

## Verification

Final technical HEAD `7c4566526cddfaaa6aa4329f502092a3eb28bd4d` has an exact-head pull-request CI run:

- Workflow: `CI`
- Run: `32707992739`
- Conclusion: `success`
- Exact run head: `7c4566526cddfaaa6aa4329f502092a3eb28bd4d`

All configured gates passed, including:

- Build
- Contract typecheck
- Architecture validation and negative contract
- Lint
- Unit tests, including the three PR85 follow-up regressions
- T602/T603/T403/T404/T405/T406
- T304
- T502/T503/T504/T505/T506
- T604/T605/T606/T609/T610
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

The successful run skipped failure-artifact collection, as expected.

## Intentionally untouched

- No task-status entry was modified; this work is a PR review follow-up, not a new task-status transition.
- No design change was made; the fix brings implementation into the already accepted rev7 behavior.
- No workflow change was needed because the required failure diagnostic artifact workflow already existed.
- No merge was performed.

## Remaining risk and next action

No known implementation blocker remains for the three supplied findings. This report is an implementation report, not an independent review verdict.

After this report/handoff administrative commit is pushed, the resulting PR current HEAD must again have a matching `pull_request` CI run before review starts; the successful technical-head run above must not be substituted for that final administrative HEAD.

Next action: normal fix-verification review of `PR85-NR-001` through `PR85-NR-003`, using the final PR current HEAD and its exact-head CI evidence.
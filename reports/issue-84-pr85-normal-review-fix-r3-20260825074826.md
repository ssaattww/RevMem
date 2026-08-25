# Issue #84 / PR #85 normal-review finding follow-up R3

- Generated: 2026-08-25T07:48:26+09:00
- Repository: `ssaattww/RevMem`
- Pull Request: `#85 Issue #84: PR Progressの競合解消と進捗診断の具体化`
- Branch: `fix/issue-84-pr-progress-diagnostics`
- Base: `main` (`4535c2a3836c032cd7efaeaddbb543bedfcdb528`)
- Finding source: `PR85-NR-003` Medium from closure R2
- Reviewer implementation HEAD: `deff9453fc382abca8e71406ee16232379785672`
- Work-start administrative HEAD: `97b47736f3c93742ac3439064a1d6fb3e2eb0857`
- Technical implementation HEAD: `68eaa552a81b535d54eb61d2f4e19d53977f1936`
- Verification capability: `remote_ci_only`
- Merge: not performed

## Scope

This follow-up addresses only the remaining normal-review finding `PR85-NR-003`. `PR85-NR-001` and `PR85-NR-002` were already closed by the normal reviewer and were not reopened or redesigned.

The required behavior is that concrete `pull-request-files` progress belongs to the selected PR Progress operation. The real selected Tree path is `refreshSelectedPullRequestProgress -> PullRequestReviewRuntime.activateProgress`. That path must emit useful count progress even when immutable full-text content is already cached, while Review Contexts and Global operations must not acquire ownership of PR-file progress.

## Diagnostic workflow confirmation

Before implementation, `.github/workflows/ci.yml` was inspected at work-start HEAD `97b47736f3c93742ac3439064a1d6fb3e2eb0857`. The workflow already preserves failure diagnostics through `Collect failure context` and `Upload failure diagnostics`, including test output, stdout/stderr command logs, generated output, source/tests/tools, environment and configuration context. No workflow change was required.

The formal RED run below produced diagnostic artifact `9541252898`, confirming that the required failure-investigation path remains operational.

## Root cause

The prior fix correctly prevented Review Contexts from publishing PR-file progress by making the explicit-feedback-context `getProgress` path delegate directly to the base runtime. It also made the no-context `getProgress` path publish cache-independent `0/total` and `total/total` events.

However, the production selected PR Progress Tree does not use that wrapper `getProgress` path. It invokes `activateProgress`, whose `PR進捗を計算` feedback lifecycle is created in `t405-pull-request-review-runtime-base.ts`.

Before this follow-up, `activateProgress` obtained concrete file-count events only indirectly from the wrapper around `registration.readTextContent`. `lineReviewabilityFor` uses `readCachedFullText`; once immutable content is cached, the wrapper is not called. Therefore a same-snapshot selected Tree recalculation could complete successfully with no `pull-request-files` progress entries at all.

## TDD evidence

### RED

A production-path regression was added first in `test/unit/issue-84-pr85-review-closure-followup.test.ts`.

The test:

1. registers a real `PullRequestReviewRuntime` with one modified PR file;
2. refreshes via `refreshSelectedPullRequestProgress`, using `activateProgress` exactly as the production Tree projection does;
3. verifies the first refresh primes immutable full-text cache;
4. clears operation logs and performs a second same-snapshot refresh;
5. verifies the second refresh performs no new immutable content read;
6. requires `pull-request-files 0/1` and `1/1` under `PR進捗を計算` on that cache-hit refresh;
7. requires every observed PR-file progress event to remain owned by `PR進捗を計算`.

Test-only HEAD: `a6d843b37e2cb78b9aa62e340dfb1094b018b51d`

Exact-head pull-request CI run: `32785125487`.

The first job attempt stopped earlier on a pre-existing Git process timeout regression and was not used as finding RED evidence. The same exact HEAD/job was rerun without changing code. On the rerun, Build, typecheck, architecture, lint, Unit, T602/T603/T403/T404 all passed and T405 failed only on the new NR-003 regression with:

`cache-hit selected Tree refresh must report pull-request-files 0/1`

Formal RED diagnostic artifact:

- artifact ID: `9541252898`
- name: `ci-failure-diagnostics-32785125487-2`
- purpose: test result, stdout/stderr and failure-investigation context for the NR-003 RED run

No unrelated production code was changed for the transient first-attempt timeout.

### GREEN implementation

Technical fix commit: `68eaa552a81b535d54eb61d2f4e19d53977f1936` (`fix: report PR Progress on cache hits`).

Changes:

- `src/t405-pull-request-review-runtime-base.ts`
  - `activateProgress` now publishes `pull-request-files 0/total` immediately inside its own `PR進捗を計算` feedback context.
  - after successful/current snapshot replacement it publishes `pull-request-files total/total` in the same context.
  - completion is not emitted before a failed, stale, or cancelled Tree publication.
- `src/t405-pull-request-review-runtime.ts`
  - cache-miss `readTextContent` observations still provide intermediate unique-file progress.
  - the old first-read `0/total` fallback was removed because `activateProgress` now owns the start event explicitly.
  - explicit-feedback-context `getProgress` remains unchanged and continues to avoid PR-file events, preserving Review Contexts isolation.
- `test/unit/issue-84-pr85-review-closure-followup.test.ts`
  - adds the actual selected Tree/cache-hit regression described above.

## Verification

Technical HEAD `68eaa552a81b535d54eb61d2f4e19d53977f1936` has exact-head pull-request CI run `32785699847`, conclusion `success`.

All configured gates passed:

- Build
- Contract typecheck
- Architecture validation and negative contract
- Lint
- Unit tests
- T602 / T603 / T403 / T404
- T405, including the new production Tree/cache-hit NR-003 regression and the existing Review Contexts ownership regressions
- T406
- T304
- T502 / T503 / T504 / T505 / T506
- T604 / T605 / T606 / T609 / T610
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

Failure artifact collection was skipped on the successful technical run, as designed.

## Finding disposition supplied to reviewer

### PR85-NR-003 — Medium — implementation addressed

Implementation evidence now covers the exact path identified by closure R2: the production selected PR Progress Tree executes `activateProgress`, immutable cache is already warm, no new content read occurs, and the owning `PR進捗を計算` lifecycle still reports `0/total` and `total/total`.

Review Contexts isolation remains separately covered because its explicit feedback context continues through `getProgress` without publishing `pull-request-files` events.

This is an implementation disposition only; it is not an independent review verdict. The same normal-review worker should perform finding-limited fix verification for `PR85-NR-003`.

## Intentionally untouched

- `PR85-NR-001` and `PR85-NR-002`: already closed; no behavior change requested.
- `tasks/tasks-status.md`: no task-state transition for this finding-limited review follow-up.
- design documents: no accepted behavior change was needed.
- `.github/workflows/ci.yml`: required diagnostic artifact collection was already present.
- merge: not performed.

## Next action

After this report and its handoff are committed, the resulting administrative PR HEAD must receive its own pull-request CI run whose run HEAD SHA exactly matches that final PR HEAD. Only that exact-head run is valid for the final handoff. Then update PR #85 and post the concise implementation summary, without merging.
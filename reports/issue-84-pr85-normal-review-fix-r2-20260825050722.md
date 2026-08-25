# Issue #84 / PR #85 normal-review fix R2 implementation report

- Generated: 2026-08-25T05:07:22+09:00
- Repository: `ssaattww/RevMem`
- Issue: #84
- Pull Request: #85
- Branch: `fix/issue-84-pr-progress-diagnostics`
- Base: `main` (`4535c2a3836c032cd7efaeaddbb543bedfcdb528`)
- Scope: remaining normal-review findings `PR85-NR-002` and `PR85-NR-003` only
- Technical implementation HEAD: `fe67ab16b3d4b92aa8c91f284d04efb0e786b15e`
- Verification capability: `remote_ci_only`
- Merge: not performed
- Review: not started by this implementation worker

## Summary

The previous normal-review closure R1 closed `PR85-NR-001` but left `PR85-NR-002` and `PR85-NR-003` open. This follow-up adds an actual production-composition regression for both remaining findings, proves the defects with exact-head CI RED evidence, applies narrowly scoped production fixes, and verifies the final technical HEAD through every configured CI gate including the VS Code Extension Host suite.

Final behavior proven by the production-composition regression:

1. While two persisted PR contexts are synchronized sequentially, completion of the first PR is immediately visible as `pull-request-contexts completed=1` even while the second lifecycle request remains blocked.
2. Review Contexts internal PR progress calculation emits no `pull-request-files` progress under `Review Contextsを更新`.
3. Selected PR progress calculation still emits `pull-request-files` under the PR progress operation, including after Review Contexts has already populated immutable full-text caches.

## Diagnostic workflow confirmation

Before implementing the remaining findings, the existing CI failure-diagnostic workflow was confirmed to collect failure evidence. The observed failing runs executed both `Collect failure context` and `Upload failure diagnostics`, and uploaded test output, standard output/error command logs, generated output, source/test trees, environment metadata, and workflow/config context. No workflow change was required.

Relevant artifacts:

- `9522364043` — formal actual-composition RED run `32733580907`.
- `9522549978` — intermediate NR-002-fixed / NR-003-still-open run `32734105057`.
- `9536080648` — lint-only failure after NR-003 code change, run `32770696463`.
- `9536160412` — cache-hit selected-progress regression found after NR-003 isolation, run `32770862016`.

## TDD and regression evidence

### Formal RED — both remaining findings reproduced

Exact HEAD: `eb69a4723031752ff90c5271a6a73e84087cc9a2`

CI run: `32733580907`

Preceding build, contract typecheck, architecture, lint, Unit, T602, T603, T403, and T404 gates passed. T405 failed on the actual production-composition regression with:

```text
actual:
  firstContextWasReported: false
  reviewContextsPrFileProgressCount: 1
  selectedPrFileProgressReported: true
expected:
  firstContextWasReported: true
  reviewContextsPrFileProgressCount: 0
  selectedPrFileProgressReported: true
```

This is the authoritative RED evidence for `PR85-NR-002` and `PR85-NR-003`.

### NR-002 intermediate verification

Commit: `878cc4920518fc22a9d4721aeccfc49e127faf95`

Exact-head CI: `32734105057`

The actual-composition result changed to:

```text
firstContextWasReported: true
reviewContextsPrFileProgressCount: 1
selectedPrFileProgressReported: true
```

This proves the NR-002 per-context in-flight counter was fixed independently while NR-003 still reproduced.

### NR-003 isolation and cache-hit follow-up

The initial NR-003 change removed PR-file start/end reporting from Review Contexts' explicitly owned `getProgress` call. After a lint-only correction, exact HEAD `8e6b4bd6967995ebd5dfda2b412d43091224e7f0` reached T405 and produced:

```text
firstContextWasReported: true
reviewContextsPrFileProgressCount: 0
selectedPrFileProgressReported: false
```

This proved Review Contexts ownership isolation was correct but also exposed a second-order regression: Review Contexts had already warmed the immutable text cache, so selected PR progress could complete without a `readTextContent` callback and therefore without emitting PR-file progress.

The final fix makes selected `getProgress` reporting independent of cache reads while keeping Review Contexts' explicitly supplied feedback context silent for PR-file progress.

## Finding dispositions

### PR85-NR-002 — High — addressed

Root cause: `readSynchronizedRepository` completed all persisted PR lifecycle synchronization before `T405ReviewContextsSource.load` could advance the PR-context count. With two PRs in one repository, a stalled second lifecycle request kept visible progress at zero even after the first PR had completed.

Fix: successful lifecycle synchronization reports per-context completion immediately at the lifecycle boundary using the owning Review Contexts feedback context, with operation-local identity deduplication. The progress payload remains count-only and does not include repository paths, PR titles, filenames, source text, or credentials.

Production-composition evidence: the test blocks the second real lifecycle request and observes `pull-request-contexts completed=1` before releasing it.

### PR85-NR-003 — Medium — addressed

Root cause: wrapper `getProgress` emitted `pull-request-files` start/end using any supplied feedback context. Production Review Contexts explicitly supplied its own feedback context, so PR-file progress was incorrectly logged under `Review Contextsを更新`.

Fix:

- Calls with an explicit parent feedback context, including Review Contexts internal progress reads, delegate without PR-file progress reporting.
- Selected PR progress calls without an externally supplied context retain PR-file start/end reporting under the active PR progress operation.
- `activateProgress` per-file reporting remains explicitly tied to its own feedback context.
- Selected progress reporting no longer depends on immutable text cache misses, so cache warming by Review Contexts cannot suppress it.

Production-composition evidence: after Review Contexts refresh warms the same runtime caches, the regression verifies zero Review Contexts PR-file progress entries and a positive selected PR-file progress observation.

## Final technical verification

Technical HEAD: `fe67ab16b3d4b92aa8c91f284d04efb0e786b15e`

Exact-head workflow: `CI` run `32771179020`

Conclusion: `success`

Every configured gate passed:

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T602 history rewrite recovery
- T603 schema migration and corruption recovery
- T403 GitHub cache
- T404 GitHub PR context layer
- T405 Review Contexts follow-up, including the actual-composition PR85 closure regression
- T406 GitHub PR integration
- T304 PR progress tree
- T502/T503/T504/T505/T506 Global-related gates
- T604/T605/T606
- T609 repository and encoding
- T610 folder Global Understanding
- Temporary Git integration
- Mock GitHub integration
- VS Code Extension Host tests

Failure diagnostic collection was skipped on this successful run, as expected.

## Commits in this closure follow-up

- `878cc4920518fc22a9d4721aeccfc49e127faf95` — report PR-context progress as each lifecycle synchronization completes (`PR85-NR-002`).
- `6f1f7fd9de1c4629495b1b5b9a4c22fe22621f79` — isolate PR-file progress to the selected PR tree path (`PR85-NR-003`).
- `8e6b4bd6967995ebd5dfda2b412d43091224e7f0` — remove the unused import found by lint.
- `fe67ab16b3d4b92aa8c91f284d04efb0e786b15e` — restore selected PR-file progress without reintroducing Review Contexts ownership leakage.

The actual-composition regression and its T405 gate wiring were added before these production fixes and produced the formal RED evidence above.

## Scope and intentionally untouched areas

- `PR85-NR-001` was already closed by the normal-review closure and was not redesigned here.
- `tasks/tasks-status.md` was not modified because this is finding-limited PR follow-up work, not a new task transition.
- The accepted design contract was not changed.
- `.github/workflows/ci.yml` was not changed because required diagnostic artifact capture already exists and was demonstrated on the failing runs.
- No merge was performed.
- No independent review verdict is claimed by this report.

## Remaining risk and next action

No known implementation blocker remains for `PR85-NR-002` or `PR85-NR-003` based on the production-composition regression and full technical-head CI.

This report commit and its handoff are administrative changes and therefore move the PR HEAD. Per repository policy, the resulting final administrative HEAD must receive its own matching CI success; run `32771179020` must not be substituted for that future HEAD.

After final administrative exact-head CI succeeds, post the concise implementation summary to PR #85 and hand the PR back for finding-limited fix verification. The implementation worker must not merge the PR.

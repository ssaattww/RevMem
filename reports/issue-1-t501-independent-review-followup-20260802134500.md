# T501 Independent Review Follow-up

## Target and scope

- Pull Request: #32
- branch: `task/t501-global-state-repository`
- reviewed finding source: `reports/issue-1-t501-independent-final-review-20260802090100.md`
- prior reviewed HEAD: `59a99dd571555ff3f9c9c0e8fa402fbb3e7e5354`
- integrated base: `origin/main` `238149edb632d298ea43122b12b4cde72b70ec38`
- mode: one-pass implementation of only `T501-IFR2-P1` through `T501-IFR2-P4`

## Implemented closure evidence

### T501-IFR2-P1 — tracking synchronization

`tasks/tasks-status.md` now records T501 as independent-review finding response complete, identifies PR #32 and the remaining closure-only review/CI/squash steps, and records the two relevant reports. `tasks/phases-status.md` now marks P5 in progress and states the precise remaining milestone.

### T501-IFR2-P2 — current-main integration

The branch was rebased onto `238149edb632d298ea43122b12b4cde72b70ec38` without conflicts before the implementation changes. Focused T501, T206, T303, and T207 integration validation were run against that integrated worktree; the parent must run exact-head CI after committing and pushing this follow-up tree.

### T501-IFR2-P3 — lossless Context/Global history

`previousRanges` and `nextRanges` remain Context-side fields. New modified-side transaction and mapping events add the discriminator `rangeRepresentation: "context-and-global"` with `globalPreviousRanges` and `globalNextRanges`. The codec keeps accepting canonical legacy JSONL records that omit these fields, so no existing field is removed or reinterpreted and no breaking-change entry is needed.

The Red/Green regression covers a Global-only range unmark and a Global-only whole-file unmark from `RepositoryGlobalStateRepository` through the production `ReviewHistoryRecorder`, then validates JSONL serialization/parse round trips. A legacy Context-only JSONL record also remains readable.

### T501-IFR2-P4 — public consumer fixture

`type-fixtures/contracts/t501-repository-global-state.fixture.ts` imports the public application barrel and compile-checks range and file operations, `applied`/`no-op` results, the atomic committer, and the history dependency. The fixture is included by the contract typecheck configuration.

## Validation

- Red: the first `npm run test:t501` was blocked because the isolated worktree had no `tsc`; this environment-only defect is tracked by Issue #36. With the already-present shared development dependencies available, temporarily restoring the previous recorder output made the new Global-only history regression fail with `Global repository operations must retain Context and Global history evidence` (and the existing T206 recorder expectation also failed), proving the missing evidence path.
- Green: `npm run test:t501` — 14 passed.
- `npm run test:t206` — 25 passed.
- `npm run test:t303` — 14 passed.
- `npm run test:t207` — 1 passed.
- `npm run compile` — passed.
- `npm run lint` — passed.
- `npm run typecheck:contracts` — passed.
- `npm run validate:architecture` — passed.
- `npm run validate:architecture:negative` — expected 10 violations matched.
- `git diff --check` — passed.

## Markdown and non-product tooling disposition

The changed Markdown files are this report, `tasks/tasks-status.md`, `tasks/phases-status.md`, and `doc/design/vscode-review-range-tracker-design.md`. The repository has neither `tools/lint/` nor a `lint:md` script, so focused Markdown wording lint is `unsupported`; no whitelist or lint-configuration change was made. The missing worktree dependency installation is tracked as [Issue #36](https://github.com/ssaattww/RevMem/issues/36) and did not alter product scope.

## Remaining handoff

No independent verdict is issued by this implementation report. The same independent reviewer must verify closure of only `T501-IFR2-P1` through `T501-IFR2-P4` after the parent commits, pushes, and obtains exact-head CI. No new review perspective or finding is requested.

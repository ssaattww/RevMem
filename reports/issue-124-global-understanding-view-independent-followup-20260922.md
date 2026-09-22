# Issue #124 / PR #125 Independent Review Follow-up

## Metadata

- report type: implementation report / independent-review follow-up
- generated at: 2026-09-22T12:47:54+09:00
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base SHA: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- independent review record HEAD before fixes: `da5f97ee02b8f2179a3fe894c5cf58aed7aac2b8`
- technical implementation HEAD: `67c73c4ddd34fb1fb26720c16a840fa1b5bc8c6c`
- execution: FA780 / Windows / PowerShell / RDC
- completion gate: local validation; CI wait deferred by user

## Scope

The additional independent final review established five required findings.

- I124-IFR-001 / High: stopped sibling loses known file row/open target on another sibling refresh.
- I124-IFR-002 / Low: task ledger and PR body advertise obsolete HEAD/test/review/CI state.
- I124-IFR-003 / High: accepted sibling remains published as running until all siblings finish.
- I124-IFR-004 / Medium: unchanged PR path-only row receives an open command whose immutable PR runtime rejects the path.
- I124-IFR-005 / Medium: source-side path canonicalization/sorting/target projection is not bounded by the scheduler.

All product findings were handled with TDD before implementation. IFR-002 is synchronized after product fixes and local validation.

## I124-IFR-001 / High

### Required action

Retain same-owner/root/revision path-only rows and open targets for known non-active lifecycle scopes, without re-reading the stopped scope body.

### Production path

`T505GlobalUnderstandingSource.recalculate()` now starts from the prior accepted owner/root/revision snapshot.

The new active scopes replace their own direct path/progress evidence. For prior paths whose direct folder is not in the current active set, the source preserves:

- discovered path identity
- prior calculated file progress, when available
- prior open target

The final snapshot merges active-scope results with retained non-active scope evidence. A stopped scope is therefore visible but is not re-enumerated or recalculated.

### Actual-source fixture

`I124-IFR-001 retains stopped sibling file rows and targets without recalculating that scope`

Sequence:

1. discover and calculate `one/a.ts` and `two/a.ts`
2. stop `one`
3. refresh while `two` remains active
4. assert `one` is stopped
5. assert both file rows remain
6. assert `one/a.ts` keeps its previous open target
7. account loaded-line work and verify only one active sibling is recalculated

### TDD evidence

- Red: after stop/refresh, discovered paths were only `["two/a.ts"]`
- Green: discovered paths remain `["one/a.ts","two/a.ts"]`
- commit: `ca4523a24c6fc620aa61cd6748fada1fcb9eca19`

## I124-IFR-003 / High

### Required action

After each scope result is accepted, publish the new current-generation lifecycle before waiting for a longer sibling.

### Production path

Immediately after a successful `FolderUnderstandingScopeController.accept(...)`, the source publishes `lifecycleSnapshot(...)`, then re-checks cancellation/current owner evidence before continuing.

This exposes the accepted scope as `active` while a later sibling may still remain `running`.

### Actual-source fixture

`I124-IFR-003 publishes an accepted sibling as active while another sibling remains running`

The fixture starts two sibling scopes and records source progress publications. It requires a publication containing:

- `one=active`
- `two=running`

### TDD evidence

- Red: no such intermediate lifecycle publication existed
- Green: intermediate `active/running` publication exists
- commit: `ca4523a24c6fc620aa61cd6748fada1fcb9eca19`

## I124-IFR-004 / Medium

### Required action

Every rendered PR path-only row must either have a valid exact-HEAD open route or be explicitly non-openable.

### Production path

For PR contexts:

- the source still displays all path-enumerated direct files
- it creates `pull-request-head` open targets only for paths for which immutable PR HEAD evidence was actually returned
- unchanged/non-diff path-only rows have no open target
- Tree model accepts sparse open targets, but still rejects duplicate targets and targets for undiscovered paths
- VS Code Tree items attach the public open command only when `node.openTarget` exists

Working-tree Global rows retain their existing open behavior.

### Actual composition coverage

The Issue #59 PR source fixture now asserts:

- discovered paths: `pr.ts`, `untouched.ts`
- progress: only `pr.ts`
- open targets: only `pr.ts`

The UI-model fixture `Global Understanding model accepts sparse open targets for non-openable path-only rows` verifies the unchanged row remains visible with no target.

### TDD evidence

- Red: source produced open target for unchanged `untouched.ts`; UI rejected sparse target set
- Green: unchanged row remains visible and non-openable
- T505 focused gate: 26/26 pass
- commit: `88142e7494a9547620e7b30553bc8c7daa8ab6a6`

## I124-IFR-005 / Medium

### Required action

Put source-side candidate/canonicalization/dedupe/sorting/open-target projection on a generation-aware bounded scheduler and prove 10,000-path actual-source work stays within the configured item budget.

### Production path

Repository path enumeration:

- final residual repository-entry work now yields before sorting
- included/direct-directory/excluded result sorting is cooperative bottom-up merge sort
- sort work is accounted as `repository-sort`
- each 128-item stage yields and checks abort

Global source path publication:

- canonicalization, owner candidate union, capture candidate union, available-path filtering, evidence indexing, progress collection, retained-path merge, displayed-path collection, displayed-path sorting, and open-target projection run through one bounded `sourcePathStep` / `flushSourcePath` scheduler
- each scheduler yield re-checks current cancellation and exact owner/root/revision evidence
- displayed-path sort is cooperative rather than native full-array sort

### Actual-source workload

`I124-IFR-005 bounds actual source path enumeration, canonicalization, sorting, and target projection`

The fixture creates 10,000 real files and runs the actual T505 source. It accounts both:

- `repository-*` work
- `source-path-*` work

Assertions require:

- 10,000 discovered rows
- repository sorting work is actually accounted
- source canonicalization/sorting/target work is actually accounted
- every adjacent scheduler-yield interval stays within 128 work items

### TDD evidence

- Red: repository sort/source publication were not present in bounded accounting
- Green: actual-source 10,000-path workload passes
- repository enumeration focused: 8/8 pass
- source/UI performance focused: 5/5 pass
- commit: `67c73c4ddd34fb1fb26720c16a840fa1b5bc8c6c`

## I124-IFR-002 / Low

The task ledger and PR body are synchronized after product implementation and local validation.

The record must distinguish:

- technical implementation HEAD
- administrative current PR HEAD after report/tracking/handoff commits
- local validation status
- normal fix verification still pending
- CI is deferred by user and must not be presented as current-head success

The PR body is updated through the GitHub connector after the administrative record commit.

## Local validation

Technical HEAD: `67c73c4ddd34fb1fb26720c16a840fa1b5bc8c6c`

Focused and static:

- repository enumeration: 8/8 pass
- `npm run test:t505`: 26/26 pass
- `npm run test:t610`: 81/81 pass
- R003/R004/IFR005 performance focused: 5/5 pass
- `npm run test:t607`: 88/91
  - exactly the same three previously reproduced baseline failures
  - no new failure from this follow-up
- `npm run build`: pass
- `npm run lint`: pass
- `npm run typecheck:contracts`: pass
- `npm run validate:architecture`: pass
- `npm run validate:architecture:negative`: expected 11 findings matched

Default local gate:

- `npm test`: exit code 0
- unit: 864 pass / 0 fail / 2 skip
- Git integration: 35 pass / 0 fail / 3 skip
- GitHub integration: 48/48
- T502: 11/11
- VS Code Extension Host: runner phases completed successfully

Per user instruction, CI completion is not a completion gate for this round. No CI result from another SHA is substituted.

## Finding completeness matrix

| Finding | Required action | Production path | Actual fixture | Local evidence |
| --- | --- | --- | --- | --- |
| I124-IFR-001 / High | retain stopped scope known row/target without body read | merge prior non-active scope evidence into final owner snapshot | two-sibling stop/refresh actual source fixture | Red lost row -> Green; T610 81/81 |
| I124-IFR-003 / High | publish accept transition before longer sibling finishes | lifecycle publication immediately after current-generation accept | two-sibling active/running publication fixture | Red no transition -> Green |
| I124-IFR-004 / Medium | valid PR open route or explicit non-openable row | sparse exact-HEAD targets + conditional Tree command | unchanged PR path-only source/UI fixture | Red failing target -> T505 26/26 |
| I124-IFR-005 / Medium | bound source candidate/sort/projection work | cooperative repository/source path scheduler | 10k actual-source workload | Red unaccounted full-array work -> focused Green |
| I124-IFR-002 / Low | sync task/PR metadata | tracking + PR body administrative update | record delta only | completed after technical fixes |

## Current state

All independent-review product findings are implemented and locally validated.

Normal fix verification for I124-IFR-001 through I124-IFR-005 is still required. After normal verification, the same independent reviewer should perform finding/CI-delta-only closure according to the independent review handoff.

CI wait is deferred by explicit user instruction. If CI is checked later, only a run whose head SHA exactly matches the then-current PR HEAD may be used.

Merge is not performed.

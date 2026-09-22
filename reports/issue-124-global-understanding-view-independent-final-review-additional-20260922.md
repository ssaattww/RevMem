# Issue #124 / PR #125 Additional Independent Final Review

## Metadata

- report type: independent final review report
- review mode: independent final review / concurrent report-only delta
- generated at: 2026-09-22T09:12:20+09:00
- repository: `ssaattww/RevMem`
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base SHA: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- initial frozen implementation HEAD: `8bfd513f09f5b249ad8b047d878f48930157a50a`
- current reviewed PR HEAD after concurrent report-only delta: `bdb51d41f1f142c55679e92a4fd1b25e241a1709`
- concurrent delta: one added report file only; no executable/test/design/workflow/tracking changes
- execution: FA780 / Windows / PowerShell / Remote Desktop Commander
- verification capability: `local_execution_available`
- reserved report path: `reports/issue-124-global-understanding-view-independent-final-review-additional-20260922.md`

## Reviewer independence

This chat did not implement Issue #124, implement any review fix, or perform the normal review/fix-verification rounds.
The product source was frozen at `8bfd513...` before the exhaustive pass.
The concurrent commit `bdb51d4...` appeared during the review and adds only
`reports/issue-124-global-understanding-view-independent-final-review-20260922.md`.
The product fingerprint therefore stayed unchanged; that report-only delta was reviewed separately.

The independent product findings below were reproduced before the concurrent independent-review report was opened.
That report was then read only as current-head review-record evidence.

## Verdict

**fail**

Required findings remain. No merge is authorized or performed.

## Authoritative requirements reviewed

Issue #124 requires a spinner that identifies the folder currently in `running`,
action labels that describe the click result, path-enumerated direct files to remain visible
even without content evidence, no guessed percentage for uncollected files, no repository-wide
body scan merely to populate rows, and current-generation state/action presentation after
`running -> active / stopped / failed` transitions.

Design 16.5 additionally says that path-enumerated direct files in a started scope remain file rows
when content evidence is uncollected. Design 19.1 requires Global candidate/evidence/aggregate,
validation, sorting, and projection work to use deterministic bounded scheduling.

Issue #59 was also checked. Its comment explicitly keeps the Global line denominator to previously
opened content and reports unopened files separately. Therefore an uncollected direct file does not
by itself make the repository line denominator a finding in this review.

## Inspected scope

The full product delta and direct dependencies were inspected, including Global source/model/runtime,
folder scope controller, PR immutable file-open runtime, manifest contributions, changed tests,
design 11.3 / 16.5 / 19.1, CI diagnostic workflow, current reports/handoffs/tracking, PR metadata,
and exact-head Actions evidence.

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_finding | IFR-001, IFR-003, IFR-005 violate explicit Issue/design contracts |
| correctness / edge cases | checked_finding | stopped sibling, mixed active/running siblings, and PR unchanged-file probes reproduce defects |
| scope discipline | checked_no_finding | executable delta is limited to Global Understanding presentation/source/model and relevant tests/config |
| changed files / direct dependencies | checked_finding | source/controller and source/PR-open-runtime interactions expose three missed lifecycle/compatibility paths |
| API/data/config/workflow/compatibility | checked_finding | IFR-004 creates invalid PR file-open targets for newly visible non-diff rows |
| error handling / diagnostics | checked_no_finding | failed-state publication and diagnostic artifact workflow exist; no raw secret exposure found |
| security / secret handling | checked_no_finding | no credential change and no repository-wide body scan was added for path-only rows |
| tests / validation adequacy | checked_finding | changed tests miss stopped-row retention, completed-sibling spinner transition, PR unchanged-row open, and source-level path publication budget |
| current-head CI evidence | checked_no_finding | exact current report-only HEAD run 35669893514 succeeded with matching artifact SHA |
| report / tracking / documentation accuracy | checked_finding | IFR-002: task ledger and PR body still advertise obsolete state/HEAD/CI |
| regression / maintainability risk | checked_finding | lifecycle snapshot ownership and unbounded source publication can regress multi-scope responsiveness/state accuracy |

## Finding I124-IFR-001 / High — reconfirmed

- origin: introduced_by_change / incomplete Issue #124 lifecycle handling
- location: `src/composition/global-understanding/global-understanding-source.ts:135,267-309`
- dependency: `FolderUnderstandingScopeController.activeFolders()`
- requirement: Issue #124 path-enumerated file retention / design 16.5

After two sibling scopes have both completed path enumeration, stopping one while the other remains
active causes the next successful refresh to rebuild `discoveredFilePaths` only from the active sibling.
The stopped folder row remains, but its previously known direct file row and open target disappear.

Independent reproduction on compiled product source:

- before stop: `["one/a.ts","two/a.ts"]`
- after stopping `one` and refreshing while `two` remains active: `["two/a.ts"]`
- final states: root=`inactive`, `one=stopped`, `two=active`
- probe exit: 1
- evidence: `C:\Users\donabe\Project\RevMem-pr125-independent-evidence-20260922\stopped-sibling-file-row-probe.log`

### Required action

Retain same-owner/root/revision path-only rows for known non-active lifecycle scopes instead of rebuilding
the final owner snapshot only from `activeFolders()`. Add an actual-source regression covering:
successful two-sibling discovery -> stop one -> sibling refresh, while asserting the stopped row,
its known direct file row/open target, and zero stopped-scope body reads.

## Finding I124-IFR-002 / Low — reconfirmed

- origin: workflow_record_inconsistency
- location: `tasks/tasks-status.md:7,26-27` and PR #125 body

Current tracking still says R004 / I124-FINAL are waiting for normal fix verification even though the
committed R3 fix-verification report records `pass_with_held`. The PR body still calls
`4e6ddb45966ec96e7b5e16834f44af7e5858979d` the final HEAD, reports T610 75/75, and cites the old
CI run/artifact, while the current branch has advanced through multiple review-fix rounds.

### Required action

After product findings are fixed and normally verified, synchronize the task ledger and PR summary to the
actual reviewed HEAD, focused counts, review status, and exact-head CI evidence.

## Finding I124-IFR-003 / High — completed sibling keeps a false running spinner

- origin: introduced_by_change
- location: `src/composition/global-understanding/global-understanding-source.ts:153-178,267-309`
- requirement: Issue #124 running-spinner identification and current-generation transition acceptance

`recalculate()` publishes lifecycle snapshots when scopes are put into `running`.
Later, `FolderUnderstandingScopeController.accept()` changes each completed scope to `active`,
but the source does not publish the updated lifecycle state at that point. It waits until all sibling
scope work finishes and only then publishes the final snapshot.

With a short `one` scope and a longer `two` scope, the controller can already be
`one=active, two=running` while the last published Tree still says
`one=running, two=running`. The completed folder therefore continues to show the spinner even though
it is no longer collecting, defeating the requested ability to distinguish which folder is currently running.

Independent probe:
- actual controller states at the blocked scheduler point: `[["","inactive"],["one","active"],["two","running"]]`
- last published states: `[["","inactive"],["one","running"],["two","running"]]`
- probe exit: 1
- evidence: `C:\Users\donabe\Project\RevMem-pr125-independent-evidence-20260922\sibling-active-transition-probe.log`

### Required action

Publish a current-generation lifecycle update after each accepted scope transition, before waiting on a
longer sibling, while preserving stale-generation fencing. Add a two-sibling actual-source/runtime fixture
that blocks after the first accept and verifies only the still-running sibling has `loading~spin`.

## Finding I124-IFR-004 / Medium — PR path-only rows can be rendered but cannot be opened

- origin: introduced_by_change / compatibility
- locations:
  - `src/composition/global-understanding/global-understanding-source.ts:286-301,427+`
  - `src/ui/global-understanding/vscode-global-understanding-runtime.ts:200`
  - `src/composition/pull-request/pull-request-review-runtime-base.ts:357-370`

The new path-only projection creates a `pull-request-head` open target for every displayed PR-context
path and the Tree assigns the public open command to every file row. Repository path enumeration can
include unchanged files that are not members of the PR diff snapshot.

`PullRequestReviewRuntime.createHeadFileDocumentUri()`, however, accepts only
`registration.snapshot.files` and throws `Global PR file is unavailable at the requested HEAD revision`
for an unchanged path. Thus the new row is visible but clicking it fails.

Independent actual-runtime probe:
- discovered: `["changed.ts","unchanged.ts"]`
- calculated progress: `["changed.ts"]`
- `unchanged.ts` receives a `pull-request-head` target
- `createHeadFileDocumentUri(...unchanged.ts...)` throws the error above
- probe exit: 1
- evidence: `C:\Users\donabe\Project\RevMem-pr125-independent-evidence-20260922\pr-unmodified-file-open-probe.log`

### Required action

Make every newly rendered PR path-only row's open behavior valid for its exact PR HEAD identity, or
explicitly project it as non-openable without assigning a failing command. Add an actual composition test
for an unchanged direct file that is path-enumerated but absent from the PR diff snapshot.

## Finding I124-IFR-005 / Medium — source path-only publication bypasses the bounded scheduler

- origin: introduced_by_change / performance
- locations:
  - `src/composition/global-understanding/global-understanding-source.ts:178,199,205,286-289`
  - design 19.1

The UI-model validation/projection was made cooperative by R003/R004, but the source still performs
large path-only materialization synchronously. On a 10,000-file root, after the enumerator's bounded
checkpoints complete, the source performs full-array canonicalization/sorting/target projection without
another scheduler yield or current-generation check.

The independent source-level probe instruments real 10,000-item `sort` / `map` calls:
- total `yieldControl` calls: 78
- large operations:
  - `sort(10000)` at yield count 78
  - `map(10000)` at yield count 78
  - `sort(10000)` at yield count 78
  - `map(10000)` at yield count 78
- discovered rows: 10,000
- probe exit: 1
- evidence: `C:\Users\donabe\Project\RevMem-pr125-independent-evidence-20260922\source-path-publication-budget-probe.log`

This is outside the fixed UI-model R004 budget and violates design 19.1's requirement that Global
candidate/evidence/aggregate plus sorting/projection remain inside an explicit deterministic work budget.

### Required action

Move path canonicalization/deduplication, displayed-path sorting, and open-target projection onto a
generation-aware bounded scheduler with abort/current checks. Add an actual source 10,000-path workload
that accounts all source-side candidate/sort/projection work and proves every adjacent yield interval stays
within the configured budget and stale work cannot publish.

## Validation

Frozen product HEAD `8bfd513f09f5b249ad8b047d878f48930157a50a`:

- `npm.cmd run test:t610`: 78/78 pass
- `npm.cmd run build`: pass
- `npm.cmd run lint`: pass
- `npm.cmd run typecheck:contracts`: pass
- `npm.cmd run validate:architecture`: pass
- `npm.cmd run validate:architecture:negative`: pass
- `git diff --check eb8dc52..8bfd513`: pass
- `npm.cmd run test:t607`: 86/89; exactly three failures

Base `eb8dc52f1c329a5768c263a8773289c9865f5dd4` was independently re-run:
- `npm.cmd run test:t607`: 83/86
- the same three named tests fail with the same defect classes
- therefore those three T607 failures are held as baseline and are not attributed to this PR

The R003 and R004 performance fixtures added by Issue #124 pass on the reviewed product HEAD.
They do not cover IFR-005's earlier source-side path materialization stage.

## CI evidence

Exact product review HEAD:
- run `35665059323` / CI #4632
- head SHA `8bfd513f09f5b249ad8b047d878f48930157a50a`
- conclusion: success
- artifact `review-range-user-validation-0.1.55-pre+8bfd513`
- artifact id `10669256004`

Exact current report-only HEAD after the concurrent review record:
- run `35669893514` / CI #4634
- head SHA `bdb51d41f1f142c55679e92a4fd1b25e241a1709`
- conclusion: success
- artifact `review-range-user-validation-0.1.55-pre+bdb51d4`
- artifact id `10670689043`

No workflow run from another SHA was substituted. The CI workflow already contains diagnostic output
preparation and failure-diagnostics artifact upload, so this review required no workflow modification.

## Held

The three local T607 failures reproduced identically on the PR base:
1. production VS Code Global runtime fences partial publication on invalidate/dispose
2. production Global runtime supersedes old/new refreshes and gives each feedback operation one terminal
3. IFR002 actual Global source / Review Contexts provider stale-publication test

These are pre-existing baseline failures and do not explain any finding above.

## Unexplored

An installed-VSIX manual visual smoke test was not performed.
This does not remove the reproduced findings because each functional defect is demonstrated through
the compiled production source/runtime composition and the performance defect through the production source.

## Concurrent review-record delta

During this review, another independent review record advanced the PR from `8bfd513...` to
`bdb51d4...`. GitHub compare shows exactly one added file:
`reports/issue-124-global-understanding-view-independent-final-review-20260922.md`.

No executable, test, design, workflow, configuration, handoff, or tracking file changed.
That report records IFR-001 and IFR-002. This review independently reconfirmed those two and adds
IFR-003 through IFR-005 based on separate reproductions. The current product fingerprint therefore
remains the originally frozen implementation content.

## Closure requirements

Do not repeat the exhaustive pass for this review. Return required findings to the normal
implementation/fix-verification route. After normal verification, closure for this review must check only
these finding classes plus the implementation/CI delta:

| Finding | Closure evidence required |
| --- | --- |
| I124-IFR-001 | two-sibling stop/refresh retains stopped-scope row and known file/open target without body read |
| I124-IFR-002 | task ledger and PR metadata match the actual reviewed/final HEAD and exact-head CI |
| I124-IFR-003 | completed sibling becomes active in published Tree while another sibling remains running |
| I124-IFR-004 | unchanged path-only PR row has a valid exact-HEAD open path or is explicitly non-openable |
| I124-IFR-005 | 10,000-path actual source workload keeps all candidate/sort/projection intervals inside budget |

The updated PR current HEAD must have its own matching pull-request CI run. A different-SHA run must not
be used as closure evidence. Merge remains the user's action.

## Report persistence boundary

This is a failing review record, not a passing report-attestation. It does not authorize merge.
Product implementation, tests, design, workflow, task tracking, and PR behavior were not modified by this review.
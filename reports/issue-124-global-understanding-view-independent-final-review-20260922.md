# Issue #124 / PR #125 Independent Final Review

## Metadata

- report type: independent final review report
- review mode: independent final review
- generated at: 2026-09-22T08:54:23+09:00
- repository: `ssaattww/RevMem`
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base: `main`
- base SHA: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- reviewed implementation HEAD: `8bfd513f09f5b249ad8b047d878f48930157a50a`
- reviewed range: `eb8dc52f1c329a5768c263a8773289c9865f5dd4..8bfd513f09f5b249ad8b047d878f48930157a50a`
- execution: FA780 / Windows / PowerShell / Remote Desktop Commander
- source state at freeze: clean detached worktree, remote branch HEAD matched reviewed HEAD
- verification capability: `local_execution_available`
- reserved report path: `reports/issue-124-global-understanding-view-independent-final-review-20260922.md`
- persistence mode: repository review record; **not** a passing report-attestation

## Reviewer independence

This chat did not implement Issue #124, implement its review fixes, or perform the normal review/fix-verification rounds.
The implementation HEAD was frozen before the independent exhaustive pass.
Previous normal-review reports/comments were consulted only after the independent source/design pass had already found the multi-scope lifecycle defect.

## Verdict

**fail**

Required findings remain. No merge is authorized or performed.

## Authoritative requirements reviewed

Issue #124 requires:
- a spinner for `running` folder scopes;
- action labels that describe the click result: `開始` / `停止` / `再開`;
- every direct file whose existence is known by repository path enumeration to remain in the file list even when content evidence is uncollected;
- uncollected file rows to avoid guessed percentages;
- no repository-wide file-body scan merely to populate the list;
- state/action presentation to follow current-generation transitions including `running -> stopped`.

Design 16.5 additionally states that a path-enumerated direct file in a started scope remains a file row even when content evidence is uncollected.

## Inspected scope

The complete PR diff contains 26 changed paths. The independent pass inspected:
- `src/composition/global-understanding/global-understanding-source.ts`
- `src/ui/global-understanding/global-understanding-ui-model.ts`
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`
- direct lifecycle dependency `src/application/global-understanding/folder-understanding-scope-controller.ts`
- `package.json`
- changed Global Understanding unit/performance/folder tests
- design 11.3 / 16.5 and the changed design text
- CI diagnostic-artifact workflow
- normal review/fix-verification records and current task tracking
- PR #125 current metadata and review comments

The review did not modify implementation, tests, design, workflow, configuration, or task tracking.

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_finding | I124-IFR-001 violates the path-enumerated file-retention requirement after a stopped-scope transition |
| correctness / edge cases | checked_finding | two active sibling scopes -> stop one -> refresh the other reproduces row loss |
| scope discipline / unrelated changes | checked_no_finding | executable changes stay in Global Understanding presentation/source/model plus relevant tests/config; review records are issue-specific |
| changed files / direct dependencies | checked_finding | source final projection and `FolderUnderstandingScopeController.activeFolders()` interact to drop stopped-scope rows |
| API / data / configuration / workflow / compatibility | checked_no_finding | `discoveredFilePaths` is optional for legacy snapshots; action contributions remain compatible; workflow unchanged |
| error handling / failure diagnostics | checked_no_finding | failed lifecycle publication and privacy-safe error boundary are covered; CI diagnostic-artifact workflow already exists |
| security / secret handling | checked_no_finding | no credential changes; no repository-wide body scan was introduced; root/revision retained-snapshot isolation is present |
| tests / validation adequacy | checked_finding | existing tests do not cover a previously successful multi-scope snapshot followed by stopping one scope while another remains active |
| current-HEAD CI evidence | checked_no_finding | exact reviewed HEAD run `35665059323` completed successfully; no different-SHA run was substituted |
| report / tracking / documentation accuracy | checked_finding | I124-IFR-002: task ledger still says R004 fix verification is pending after the R3 report records completion |
| regression / maintainability risk | checked_finding | retained owner snapshot is rebuilt only from currently active scopes, losing lifecycle-local path evidence for non-active scopes |

## Finding I124-IFR-001 / High

- origin: introduced_by_change / incomplete Issue #124 lifecycle handling
- location:
  - `src/composition/global-understanding/global-understanding-source.ts:135`
  - `src/composition/global-understanding/global-understanding-source.ts:267-269`
  - `src/composition/global-understanding/global-understanding-source.ts:299-309`
  - `src/application/global-understanding/folder-understanding-scope-controller.ts:215-218`
- requirement: Issue #124 requirement 3 / acceptance criteria and design 16.5

### Description

`recalculate()` seeds work only from `activeFolders()`, and that API deliberately excludes `stopped` scopes.
The final successful snapshot then rebuilds `discoveredFilePaths` only from the `availablePaths` of those active/running work items and stores that reduced snapshot as the new retained snapshot.

Therefore, after two scopes have both been successfully path-enumerated, stopping one scope while another remains active causes the stopped scope's previously known direct file rows to disappear when the sibling refresh completes.
The stopped folder row itself remains visible, so the Tree becomes internally inconsistent: the scope exists and is explicitly stopped, but its known file rows vanish.

### Reproduction evidence

Independent probe against compiled current HEAD:
- before stop:
  - `discoveredFilePaths = ["one/a.ts","two/b.ts"]`
  - states: `one=active`, `two=active`
- stop `one`, then recalculate while `two` remains active
- after refresh:
  - `discoveredFilePaths = ["two/b.ts"]`
  - states: `one=stopped`, `two=active`
- probe exit: `2`
- preserved logs:
  - `C:\Users\donabe\Project\RevMem-pr125-independent-evidence-20260922\multi-scope-stop-probe.stdout.log`
  - `C:\Users\donabe\Project\RevMem-pr125-independent-evidence-20260922\multi-scope-stop-probe.stderr.log`

### Impact

This directly violates Issue #124's requirement that a path-enumerated file remain in the Global Understanding file list independently of content collection state.
It also breaks the requested `running -> stopped` lifecycle behavior for the file-list portion of the same current-generation UI.

### Required action

Preserve same-owner/root/revision path-only rows for scopes whose known lifecycle state becomes `stopped` (and the same defect class for other retained non-active lifecycle rows where applicable) instead of rebuilding the final owner snapshot only from currently active scopes.

Add an actual-composition regression fixture that:
1. creates two active sibling scopes;
2. completes one successful enumeration containing a direct file in each scope;
3. stops only one scope;
4. lets the other scope complete a refresh;
5. verifies the stopped folder remains `stopped` **and** its previously discovered direct file row/open target remains present;
6. verifies no stopped-scope file body is read.

## Finding I124-IFR-002 / Low

- origin: workflow_record_inconsistency
- location:
  - `tasks/tasks-status.md:7`
  - `tasks/tasks-status.md:26-27`
  - PR #125 body metadata
  - contrast: `reports/issue-124-global-understanding-view-fix-verification-r3-20260922.md:151`

### Description and evidence

Current task tracking still states that R004 is implemented but `fix verification待ち`, and that `I124-FINAL` is waiting for normal fix verification.
The committed R3 fix-verification report states that normal review/fix verification is complete and records `pass_with_held`.
PR #125's body also still identifies the old implementation HEAD `4e6ddb4...`, 75/75 T610, and the old CI run, while the current reviewed HEAD is `8bfd513...` and the current focused suite is 78/78.

### Impact

The repository's authoritative work ledger and PR summary do not describe the actual review state.
A subsequent worker can repeat already-completed normal verification or use obsolete target/CI metadata.

### Required action

After I124-IFR-001 is fixed and normal fix verification is complete, synchronize `tasks/tasks-status.md` with the actual Issue #124 state and update the PR summary/current target metadata so it no longer advertises obsolete HEAD/test/CI data.
Closure evidence must compare the committed ledger and GitHub PR metadata to the new reviewed HEAD.

## Validation assessment

Local validation on reviewed HEAD `8bfd513f09f5b249ad8b047d878f48930157a50a`:
- `npm ci`: exit 0
- `npm run compile:test`: exit 0
- `npm run test:t610`: **78/78 pass**
- focused `t607-performance-incremental-ui.test.js`:
  - Issue #124 R003 path-only validation fixture: pass
  - Issue #124 R004 validation+projection budget fixture: pass
  - total: 19/22; the three failures are the same known T607 environment/baseline cases recorded by prior normal review
- `npm run build`: exit 0
- `npm run lint`: exit 0
- `npm run typecheck:contracts`: exit 0
- `npm run validate:architecture`: exit 0
- `npm run validate:architecture:negative`: exit 0
- `git diff --check base..reviewed-head`: exit 0

Independent negative probes:
- multi-scope stopped-file retention: **reproduced**, exit 2
- uncollected 0/0 summary probe: reproduced, but **not filed as an Issue #124 finding** because the existing T505 contract explicitly keeps unopened contents out of the line denominator and already expects `progress=1` for that condition.

All local stdout/stderr/probe evidence is stored outside the reviewed worktree under:
`C:\Users\donabe\Project\RevMem-pr125-independent-evidence-20260922`.

## CI evidence

At independent review time, the exact reviewed implementation HEAD has a matching successful pull-request CI run:
- workflow: `CI`
- run id: `35665059323`
- run number: `4632`
- head SHA: `8bfd513f09f5b249ad8b047d878f48930157a50a`
- conclusion: `success`
- user-validation artifact id: `10669256004`
- artifact: `review-range-user-validation-0.1.55-pre+8bfd513`
- artifact head SHA matches the reviewed implementation HEAD

The workflow already contains diagnostic-output preparation and failure-diagnostic artifact upload steps, so no workflow modification was required for this review.

## Held

- T607 local performance/incremental suite has three known failures:
  - production VS Code Global runtime fences partial publication on invalidate/dispose
  - production Global runtime supersedes old/new refreshes and gives each feedback operation one terminal
  - IFR002 actual Global source / Review Contexts provider stale-publication test
- The same three are documented by the prior normal review as reproducing on clean `origin/main`.
- They are held as repository-maintenance baseline failures and are not used to explain I124-IFR-001.

## Unexplored

- Manual visual smoke test of an installed VSIX was not performed.
- This does not remove the reproduced required finding because I124-IFR-001 is demonstrated through the actual compiled source/controller composition.

## Independent closure requirements

This exhaustive independent review must not be repeated in a new reviewer/chat.
After normal implementation and normal fix verification, the **same independent reviewer** may perform only finding/CI-delta-limited closure.

Required completeness matrix before closure:

| Finding | Required action | Production path | Actual fixture / state check | Focused evidence |
| --- | --- | --- | --- | --- |
| I124-IFR-001 / High | retain previously enumerated rows across stopped/non-active same-revision lifecycle without body scan | source/controller retained-snapshot projection | two-sibling actual source fixture: initial success -> stop one -> sibling refresh | stopped scope row plus its file/open-target retained; no stopped-scope body read |
| I124-IFR-002 / Low | synchronize ledger and PR current metadata | task tracking + PR metadata | committed tracking text and GitHub PR metadata comparison | no obsolete pending-review state or old final HEAD/CI summary |

Closure must also verify CI only against the updated PR current HEAD SHA. A workflow run from another SHA must not be substituted.

## Report persistence boundary

Because the verdict is `fail`, this report is a review record, not a passing report-attestation.
Its persistence does not transfer the technical verdict from reviewed implementation HEAD `8bfd513f09f5b249ad8b047d878f48930157a50a` to later implementation content.
The next product change must go through the normal implementation/fix-verification route before bounded independent closure.

## Next action

1. Return I124-IFR-001 and I124-IFR-002 to the normal implementation/fix-verification route.
2. Implement I124-IFR-001 with TDD and the multi-scope lifecycle regression above.
3. Synchronize task/PR records for I124-IFR-002.
4. Complete normal fix verification.
5. Return to this same independent reviewer for bounded finding/CI-delta closure.
6. Do not merge automatically.

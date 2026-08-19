# PR #68 fix verification report

## Metadata

- Repository: `ssaattww/RevMem`
- Issue: #66
- PR: #68 `Fix #66 Global and PR progress projections`
- Review mode: fix verification
- Base: `main`
- Base SHA: `7d4df08e6a55b40ecb1d0faf515005912274258d`
- Source reviewed implementation HEAD: `20b04efbdf3cc0dfb6a9a9f58e3cf979552cc592`
- Source review evidence HEAD: `5bc822a054a856f1709756034fb63d271101f30f`
- Fix-verification reviewed HEAD: `00e5b08854a4fb4ab51fc7839ee52594475d8876`
- Fix range inspected: `5bc822a054a856f1709756034fb63d271101f30f..00e5b08854a4fb4ab51fc7839ee52594475d8876`
- Reviewer: `ChatGPT normal reviewer / PR68 / 2026-08-19`
- Continuity: same normal-review chat and same reviewer identity as the initial review; this reviewer did not implement PR #68 or PR68-R001–R004 fixes.
- Verdict: **fail**
- Source findings: PR68-R001 High, PR68-R002 High, PR68-R003 High, PR68-R004 High
- Disposition: **R001 closed / R002 partial-open / R003 partial-open / R004 closed**
- Merge: not performed

The technical verdict in this report applies to `00e5b08854a4fb4ab51fc7839ee52594475d8876`. A later report/handoff persistence commit is review evidence only and does not close the remaining technical findings.

## Scope and review method

This is a `review-worker` fix-verification pass. It verifies every source finding by identity and severity, inspects the fix diff and direct dependencies, checks sibling cases in the same defect class, and inspects newly changed areas for additional regressions.

The fix diff contains 14 commits after the initial review-evidence HEAD and changes 11 files:

- `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`
- `src/t305-extension.ts`
- `src/t305-projection-refresh.ts`
- `src/t405-pull-request-review-runtime.ts`
- `src/t505-global-understanding-source.ts`
- `test/unit/core-contracts.test.ts`
- `test/unit/issue-66-global-pr-progress.test.ts`
- `test/unit/issue-66-pr68-review-findings.test.ts`
- `test/unit/t305-projection-refresh.test.ts`
- `reports/issue-66-pr68-review-followup-20260819.md`
- `handoffs/issue-66-pr68-review-followup-20260819.yaml`

Direct dependencies re-inspected for closure include:

- `src/application/editor-decoration/normal-editor-decoration-model.ts`
- `src/core/pr-progress/pr-diff-progress.ts`
- `src/core/review-state/review-state-service.ts`
- `src/core/global-understanding/global-understanding-progress.ts`
- `src/t405-review-contexts-runtime.ts`
- `src/ui/current-context/current-context-runtime-coordinator.ts`
- `src/ui/pr-progress/vscode-pull-request-progress-tree.ts`
- `.github/workflows/ci.yml` failure-diagnostic contract from the initial review (unchanged by the fix diff)
- `doc/design/vscode-review-range-tracker-design.md` rev5 requirements from the initial review

## Validation evidence

### Exact-head TDD evidence

The implementation worker's TDD chronology was independently checked at the workflow-run identity level:

- `aa385571313dff8bc9f8837a5038189ac3d23b47` → CI `32202287069` → **failure** (R001/R002/R003 behavior RED)
- `779c3d66cd6c6538979f35f468eb805b01424160` → CI `32202387065` → **failure** (R004/source-switch RED)
- `d6082974c322421384cf943bf913cd12ef36d20c` → CI `32203046332` → **success** (technical fix Green)
- current reviewed HEAD `00e5b08854a4fb4ab51fc7839ee52594475d8876` → CI `32203482217` → **success**

No workflow run from another SHA is used as the current-head validation result.

The existing CI workflow still preserves stdout, stderr, combined logs, result metadata, environment/git status, generated outputs, source, tests, tools and configuration on failure; the fix diff does not change the workflow.

## Finding verification

### PR68-R001 — High — **closed**

Source defect: a mixed-case Windows PR file reviewed from PR diff first could persist raw `fileId` plus lower-cased `currentPath`, then fail its own PR Progress validation.

Verification:

- `PullRequestReviewRuntime.openSession()` now uses the PR logical path when no persisted state exists instead of lower-casing only the target path.
- `projectContextFileIdentities()` no longer skips the calculation-only projection merely because the raw diff key already exists; canonical path matching can repair the calculation view consistently.
- `test/unit/issue-66-pr68-review-findings.test.ts` executes the actual diff command path from empty persisted state, marks the modified line reviewed, then verifies `getProgress()` returns `1/2` and `0.5`.
- Current exact-head CI passes that regression.

Disposition: `addressed` / closed. Severity history remains High; no reclassification.

### PR68-R002 — High — **partial / open**

Source defect: pre-PR68 Windows persisted state with raw Git path casing must remain usable after upgrade without Global `missing` or identity splitting.

The fix closes two important parts:

- `T505GlobalUnderstandingSource.projectGlobalStatePaths()` projects persisted Global `currentPath` through Windows case-insensitive canonical identity and rejects ambiguous duplicate IDs.
- `DocumentReviewStateSessionProvider.loadSelectedPullRequest()` now finds legacy Context/Global IDs using canonical Windows path comparison, so it no longer creates a second hashed ID for the same logical file.

However the selected normal-editor compatibility path is still internally inconsistent for **read-only decoration**:

1. A legacy persisted entry may contain `currentPath = "Src/Example.ts"`.
2. `loadSelectedPullRequest()` successfully finds that entry by canonical comparison, but returns the original `contextState` and `globalState` unchanged while returning `target.currentPath = "src/example.ts"`.
3. `createNormalEditorDecorationModel()` requires exact equality for both current Context and Global state: `file.currentPath === target.currentPath`.
4. Its PR-change evidence also requires exact `file.newPath === target.currentPath`.
5. Therefore an already-reviewed legacy mixed-case file is resolved to the correct ID but its persisted reviewed ranges are rejected by the decoration model until a later mutation rewrites the path representation.

Impact:

- After upgrading on Windows, an existing confirmed line can lose its reviewed background in the selected PR normal editor even though the persisted state is otherwise accepted as the same logical file.
- This is a persistence/upgrade compatibility regression in the same R002 defect class. It is conservative rather than unsafe, but it breaks durable reviewed-state continuity and the expected normal-editor presentation of known-valid persisted state.

Test gap:

- The new R002 unit test stops at `provider.open()` and asserts only legacy `fileId` reuse and the lower-cased target path.
- It does not call `loadForDecoration()` plus `createNormalEditorDecorationModel()` (or an Extension Host equivalent), so the exact-path rejection is not covered.
- The initial R002 required action also requested legacy PR Progress reflection and PR diff-open continuity; those executable legacy-state checks are still not present, although the reviewed implementation paths appear compatible by inspection.

Required action:

- Keep the target/state path representation consistent when reusing a legacy ID. A valid fix can preserve the persisted path for the read session, or project cloned Context/Global/diff evidence to the same canonical path before decoration; do not mutate persisted state merely to render it.
- Add a pre-fix mixed-case fixture that goes through `loadForDecoration()` and the real decoration model and proves the reviewed interval remains visible immediately after upgrade.
- Add the legacy-state PR Progress and PR diff-open regression cases required by the original finding so the full compatibility contract is executable.

Disposition: `partial`; PR68-R002 remains open at **High**.

### PR68-R003 — High — **partial / open**

Source defect: asynchronous PR Progress activation must not allow stale work to overwrite/clear the currently selected immutable PR snapshot.

The implemented generation guard correctly closes the explicitly tested A→B and PR-leave races:

- `activateProgress()` increments `progressGeneration`, clears the shared snapshot synchronously and checks `contextId + generation` after awaited line-reviewability work and in the error path.
- `clearProgress()` advances the generation.
- The source-switch helper starts activation before publishing the GitHub PR source, so the previous snapshot is synchronously cleared first.
- Deferred tests cover A success after B, A failure after B, and leaving PR while A is pending.

A same-defect-class stale path remains for **the same PR context when its immutable revision changes**:

1. `activateProgress(contextId)` captures a `PullRequestReviewRuntimeRegistration` containing one exact base/head snapshot.
2. `register()` can replace `registrations[contextId]` with a new base/head snapshot for the same PR context.
3. `register()` invalidates the full-text cache when revisions change, but it does **not** advance `progressGeneration`, clear active progress, or otherwise invalidate an already-running activation for that context.
4. `isCurrentProgressGeneration()` checks only `activeProgressContextId === contextId` and the numeric generation.
5. A pending activation started against the old registration can therefore finish after same-context re-registration and publish its old `calculated.registration.snapshot`, because both context ID and generation still match.

This is production-relevant: `T405ReviewContextsSource.load()` synchronizes persisted PR lifecycle metadata, and `progressFor()/acquire()` calls `registerPullRequestReviewDiff()` whenever a diff is acquired. That registration can update the same PR context's immutable snapshot independently of a dedicated PR Progress activation.

Impact:

- When a selected PR receives a new head/base revision, the runtime can know the new registration while the dedicated PR Progress tree later publishes an older immutable comparison from an in-flight activation.
- File counts/nodes can therefore belong to the previous PR revision even though the runtime registration has advanced, which is the same identity-confusion class as the original R003 race.

Test gap:

- Current R003 tests use different context IDs (`CONTEXT_A`, `CONTEXT_B`) or `clearProgress()`.
- There is no deferred test for `register(old context/revision) → activate pending → register(same context/new revision) → old activation completes`.

Required action:

- Bind publication to the exact registration identity, not only context ID. For example, advance/invalidate the progress generation when an active context is re-registered with a different base/head/originalDiffId, or capture and compare the current registered snapshot identity before every publish/error mutation.
- Clear/invalidate the old active tree when authoritative registration revision changes.
- Add deterministic same-context re-registration tests for stale success (and failure where applicable), then verify a new activation publishes only the new revision.

Disposition: `partial`; PR68-R003 remains open at **High**.

### PR68-R004 — High — **closed**

Source defect: PR Progress refresh failure must not abort adoption of the newly selected owner or convert an already-successful edit-state mutation into a mutation failure.

Verification:

- `refreshCurrentContextDependents()` settles PR Progress independently while continuing decorations, Global Understanding and Review Contexts refreshes.
- `refreshAfterDocumentEdit()` independently reports PR Progress failure after refreshing decorations and Global; the successful state mutation is not reclassified as failed.
- `src/t305-extension.ts` routes Current Context and live-edit continuations through those helpers.
- Unit tests inject a failing PR Progress refresh and verify the other owner projections execute and the progress error is reported separately.

Disposition: `addressed` / closed. Severity history remains High; no reclassification.

## Required coverage disposition

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirements / design conformance | `checked_finding` | R002 legacy reviewed decoration and R003 exact immutable-registration race remain. |
| Correctness / edge cases | `checked_finding` | Mixed-case upgrade read path and same-context revision replacement inspected. |
| Scope discipline | `checked_no_finding` | Fix changes are limited to the four findings, tests, report and handoff. |
| Changed files / direct dependencies | `checked_finding` | All 11 fix-range files inspected; decoration model and T405 registration lifecycle reveal remaining paths. |
| API / data / compatibility | `checked_finding` | R002 upgrade compatibility remains incomplete. No persistence schema change. |
| Configuration / workflow | `checked_no_finding` | No configuration/workflow changes; existing failure diagnostics remain sufficient. |
| Error handling / diagnostics | `checked_no_finding` | R004 isolation is correct; stale different-context errors are contained. |
| Security / secrets | `not_applicable` | No new credential or secret handling in this fix range. |
| Tests / validation adequacy | `checked_finding` | Exact-head CI succeeds, but missing R002 decoration/legacy integration and R003 same-context revision-race regressions leave required behavior uncovered. |
| Current-head CI | `checked_no_finding` | `00e5b088...` has exact matching successful run `32203482217`. |
| Reports / tracking / documentation | `checked_no_finding` | Follow-up report/handoff preserve source finding IDs/severity and explicitly state worker `addressed` claims are not reviewer verdicts; task-status remains correctly untouched. |
| Regression / maintainability risk | `checked_finding` | R002/R003 remaining cases can regress user-visible state/identity after upgrade or PR revision update. |

## Held / unexplored / unknown

- Held: none.
- Verdict-blocking unexplored areas: none; the remaining failures are established from executable path contracts and direct dependency inspection.
- Unknown: failure artifact contents were not re-downloaded during fix verification; their run/HEAD/conclusion identities and the unchanged diagnostic workflow contract were verified. This does not affect the two code-path findings above.

## Verdict and next action

**Verdict: fail.**

- PR68-R001 High: closed
- PR68-R002 High: partial/open
- PR68-R003 High: partial/open
- PR68-R004 High: closed

Return to the implementation worker for finding-limited fixes to R002 and R003. Preserve finding IDs and High severities. Add RED regressions for the exact remaining paths before implementation, validate the resulting implementation and final report/handoff HEADs using only matching workflow runs, then return to this same normal-review chat for another fix verification.

Do not merge PR #68.
# Issue #128 / PR #129 Independent Final Closure Review

## Metadata

- generated_at: 2026-09-24T11:13:22+09:00
- repository: ssaattww/RevMem
- review_mode: independent final closure
- reviewer_continuity: same independent reviewer chat
- initial_independent_reviewed_head: 8d09587e27396027ad808c312ab46e826ebddb19
- independent_report_head: 2f2c568a72a54cb9c62704b8c49a9703eb66a720
- closure_reviewed_head: 893ab7d94368ab0366d5afaf4898206c5cf28d27
- base_sha: df1501358be6ad0e6e03989ddc9e08f67a6e1996
- verdict: fail
- merge: not performed

## Scope

This is the bounded closure for I129-IFR-001 through I129-IFR-004 and exact-head CI delta only.
No second exhaustive independent review was performed.

## Source identity

- local/origin/GitHub PR HEAD all matched 893ab7d94368ab0366d5afaf4898206c5cf28d27
- tracked worktree: clean
- Red-only HEAD: 3b29d2b5d3d7261adfa0c42e2a2a6f8064e86c9d
- IFR-001 fix: 84592ff896f7ed6ca3c2234e2f1e9772acc74e9b
- IFR-002/003 fix: 3e4d9ad2a7f3ce5115adc25dd77ce856f5d7efb4
- tracking sync: 4387d09767d5874f3c25848f1f18e78012f0af20
## Validation

Exact closure HEAD local validation:
- build: pass
- typecheck:contracts: pass
- architecture positive/negative: pass
- lint: pass
- compile:test: pass
- finding-focused: 3/3 pass
- T504 related: 17/17 pass
- T610: 96/96 pass
- npm test: pass / exit 0
- VS Code Extension Host: success

Reviewer evidence directory:
C:\Users\donabe\Project\RevMem-pr129-independent-closure-20260924

The first local gate attempt used a nonexistent npm script test:t504 and stopped with exit 1.
This was reviewer command error, not a product failure. The CI-equivalent direct T504 command was then used and passed 17/17.

Exact-head CI:
- Red-only CI #4723 / run 35943690694: failure at T504 as expected
- failure artifact id 10785009533, head SHA matches Red-only HEAD
- closure CI #4735 / run 35944645058: success
- user-validation artifact id 10786506311
- artifact head SHA matches closure reviewed HEAD
## Closure dispositions

### I129-IFR-001 / High: not closed

The original line-evidence case is improved:
- root.txt known total 2 is retained
- repository shows partial (0/2)
- root file row shows 0% (0/2)
- child scope is failed

However sibling verification of the same failure-time partial-publication defect class still fails.

Opened-count sibling probe:
- root.txt is collected from open-document evidence
- root succeeds, then child fails with ENOENT
- repository total remains 2
- openedFileCount is 0, expected 1
- unopenedFileCount is 2, expected 1

Excluded-count sibling probe:
- root contains a 2-line text file plus a NUL binary file
- binary exclusion is confirmed in the successful root scope
- child then fails with ENOENT
- excludedFileCount is 0, expected 1

The fix passes current files into failure-time lifecycleSnapshot, but other accepted current-generation metadata still comes from the previous snapshot.
Therefore I129-IFR-001 remains open at its original High severity.

Required action:
retain accepted current-generation opened/unopened classification, excluded file count, pruned excluded directory count, and related successful-scope snapshot metadata in later failure-time partial publication.
Add opened-count and excluded-count regression fixtures.
### I129-IFR-002 / Medium: closed

NodeGlobalUnderstandingFileSource now fences cancellation before/after filesystem stages, at analysis start, each content chunk, after yield, and before successful completion.
First-yield cancellation returns AbortError with exactly one yield.
Focused tests, T504, local full gate, and exact-head CI pass.

### I129-IFR-003 / Medium: closed

Binary/invalid-encoding exclusion now performs file stability validation before the typed exclusion is accepted.
The invalid-to-valid race rejects as changed while reading or analyzing rather than returning stale invalid-encoding exclusion.
Focused tests, T504, local full gate, and exact-head CI pass.

### I129-IFR-004 / Low: closed

tasks/tasks-status.md now records:
- I128-NR-002 as normal review closed
- I128-FINAL as independent finding-limited closure wait
- the independent finding implementation states

The stale normal-review-wait wording is removed.

## Verdict

fail

- I129-IFR-001 / High: not closed
- I129-IFR-002 / Medium: closed
- I129-IFR-003 / Medium: closed
- I129-IFR-004 / Low: closed
- new finding IDs: none
- severity reclassification: none
- held: none
- unexplored blocking areas in bounded scope: none
- report_attestation_allowed: false

Next action: implementation fixes I129-IFR-001 only, then this same independent reviewer verifies I129-IFR-001 and CI delta only.

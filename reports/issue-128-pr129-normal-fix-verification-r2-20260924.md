# Issue #128 / PR #129 Normal Fix Verification R2

## Metadata

- generated_at: 2026-09-24T09:17:30+09:00
- repository: ssaattww/RevMem
- issue: #128
- pull_request: #129
- review_mode: fix verification
- reviewer_continuity: same normal reviewer as initial review and prior fix verification
- previous review record HEAD: dac3ede4528692fc70fc03216a4d4792fe7bd54a
- Red-only HEAD: 556d0a38b5f46018a052bbc102d9024a3e65eb7c
- source fix HEAD: f9e87e04f6a398aedb030d15aa078347a81d6c8c
- product/test candidate: 851a79f63c654b8c1c75b830a43a290e0ade2888
- reviewed implementation HEAD: c1074d8b0e18c30b6e10b09d48f1e23cb94806ca
- execution_environment: FA780 / Windows / PowerShell / Remote Desktop Commander
- verdict: pass
- merge: not performed

## Scope

前回fix verificationで唯一openのまま残った I128-NR-002 / High だけをfinding-limitedに再検証した。
新しいreview criteriaは追加していない。I128-NR-001 / I128-NR-003 はclosed済みで、この再レビューでは再開していない。

## Source identity

- review開始時のFA780 worktree: `fix/issue-128-global-understanding-folder-scan`
- HEAD: `c1074d8b0e18c30b6e10b09d48f1e23cb94806ca`
- GitHub PR #129 current HEAD: 同一
- tracked worktree: clean
- `851a79f..c1074d8` は report / handoff / task tracking のみで、product source/test差分なし

## I128-NR-002 closure matrix

| Required action | Production path | Actual composition fixture | Focused evidence | Disposition |
| --- | --- | --- | --- | --- |
| local-only working-tree open fileをPR line evidenceへ昇格しない | `createGlobalUnderstandingOpenDocumentReader` → `captureOpenedDocuments` のPR owner分岐 | immutable `changed.ts=1` + local-only open file `2` | Red `3 != 1` at `556d0a3`; current reviewer probe total 1 | closed |
| same-path working-tree open editでimmutable PR HEADを上書きしない | PR ownerでは`pullRequestEvidenceByOwner`だけを返す | immutable `changed.ts=1` + same-path open working-tree `2` | Red `2 != 1` at `556d0a3`; current reviewer probe total 1 | closed |
| branch/workspace ownerのopen-document挙動を維持 | PR ownerだけをearly returnで分岐 | existing suites / full local gate | product candidate full local gate pass | closed |
| mixed-case Windows regressionを維持 | PR68 fixtureへauthoritative immutable providerを追加 | `Src/Example.ts` → canonical `src/example.ts` | assertion unchanged; focused + full gate pass | closed |

## TDD verification

Red-only commit `556d0a38b5f46018a052bbc102d9024a3e65eb7c` は `test/unit/t610-folder-understanding.test.ts` だけを変更するtest-only commit。
そのHEADの exact-head CI #4707 / run `35933857093` は T610 stepでfailureし、failure diagnostics artifact `10781914311` が同じHEADに紐づく。

Red cases:
- local-only production open document: actual 3 / expected 1
- same-path production open document: actual 2 / expected 1

製品fix `f9e87e04f6a398aedb030d15aa078347a81d6c8c` は `captureOpenedDocuments` にPR owner境界を4行追加し、PR ownerでworking-tree readerを呼ばずimmutable PR evidence mapだけを返す。

## Reviewer current-source verification

current HEADをbuildし、前回reviewerが使ったproduction composition probeをそのまま再実行した。

Case A — local-only open document:
- input: immutable PR HEAD `changed.ts=1行` + local-only open working-tree `unchanged.ts=2行`
- previous actual: total 3
- current actual: total 1
- current progress files: `changed.ts` only
- `unchanged.ts` remains discovered/path-only

Case B — same-path working-tree edit:
- input: immutable PR HEAD `changed.ts=1行` + open working-tree `changed.ts=2行`
- previous actual: total 2
- current actual: total 1
- current progress: `changed.ts=1`

Reviewer local commands on current HEAD:
- `npm run build`: pass
- `npm run compile:test`: pass
- I128-NR-002 focused tests: 3/3 pass
- previous production probe A: pass
- previous production probe B: pass

Reviewer evidence directory:
`C:\Users\donabe\Project\RevMem-review-evidence\issue128-c1074d8`

## Validation / CI

Implementation local evidence on product/test candidate `851a79f63c654b8c1c75b830a43a290e0ade2888`:
- NR-002 + PR68 focused: 5/5
- T610: 96/96
- build / contracts / architecture positive+negative / lint / npm test: pass
- VS Code Extension Host: success

Exact current-head CI:
- HEAD: `c1074d8b0e18c30b6e10b09d48f1e23cb94806ca`
- CI #4715 / run `35934712641`: success
- all required jobs including T610 and VS Code Extension Host: success
- artifact: `review-range-user-validation-0.1.56-pre+c1074d8`
- artifact id: `10783070927`
- artifact workflow head SHA matches current HEAD

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_no_finding | PR Global uses immutable PR evidence only after owner-kind fence |
| correctness / edge cases | checked_no_finding | both previously failing actual production cases now pass |
| scope discipline | checked_no_finding | source fix limited to PR owner branch; later changes metadata/tracking only |
| changed files / direct dependencies | checked_no_finding | open-document reader path exercised through actual composition |
| API / data / compatibility | checked_no_finding | PR evidence provenance restored; PR68 path identity regression retained |
| error handling / diagnostics | not_applicable | NR-002 fix does not alter failure diagnostics |
| security / secret handling | checked_no_finding | mutable local content no longer affects PR immutable evidence |
| tests / validation adequacy | checked_no_finding | actual production reader regressions added Red-first |
| current-HEAD CI | checked_no_finding | exact c1074d8 run #4715 success and artifact matches |
| report / tracking accuracy | checked_no_finding | follow-up report/handoff identify Red/fix/candidate and validation correctly |
| regression / maintainability | checked_no_finding | explicit owner-kind authority rule is narrow and test-covered |
| workflow / failure artifact | checked_no_finding | Red failure artifact exists and matches Red-only HEAD |

## Finding status

- I128-NR-001 / High: closed (prior verification)
- I128-NR-002 / High: **closed in this verification**
- I128-NR-003 / Medium: closed (prior verification)
- new findings: none
- held: none
- unexplored blocking areas: none within finding-limited scope

## Verdict

**pass**

All normal-review findings are closed on reviewed implementation HEAD `c1074d8b0e18c30b6e10b09d48f1e23cb94806ca`.
次はfresh chatによるindependent final review。Mergeは行わない。
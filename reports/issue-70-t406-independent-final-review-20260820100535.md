# T406 / Issue #70 / PR #71 独立最終レビューレポート

## メタデータ

- report type: `independent_final_review_report`
- review mode: `independent_final_review`
- reviewer: Codex sub-agent `/root/t406_independent_review`
- reviewer independence: T406 の実装、通常review、R1/R2 follow-up、検証実行、normal finding closureに参加していないfresh reviewer。今回のrepository writeは予約済み本reportのplaceholder更新だけ
- repository: `ssaattww/RevMem`
- Issue / PR: `#70` / `#71`
- PR lifecycle at observation: `OPEN` / `DRAFT` / unmerged
- branch / base ref: `task/t406-github-pr-integration` / `main`
- reviewed implementation HEAD: `9344e7c636bc22bb446eb2475b6048c2744d8e64`
- base / merge-base: `bd64d0a884ffe469eb4a8292ce09f03a64825144`
- commit range: `bd64d0a884ffe469eb4a8292ce09f03a64825144..9344e7c636bc22bb446eb2475b6048c2744d8e64`
- changed files: `22`
- reserved report path: `reports/issue-70-t406-independent-final-review-20260820100535.md`
- persistence mode: `repository_file`（fail evidence。report-attestation commitではない）
- report attestation allowed: `false`
- verdict: `fail`

技術verdictは上記reviewed implementation HEADにだけ適用する。required findingがあるため、本reportをreviewed HEAD直後の行政的attestation commitとして扱うことはできない。

## 目的と範囲

Issue #70 / T406 / AC-11、設計rev5と`Design/BreakingChanges.md`、PR #71の22 changed files全件、T305 / T401〜T405の主要直接依存、mock GitHub、cache、PR diff acquisition、Current Context選択、workspace Memento、Operation Feedback、Context / Global state、JSONL history、restart、CI diagnostic wiringを一度の独立full-scope passで確認した。

対象scenarioは次のとおりである。

- unauthenticated public repository PR resolution
- GitHub 401 / 403 / 404 / 429とnetwork interruption
- patch missingからexact BASE / HEAD contentへのfallback
- multiple candidate明示選択、cancel、zero candidate
- saved closed / merged PR coexistence、persistence、editor layer既定OFF
- GitHub unavailable時のbranch fallback、通常editor mark / unmark、false reviewed-state isolation
- privacy-safe failure diagnostic
- live A / offline A / cache write failure / recovered live B
- PR #52 / #53の双方向Context・Global・history・restart isolation
- API、data、persistence、configuration、workflow、compatibility、error、security、privacy
- tests、CI wiring、README、tasks、phases、PR lifecycle
- normal finding `T406-R001`〜`T406-R005`のclosure continuity

## 対象外

- T604 storage locking、T605 remote / multi-root、T608 final product acceptance。
- live GitHub credentialを使う非決定的試験とGitHub実serviceへの書込み。
- test / build / lint / architecture / CIの起動、再実行、待機。
- 実装、tracking、Design、BreakingChanges、Skill、handoff、既存reportの修正。
- commit、push、PR body / comment / review、draft state、Issue、merge、branch cleanupの操作。
- 今回確定findingより後の新観点追加。後続は同じindependent reviewerによる今回finding限定closureだけとする。

## 権威ある要件

- GitHub Issue #70のScope、Acceptance criteria、Non-goals。
- `tasks/tasks-status.md`のT401〜T406、AC-11 traceability、次工程。
- `tasks/phases-status.md`のP4目的、進捗、終了checkpoint。
- `doc/design/vscode-review-range-tracker-design.md` rev5 §14、§15、§16.2、§16.4、§16.10、§17、§18、§20.4、§21。
- root `AGENTS.md`のSkill-first ruleと、破壊的変更を`Design/BreakingChanges.md`へ記録するrule。
- implementation / normal review / follow-up / closure reportとnormal handoff。
- PR #71 metadataとreviewed HEADに一致するGitHub Actions観測。

## Work context

```yaml
repository: ssaattww/RevMem
issue_or_pr: Issue #70 / PR #71
task_id: T406
mode: independent final review
branch: task/t406-github-pr-integration
base_ref: main
current_head: 9344e7c636bc22bb446eb2475b6048c2744d8e64
reviewed_head: 9344e7c636bc22bb446eb2475b6048c2744d8e64
write_boundary:
  allowed:
    - reports/issue-70-t406-independent-final-review-20260820100535.md placeholder body
  forbidden:
    - implementation, design, workflow, configuration, tracking, Skill, handoff, other reports
    - test or CI execution/re-execution/waiting
    - commit, push, PR/Issue mutation, merge
development_policy:
  method: repository-defined test-first for behavior changes
  testing_order: supplied Red/Green evidence only; reviewer rerun prohibited
ci:
  matching_runs:
    - 32319755315 pull_request in_progress
    - 32319751335 push in_progress
  conclusion: held
unknown: []
blocked: []
```

## Inspected files

### Changed files 22 / 22

- `.github/workflows/ci.yml`
- `README.md`
- `doc/design/vscode-review-range-tracker-design.md`
- `handoffs/issue-70-t406-review-followup-20260820092341.yaml`
- `package.json`
- `reports/issue-70-t406-finding-closure-20260820094155.md`
- `reports/issue-70-t406-finding-closure-r2-20260820100012.md`
- `reports/issue-70-t406-implementation-20260820090333.md`
- `reports/issue-70-t406-normal-review-20260820091339.md`
- `reports/issue-70-t406-review-followup-20260820092341.md`
- `reports/issue-70-t406-review-followup-r2-20260820094751.md`
- `src/application/operation-feedback/operation-feedback.ts`
- `src/application/review-contexts/current-pull-request-context.ts`
- `src/t405-review-contexts-runtime.ts`
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
- `tasks/phases-status.md`
- `tasks/tasks-status.md`
- `test/integration/mock-github.test.ts`
- `test/integration/t402-pr-diff-acquisition.test.ts`
- `test/unit/ci-workflow-contract.test.ts`
- `test/unit/t405-composition-regression.test.ts`
- `test/unit/t405-review-followup.test.ts`

### 主要直接依存

- T305 Current Context candidate selection、composition、coordinator、`SelectedReviewContext`から通常editor session / decoration / document-edit ownerへのproduction配線。
- T401 GitHub remote identity、VS Code authentication、public unauthenticated fetch、PR search adapter、0 / 1 / multiple resolver。
- T402 local Git / GitHub patch / exact content acquisition、identity matching、missing patch fallback。
- T403 exact request cache、offline eligibility、fresh / stale / not-cached、source-redacted entry、generation pointer。
- T404 PR context ID、immutable revision mapper、Context / owner-wide Global CAS、open / closed / merged lifecycle、layer既定値。
- T405 Review Contexts source / controller / UI、lifecycle synchronization、cache refresh、canonical PR diff、current PR inference、Memento selection store。
- `OperationFeedback` / VS Code Output host、`NormalEditorReviewCommandService`、`PullRequestReviewRuntime`、`FileSystemReviewStateRepository`、`ReviewHistoryRecorder`、`JsonlReviewHistoryStore`。
- mock GitHub server、CI command runner、failure-context collection / artifact upload、package scripts、CI contract test。

## 実行・観測

reviewerはtest、build、lint、architecture、CIを起動・再実行・待機していない。使用したのはread-onlyの`git status / rev-parse / merge-base / diff / show / log`、`rg`、`Get-Content`、`git diff --check`と、Issue / PR / exact-head CIを一度だけ読む`gh issue view / gh pr view / gh run list`である。

- frozen identity: local HEAD、origin branch HEAD、PR head OIDはいずれも`9344e7c636bc22bb446eb2475b6048c2744d8e64`。
- merge-base: 指定値`bd64d0a884ffe469eb4a8292ce09f03a64825144`と一致。
- changed files: local diffとPR metadataはいずれも22件。
- `git diff --check bd64d0a..9344e7c`: 出力なし。
- worktree: task branchはoriginと一致し、予約済み本reportだけがuntracked。
- PR #71: `OPEN`、`DRAFT`、`MERGEABLE`、base `main`、Issue #70をclose対象として参照、unmerged。

supplied local evidenceはimplementation / follow-up reportから次のとおり確認した。reviewerは再実行していない。

- initial / follow-up / R2の`npm run test:t406`: 28 pass / 0 fail。
- build、contract typecheck、lint、architecture positive / expected-negative: pass。
- CI workflow contract: 10 pass / 0 fail。
- focused T405 composition: 2 pass / 0 fail。
- Red evidence: initial network fallback failure、R1 API追加前compile failure、R2 cross-key sentinel loss `false !== true`。
- final non-report implementation HEAD `b7e90a1968417a3b943f8cec4749e4d520260194`後、`9344e7c...`はnormal closure report、README、tracking、handoffだけを変更している。

exact-head CIはレビュー開始時に一度だけ観測した。いずれも`headSha=9344e7c636bc22bb446eb2475b6048c2744d8e64`だが完了していないため成功扱いしない。

- pull_request run `32319755315`: `in_progress`
- push run `32319751335`: `in_progress`

## Findings

### T406-IFR001 — Medium — 公開Review Contexts APIの`clear()`削除が互換性契約とBreaking Changesへ反映されていない

- origin: `introduced_by_change`
- location: `src/ui/review-contexts/vscode-review-contexts-runtime.ts:49-98`、`src/ui/review-contexts/index.ts:1-9`、`Design/BreakingChanges.md:1`、`reports/issue-70-t406-review-followup-20260820092341.md:25`、`reports/issue-70-t406-review-followup-r2-20260820094751.md:19`、`reports/issue-70-t406-finding-closure-r2-20260820100012.md:75`
- description: base HEADの`VscodeCurrentPullRequestSelectionStore`はpublic method `clear(repositoryId, headRevision)`を持ち、`src/ui/review-contexts/index.ts`は同classを明示的に`Public UI API`としてexportする。reviewed HEADは`clear()`を削除して`selectBranch()` / `prefersBranch()`へ置換したため、既存consumerはcompile-timeで破壊される。またworkspace Memento valueは従来のnon-empty `string`から`string | false`へ拡張された。しかしfollow-up / closure reportは「公開API、schema、format変更なし」「既存`string | false` contract」と記録し、`Design/BreakingChanges.md`にもmigration / compatibility記録がない。
- impact: Review Contexts public moduleを直接利用するhost / test / downstream compositionは`clear()`呼出しでcompileできず、保存値をexhaustiveに扱うconsumerは新しい`false` sentinelを認識できない。AGENTS.mdが要求するbreaking-change台帳と実態が不一致になり、後続のcontract fixture / migration判断が誤る。
- evidence: `git show bd64d0a...:src/ui/review-contexts/vscode-review-contexts-runtime.ts`にはpublic `clear()`が存在し、reviewed fileには存在しない。HEADのindexはclassを`Public UI API`としてexportし続ける。changed diffに`Design/BreakingChanges.md`は含まれず、type fixtureにもselection-store surfaceの互換性証拠がない。historical reportsの上記記述はbase / HEAD差分と矛盾する。
- required action: 互換性を維持するなら`clear()`をdeprecated compatibility methodとして残し、実際にbranchへ戻す契約に合わせて`selectBranch()`へdelegateし、public contract fixtureを追加する。破壊を選ぶなら`Design/BreakingChanges.md`へsource / persisted-value compatibility、consumer migration、downgrade behaviorを記録し、公開type fixtureを更新する。historical reportは書き換えず、follow-up evidenceで「public API / persisted representation変更なし」という過去claimのcorrectionを記録する。

### T406-IFR002 — Medium — 新しいGitHub検出diagnosticはruntime allowlistを通らずprivacy境界を迂回できる

- origin: `introduced_by_change`
- location: `src/application/operation-feedback/operation-feedback.ts:130-167,195-201,304-315`、`test/unit/t405-composition-regression.test.ts:1015-1031`
- description: `OperationDiagnosticError`は「constructor validationでpath / title / source dataのsmugglingを防ぐ」境界であり、既存`PR_PROGRESS_UNAVAILABLE`はsource / reasonをruntime allowlistで検証する。一方、新しい`GITHUB_PR_DETECTION_UNAVAILABLE` branchは`diagnostic.reason`を検証せずfreezeし、formatterがその値をそのままOutput messageへ挿入する。TypeScriptの`"rate-limit" | "network" | "api"`はruntime guardではない。最終`singleLine()`は改行を潰すだけで任意path / title / source文字列をredactしない。
- impact: JavaScript consumer、型境界を越えた値、将来のunsafe cast / adapter変更が任意reasonを渡すと、repository path、PR title、source fragment等を`Output > Review Range`へ出せる。現在のproduction callerは固定3値を渡すため直ちに発火していないが、privacy-safe diagnostic boundary自身が設計§16.10 / §18の保証を強制しなくなっている。
- evidence: constructor line 145-147はPR progressだけ`validatePrProgressAttempts()`を呼び、新branchは`Object.freeze({ code, reason: diagnostic.reason })`のみ。formatter line 160-163はreasonを直接interpolateする。追加testは正規`network`が一度出ることと特定fixture文字列の非出力だけを確認し、invalid runtime reasonのreject / redactionを確認しない。
- required action: GitHub検出reasonにもruntime allowlist guardを追加し、未知code / reasonを`TypeError`でrejectしてdetached immutable copyだけを保持する。型を意図的に越えたinvalid reason（path、title、改行、source片）をconstructorへ渡すnegative testと、Outputへ到達しないことを固定する。既存`network | api | rate-limit`のexact message / exactly-once behaviorは維持する。

severity reclassificationはない。上記2件はいずれも今回のfresh independent full-scope passで初めて確定したfindingであり、normal finding IDを再利用しない。

## Normal finding closure continuity

| Finding | Source severity | Disposition | Independent evidence |
| --- | --- | --- | --- |
| `T406-R001` | High | `closed` | repository / immutable HEAD別`false` sentinel保持、別key PR選択、single saved PRでmultiple-cancel / zero / network、branch mark / unmarkとPR #52不変を確認 |
| `T406-R002` | Medium | `closed` | branch fallbackを成功させつつfixed code / reasonをexactly once記録するsource required actionは確認。`T406-IFR002`は別のruntime validation defectであり、R002のidentityを再openしない |
| `T406-R003` | Medium | `closed` | live A、stale offline A、cache write failure、live B後のContext / Global / file revision / canonical URI / fresh cache exact B identityを確認 |
| `T406-R004` | Medium | `closed` | PR #52 / #53のoriginal / modified 8 transaction、直後のsibling state不変、exact history owner / file / revision / action、owner-wide Global、restart / JSONL分離を確認 |
| `T406-R005` | Low | `closed` | README、tasks、phases、handoff、PR #71 draft/open、normal closure、main未統合、次工程が一致 |

normal findingのseverityはすべてsource severityを保持する。reclassification / erratumはない。

## Scenario dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| unauthenticated public PR | `checked_no_finding` | auth sessionなしでproduction adapterがpublic APIを呼び、single PR #70を解決 |
| 401 / 403 / 404 / 429 | `checked_no_finding` | mock HTTP classification、429 rate-limit、他API unavailable、resolver branch fallback |
| network interruption | `checked_no_finding` | adapter network classificationとproduction redetect branch selection |
| patch missing fallback | `checked_no_finding` | local unavailable → missing patch → exact BASE / HEAD content acquisition |
| multiple explicit selection | `checked_no_finding` | production quick-pickで#53を選びCurrent Context / normal-editor ownerへ公開 |
| multiple cancel | `checked_no_finding` | saved open PR #52が1件でも明示branch sentinelがauto-inferenceを抑止 |
| zero candidate | `checked_no_finding` | production zero search後もbranch selection |
| branch mark / unmark while unavailable | `checked_no_finding` | T305 selected owner配線、production normal-editor service、branch ranges変更 / 復元、PR #52不変 |
| unavailable diagnostic | `checked_finding` | valid exactly-once behaviorは成立するがruntime privacy allowlist欠落（T406-IFR002） |
| saved closed / merged persistence | `checked_no_finding` | lifecycle refresh、group、durable state、restart |
| closed / merged layer default OFF | `checked_no_finding` | persisted lifecycle stateとlayer default、restart |
| live / offline / live B recovery | `checked_no_finding` | exact B Context / Global / URI / cache identity、A-as-B reuseなし |
| AC-11 PR #52 / #53 isolation | `checked_no_finding` | bilateral state / Global / history / restart proof |
| API / persisted representation compatibility | `checked_finding` | public `clear()` removalとnew `false` representationが未記録（T406-IFR001） |
| CI diagnostic wiring | `checked_no_finding` | package command、workflow step、runner、failure-context artifact、CI contract |
| PR lifecycle / tracking | `checked_no_finding` | PR #71 OPEN/DRAFT/unmerged、README/tasks/phases/handoff整合 |

## Required coverage dispositions

| Required coverage | Disposition | Evidence |
| --- | --- | --- |
| requirement and design conformance | `checked_finding` | functional ACは充足、compatibility / privacy contractにIFR001 / IFR002 |
| correctness and edge cases | `checked_finding` | scenario matrixは充足、invalid diagnostic runtime inputが未防御 |
| scope discipline and unrelated changes | `checked_no_finding` | 6 commits / 22 filesはT406 implementation、review closure、trackingに限定 |
| changed files and direct dependencies | `checked_finding` | 22 / 22とT305 / T401〜T405全指定依存を確認、IFR001 / IFR002 |
| API effects | `checked_finding` | T406-IFR001 |
| data / persistence effects | `checked_finding` | Memento valueの`string`→`string-or-false`をreports / compatibility台帳が未反映（IFR001） |
| configuration effects | `checked_no_finding` | package configuration key / default変更なし |
| workflow effects | `checked_no_finding` | `test:t406`とCI diagnostic runner接続は整合 |
| compatibility | `checked_finding` | T406-IFR001 |
| error handling and failure diagnostics | `checked_finding` | fallback behaviorは成立、diagnostic runtime validation欠落（IFR002） |
| security, secret handling, privacy | `checked_finding` | token / source persistence追加なし、Output boundaryにIFR002 |
| tests and validation adequacy | `checked_finding` | supplied functional evidenceは十分だがpublic API contract / invalid diagnostic negative test欠落 |
| current-HEAD CI evidence | `held` | exact-head push / pull_request runは一度の観測でin_progress |
| report, tracking, documentation accuracy | `checked_finding` | lifecycle trackingは正しいがpublic API / format no-change claimとBreakingChanges欠落（IFR001） |
| regression and maintainability risks | `checked_finding` | public consumer breakとdiagnostic boundaryのfuture unsafe input |

## Validation assessment

- reviewer test / build / lint / architecture / CI rerun: `not_performed`（明示禁止）。
- supplied Red / Green / local validation: test body、reports、commit rangeを突合済み。
- focused T406 suite: supplied 28 pass / 0 fail。functional scenario coverageは`checked_no_finding`。
- exact-head CI: `held`。matching runはあるがcompletion / success evidenceはない。
- CI wiring: `checked_no_finding`。workflowは`tools/run-ci-command.mjs`経由で`npm run test:t406`を呼び、failure時のlogs / environment / source / generated artifactをuploadする。
- Markdown wording lint: repositoryに`tools/lint/`、focused wiring、`lint:md`がなく`unsupported`。実行していない。
- `git diff --check`: reviewerのstatic checkはpass。

## Held items

1. `H406-IFR001` — exact-head CI run `32319755315`（pull_request）と`32319751335`（push）は一度の観測で`in_progress`。ownerはparent / merge gate。本reportは成功を主張しない。
2. `H406-IFR002` — Markdown wording lintはrepository-local wiring不在で`unsupported`。ownerはrepository tooling policy。
3. `H406-IFR003` — implementation reportの`npm ci`が既存dependencyにhigh severity 4件を報告。`package-lock.json`はT406 rangeで不変のため既存security backlog / release gateに保持する。

## Unexplored / unknown / not applicable

- unexplored: なし。依頼された全scenario、22 changed files、直接依存、normal closure、横断criterionにdispositionを付けた。
- unknown: なし。repository、Issue / PR、branch、base、merge-base、reviewed HEAD、origin HEAD、changed files、CI run identityは解決済み。
- not applicable: T604、T605、T608、live GitHub credential test、実service write、merge、report attestation（verdict failのため）。

## Intentionally untouched

- implementation、tests、README、Design、BreakingChanges、tasks、phases、handoff、historical reports。
- GitHub Issue / PR / review / comment / draft state。
- test / CIの起動・再実行・待機。
- commit、push、merge、branch cleanup。

## Verdict

`fail`

functional acceptance scenarioとnormal finding `T406-R001`〜`T406-R005`のclosureは確認できた。しかしrequired findingはMedium 2件ある。`T406-IFR001`はPublic UI APIのsource breakとMemento representation変更が互換性台帳 / reportへ反映されておらず、`T406-IFR002`はprivacy-safe diagnostic boundaryが新reasonをruntime allowlistで強制しない。したがって`pass`または`pass_with_held`にはできない。

## Remaining risks

- `clear()` compatibility方針を決めずにconsumer migrationだけ進めると、public contractと設計 / BreakingChangesが再度乖離する。
- diagnostic guardは正規3値のexactly-once Output behaviorを保ちながらnegative runtime inputだけをrejectする必要がある。
- exact-head CIは未完了であり、finding follow-up後は新しいfrozen HEADに一致するCI evidenceを改めて観測する必要がある。
- historical implementation / closure reportは書き換えず、correctionをfollow-up reportへ残す必要がある。

## Report attestation

```yaml
reviewed_implementation_head: 9344e7c636bc22bb446eb2475b6048c2744d8e64
report_attestation_head: null
reserved_report_paths:
  - reports/issue-70-t406-independent-final-review-20260820100535.md
report_attestation_allowed: false
reason: required findings T406-IFR001 and T406-IFR002
```

verdictがfailのため、reviewed HEAD直後のreport-only 1 commitであってもadministrative attestationとして受理してはならない。本reportはnormal follow-up lifecycleへ戻すreview evidenceとして扱う。

## Next action

`T406-IFR001` Mediumと`T406-IFR002` Mediumを同一follow-up batchで修正し、identity / severityを保持する。design / BreakingChanges判断、public contract fixture、diagnostic negative test、reports / tracking correction、local validation、normal review / fix verification、commit / push、new exact-head CI evidenceを独立closure前に完了する。その後、今回と同じindependent reviewer `/root/t406_independent_review`がこの2 findingだけをclosure確認し、新規観点・新規findingを追加しない。

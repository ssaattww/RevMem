# T405 通常review finding fix verification

## Metadata / target identity

- report type: `verification_report`
- review mode: `fix_verification`
- repository: `ssaattww/RevMem`
- task: `T405`
- pull request: `#54 T405 Review Contexts ViewとPRコンテキスト操作を実装`
- branch: `feature/t405-review-contexts`
- base ref: `main`
- base SHA: `146aec15783294da1795f268315c85d1a0dffa56`
- source reviewed implementation HEAD: `b0ee79dc84e27363b805bd6ffa440bfb9b351f72`
- source normal-review completion HEAD: `6b065442d1ecd0195d05979e36db0ca1ce633154`
- implementation-side technical fix HEAD: `47d032b20fe5e0563254b960ad7bfd012e7f8863`
- fix-verification reviewed HEAD: `2597cae6fe1b30d2b9c0e26d84ece022b03b0f7c`
- implementation fix range: `6b065442d1ecd0195d05979e36db0ca1ce633154..47d032b20fe5e0563254b960ad7bfd012e7f8863`
- verification target range: `6b065442d1ecd0195d05979e36db0ca1ce633154..2597cae6fe1b30d2b9c0e26d84ece022b03b0f7c`
- source review report: `reports/2026-08-16-t405-review.md`
- implementation follow-up report: `reports/2026-08-16-t405-review-followup.md`
- reviewer identity: `ChatGPT normal reviewer / T405 review chat 2026-08-16`
- reviewer continuity: initial T405 normal reviewと同じchatでfix verificationを実施。実装・finding修正には関与していない。
- persistence mode: `repository_file`
- report path: `reports/2026-08-16-t405-fix-verification.md`
- merge boundary: mergeは実施しない。利用者がmergeする。

## Purpose / scope / non-goals

前回normal reviewのfinding `R405-1`〜`R405-9`をidentityとseverityを維持したまま個別にclosure確認する。fix diff、各findingの直接影響、affected contract、同じdefect classのsibling case、fixで新たに変更されたproduction composition/tests/workflow/docsを確認する。

Non-goals / held ownership:

- T406が担当するGitHub未認証public repository、401/403/404/429、network断、patch欠落、複数PR、closed PRの**統合試験matrix**。ただし、そのmatrixが検出するproduction不具合そのものはT405 codeに存在する場合findingとする。
- T506が担当する複数contextの変更追従・Global集計の統合/Extension Host試験。
- T604以降のcross-window lock、cleanup、総合error policy。
- task-status manager Skillが必要なtracking write。
- merge。

## Authoritative requirements / design

Authority order:

1. user instruction: T405を再レビューする。
2. repository/project instructions: uploaded worker Skills、GitHub connector、exact-head CI、RevMem TDD、reviewerはfixを実装しない。
3. `tasks/tasks-status.md`: T405 scope/終了条件、T406のintegration-test ownership、AC-21 traceability。
4. `doc/design/vscode-review-range-tracker-design.md` rev4: PR identity/revision continuity、canonical diff、Current Context、Review Contexts、progress、closed PR layer。
5. source normal-review report / handoff。
6. implementation follow-up report / handoff。

Key acceptance points:

- T405: current PR/branch/saved open・closed PRを並列表示し、履歴を消さず表示だけ削除できる。
- Design 6.1: PR base/headはidentityではなくcurrent revisionで、commit追加後も同一PR contextを継続する。
- Design 8: review diffはcanonical identity-bound virtual documentを使う。
- Design 16.2: PRをCurrent Contextとして扱う。
- Design 16.4: Review Contextsは各contextの**進捗表示**、diff、layer、cache、表示削除を扱う。
- T401/T405のPR解決経路では、同一HEADに複数candidateがある場合に利用者が選んだPRをcurrent review contextとして成立させる必要がある。T406はそのE2E integration test追加のownerである。

## Fix diff / files inspected

Source normal-review completion HEAD `6b065442...` からverification target `2597cae...` のchanged/new areasを確認した。implementation-side technical fix HEAD `47d032b...` から`2597cae...`まではfollow-up report/handoffのみで、product code差分はないことも確認した。

Changed / inspected:

- `.github/workflows/ci.yml`
- `README.md`
- `package.json`
- `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`
- `src/adapters/github/fetch-github-pull-request-lifecycle-adapter.ts`
- `src/adapters/github/index.ts`
- `src/application/review-context/selected-review-context.ts`
- `src/application/review-contexts/current-pull-request-context.ts`
- `src/application/review-contexts/index.ts`
- `src/application/review-contexts/pull-request-revision-evidence-loader.ts`
- `src/application/review-contexts/review-contexts-controller.ts`
- `src/extension.ts`
- `src/t305-extension.ts`
- `src/t405-pull-request-review-runtime.ts`
- `src/t405-review-contexts-runtime.ts`
- `src/t505-global-understanding-source.ts`
- `src/ui/current-context/current-context-ui-controller.ts`
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
- `test/unit/review-contexts-runtime-wiring.test.ts`
- `test/unit/review-contexts-storage.test.ts`
- `test/unit/review-contexts-ui.test.ts`
- `test/unit/t405-github-lifecycle.test.ts`
- `test/unit/t405-pull-request-review-runtime.test.ts`
- `test/unit/t405-review-followup.test.ts`
- `test/unit/t405-revision-evidence.test.ts`
- `test/unit/t405-selected-pr-session.test.ts`
- `reports/2026-08-16-t405-review-followup.md`
- `handoffs/issue-1-t405-review-followup-20260816191923.yaml`

Direct dependencies / contracts inspected as applicable:

- T401 PR search/resolver and multiple-candidate contract
- T302/T303 canonical `review-range-diff` runtime and review-command ownership
- T304 effective PR progress
- T305 Current Context candidate/selection composition
- T404 PR lifecycle state service / immutable revision mapper
- T502 normal-editor decoration boundary
- T505 Global owner compatibility
- filesystem Review State repository and persisted document session ownership
- design rev4, task/status definition, README, CI workflow

## Source finding closure matrix

Finding IDとseverityはsource reviewから変更していない。severity reclassificationは0件。

| Finding | Severity | Fix verification | Result |
| --- | --- | --- | --- |
| R405-1 | Medium | `partial` | production revision mapper/evidence pathは接続されたが、source findingで要求したB→C redetect→layer operation→restart continuityのruntime regression testがない。 |
| R405-2 | Medium | `partial` | lifecycle adapterとpersisted PR synchronizationは実装されたが、open→closed/merged→saved-closed/merged projection→default layerのruntime regression testがない。 |
| R405-3 | Medium | `partial` | custom schemeは廃止されcanonical runtimeへ統合されたが、Review Contexts起点でoriginal/modified両側のmark/unmarkが実際にpersistするruntime/Extension Host regression testがない。 |
| R405-4 | Medium | `addressed` | hidden identityをcurrent/saved双方へ適用し、current PR/branch/workspace hide回帰testも追加された。 |
| R405-5 | Medium | **`partial` / required finding remains** | progressは計算・projectionされるがVS Code Tree row/tooltipが`item.progress`を描画せず、利用者には進捗が表示されない。 |
| R405-6 | Low | `addressed` | dead `reviewRange.closedPullRequestLayerDefault` settingをmanifestから削除しwiring testも更新した。 |
| R405-7 | High | **`partial` / required finding remains** | single persisted PRのCurrent Context/normal-editor ownershipは接続されたが、同一HEADにopen PRが複数あるsibling caseで選択PRを保持できずCurrent Contextがbranchへ戻る。 |
| R405-8 | Medium | `addressed` |先行in-memory current PR publicationを廃止し、durable persisted state + exact local HEADからcurrentを導出する構造へ変更した。 |
| R405-9 | Low | `partial` | READMEの大半はT405後状態へ同期したが、R405-5未解消にもかかわらずReview Contextsで「進捗確認」可能と記載し、実装と不一致が残る。 |

## Required findings

### R405-1 — Medium — introduced_by_change — partial closure

- location: `src/t405-review-contexts-runtime.ts`, `src/application/review-contexts/pull-request-revision-evidence-loader.ts`, T404 state-service composition
- description: source defectのproduction pathは修正された。既存PRのbase/head変化時にも`contextStateService.update()`を通し、real immutable revision evidence loader/mapperをfactoryへ渡すようになっている。一方、source findingのrequired actionに含めたruntime continuity proofが未実装。
- impact: code inspection上の旧「SHA差分ならreturn / mapper常時throw」は解消しているが、実際のT405 compositionでB→C redetect後にlayer操作し、restart後もCを復元する一連のcontractが回帰suiteで固定されていない。将来のcomposition regressionをCIが検出できない。
- evidence: `t405-revision-evidence.test.ts`はevidence loader単体を検証するが、`registerT405ReviewContextsRuntime`からT404 update/layer/restartまでを通さない。`test:t405`にもそのruntime transition scenarioはない。
- required action: source findingどおり、同一PRのbase/head B→Cをproduction runtimeで再検出し、mapped durable state、layer operation成功、restart復元を一連で検証する回帰testを追加する。

### R405-2 — Medium — introduced_by_change — partial closure

- location: `src/adapters/github/fetch-github-pull-request-lifecycle-adapter.ts`, `src/t405-review-contexts-runtime.ts` synchronization
- description: stable PR numberからcurrent lifecycleを取得し、persisted PR stateをopen/closed/mergedへ更新するproduction codeは追加された。ただしsource findingのruntime transition validationが未実装。
- impact: adapter parsingだけでなく、Review Contexts load/redetectで実際にopen→closed/mergedを永続化し、saved-closed/merged groupとlayer defaultへ反映するcontractがCIに固定されていない。
- evidence: `t405-github-lifecycle.test.ts`はlifecycle adapterを検証する一方、`review-contexts-storage.test.ts`は依然として最初からclosedのfixtureを保存するtestで、production synchronization transitionを通さない。
- required action: persisted open PRをfixtureにし、GitHub lifecycleをclosed/mergedへ変化させ、T405 synchronization後のdurable state、View grouping、default layerを検証するruntime testを追加する。

### R405-3 — Medium — introduced_by_change — partial closure

- location: `src/t405-pull-request-review-runtime.ts`, `src/extension.ts`, `src/t405-review-contexts-runtime.ts`
- description: product codeはT302/T303 canonical `review-range-diff`へ統合され、custom `review-range-pr-context` schemeは撤去された。binary rejectionも既存contractへ寄せられた。しかしsource findingが要求した「Review Contextsから開いたdiffで両側review commandが実際に動く」回帰証拠がない。
- impact:今回の旧不具合はまさに「diffは開くがreview commandが失敗する」というruntime integration defectだったため、URI schemeだけのassertではclosure証拠として不足する。
- evidence: `t405-pull-request-review-runtime.test.ts`はcanonical URI open、progress、binary rejectを検証するが、`createCommandService()`を通したoriginal/modified mark/unmark persistence、またはT405-specific Extension Host scenarioを実行しない。通常のVS Code Extension Host suite成功は既存scenarioでありT405起点を証明しない。
- required action: Review Contexts起点でcanonical diffを開き、original/modified双方でmark/unmarkを実行し、PR context stateとprogressへ反映されるruntime/Extension Host regressionを追加する。

### R405-5 — Medium — introduced_by_change — remains open

- location: `src/application/review-contexts/review-contexts-controller.ts`, `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
- description: PR progressを`ReviewContextListItem.progress`まで計算・projectionするよう修正されたが、Tree adapterはその値をrow descriptionにもtooltipにも表示していない。
- impact: Design 16.4の「各contextの進捗表示」を利用者が確認できない。READMEの「進捗確認」も実態と不一致になる。
- evidence: `ReviewContextsTreeProvider.getTreeItem()`のdescriptionは`現在`、context description、`Layer: ON/OFF`のみ。`tooltip()`もlabel/description/base/head/layerのみで、`element.progress` / `item.progress`を参照しない。`t405-review-followup.test.ts`はprojection objectのprogressだけをassertし、VS Code Tree item表示を検証しない。
- required action: PR progressをTree rowまたはtooltip等の利用者可視UIへ表示し、0/partial/100%などの表示回帰testを追加する。Designで非PR contextにも進捗が必要なら同じprojection contractで定義・検証する。

### R405-7 — High — introduced_by_change — remains open for sibling case

- location: `src/application/review-contexts/current-pull-request-context.ts`, `src/t405-review-contexts-runtime.ts`, Current Context composition
- description: single open PRではpersisted PRをCurrent Context candidateへ接続できるようになった。しかし同一local HEADにopen PRが複数存在すると、`findCurrentPullRequestContext()`は意図的に`undefined`を返す。redetectでQuick Pickから1件を選んでも、その「選択したPR identity」を別途保持するauthoritative selectionがないため、直後のCurrent Context refreshで再び複数一致となりPR candidateが消える。
- impact: T401のmultiple-candidate選択を利用しても、その選択をCurrent Context/通常editor review ownershipへ昇格できない。Review Contextsでは両PRがsaved-openのままで「current PR」が成立せず、通常editor commandはbranchへfallbackする。これはT406のintegration test追加で検出すべきproduction defectであり、T406へ実装を先送りできない。
- evidence: `findCurrentPullRequestContext()`は`matches.length === 1 ? ... : undefined`。`augmentCurrentContextCandidates()`も同helperだけでPR candidateを作る。`redetectPullRequest()`はselected PRのstateをpersist後`refreshCurrentContext()`するが、選択identity自体を保存/伝搬しない。現在のT405 unit testsはsingle PRだけでこのsibling caseを持たない。
- required action: multiple same-HEAD PRでもresolverで利用者が選んだPR identityをCurrent Contextへ安定して保持できるauthoritative selectionを実装し、redetect→refresh→通常editor ownershipまで回帰testする。T406ではそのproduction contractのE2E matrixを追加する。

### R405-9 — Low — introduced_by_change — partial closure

- location: `README.md`
- description: READMEはT405接続後のCurrent Context/Review Contexts/canonical diffを説明するよう更新されたが、「Review Contextsで進捗確認できる」という記載はR405-5の現production UIと一致しない。
- impact: user-facing documentationが利用可能機能を過大に案内する。
- evidence: READMEはReview Contextsで進捗確認可能と記載する一方、`ReviewContextsTreeProvider`はprogressを描画しない。
- required action: R405-5を実装してREADME記載を真にする。仕様変更する場合はREADMEとdesign/taskの双方を整合させる。

## Addressed source findings

### R405-4 — Medium — addressed

- hidden presentation identityはcurrent/saved双方へ適用される。
- `review-contexts-ui.test.ts`でcurrent PRもhiddenになる回帰が追加された。
- Review State/history削除経路は追加されていない。

### R405-6 — Low — addressed

- dead `reviewRange.closedPullRequestLayerDefault` settingはmanifestから削除された。
- runtimeに効かないconfigurationを公開する問題は解消した。

### R405-8 — Medium — addressed

- `currentPullRequests`の先行in-memory publicationを廃止。
- current PRはpersisted authoritative stateとlocal exact HEADから導出される。
- redetectはupdate/createの後にCurrent Context refreshを行うため、旧phantom-current dataflowは消えている。

## Required coverage dispositions

| Required criterion | Disposition | Evidence / result |
| --- | --- | --- |
| requirement and design conformance | `checked_finding` | R405-5 progress UI、R405-7 multiple candidate Current Contextが未完了。R405-1/2/3 validation closureもpartial。 |
| correctness and edge cases | `checked_finding` | multiple same-HEAD PR sibling caseでR405-7が再現する。R405-5はuser-visible behavior欠落。revision/lifecycle/diff integrationの未固定scenarioも確認。 |
| scope discipline and unrelated changes | `checked_no_finding` | fix差分はT405 findingsとその直接compatibility（T305/T505等）、tests、CI、README、report/handoffに限定。unrelated cleanupなし。 |
| changed files and direct dependency impact | `checked_finding` | T302/T303/T304/T305/T404/T505/normal-editor persistenceを追跡。R405-3/5/7の残課題あり。 |
| API, data, configuration, workflow, compatibility effects | `checked_finding` | PR SelectedReviewContext追加とdiff runtime multiplexは整合。dead settingは解消。multiple PR selection identityは不足（R405-7）。 |
| error handling and failure diagnostics | `checked_no_finding` | R405-8 old phantom publicationは解消。CIはstdout/stderr/test-output/source等のfailure artifactを維持し、T405 logも追加。 |
| security and secret handling where applicable | `checked_no_finding` | lifecycle/diff adaptersはtokenをrequest headerにのみ使用し、persist/logする新経路なし。token/contentの新規漏洩を確認せず。 |
| tests and validation adequacy | `checked_finding` | exact-head CIはgreenだが、R405-1/2/3 required runtime regressions、R405-5 Tree render、R405-7 multiple-candidate regressionが不足。 |
| current-HEAD CI evidence | `checked_no_finding` | verification target `2597cae...`に完全一致するCI run `31941380967`のみをcurrent-head evidenceとして採用し、全step success。 |
| report, tracking, and documentation accuracy | `checked_finding` | implementation follow-up reportは9件全addressedとするが本verificationでは6件partial/open。README progress記載もR405-5と不一致。tracking writeはheld。 |
| regression and maintainability risks | `checked_finding` | canonical path reuseは改善したが、integration seamの未テストとmultiple-candidate selectionの状態identity不足が残る。 |

`unexplored`: 0件。

## TDD / validation assessment

### TDD Red evidence

fix implementationはtest-first commitをproduction fixより前に積んでいる。

- `20ce97a88aba1dedc4d34d9fee17c2c67c47bf6a` — `test: reproduce T405 review findings`
  - exact-head PR CI run `31933251564`: `failure`
  - Unit/compile:testが新T405 contract未実装で失敗（`progressByContextId`、`ReviewContextListItem.progress`、`pull-request` SelectedReviewContext等）。
  - diagnostic artifact `9259899523`、artifact `head_sha`も`20ce97a...`一致。
- `710e80946d28d6f59dddfce71e105b950d4546f2` — lifecycle/canonical diff test追加
  - exact-head PR CI run `31933283786`: `failure`

production contract実装commitはこれらRedの後に続いており、fix cycleのTDD順序は確認できる。

### Diagnostic artifact workflow

Current `.github/workflows/ci.yml` は各stepを`2>&1 | tee test-output/ci/*.log`で保存し、failure時にenvironment/git status/generated files、`test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、`tools/`、`type-fixtures/`、manifest/config/workflowをartifactへuploadする。T405専用stepも`test-output/ci/test-t405.log`を生成する。作業開始時の診断artifact要件は満たすためreviewer側変更なし。

### Exact-head CI

Fix-verification reviewed HEAD:

`2597cae6fe1b30d2b9c0e26d84ece022b03b0f7c`

Matching run only:

- workflow: `CI`
- run ID: `31941380967`
- job: `95150982179`
- conclusion: `success`
- Build / Contract typecheck / Architecture / Architecture negative / Lint / Unit / T602 / T403 / T404 / **T405 follow-up** / T304 / T502 / T503 / T504 / T505 / Temporary Git / Mock GitHub / VS Code Extension Host: all success

別SHAのrunはcurrent-head acceptanceへ代用していない。

## Held items

1. **T406 failure / multiple-candidate / closed-PR E2E matrix**
   - reason: task定義上T406がintegration test追加を担当。
   - owner: T406 lifecycle。
   - remaining risk: public unauth、HTTP failure、network、patch欠落等のE2E recoveryは未証明。
   - verdict impact: T406-owned matrix自体はnonblocking held。ただしR405-7のmultiple-candidate production defectはT405 findingとしてblocking。

2. **T506 multi-context / Global integration**
   - reason: task定義上T506 ownership。
   - owner: T506 lifecycle。
   - remaining risk:複数context変更追従・Global集計のExtension Host integrationは未証明。
   - verdict impact: nonblocking held。T405で今回変更したT505 PR-owner compatibilityに明確な新規defectは確認していない。

3. **task tracking write**
   - reason: `tasks/tasks-status.md` / `tasks/phases-status.md` は専用manager Skill ownershipで、uploaded worker setに該当manager Skillがない。
   - owner: task-status/phase-status manager lifecycle。
   - remaining risk: repository trackingはこのreviewerから更新されない。
   - verdict impact: nonblocking held。

## Unknown / unexplored / intentionally untouched

- unknown: なし。
- unexplored: なし。
- intentionally untouched: product code、tests、design、workflow、configuration、tracking。reviewerはfindingを実装しない。
- merge: intentionally untouched / user-owned。

## Severity continuity / discrepancies

- R405-1 Medium: preserved
- R405-2 Medium: preserved
- R405-3 Medium: preserved
- R405-4 Medium: preserved
- R405-5 Medium: preserved
- R405-6 Low: preserved
- R405-7 High: preserved
- R405-8 Medium: preserved
- R405-9 Low: preserved
- reclassification: なし

Implementation follow-up report `reports/2026-08-16-t405-review-followup.md` は全9件を`addressed`と記載するが、本fix verificationでは上記6件をpartial/openと判定した。historical reportは書き換えず、本reportをcurrent correction/verification evidenceとする。

## Verdict

`fail`

Required findings remaining:

- R405-1 Medium — product path fixed, required runtime continuity regression missing
- R405-2 Medium — product path fixed, required lifecycle transition runtime regression missing
- R405-3 Medium — canonical product path fixed, required both-side review command runtime/Extension Host regression missing
- R405-5 Medium — progress not rendered in Review Contexts UI
- R405-7 High — multiple same-HEAD PR selection cannot remain Current Context
- R405-9 Low — README progress claim remains inaccurate while R405-5 is open

Addressed:

- R405-4 Medium
- R405-6 Low
- R405-8 Medium

Blocking unexplored: なし。

## Remaining risks

- Green CI does not currently exercise the exact runtime paths that caused R405-1/2/3.
- Review Contexts displays no progress despite carrying a progress model.
- Multiple PR candidates sharing local HEAD cannot establish stable Current Context selection.
- README overstates progress availability.

## Next action

Implementation chatへ戻し、同じfinding IDs/severitiesのままR405-1/2/3/5/7/9を修正・回帰test追加する。その後、同じnormal-review chatで再度fix verificationする。

本reviewerはproduct fixを実装せず、mergeもしない。

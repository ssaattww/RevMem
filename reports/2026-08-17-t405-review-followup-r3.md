# T405 fix verification R2 指摘対応 R3

## Metadata

- repository: `ssaattww/RevMem`
- pull request: `#54`
- task: `T405`
- branch: `feature/t405-review-contexts`
- base: `main`
- source verification HEAD: `699656897f1bb403290ab5528908be85c1fc4370`
- technical implementation HEAD: `4f7071a0ae9b588b32ffe21fefae206d4d36a7e6`
- source verification report: `reports/2026-08-16-t405-fix-verification-r2.md`
- source verification handoff: `handoffs/issue-1-t405-fix-verification-r2-20260816224800.yaml`
- implementation mode: review follow-up
- merge: not performed

## 対象指摘

前回fix verificationでpartial/openとして残った次の4 findingを、IDとseverityを維持したまま対応した。

| Finding | Severity | 今回の対応 | 結果 |
| --- | --- | --- | --- |
| R405-1 | Medium | T405 production compositionでB→C redetect/synchronize、immutable revision mapping、durable state、layer操作、runtime再構築後の復元を一連で検証 | addressed |
| R405-2 | Medium | T405 `source.load()` / `synchronizeRepository()`を通してopen→closed/merged、durable state、saved-closed group、default layer OFF、restart復元を検証 | addressed |
| R405-3 | Medium | 実`reviewRange.openReviewContextDiff`からcanonical `review-range-diff`を開き、original/modified両側のmark/unmark、永続state、progress更新を検証 | addressed |
| R405-7 | High | 同一HEADのPR #52/#53をproduction resolverへ流し、Quick Pickで#53を選択後、workspaceState preference→Current Context coordinator→selected runtime ownershipまで検証 | addressed |

R405-4 / R405-5 / R405-6 / R405-8 / R405-9 は前回verificationでaddressed済みのため変更していない。

## 作業開始時の診断workflow確認

`.github/workflows/ci.yml`をcurrent source HEADで確認した。追加変更は不要だった。

- 各build/test commandは `2>&1 | tee test-output/ci/*.log` で標準出力・標準エラーを保存する。
- failure時はenvironment、Git status、generated file一覧を収集する。
- failure artifactには `test-output/`, `dist/`, `test-dist/`, `src/`, `test/`, `tools/`, `type-fixtures/` と主要config/workflowを含む。
- T405 focused suiteは `test-output/ci/test-t405.log` を保存する。

## TDD / composition regression

### 1. composition regression追加

新規 `test/unit/t405-composition-regression.test.ts` を追加し、`test/unit/t405-review-followup.test.ts` から読み込ませて既存 `npm run test:t405` / CIの `T405 Review Contexts follow-up tests` に接続した。

テストは下位serviceを直接呼ぶだけではなく、以下を1 fixtureで接続する。

- 実temporary Git repository
- 実`createNodeLocalGitAdapter()`
- 実`FileSystemReviewStateRepository`
- 実`registerT405ReviewContextsRuntime()`
- 実`PullRequestReviewRuntime`
- 実Current Context composition/controller/coordinator
- VS Code host surfaceのみfake（commands/tree/memento/Quick Pick/error UI）
- GitHub HTTP boundaryのみfixture response

### 2. fixture compile修正

- test wiring HEAD: `78b80d0f5ea138d2942529bfdda42ae3e1a0ccad`
- exact-head run: `31973790259`
- result: `failure`
- diagnostic artifact: `9270502488`
- cause: 新testの`SelectedReviewContext` narrowing記述ミスによる`compile:test` failure

これはproduct behaviorのRed証拠には使用していない。test側だけを `d69f9b9bdaacebdc4c00a6ad05417a88393f9a9b` で修正した。

### 3. 有効なRedでproduction defectを検出

- Red HEAD: `d69f9b9bdaacebdc4c00a6ad05417a88393f9a9b`
- exact-head run: `31973885788`
- result: `failure`
- failing step: `T405 Review Contexts follow-up tests`
- diagnostic artifact: `9270528839`
- failure: `Review Contexts操作に失敗しました: Git command cwd must identify a directory.`

composition regressionは実`reviewRange.redetectPullRequest`まで到達し、T405がactive editorの**file path**をそのまま`inspectRepository()`へ渡すproduction defectを検出した。Node Git executorは`cwd`にdirectoryを要求するため、実利用でもPR再検出がこの経路で失敗する。

### 4. production修正

`src/adapters/local-git/node-local-git-adapter.ts`を修正した。

- Node production Git adapterの`inspectRepository(startPath)`がdirectory入力なら従来どおりそのまま使用する。
- normal file入力なら既存`gitInspectionStartPath()`で親directoryへ正規化する。
- stat不能なpathは従来のerror contractを保つためそのまま下位境界へ渡す。

これによりT405だけでなく、Node production adapterの公開説明どおり「repository root以下のresource path」から安全にinspectionできる。

## Composition regressionで固定したflow

### R405-1

1. PR #52をbase=A / head=Bで実filesystem stateへ保存。
2. local Git HEADをCへ進める。
3. 実`reviewRange.redetectPullRequest`を実行。
4. T405 `synchronizeRepository()`→T404 state service→immutable mapperでB→Cへmapping。
5. Context/Global/file revisionがCへdurableに更新されたことを確認。
6. 実`toggleReviewContextLayer`を実行してlayer overrideを保存。
7. T405 runtimeを再構築し、Cとlayer overrideが復元されることを確認。

### R405-2

1. production T405 runtime上で保存済みPRをopenから開始。
2. GitHub lifecycle fixtureを#52=`closed`, #53=`merged`へ変更。
3. 実runtime `refresh()`→`source.load()`→`synchronizeRepository()`を実行。
4. durable lifecycle state、`saved-closed-pull-request` grouping、layer OFFを確認。
5. runtime再構築後も同じ状態を確認。

### R405-3

1. 実Review Contexts providerのPR rowを取得。
2. 実`reviewRange.openReviewContextDiff` commandを実行。
3. canonical `review-range-diff://document/v1/...` original/modified URIを確認。
4. 実PR review command serviceでoriginal/modified両側をmark。
5. progressが100%へ更新されることを確認。
6. 両側をunmarkし、progressとdurable Review Stateが戻ることを確認。

### R405-7

1. 同一local HEAD Cにopen PR #52/#53を返す。
2. 実redetect resolverのQuick Pickで#53を選択。
3. T405 selected PR preferenceをworkspaceStateへ保存。
4. `augmentCurrentContextCandidates()`を通す。
5. Current Context runtime composition/controller/coordinatorのrefreshを実行。
6. downstream `setSelectedContext`相当へPR #53のimmutable contextIdが渡ることを確認。

## Changed files

`699656897f1bb403290ab5528908be85c1fc4370..4f7071a0ae9b588b32ffe21fefae206d4d36a7e6`:

- `test/unit/t405-composition-regression.test.ts` — T405 production composition regression
- `test/unit/t405-review-followup.test.ts` — focused T405 suiteへのcomposition regression接続
- `src/adapters/local-git/node-local-git-adapter.ts` — active file pathからのNode Git repository inspection修正

比較結果: 4 commits / 3 files / baseからfast-forward可能。

## Validation

### Technical HEAD

- HEAD: `4f7071a0ae9b588b32ffe21fefae206d4d36a7e6`
- exact-head CI run: `31974161050`
- conclusion: `success`

成功step:

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T602 history rewrite recovery tests
- T403 GitHub cache tests
- T404 GitHub PR context layer tests
- T405 Review Contexts follow-up tests（新composition regression含む）
- T304 PR progress tree tests
- T502 Global mapping and display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- T505 Global understanding tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのworkflow runは代用していない。

## Scope / held

- T406のGitHub未認証・HTTP/network障害・patch欠落等を含むfull integration matrixは対象外。
- T506のmulti-context変更追従・Global integrationは対象外。
- `tasks/tasks-status.md` / `tasks/phases-status.md` は、今回利用可能なuploaded worker skill setに同ファイルのmanager writeを許可するskillがないため未更新。
- mergeは利用者所有のため実施していない。

## Outcome

前回fix verificationで残っていたR405-1 / R405-2 / R405-3 / R405-7の要求されたT405 composition seam regressionを追加し、実flowで検証した。その過程でPR再検出を阻害するactive-file Git cwd production defectをRedで検出・修正し、technical exact-head CI全step成功まで確認した。

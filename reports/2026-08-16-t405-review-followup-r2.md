# T405 通常レビュー指摘対応 R2 レポート

## Metadata

- report type: `review_followup`
- repository: `ssaattww/RevMem`
- task: `T405`
- pull request: `#54 T405 Review Contexts ViewとPRコンテキスト操作を実装`
- branch: `feature/t405-review-contexts`
- base ref: `main`
- base SHA: `146aec15783294da1795f268315c85d1a0dffa56`
- source verification report: `reports/2026-08-16-t405-fix-verification.md`
- source verification HEAD: `b0f3184a629945ed62d2a9d300f505b907e086f4`
- technical final HEAD: `fcdae7d5121dc74459a20c148bdf9da0bfb1d6e2`
- generated at: `2026-08-16T21:50:02+09:00`
- merge boundary: mergeは実施しない。利用者がmergeする。

## 対応対象

追加fix verificationで残存またはpartialとされた6件を対象とした。

- R405-1 Medium: base/head変更後のrevision mapping、layer操作、restartまでのdurable regression不足
- R405-2 Medium: open→closed/mergedの永続遷移、saved group、既定layer OFFのregression不足
- R405-3 Medium: Review Contexts起点canonical diffのoriginal/modified確認・解除永続化regression不足
- R405-5 Medium: Review ContextsでprogressがprojectionされるがTree row/tooltipへ表示されない
- R405-7 High: 同一HEADに複数open PRがある場合、再検出で選んだPRをCurrent Contextへ保持できない
- R405-9 Low: READMEの「進捗確認」記述がR405-5未実装時点では実態と不整合

T406のGitHub障害系・複数候補・closed PRの総合E2E、およびT506の複数context/Global統合は対象外とした。

## 作業開始時の診断workflow確認

`.github/workflows/ci.yml` をcurrent HEADで確認した。

- 各build/testコマンドは `2>&1 | tee test-output/ci/*.log` で標準出力・標準エラーを保存する。
- failure時にenvironment、git status、generated filesを収集する。
- `test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、主要configをdiagnostic artifactへ保存する。
- T405 focused suiteは `T405 Review Contexts follow-up tests` stepで `npm run test:t405` を実行する。

必要な診断artifact workflowは既に存在していたため、workflow追加は行っていない。

## TDD Red

R405-5とR405-7の残存production defectについて、先に失敗testを追加した。

- Red commit: `4fac6706d184e41865aade724d50c2fd3814f7ed`
- exact-head CI run: `31947458446`
- diagnostic artifact: `9263698972`
- result: `failure`
- intended failures:
  - R405-5: Review Contexts Treeがprojected progressを表示していない
  - R405-7: 同一HEAD複数PRでpreferred PR identityを保持できない

このRedではbuild/typecheck/architecture/lint/unit/T602/T403/T404まで成功し、`test:t405`で上記2件が失敗したため、回帰testが狙った欠陥を検出していることを確認した。

## 実装

### R405-5 — Review Contexts progressを利用者へ表示

変更:

- `src/application/review-contexts/review-contexts-controller.ts`
  - `formatReviewContextProgress()`を追加
  - `0% (0/4)`、部分進捗、`100%`を一貫したuser-visible形式で表現
- `src/application/review-contexts/index.ts`
  - formatterをpublic application APIへexport
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
  - Tree row descriptionへprogressを追加
  - tooltipへprogressを追加

主なcommit:

- `a1d05aaded4d23adb77abccc3986a37eef685d78` `feat: format Review Contexts PR progress`
- `74e7beffa1e9f85c22551ca4e19b10833980afec` `refactor: export Review Contexts progress formatter`
- `e77cb3e652884e015b460704a1172f64a11ee0c1` `feat: render PR progress and store explicit PR choice`

これによりREADMEの「Review Contextsで進捗確認」の記述とproduction UIが一致し、R405-9の不整合も解消した。

### R405-7 — 再検出で選んだPRをCurrent Contextへ保持

変更:

- `src/application/review-contexts/current-pull-request-context.ts`
  - `preferredContextId`を受け取れるようにした
  - repo/HEADに一致するopen PR群からpreferred contextを優先
  - preferenceがない複数候補は従来どおりfail-closedでundefined
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
  - `VscodeCurrentPullRequestSelectionStore`を追加
  - `workspaceState` key `reviewRange.currentPullRequestSelections.v1` に、repositoryId + immutable HEAD単位で選択PR contextIdを保存
- `src/ui/review-contexts/index.ts`
  - selection storeをexport
- `src/t405-review-contexts-runtime.ts`
  - Review Contexts projectionとCurrent Context候補生成の双方でpreferred PRをread
  - PR再検出でauthoritative stateのcreate/updateが成功した後にのみ選択identityをpersist
  - persistence前にcurrentをpublishしないR405-8のfail-closed方針を維持

主なcommit:

- `298437fc1aaf1e3ecbfec35662ad318c0777ba5d` `refactor: export explicit PR selection store`
- `03663a4b75341c60477878f60420465799a322dd` `fix: honor explicit PR choice for shared HEAD`
- `0b9232bf45fcc853fdafa4282883ff489935895d` `fix: retain redetected PR selection across refreshes`

### R405-1 — revision mapping durable regression

既存productionのT404 immutable mapper接続を、要求されていた一連の操作で検証するtestを追加した。

- B→C revision update
- immutable zero-context diff + old/new text evidenceを用いたmapping
- Context/Global/file revisionがCへ進むこと
- unchanged reviewed lineが保持されること
- revision update後のlayer操作が成功すること
- repositoryを共有したservice再生成（restart相当）後もCとlayer状態が復元されること

対象:

- `test/unit/t405-github-lifecycle.test.ts`

主なcommit:

- `bf2541a56eb77be82225cadfa56c94a5a5ac7ad4` `test: cover T405 revision and lifecycle durable transitions`
- `8b4ed2a6641485a7be0cda52016045bdaff92eb5` `test: assert persisted PR layer through public visibility contract`
- `028754fcd4a195e8623626f1061a518c1ea452a9` `test: fix immutable revision evidence fixture`

### R405-2 — closed/merged durable lifecycle regression

`GitHubPullRequestContextStateService`のmetadata-only lifecycle updateを実際に通し、closed/merged双方について次を確認した。

- lifecycle stateが永続化される
- service再生成後もstateが復元される
- `isPullRequestDecorationEnabled()` が既定OFFを返す
- `projectReviewContexts()` が `saved-closed-pull-request` groupへ分類する
- View projectionのlayerもOFFになる

対象:

- `test/unit/t405-github-lifecycle.test.ts`

### R405-3 — canonical diff original/modified永続化 regression

`PullRequestReviewRuntime`でReview Contextsと同じcanonical `review-range-diff` URIを開き、T303 command serviceを実際に通して検証した。

- original side mark → `originalReviewedByDiff[base..head]`へ永続化
- modified side mark → context `modifiedReviewed` と Global `reviewed`へ永続化
- original side unmark → canonical diff keyのrangeがemptyになる
- modified side unmark → context/Global rangeがemptyになる
- binary PR changeはtext line reviewとして開かない

対象:

- `test/unit/t405-pull-request-review-runtime.test.ts`

主なcommit:

- `25c5682d6f033049f4fbdc50117a1880bdadc727` `test: verify canonical PR diff review persistence`
- `fcdae7d5121dc74459a20c148bdf9da0bfb1d6e2` `test: align canonical unmark persistence expectation`

## 追加test coverage

`test/unit/t405-review-followup.test.ts`へ次を追加した。

- progress formatter: undefined / 0% / 75% / 100%
- Tree row/tooltipがformatterを使用すること
- 同一HEAD複数PRでpreferred contextが選択されること
- preferenceなしの複数候補はundefinedでfail-closedすること
- redetect後にselectionがpersistされ、current projection側でreadされるproduction wiring

commit:

- `5a89182d664372282900cefb57f8a01627e02a59` `test: cover visible progress and durable multi-PR selection`

## 中間CIと診断

### 1. test型契約ミス

- HEAD: `5a89182d664372282900cefb57f8a01627e02a59`
- exact-head run: `31947783365`
- diagnostic artifact: `9263785235`
- failure: `compile:test`
- 原因: testがbase `PullRequestReviewContext`から`decorationEnabled`を直接参照した
- 対応: public behavior `isPullRequestDecorationEnabled()`でassertするよう修正

### 2. focused test fixture / expectationミス

- HEAD: `8b4ed2a6641485a7be0cda52016045bdaff92eb5`
- exact-head run: `31947862342`
- diagnostic artifact: `9263810158`
- Unitまで成功、T405 focused suiteで2件失敗
- 原因1: R405-1 fixtureがzero-context parserへcontext lineを含めていた
- 対応1: line 2だけを変更する `@@ -2 +2 @@` evidenceへ修正
- 原因2: original unmark後のcanonical representationはdiff key自体を消さずempty range配列を保持する
- 対応2:既存contractどおり `{ [diffId]: [] }` を期待するよう修正

いずれもproduction defectではなく追加testのfixture/expectation不整合だった。

## 最終技術検証

Technical final HEAD:

`fcdae7d5121dc74459a20c148bdf9da0bfb1d6e2`

exact-head CI:

- run: `31947993979`
- Actions `head_sha`: `fcdae7d5121dc74459a20c148bdf9da0bfb1d6e2`
- status: `completed`
- conclusion: `success`

成功step:

- npm ci
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T602 history rewrite recovery
- T403 GitHub cache
- T404 GitHub PR context layer
- **T405 Review Contexts follow-up tests**
- T304 PR progress tree
- T502 Global mapping/display priority
- T503 repository enumeration
- T504 Global understanding
- T505 Global understanding
- Temporary Git integration
- Mock GitHub integration
- VS Code Extension Host

別SHAのworkflow runはCI判定に使用していない。

## Finding disposition

| Finding | 結果 | 根拠 |
| --- | --- | --- |
| R405-1 | addressed | B→C mapping → layer operation → restart durable regressionを追加しT405 suite成功 |
| R405-2 | addressed | open→closed/merged永続化、restart、saved group、default layer OFF regression成功 |
| R405-3 | addressed | canonical original/modified mark/unmark persistence regression成功 |
| R405-5 | addressed | Tree row/tooltipへT304-compatible progressをuser-visible表示 |
| R405-7 | addressed | redetectで選択したPR identityをHEAD単位でpersistしCurrent Contextへ再利用 |
| R405-9 | addressed | R405-5実装によりREADMEの「進捗確認」記述がproduction挙動と一致 |

前回closed済みのR405-4/R405-6/R405-8は変更していない。

## Held / non-goals

- T406: GitHub未認証、401/403/404/429、network断、patch欠落、複数PR候補・closed PRを含む総合end-to-end matrix
- T506: 複数context変更追従とGlobal集計の統合/Extension Host
- task tracking: `tasks/tasks-status.md`はmanager系Skill不在のため更新しない
- merge: 実施しない

## Result

追加fix verificationで残っていたR405-1/2/3/5/7/9をすべて対応し、technical final HEADと完全一致するCIで全step成功を確認した。report/handoff保存後は管理HEADが変わるため、新しいHEADに一致するCIを別途確認する。

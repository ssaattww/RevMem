# T205 レビュー指摘対応レポート

## メタデータ

- repository: `ssaattww/RevMem`
- PR: `#27`
- task: `T205`
- mode: review follow-up
- branch: `task/t205-branch-context-resolver`
- base: `main` (`68a2b49847fcaae2dd5943358c8ff875a1ce75a9`)
- review対象実装HEAD: `15a10ca850f525a13c67e3d5af33ada77602240a`
- review report commit / 対応開始HEAD: `fe5aa714bb94427761f8fc481bb214eaf070a5ee`
- 修正実装HEAD: `bad75d4fe119e183361c0828b623712d6a1d79fe`
- finding: `T205-R1-P1`
- source severity: `high`
- source review: `reports/issue-1-t205-review-20260801155600.md`

## 目的

`PollingGitStateMonitor.pollObserved()`で1つの監視rootのinspectionまたはchange callbackが失敗した場合でも、同一poll内の後続rootを継続処理し、失敗rootのbaselineを更新せず次回pollで再試行できるようにする。

## 対象範囲

- `src/application/review-context/polling-git-state-monitor.ts`
- `test/unit/polling-git-state-monitor-error.test.ts`
- review follow-up reportとhandoff

## 対象外

- Context resolver、revision mapper、document routing、Local Git adapterの追加変更
- public contract、設定、設計書、task tracker、CI workflowの変更
- user-facing notification、release、merge

## authoritative requirements

- PR #27 review finding `T205-R1-P1`
- review対象HEAD: `15a10ca850f525a13c67e3d5af33ada77602240a`
- required action:
  - root単位の失敗を隔離する
  - 同一pollの残りrootを処理する
  - 失敗rootのbaselineを更新しない
  - inspection失敗とcallback失敗の双方をRed testで再現する
  - 修正後のcurrent HEADと一致するCIだけを検証証拠にする

## 診断artifact workflow確認

`.github/workflows/ci.yml`を確認した。既存workflowは各工程のstdout/stderrを`test-output/ci/*.log`へ保存し、失敗時に以下を`ci-failure-diagnostics-*` artifactへ保存する。

- test outputと標準出力・標準エラー
- `dist/`、`test-dist/`
- `src/`、`test/`、`tools/`、`type-fixtures/`
- package、TypeScript、ESLint、workflow設定
- runner環境、Git状態、生成ファイル一覧

必要な診断情報を保存するworkflowが既に存在するため、workflowは変更していない。

## TDD Red

### 追加した回帰テスト

- `polling continues after an inspection failure in an earlier root`
  - 先頭rootのinspectionを失敗させる
  - 後続rootのchange callbackが同一pollで実行されることを要求する
  - 失敗rootが次回pollで再試行されることを要求する
- `polling continues after a change callback failure in an earlier root`
  - 先頭rootのchange callbackを失敗させる
  - 後続rootのchange callbackが同一pollで実行されることを要求する
  - 成功していない先頭rootのbaselineが更新されず次回pollで再試行されることを要求する

### Red evidence

- Red test commit: `1e404916bfe8071af15491a3d753b9f6a8a7f402`
- HEAD一致CI run: `30688975002`
- conclusion: `failure`
- Unit tests: 319件中317件成功、追加した2件のみ失敗
- inspection failure test actual: 後続root callback `[]`
- callback failure test actual: 後続root callback `[]`
- diagnostic artifact: `8814981197` (`ci-failure-diagnostics-30688975002-1`)

この失敗はreview findingで指摘された後続root starvationを直接再現している。

## 実装

`pollObserved()`を次のように変更した。

- observed rootごとにinspectionからcallback完了までを`try/catch`で隔離する
- inspectionまたはcallbackが失敗したrootの例外を収集する
- callbackまで成功したrootだけbaselineを更新する
- 失敗rootがあっても同一pollの残りrootを継続処理する
- poll終了後、失敗が1件なら元の例外を再throwする
- 複数rootが失敗した場合は全例外を保持した`AggregateError`をthrowする

これにより、scheduled pollingでは既存`onError`境界へ失敗が通知され、直接`pollNow()`する呼出元にも失敗が隠れない。成功していないrootのbaselineは変更されないため次回pollで再試行される。

## Green validation

- 修正実装HEAD: `bad75d4fe119e183361c0828b623712d6a1d79fe`
- HEAD一致CI run: `30689021555`
- conclusion: `success`
- Build: success
- Contract typecheck: success
- Architecture validation: success
- Architecture negative contract: success
- ESLint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

別SHAのworkflow runはGreen判定へ代用していない。

## finding disposition

### T205-R1-P1

- source severity: `high`
- disposition: `addressed; reviewer verification pending`
- evidence:
  - inspection失敗時に後続rootを処理する回帰テストがGreen
  - callback失敗時に後続rootを処理する回帰テストがGreen
  - 両ケースで失敗rootの次回retryを検証
  - 修正実装HEAD一致のfull CIがsuccess

severityは変更していない。fix verificationとreview verdictは同一normal reviewerが新しいcurrent HEADに対して行う。

## 変更ファイル

- `test/unit/polling-git-state-monitor-error.test.ts`
  - inspection失敗・callback失敗のmulti-root starvation回帰テストを追加
- `src/application/review-context/polling-git-state-monitor.ts`
  - root単位の障害分離、失敗収集、成功後baseline更新を実装
- `reports/issue-1-t205-review-followup-20260801160638.md`
  - 本レポート
- `reports/issue-1-t205-review-followup-handoff-20260801160638.yaml`
  - 次のreview chat用handoff

## intentionally untouched

- `tasks/tasks-status.md`
- `doc/design/vscode-review-range-tracker-design.md`
- `.github/workflows/ci.yml`
- T205の他実装、他task、release、merge

## remaining risks

- 複数rootが同一pollで失敗した場合は`AggregateError`で全例外を保持するが、個別例外へroot path metadataを新規付与していない。既存例外のdiagnosticとmonitorのobserved root順序を利用する。
- providerからuser-facing notificationを出す変更は対象外。
- native Windows runner、実Git object prune等の既存held riskは初回implementation/review reportから変更なし。

## next action

同じnormal reviewerが、最終current HEADと一致するCIを確認し、finding ID `T205-R1-P1`とseverity `high`を保持してfix verificationを行う。

## merge boundary

mergeは実施していない。mergeは利用者が行う。

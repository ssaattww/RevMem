# T501 実装レポート

## タスク

- 対象: T501 Repository Global State repository
- 関連Issue: #1
- Pull Request: #32
- ブランチ: `task/t501-global-state-repository`
- 依存: T102、T104、T206

## 作業開始時確認

- `.github/workflows/ci.yml`を確認した。
- 各commandのstdout/stderr統合logを`test-output/ci`へ保存する。
- 失敗時にtest output、生成物、`src`、`test`、`tools`、type fixture、設定、環境情報、Git状態をdiagnostic artifactへ保存する。
- 原因調査に必要なartifact workflowが既に存在するため、workflowは変更していない。

## Test-Driven Development

### Red

- `test/unit/repository-global-state-repository.test.ts`をproduction実装より先に追加した。
- `test/unit/core-contracts.test.ts`から通常unit suiteへ接続した。
- Red HEAD: `c805cd7107a84a0a5563e026383439f0ccc18900`
- HEAD一致CI run: `30704211883`
- 結果: Unit tests failure
- failure diagnostics artifact: `8819795376`
- artifact名: `ci-failure-diagnostics-30704211883-1`
- 失敗理由: `src/application/repository-global-state/index`が未実装で、追加した契約testをcompileできなかった。

### Green移行中の診断

- 実装・通常editor統合HEAD: `1504c20a01d0daf043b9f0d26bfb821c83456377`
- HEAD一致CI run: `30704279955`
- 結果: Lint failure
- failure diagnostics artifact: `8819815699`
- 原因: `ReviewStateFileTarget`の未使用import 1件。
- 対応: 未使用importだけを削除し、機能変更は行わなかった。

### Green

- Green HEAD: `d6a5edabd1e540220ba04e97cff786c00968726c`
- HEAD一致CI run: `30704317434`
- conclusion: success
- 成功工程:
  - Install dependencies
  - Build
  - Contract typecheck
  - Architecture validation
  - Architecture negative contract
  - Lint
  - Unit tests
  - Temporary Git integration tests
  - Mock GitHub integration tests
  - VS Code Extension Host tests

別SHAのworkflow runはRed、診断、Greenの判定へ代用していない。

## 実装内容

### Repository Global State repository

`RepositoryGlobalStateRepository`をapplication層へ追加した。

- range確認
- range解除
- file全体確認
- file全体解除

各操作は既存T102 Review State Serviceで完全なcontext/Global transactionを生成し、T104のatomic committerへ1回だけ渡す。

### Global自動反映

PR、branch、workspaceの各contextで確認操作を実行すると、同一transactionのnext snapshotへ次を格納する。

- current contextの確認済みrange
- owner-wide Globalの確認済みrange

contract testで3種類のcontextを通して、両snapshotとhistory requestが同一transactionであることを確認した。

### 解除semantics

解除はcurrent context側に該当rangeが存在しなくても、Global側の該当rangeを削除する。参照数や別contextの状態を解除判定へ使用しない。

contract testではcontextが空、Globalだけが`[1, 8)`を持つ状態から`[3, 6)`を解除し、Globalが`[1, 3)`と`[6, 8)`になることを確認した。

### Semantic no-op

context modified ranges、Global ranges、original-side rangesを比較し、意味上変化しない操作では次を実行しない。

- atomic commit
- history request

既存の通常editor command service内にあった判定をRepository Global State repositoryへ移し、同一規則を再利用する構成にした。

### History順序

- atomic commit成功後だけhistoryをrequestする。
- commit failureではhistoryをrequestしない。
- history failureはcommit済みstateをrollbackせず、observable partial successとして呼び出し側へ伝播する。

T206のappend-only history contractを変更していない。

### 通常editor統合

`NormalEditorReviewCommandService`は直接transaction生成・commit・history制御を行わず、`RepositoryGlobalStateRepository.apply()`へ委譲するよう変更した。

- selection確認・解除
- file全体確認・解除
- no-op result
- confirmation dialog境界
- session line count検証

既存の外部挙動は維持した。

## 追加した検証

- PR、branch、workspaceからの確認がcontextとGlobalへatomicに反映される。
- commit済みtransactionとhistoryへ渡すtransactionが一致する。
- contextにrangeがなくてもGlobalから解除される。
- file全体確認が両layerへ反映される。
- semantic no-opではcommit/historyが0回になる。
- commit failureではhistoryが0回で、元のerrorを伝播する。

## 変更ファイル

- `src/application/repository-global-state/index.ts`
- `src/application/repository-global-state/repository-global-state-repository.ts`
- `src/application/review-commands/normal-editor-review-command-service.ts`
- `test/unit/repository-global-state-repository.test.ts`
- `test/unit/core-contracts.test.ts`
- `reports/issue-1-t501-implementation-20260801234500.md`

## 変更していない範囲

- `.github/workflows/ci.yml`
- `doc/design/vscode-review-range-tracker-design.md`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`
- PR進捗、Global理解率calculator、Global UI、表示優先順位
- merge

タスク・Phase管理fileは専用manager経由でのみ更新するrepository規則のため、本実装workerでは変更していない。

## 終了条件との対応

- PR、branch、workspaceの確認がGlobalへ反映される: contract testで確認。
- 解除は参照数に関係なくGlobalからも消える: contextに対象rangeがないcaseで確認。
- contextとGlobalをatomicに更新する: 既存full-snapshot transactionとsingle committerを再利用。
- 履歴を残す: commit成功後に同じtransactionをT206 history境界へ渡す。
- AC-19、AC-20のcore/application部分: 上記testと全CIで検証。

## 残作業

- 通常reviewおよび独立最終review。
- review通過後のtask/phase進捗同期。
- T502以降のGlobal mapping、表示優先順位、理解率、UIは対象外。
- mergeは利用者が行う。

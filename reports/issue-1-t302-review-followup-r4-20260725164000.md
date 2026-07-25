# T302 レビュー指摘対応レポート R4

## 対象

- Pull Request: #26
- ブランチ: `task/t302-virtual-diff-content`
- 対応対象: 最新レビューで確認されたarchitecture、UI仕様、Local Git構築経路、timeout error contract

## 指摘と対応

### 1. 設計書の依存方向がarchitecture validatorと矛盾する

問題:

- 設計書rev2はUI AdapterからRuntime Adaptersへの直接依存を示していた
- `tools/validate-architecture.mjs`はUI層からadapters層へのimportを禁止している
- 実装時の判断根拠が設計と静的validatorで不一致になっていた

対応:

- 設計書をrev3へ更新した
- validatorの`allowedLayerDependencies`と同じ依存行列を機械可読tableで記載した
- UIはapplication service/portだけへ依存し、adaptersを直接importしないと明記した
- layer外のComposition Rootをruntime adapterの唯一の組み立て地点とした
- 設計tableとvalidatorの依存行列をparseして完全一致を検査するunit testを追加した

### 2. 機能別統合時に既決UI仕様が脱落した

問題:

- Current Context Viewの表示項目と操作
- PR Progress Viewの分類、表示項目、sort
- Review Contexts Viewのcontext種別と操作

上記がrev2で簡略化され、後続実装に必要な決定事項が設計から失われていた。

対応:

- Current Context ViewへPR番号・title・state、branch、base/head revision、GitHub接続、Global表示を復元した
- PR再検出、GitHub再接続、現在状態再計算を復元した
- PR Progress Viewへ未確認、完了、除外、行以外、行対象外の分類を復元した
- file表示項目、既定sort、sort切替候補、file選択時のdiff openを復元した
- Review Contexts Viewへcurrent PR/branch、open/closed PR、workspace contextを復元した
- diff open、layer切替、cache更新、表示削除と履歴削除の分離を復元した
- 重要な既決文言が設計書に残ることをunit testで固定した

### 3. 誤ったLocal Git構築経路が公開されたまま

問題:

- `createNodeLocalGitAdapter()`はruntime optionsを共有するが、`LocalGitAdapter`の1引数constructorが暗黙に別の`NodeGitBlobReader`を生成できた
- consumerがfactoryを迂回し、metadataとblobを別runtime policyで動かせた

対応:

- `LocalGitAdapter`のconstructorからblob readerのdefaultを削除した
- 直接構築時は`GitCommandExecutor`と`GitBlobReader`の両方を必須にした
- Node production wiringは`createNodeLocalGitAdapter()`を使用するcontractとした
- metadata-only testには明示的なunreachable blob boundaryを注入した
- public consumer fixtureで1引数constructorをcompile errorとして固定した

### 4. metadata timeoutとblob timeoutのerror contractが異なる

問題:

- blob timeoutは`GitCommandFailedError`としてinvocationとdiagnosticsを保持した
- metadata timeoutはraw Node process errorをrejectしていた

対応:

- metadata timeoutも`GitCommandFailedError`へ統一した
- synthetic exit codeを`-1`とした
- invocation、partial stdout、stderrを保持した
- diagnosticへ設定timeout値を含めた
- executable未検出だけは`GitExecutableNotFoundError`として維持した
- 実processをtimeoutさせるunit testを追加した

## TDD証跡

### Public constructor Red

- Head: `0ee9f621a36da73c81c69ddad28bc5b4560f1362`
- GitHub Actions Run: `30149302532`（#1059）
- 結果: Contract typecheck failure
- Artifact: `ci-failure-diagnostics-30149302532-1`
- Artifact ID: `8617091781`

### Architecture・UI・timeout Red

- Head: `619bc849ce1fcb650930b78b22deaf29ba1c5c4e`
- GitHub Actions Run: `30149454562`（#1083）
- 結果: Unit tests failure
- Artifact: `ci-failure-diagnostics-30149454562-1`
- Artifact ID: `8617139912`

### 回帰修正

- Run #1097では新規指摘のtestは成功した
- `package.json`全体更新時に既存のliteral backslash説明を1段減らしたため、既存manifest contract testがfailureとなった
- 担当外の既存仕様を元の`settings.json`表記へ戻した
- Artifact: `ci-failure-diagnostics-30149623458-1`
- Artifact ID: `8617191253`

### Code Green

- Head: `9187746bfd18e008c6d30e22099493a5a26eb69d`
- GitHub Actions Run: `30149703513`（#1101）
- Install dependencies: success
- Build: success
- Contract typecheck: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

## 設計書

- `doc/design/vscode-review-range-tracker-design.md` rev3
- 恒久仕様は引き続き本ファイル1つへ機能別に統合している
- task名やPR経緯は設計本文へ追加していない

## 結果

- 最新レビュー4件をすべて修正した
- architectureとUI仕様の設計回帰を恒久testで防止した
- Local Gitの誤構築経路を型contractで閉じた
- metadata/blob timeoutの診断契約を統一した
- マージは行っていない

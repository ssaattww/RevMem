# T302 レビュー指摘対応レポート R5

## 対象

- Pull Request: #26
- ブランチ: `task/t302-virtual-diff-content`
- 対応対象: test discovery、architecture CI gate、blob timeout process lifecycleに関する最新レビュー

## 指摘と対応

### 1. 設計contract testがCIで実行されていない

問題:

- `test/unit/design-document-structure.test.ts`はcompile対象だったが、明示列挙方式の`test:unit`と`test:t302`へ直接接続されていなかった
- 別testからのside-effect importに依存しており、focused suiteと通常suiteの実行根拠が不明確だった

対応:

- `design-document-structure.test.js`を`test:unit`と`test:t302`へ明示列挙した
- side-effect importを削除し、test discoveryをpackage scriptだけで決定するようにした
- `ci-workflow-contract.test.ts`を追加し、両scriptが設計contract testを実行することを固定した
- 設計contract test自体も通常unit suiteとfocused suiteへ接続した

### 2. Architecture validatorがCI workflowで実行されていない

問題:

- `validate:architecture`と`validate:architecture:negative`はscriptとして存在したが、workflowから呼ばれていなかった
- CI greenだけではsource layer contractとnegative fixtureの両方を検証した証拠になっていなかった

対応:

- workflowへ`Architecture validation` stepを追加した
- workflowへ`Architecture negative contract` stepを追加した
- 各stepを独立実行し、次のlogへ保存する
  - `test-output/ci/architecture.log`
  - `test-output/ci/architecture-negative.log`
- 既存failure artifactは`test-output/`と`tools/`を含むため、architecture failureの原因調査情報も保存される
- negative modeでは、期待した件数の違反を検出した場合だけ成功するようvalidatorの終了code contractを修正した
- workflow contract testでstep名、command、log pathを固定した

### 3. Blob timeoutでpartial diagnosticを破棄する

問題:

- timeout時に`child.kill()`直後にfailureを確定していた
- timeout前後に取得したstdout/stderrを捨てていた
- processの`close`を待たず、終了したかを確認できなかった
- SIGTERMを無視するprocessやsignal送信失敗の扱いが定義されていなかった

対応:

- timeout時はSIGTERMを送信し、stdout/stderrの収集を継続する
- 通常は`close`eventを待ってから`GitCommandFailedError`を確定する
- timeout前後のpartial stdout/stderr、timeout値、終了signalを保持する
- termination grace内にcloseしない場合はSIGKILLへ段階的に移行する
- SIGTERM/SIGKILLの送信結果をdiagnosticへ記録する
- SIGKILL後もcloseがない場合はstreamを破棄し、childをunrefしてbounded failureを返す
- `terminationGraceMs`を追加し、Node runtime factoryから`blobTerminationGraceMs`として設定できるようにした

回帰test:

- partial stdout/stderrを出力後、SIGTERMを受けて遅延終了するprocess
- SIGTERMを無視し、SIGKILLが必要なprocess
- failure確定がprocess close lifecycle後であること
- timeout diagnosticにpartial output、timeout値、signal lifecycleを含むこと

## 設計

単一設計書をrev4へ更新した。

- `doc/design/vscode-review-range-tracker-design.md`
- process failure contractへSIGTERM、SIGKILL、close event、signal送信失敗、bounded failureを記載
- test方針へarchitecture positive/negative gateと設計contract testのCI接続を記載
- task名、PR番号、実装経緯は設計本文へ含めていない

## TDD証跡

### Red

- Head: `c7f939e122dc60a601ac5498190a74c8d61e20a1`
- GitHub Actions Run: `30184555194`（#1139）
- 結果: Unit tests failure
- Artifact: `ci-failure-diagnostics-30184555194-1`

同runで次を確認した。

- 設計contract testが通常unit suiteから実行され、欠落fragmentで失敗した
- workflow contract testがarchitecture step欠落を検出した
- blob timeout testがpartial stdout破棄を検出した

### 中間failure

- Head: `0a77cef54dc710b44559d6550cde4022fbeb22a5`
- GitHub Actions Run: `30184839517`（#1169）
- Architecture validation: success
- Architecture negative contract: success
- Lint: failure
- Artifact: `ci-failure-diagnostics-30184839517-1`
- 原因: lifecycle実装の`timeout`変数に対する`prefer-const`

### Green

- Source・test・design確認head: `a2642c59c27e23025b30bdfc8e0a897030eb6e77`
- GitHub Actions Run: `30184917755`（#1173）
- Install dependencies: success
- Build: success
- Contract typecheck: success
- Architecture validation: success
- Architecture negative contract: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

## 結果

- 最新レビュー3件を修正した
- 新規gateが通常CIで実行されることをRed/Greenで確認した
- R4以前の回帰testも成功した
- マージは行っていない

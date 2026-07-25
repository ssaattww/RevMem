# T302 レビュー指摘対応レポート R3

## 対象

- Pull Request: #26
- ブランチ: `task/t302-virtual-diff-content`
- 対応対象: 最新レビューのruntime構成、Windows path、および設計書構成に関する指摘

## 指摘と対応

### 1. Git metadataとblobでruntime設定が分離する

問題:

- `NodeGitCommandExecutor`へcustom executableやtimeoutを設定しても、暗黙生成されたblob readerは既定`git`・30秒を使用していた
- portable Git、Remote、Container環境でmetadata確認だけ成功し、本文取得だけ失敗する可能性があった

対応:

- `createNodeLocalGitAdapter()`を追加した
- 1つの`NodeLocalGitAdapterOptions`からmetadata executorとblob readerを同時生成する
- `executable`と`timeoutMs`を両方へ適用する
- `maxBufferBytes`はboundedなmetadata出力だけへ適用する
- factoryとoptionsをpublic barrelからexportした
- consumer type fixtureへfactory利用を追加した

回帰test:

- PATHを空にする
- temporary directoryへfake portable Git executableを作る
- metadata確認、exact path lookup、blob取得が同じ絶対path executableを使用することを記録・照合する

### 2. Windows予約デバイス名を受理する

問題:

- `CON`、`NUL`、`PRN`、`AUX`、`COM1`〜`COM9`、`LPT1`〜`LPT9`をcanonical Windows pathとして受理していた
- `con.txt`等の拡張子付き名称も実在不能なdescriptorとしてURI化できた

対応:

- 共有canonical repository path validatorへ予約名判定を追加した
- 各segmentのbasenameをcase-insensitiveで検査する
- 拡張子付き名称も拒否する
- POSIXでは同じ文字列を通常file名として維持する
- URI codecは共有validatorを使用するためencode時に同じ規則を適用する

### 3. 設計書がtask単位の補遺へ分散している

問題:

- 恒久仕様をtask名付き補遺へ分離していた
- 基本設計と補遺の優先関係が必要となり、機能全体を追いにくかった
- 設計本文にtask identifierが残っていた

対応:

- `doc/design/vscode-review-range-tracker-design.md`をrev2として機能別に再編した
- レビュー操作、context、filesystem path、仮想diff文書、Local Git取得、変更追従、進捗、architecture、永続化、error等の機能軸へ統合した
- runtime factoryとWindows予約名を恒久仕様として該当機能節へ記載した
- task identifierと実装phase案を設計本文から削除した
- task専用補遺を削除した
- 同系列の設計書がmain 1件だけであることと、task identifierを含まないことをunit testで固定した
- 設計test失敗時はmain設計書と分散file一覧をCI artifactへ保存する

## TDD証跡

### Runtime・Windows path Red

- Head: `1198809b3abac7d8edb923d58fca551af43de454`
- GitHub Actions Run: `30147387508`（#967）
- 結果: Unit tests failure
- Artifact: `ci-failure-diagnostics-30147387508-1`

### 設計書構成 Red

- Head: `7418273bc52f5b0e3d0ebe0bf65f4f0ed02084e1`
- GitHub Actions Run: `30147612395`（#987）
- 結果: Unit tests failure
- Artifact: `ci-failure-diagnostics-30147612395-1`
- Artifactにはmain設計書、分散設計書、file一覧を含めた

### Green

- Source・設計・public contract確認head: `d46b850161148a4f3ac49138415c15657dd0339d`
- GitHub Actions Run: `30147956376`（#1005）
- Install dependencies: success
- Build: success
- Contract typecheck: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

## 結果

- 最新レビューのblocking findingを修正した
- Windows pathの追加findingを修正した
- 恒久設計を単一fileへ機能別統合した
- マージは行っていない

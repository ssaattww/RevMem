# T302 再レビュー対応レポート R2

## タスク

- 対象: T302 仮想diff URIとrevision content provider
- 関連Issue: #1
- Pull Request: #26
- ブランチ: `task/t302-virtual-diff-content`
- 対応種別: 再レビュー指摘へのfollow-up

## CI失敗時診断の確認

- `.github/workflows/ci.yml`は各工程の標準出力・標準エラーを`test-output/ci/*.log`へ保存する
- 失敗時はログ、生成物、`src`、`test`、`tools`、type fixture、package・TypeScript・ESLint・workflow設定をartifactへ保存する
- 再レビュー対応中のRed Run #803、Run #873、Run #881で診断artifactが生成されたため、workflowへ追加変更は不要だった

## 再レビュー指摘と対応

### 1. exit 128の誤ったmissing分類

- commit・file lookupともexit code 1だけを既知のmissingとして扱う
- exit 128を含むその他の非0 exitは`GitCommandFailedError`としてinvocation、exit code、stdout、stderrを保持する
- dubious ownership、object database破損相当のexecutor testを追加した

### 2. moving refによる仮想文書内容の変化

- Git revisionはlowercase full SHA-1またはfull SHA-256 commit object IDだけを受理する
- `HEAD`、branch、tag、abbreviated ID、revision rangeをURI codecとLocal Git content lookupの双方で拒否する
- descriptorへ`revisionSource: "git-commit"`を追加し、後続snapshot sourceと混同しないcontractにした

### 3. 4 MiBを超えるtext取得

- blob本文を`execFile`のtext stdoutと`maxBuffer`で取得する方式を廃止した
- `spawn`した`git cat-file blob <blob-id>`からraw byte streamとして取得する`NodeGitBlobReader`を追加した
- 4 MiB直下と直上のvalid UTF-8 blobを実Gitで取得する回帰testを追加した
- Git objectから再取得可能な本文にはT302固有の4 MiB上限を設けない方針を設計補遺へ明記した

### 4. invalid UTF-8のreplacement decode

- blob stdoutをencoding付きprocess APIで先にdecodeしない
- complete byte sequenceを`TextDecoder("utf-8", { fatal: true })`でdecodeする
- invalid UTF-8は`invalid-encoding`へ分類し、replacement characterを含むtextを返さない

### 5. filesystem semanticsの欠落

- descriptorへ`fileSystemPathSemantics: "posix" | "windows"`を追加した
- URI codec、content source、Local Git Adapterで同じcanonical repository path contractを使用する
- Extension Hostの対象workspace filesystem semanticsを呼び出し側から明示する

### 6. POSIXのbackslash・tab・newline

- POSIXではNULとseparator `/`以外をfilename文字として保持する
- backslash、tab、newlineを含むtracked fileを実Gitから取得するtestを追加した
- filename全体がnewline 1文字だけのケースを追加し、pathへの`trim()`適用漏れをRed Run #881で再現して修正した

### 7. Windowsとcanonical path境界

- Windowsではbackslash、drive path、control character、`< > : " | ? *`、trailing dot/space segmentを拒否する
- 共通でabsolute path、空segment、`.`、`..`、NUL、不正surrogateを拒否する
- codecとadapterで別々のpath正規化を行わず、共有validatorを再利用する

### 8. URI異常系と上限

- canonical base64url以外、padding、不正UTF-8、userinfo、password、port、query、fragment、未知version、未知segmentを拒否する
- context ID、file path、URI全長の境界値と超過値をunit testへ追加した
- unpaired UTF-16 surrogateの回帰testを維持した

### 9. 実際のVS Code URI境界

- Extension Hostでcodec生成URIを`vscode.Uri.parse`する
- `uri.toString(true)`がcanonical URIと一致することを確認する
- decode後descriptor完全一致と`TextDocumentContentProvider`への委譲を確認する

### 10. 公開contractのconsumer検証

- application、adapter、UIの公開barrelをimportする`type-fixtures/contracts/t302-diff-document.fixture.ts`を追加した
- CIへ`Contract typecheck` stepを追加した
- fixtureのNode・VS Code type解決を明示し、Run #873のtypecheck失敗を修正した

### 11. 設計・進捗の同期

- `doc/design/vscode-review-range-tracker-design-t302-amendment.md`を追加し、immutable revision、URI、filesystem semantics、Git取得、encoding、error policyを明文化した
- 本follow-upレポートと最終再レビューレポートを進捗へ追加した
- provider登録、`vscode.diff`実行、original側transactionは引き続きT303の範囲とする

## TDD証跡

### 再レビューRed

- Head: `86cc1656e176ee3f0c59ddd61e8c07ca4ff21fcc`
- GitHub Actions Run: `30144717280`（#803）
- 結果: Temporary Git integration tests failure
- 新規10件が、moving ref、fatal 128、POSIX特殊path、4 MiB超、invalid UTF-8等の未対応を再現した
- Artifact: `ci-failure-diagnostics-30144717280-1`

### Public contract Red

- Head: `4a421fa5ecd142d537fdc3950863aabbd2d0f81c`
- GitHub Actions Run: `30145452158`（#873）
- 結果: Contract typecheck failure
- 原因: consumer fixtureのNode・VS Code type解決が明示されていなかった
- Artifact: `ci-failure-diagnostics-30145452158-1`

### POSIX newline-only Red

- Head: `3620db51f8d1cdbd7a5ce2d89d0e637b6a2b5465`
- GitHub Actions Run: `30145609171`（#881）
- 結果: Temporary Git integration tests 28 success / 1 failure
- 原因: Local Git Adapterがrepository pathへ`trim()`を適用していた
- Artifact: `ci-failure-diagnostics-30145609171-1`

### Final Green

- Code head: `f62fd327ecd54451644412ebf1c4b1ab8e37cbf6`
- GitHub Actions Run: `30145823663`（#891）
- Install dependencies: success
- Build: success
- Contract typecheck: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

## 対象外

- content providerのVS Code登録
- `vscode.diff`によるdiff editor open
- original側の確認・解除transaction
- GitHub API・snapshot sourceのfallback
- 文字encodingの追加対応
- 巨大repository性能測定

これらはそれぞれT303、T402、T601、T607の既存責務を変更しない。

## 結果

- 再レビュー指摘はすべて恒久testと実装へ反映した
- T302終了条件を満たす
- マージは行っていない

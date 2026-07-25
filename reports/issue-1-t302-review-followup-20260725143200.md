# T302 再レビュー指摘対応レポート

## 対象

- Pull Request: #26
- ブランチ: `task/t302-virtual-diff-content`
- 対応開始前head: `f4c8c179b1c354fc9f816f79a63204b63bc5a72d`
- 実装検証head: `f62fd327ecd54451644412ebf1c4b1ab8e37cbf6`
- 関連Issue: #1

## 再レビュー指摘

再レビューで次の境界不足を確認した。

1. Git exit 128を理由に関係なくmissingへ変換していた
2. `HEAD`、branch、tag等のmoving refをimmutable URIへ保存できた
3. `execFile.maxBuffer`により4 MiB超のtext blobを取得できなかった
4. invalid UTF-8 blobをreplacement characterへ黙って変換した
5. POSIXで有効なbackslash、tab、newline入りfile pathを拒否した
6. codecがabsolute、parent、empty segment等の非canonical pathを保存できた
7. actual `vscode.Uri` parse・serialize境界を未検証だった
8. base64url canonical性、不正UTF-8、userinfo、port、field・URI上限のtestが不足した
9. public barrelのconsumer fixtureとCI contract typecheckがなかった
10. 設計・進捗・既存reportが再レビュー状態へ追従していなかった

## TDD証跡

### 再レビューRed

- 先に`test/integration/t302-review-followup.integration.test.ts`を追加した
- commit `43eb6be5a95789a7c8798c97013412414ebafc75`
- test wiring commit `86cc1656e176ee3f0c59ddd61e8c07ca4ff21fcc`
- CI Run #803 `30144717280`はTemporary Git integration testsで失敗した
- 既存workflowがfailure diagnostics artifactを生成した

### Contract typecheck Red

- public consumer fixtureとCI stepを先行追加した
- CI Run #875 `30145480796`はContract typecheckで失敗した
- artifact `ci-failure-diagnostics-30145480796-1`からfixture tsconfigのruntime type指定不足を特定した
- `node`と`vscode`型を明示して修正した

### POSIX newline-only path Red

- POSIXで有効な改行1文字だけのfile nameを実Git fixtureへ追加した
- CI Run #887 `30145729186`はTemporary Git integration testsで失敗した
- artifact `ci-failure-diagnostics-30145729186-1`から、汎用path validatorの`trim()`が正当なfile nameを空扱いしていたことを確認した
- canonical repository path validatorへ統一して修正した

### Green

実装検証head `f62fd327ecd54451644412ebf1c4b1ab8e37cbf6`に紐づくCI Run #891 `30145823663`で次がすべて成功した。

- Build
- Contract typecheck
- Lint
- Unit tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

## 実装対応

### immutable revision

- `revisionSource: "git-commit"`をdescriptorとURIへ追加した
- revisionをlowercase full SHA-1またはSHA-256 commit object IDへ限定した
- `HEAD`、branch、tag、short object IDをcodecとLocal Git lookupで拒否した
- `git rev-parse --verify --quiet <oid>^{commit}`のexit 1だけをmissing扱いにした
- fatal 128等は`GitCommandFailedError`としてinvocation、exit、stdout、stderrを保持した

### canonical repository path

- `FileSystemPathSemantics`をdescriptorとURIへ保持した
- application共通validator `requireCanonicalRepositoryRelativePath`を追加した
- codec、Local Git content source、Local Git adapterが同じcontractを利用する
- POSIXではNULと`/`以外のfilename文字を保持する
- Windowsではbackslash、drive path、control character、`<>:"|?*`、末尾dot・spaceを拒否する
- Git path lookupは`ls-tree --full-tree -z`とliteral pathspecを使用し、newlineを行区切りとして解析しない

### binary-safe blob content

- metadata commandとblob本文取得を分離した
- `NodeGitBlobReader`が`git cat-file blob <blob-id>`のstdout bytesをstream取得する
- blob本文へ`execFile.maxBuffer`を適用しない
- 4 MiB直下・直上のUTF-8 textを実Gitで検証した
- complete bytesをfatal UTF-8 decoderでdecodeする
- invalid UTF-8は`invalid-encoding`として決定的に返す

### URI・VS Code境界

- URIへpath semanticsとrevision sourceを明示した
- canonical base64url、invalid UTF-8、userinfo、password、port、field上限、URI長上限をtestした
- actual `vscode.Uri.parse(..., true)`と`toString(true)`をExtension Hostで検証した
- VS Code content provider adapterまで同じdescriptorが渡ることを確認した

### public contractとCI

- application、adapter、UIのpublic barrelを利用するconsumer type fixtureを追加した
- CIへ`npm run typecheck:contracts`を追加した
- failure時はtypecheck logも既存artifactに含まれる

## 設計修正

- `doc/design/vscode-review-range-tracker-design-t302-amendment.md`を追加した
- immutable revision、URI構造、filesystem semantics、Git plumbing command、stream blob、UTF-8限定、error policy、VS Code境界、追加終了条件を明記した
- 基本設計rev1のT302関連記述と矛盾する場合は補遺を優先する

## 対象外

- provider登録とdiff editor open command: T303
- original側の確認・解除transaction: T303
- GitHub API content fallback: T402以降
- snapshot revision source: T601
- 巨大repository・多数blobの性能最適化: T607

# Issue #13 レビューレポート

## 対象

- Pull Request: #15
- Branch: `issue/13-document-context-routing`
- コード最終確認head: `ee95f6bdeaec5d51dbe3e340ed340ca97642c441`
- 対象: 設計追補、document ownership router、external-file persistence、Extension接続、回帰test、README

## レビュー観点

- workspace membershipよりGit ownershipが優先されること
- workspace外Git fileがrepository-relative identityを使用すること
- Git failureを非Gitと誤認しないこと
- UNC authorityがidentityから消えないこと
- external-fileとGit repositoryの保存先が混線しないこと
- context/Globalがatomicに更新されること
- owner昇格時に不確実な範囲を移行しないこと
- decoration readが状態を作成・変更しないこと
- 既存workspace、Git、PR persistence contractを壊さないこと

## 検出・修正事項

### external-file debounce key

`ReviewStateTransactionLike`から保存targetを復元するとき、`external-file` contextが`git`へ畳み込まれ、external pending saveとconfirmation commitが別queueになる問題を検出した。

修正:

- `external-file`を独立したtransaction targetへmappingした。
- pending saveがcommit前にflushされる回帰testを追加した。

### owner/context persistence整合性

保存targetとcontext kindの組み合わせを公開repository層のsave・load・commitで検証し、external-file contextがGit targetへ混入しないことを固定した。

### Windows path identity

Windows pathのdrive、case、separator variationを同一repository-relative pathとfile IDへ正規化する回帰testを追加した。path処理はdescriptorが示すfilesystem semanticsに従い、実行側OSから推測しない。

### external descriptor

external-fileはworkspace snapshot descriptorを流用せず、専用`ExternalFileReviewContext`へcanonical URIとsnapshot revisionを保持する。Review State Serviceと通常エディタ装飾も同descriptorからrevisionを検証する。

### Git非repository分類

Local Git inspectionは、`git rev-parse`の任意の失敗を非Git扱いせず、C localeの明示的な`not a git repository`診断だけを`not-repository`へ分類する。権限・timeout・破損repositoryはエラーとして伝播する。

### README不整合

旧READMEの「workspace外は対象外」「Gitを認識しない」という記載を、Issue #13実装後のowner routingと現行制限へ修正した。

## 最終判定

- blocking finding: なし
- non-blocking finding: なし
- merge: 実施しない。ユーザーが行う。

## 検証

GitHub Actions run `30093939815`で、head `ee95f6bdeaec5d51dbe3e340ed340ca97642c441`に紐づく次の工程がすべて成功した。

- Install dependencies
- Build
- Lint
- Unit tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

同repositoryの別branchまたは他作業者の最新runではなく、上記head SHAに紐づくrunだけをコード最終判定に使用した。文書同期後のPR最終headについても、そのhead SHAに紐づくCIを別途確認する。

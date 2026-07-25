# T302 実装レポート

> このレポートは初回実装時点の記録である。再レビュー指摘を反映した最新実装は`reports/issue-1-t302-review-followup-20260725143200.md`、最終判定は`reports/issue-1-t302-review-r2-20260725143300.md`を参照する。

## タスク

- 対象: T302 仮想URI codecとoriginal/modified content provider
- 関連Issue: #1
- Pull Request: #26
- ブランチ: `task/t302-virtual-diff-content`
- 基点: `main` commit `31218556a31afa8f7f2532a302a593c3df8fc62f`
- 初回実装検証commit: `03c059a459d5b1996008821ab5e57c044b940042`

## CI失敗時診断の事前確認

- 作業開始時に`.github/workflows/ci.yml`を確認した
- 既存workflowはinstall、build、lint、unit、Git統合、mock GitHub、Extension Hostの標準出力・標準エラーを`test-output/ci/*.log`へ保存する
- 失敗時は`test-output`、`dist`、`test-dist`、`src`、`test`、`tools`、型fixture、package・TypeScript・ESLint・workflow設定をartifactとして保存する
- 原因調査に必要な情報が既に含まれていたため、初回実装ではworkflow変更を行わなかった
- 再レビュー対応ではpublic contract testをCIへ追加し、そのlogも同じartifactへ保存するよう拡張した

## Test-Driven Development

### Red

- 実装前に`test/unit/review-diff-content-provider.test.ts`を追加した
- Red commit `7e9c1340572cde03843a96c599fb465d5dcfdcaa`に紐づくCI Run #656はUnit testsで失敗した
- 同Runは`ci-failure-diagnostics-30137609948-1`を生成し、Red原因をartifactへ保存した

### 初回Green

- context、file、side、revisionを保持するversion付きcanonical URI codecを実装した
- original/modifiedのdescriptorをcontent sourceへ渡すapplication providerを実装した
- context IDからlocal repository rootを解決し、指定revisionのfile blobを読むLocal Git sourceを実装した
- VS Code `TextDocumentContentProvider`へ接続するUI adapterを実装した
- temporary Git repositoryでbase/headの本文が異なることを実Gitで検証した
- 実装commit `9517fa6fed6f9a190c71c894a69366b6330b6e46`に紐づくCI Run #706は全step成功した

### 初回Review follow-up

- URI round-trip自己レビューで、unpaired UTF-16 surrogateがUTF-8変換時に置換される非可逆境界を検出した
- 先に`test/unit/review-diff-uri-unicode.test.ts`を追加した
- Run #714は末尾high surrogateの条件漏れをUnit testsで再現し、`ci-failure-diagnostics-30138258095-1`を生成した
- 末尾high surrogate、単独low surrogate、high surrogate直後の非low surrogateを拒否し、valid surrogate pairはround-tripするよう修正した
- 修正commit `03c059a459d5b1996008821ab5e57c044b940042`に紐づくCI Run #720は全step成功した

## 初回実装内容

- 初回URI形式: `review-range-diff://document/v1/{context}/{side}/{revision}/{file}`
- 可変fieldはcanonical base64urlで保持し、Unicode、空白、path separatorを可逆化した
- URIごとにcontext IDを保持し、別PR・別branchの同一file pathを分離した
- content providerはmissing context、missing revision、missing fileをstable error codeで区別した
- Local Git adapterへ指定revisionのrepository-relative pathを読むAPIを追加した
- T303が利用できるVS Code text document provider adapterを追加した

## 再レビューによる変更

初回実装後に、次を含むcontract変更を行った。

- moving refを廃止しfull commit object IDへ限定
- filesystem semanticsとrevision sourceをURIへ追加
- canonical repository path validatorを共通化
- POSIX特殊file nameを保持
- fatal Git failureとmissingを分離
- raw blob streamingによる4 MiB超対応
- fatal UTF-8 decodeと`invalid-encoding`
- actual `vscode.Uri` test
- URI入力境界test
- public consumer type fixtureとCI Contract typecheck
- T302設計補遺

詳細は`reports/issue-1-t302-review-followup-20260725143200.md`を参照する。

## 初回検証

CI Run #720、head SHA `03c059a459d5b1996008821ab5e57c044b940042`:

- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

最新検証は`reports/issue-1-t302-review-r2-20260725143300.md`を参照する。

## 対象外

- providerのVS Code登録とdiff editorを開く処理はT303で実装する
- original側の確認・解除transactionと`originalReviewedByDiff`永続化はT303で実装する
- GitHub APIとsnapshotによるcontent fallbackはT402以降・T601で実装する

# Issue #13 実装レポート

## 対象

- Issue: #13 ワークスペース外のファイル対応
- Branch: `issue/13-document-context-routing`
- Pull Request: #15
- Base: T202統合後の`main`
- 設計追補: `doc/design/issue-13-document-context-routing.md`

## 要件整理

レビュー対象のownerは、VS Code workspace membershipではなく対象ファイルのGit ownershipを先に解決して決定する。

```text
Git working tree内
  -> workspace内外を問わずGit branch/detached context

Git working tree外かつworkspace内
  -> non-Git workspace context

Git working tree外かつworkspace外
  -> external-file context
```

UNC resourceは、VS Codeから開ける場合にserver authorityを含むcanonical URIを保持する。VS CodeのUNC security設定は迂回しない。

## 実装内容

### Document ownership router

- `DocumentReviewStateSessionProvider`を追加した。
- T202 `LocalGitAdapter`でdocumentの親directoryからworking treeを検出する。
- Git ownershipをworkspace membershipより優先する。
- Git管理下はRepository ID、branch/detached context、repository-relative pathで識別する。
- Git unavailableまたは非Gitの場合だけworkspace/externalへフォールバックする。
- Git inspectionの予期しない失敗は非Gitと誤認せず伝播する。

### external-file context

- `ReviewContextKind`とrepository targetへ`external-file`を追加した。
- canonical URIからrepository/context/file IDをdomain-separated SHA-256で生成する。
- Windows path、drive、case、separatorを正規化する。
- UNC authorityをcanonical URIへ保持する。
- `globalStorageUri/external-files/<repository-id-hash>`へ保存する。
- decoration readでは未保存状態を初期化しない。
- 再起動後もexternal-fileの確認範囲を復元する。

### owner変更時の移行

- external-fileからworkspaceへの昇格を実装した。
- workspace/external-fileからGit ownerへの昇格を実装した。
- content hashとline countが一致する確実な範囲だけを移行する。
- 新ownerへのcommit成功後だけ新状態を返し、旧ownerへの恒久的な二重書き込みは行わない。

### persistence

- external-fileをGit repositoryとは別のglobal subtreeへルーティングした。
- lifecycle debounce keyへ`external-file`を含め、pending external saveをconfirmation commit前にflushする。
- target kindとcontext kindの整合性を保存層で検証する。
- context/Globalの完全snapshot CASをexternal-fileにも適用した。

### Extension接続と文書

- 通常エディタのcommandとdecorationを同じdocument owner routerへ接続した。
- workspace外を一律拒否する処理を廃止した。
- READMEをGit ownership、external-file、UNC、現行制限へ同期した。

## TDD・CI証跡

CIは既存workflowの失敗時診断artifact収集を使用した。workflowにはログ、生成物、`src`、`test`、設定ファイルを収集する処理が既にあったため変更していない。

### Red・follow-up

- run `30090082687`: 初期実装後のlint failure。診断artifact `ci-failure-diagnostics-30090082687-1`を確認した。
- run `30090730806`: external descriptor整理後のcompile failure。診断artifact `ci-failure-diagnostics-30090730806-1`を確認した。
- run `30092181736`: unit 139件中138件成功、error message契約1件失敗。診断artifact `ci-failure-diagnostics-30092181736-1`を確認した。

### 最終Green

- head: `5da9b1efa6a24d5398634cdabd831578a9455a62`
- workflow run: `30092391779`
- Install dependencies: success
- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

## 主な回帰テスト

- workspace外Git fileがbranch contextになる。
- workspace内Git fileでもGit ownerが優先される。
- Windows Git pathのdrive、case、separator variationが同一file IDになる。
- Git inspection failureをnon-Gitへフォールバックしない。
- non-Git workspaceは既存workspace persistenceを維持する。
- external UNC authorityをidentityへ保持する。
- external-file stateを再起動後に復元する。
- externalからworkspace、workspaceからGitへ確実な範囲を移行する。
- content hash不一致時は移行しない。
- external-fileのpending saveをconfirmation commit前にflushする。
- external-file contextをGit targetへ保存できない。

## Scope外・後続

- GitHub PR resolver: T401以降
- commit追加後のrevision mapping: T203〜T205
- edit/rename mapping: T201、T203、T204の接続
- snapshot diffによる不一致内容の移行: T601
- 履歴: T206

これらが未実装の場合、既存状態を新revisionまたは不一致内容へ無条件に再ラベルしない。

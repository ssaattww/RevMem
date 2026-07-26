# Issue #13 実装レポート

## 対象

- Issue: #13 ワークスペース外のファイル対応
- Branch: `issue/13-document-context-routing`
- Pull Request: #15
- 設計書: `doc/design/document-context-routing.md`

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

- `DocumentReviewStateSessionProvider`を追加した
- Local Git inspectionでdocumentの親directoryからworking treeを検出する
- Git ownershipをworkspace membershipより優先する
- Git管理下はRepository ID、branchまたはdetached context、repository-relative pathで識別する
- Git unavailableまたは非Gitの場合だけworkspaceまたはexternal-fileへfallbackする
- Git inspectionの予期しない失敗は非Gitと誤認せず伝播する

### External-file context

- `ReviewContextKind`とrepository targetへ`external-file`を追加した
- canonical URIからRepository、Context、File IDをdomain-separated SHA-256で生成する
- external contextへcanonical URIとsnapshot revisionを保持する
- Windows path、drive、case、separatorを正規化する
- UNC authorityをcanonical URIへ保持する
- `globalStorageUri/external-files/<repository-id-hash>`へ保存する
- decoration readでは未保存状態を初期化しない
- 再起動後もexternal-fileの確認範囲を復元する

### Owner reconciliation

- external-fileからworkspaceへの昇格を実装した
- workspaceとexternal-fileからGit ownerへの昇格を実装した
- content hashとline countが一致する確実な範囲だけを移行する
- lower ownerごとのbaseline snapshotから追加と解除のdeltaを計算する
- lower owner contextが存在して対象file stateがない場合は空baselineを記録する
- 初回昇格、全source delta、全baselineを1回の完全snapshot CASへ集約する
- commit成功後だけ新owner状態を返し、旧ownerへ恒久的に二重書きしない

### Persistence

- Git、workspace、external-fileをowner別のstorage routeへ分離した
- lifecycle debounce keyへ`external-file`を含める
- target kindとcontext kindの整合性をrepository層で検証する
- contextとGlobalの完全snapshot CASを全ownerへ適用する
- CAS failure時に範囲、baseline、一部sourceだけを部分保存しない

### Extension接続と文書

- 通常エディタのcommandとdecorationを同じdocument owner routerへ接続した
- workspace外を一律拒否する処理を廃止した
- READMEをGit ownership、external-file、UNC、現行制限へ同期した
- 設計書をIssue単位ではなく機能単位の`document-context-routing.md`へ整理した

## TDD・CI証跡

CIは既存workflowの失敗時診断artifact収集を使用した。workflowにはログ、生成物、`src`、`test`、設定ファイルを収集する処理が既にあったため変更していない。

主なRed:

- run `30090082687`: lint failure
- run `30090730806`: external descriptor整理後のcompile failure
- run `30091334042`: 既存unit fixture failure
- run `30093664051`: external snapshot descriptor導入後のfixture compile failure
- run `30137797858`: baseline metadata更新漏れを再現
- run `30144211855`: 空baseline未記録と複数commitを再現
- run `30144381827`: reconciliation method境界の型絞り込みfailure

各failureでは`ci-failure-diagnostics-<run>-1` artifactを確認した。

コードGreen:

- head: `365e8a1f76cf92a12c193c7d02bdeab06810911c`
- workflow run: `30144514053`
- Build、Lint、Unit、Temporary Git integration、Mock GitHub integration、VS Code Extension Host: success

設計書整理後の最終headとworkflow runはPR本文とPRコメントへ記録する。

## 主な回帰テスト

- workspace外Git fileがbranch contextになる
- workspace内Git fileでもGit ownerが優先される
- Windows Git pathのdrive、case、separator variationが同一File IDになる
- Git inspection failureをnon-Gitへfallbackしない
- non-Git workspaceはworkspace persistenceを維持する
- external UNC authorityをidentityへ保持する
- external-file stateを再起動後に復元する
- externalからworkspace、workspaceまたはexternalからGitへ範囲を移行する
- content hash不一致時は移行しない
- empty baseline後の追加、解除、再追加を反映する
- 初回昇格と複数sourceを1回のCASへ集約する
- commit failure時に部分保存しない

## Scope外

- Pull Request context resolver
- revision間mapping
- edit、rename、move mapping
- snapshot diffによる内容不一致時の移行
- 履歴保存と閲覧

これらが未接続の場合、既存状態を新revisionまたは不一致内容へ無条件に再ラベルしない。

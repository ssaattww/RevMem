# Review State Storage

## 1. 目的

本書は、document ownerごとのレビュー状態の保存先、識別子から保存領域へのmapping、完全snapshotの永続化境界を定義する。

ownerの決定規則は`document-context-routing.md`、owner変更時の状態移行は`owner-reconciliation.md`で定義する。

## 2. 共通原則

- context stateとRepository Global stateは同じrepository identityに属する
- 更新はcontextとGlobalの完全snapshotを一体として扱う
- atomic committerは`expected`と現在snapshotを比較し、両stateを同時に置換する
- contextだけ、Globalだけを更新するAPIを公開しない
- stale expectationは拒否し、部分保存しない
- content hash、revision、line count、current pathが現在documentと一致しないfile stateは、利用前に無効化する

## 3. Git repository storage

Git ownerの状態はVS Codeの`globalStorageUri`配下へrepository単位で保存する。

```text
globalStorageUri/
  repositories/
    <repository-id-hash>/
      manifest.json
      contexts/
      global-state/
      history/
      snapshots/
      cache/
      lock
```

workspace内外で保存先を変えない。同じRepository IDを持つcloneは同じ論理repositoryとして扱う。

### 3.1 保存対象

- branch context
- detached HEAD context
- 将来接続されるpull-request context
- repository単位のGlobal review state
- owner reconciliation metadata

## 4. Non-Git workspace storage

Git working treeに所属しないworkspace documentは、workspaceの`ExtensionContext.storageUri`を使用する。

```text
storageUri/
  workspace-state.json
  history/
  snapshots/
  lock
```

workspace contextは複数fileで共有する。対象file stateが存在しないことと、workspace context自体が存在しないことを区別する。

## 5. External-file storage

Git working treeにもworkspaceにも所属しないdocumentは、canonical document URIから導出したrepository identityごとに保存する。

```text
globalStorageUri/
  external-files/
    <external-repository-id-hash>/
      manifest.json
      contexts/
      global-state/
      history/
      snapshots/
      cache/
      lock
```

VS Codeの`globalStorageUri`とRevMemのGlobal確認済みlayerは別概念である。external-file contextとGlobal stateの両方を上記rootへ保存する。

canonical URIはハッシュだけでなく、context descriptorとfile `currentPath`にも保存する。

## 6. 初期化と読み込み

writable sessionを開くとき:

1. ownerとrepository targetを解決する
2. 完全snapshotを読み込む
3. snapshotがなければ空のcontext stateとGlobal stateを初期保存する
4. repository、context、schema、revision identityを検証する
5. 現在documentに対してstaleなfile stateだけを除去する
6. detached cloneをsessionへ返す

read-only decorationでは未保存snapshotを作成しない。stale file stateは返却するcloneから除外してよいが、読み込みだけでdiskを変更しない。

## 7. Atomic transaction

review operationとowner reconciliationは、次のtransaction contractを使用する。

```text
expected:
  complete context state
  complete Global state

next:
  complete context state
  complete Global state
```

committerは次を保証する。

- `expected`が現在値と一致する場合だけ置換する
- contextとGlobalを両方置換するか、どちらも置換しない
- stale writeを成功扱いしない
- failure後に部分的なnext stateを公開しない

owner reconciliationでは、初回昇格範囲、全source delta、全baselineを同じ`next`へ含める。詳細は`owner-reconciliation.md`に従う。

## 8. Failure handling

- load failure: sessionを返さない
- schemaまたはidentity不一致: 保存済みstateを別ownerへ流用しない
- initial save failure: sessionを返さない
- CAS conflict: 再読込または操作再試行を要求する
- persistence failure: 成功表示しない
- reconciliation failure: reconciliation前snapshotを維持する

## 9. 検証条件

- Git ownerが`globalStorageUri/repositories`へ保存される
- workspace内外のGit fileが同じrepository storage routeを使用する
- non-Git workspace stateがworkspace storageへ保存される
- external-file stateが`globalStorageUri/external-files`へ保存される
- canonical URIがexternal stateから復元できる
- contextとGlobalが1回のatomic commitで更新される
- stale expectationで両stateとも更新されない
- decoration readが未保存resourceを初期化しない
- content hashまたはrevision不一致のfile stateを現在documentへ再ラベルしない

# Issue #13 Owner Reconciliation 設計追補 R4

## 1. 文書情報

- 対象Issue: #13 ワークスペース外のファイル対応
- 対象PR: #15
- 基準文書: `doc/design/issue-13-document-context-routing.md`
- 修正対象: 基準文書7.4「復旧時reconciliation」、7.5「書き込み順」
- 修正種別: 規範的追補

本書と基準文書7.4・7.5が競合する場合、owner reconciliationのbaseline確立、初回昇格、複数source集約、commit境界には本書を優先する。

## 2. 空baseline

lower ownerのcontextが存在し、現在documentに対応するfile stateがcontext・Globalの両方に存在しない場合、そのdocumentの確認済み集合は確実な空集合である。

上位ownerを開いた時点で、次の空snapshotを`ownerReconciliation`へ記録する。

```text
source owner
source repository/context/file ID
現在content hash
現在line count
reviewed = []
source context createdAt
source context updatedAt
```

lower ownerのcontext作成時刻が古くても、対象file state不在は曖昧状態として扱わない。空baseline確立後にfallback側で対象file stateが新規作成された場合、追加差分は次のように計算できる。

```text
追加差分 = 現在source - []
解除差分 = [] - 現在source = []
```

空baseline確立後の追加、解除、再追加は、通常のbaseline差分として処理する。

lower ownerのcontext自体が存在しない場合はsource snapshotを作成しない。存在しないownerを空集合として推測しない。

## 3. 初回昇格の単一CAS

lower ownerから上位ownerへの初回昇格では、確認済みintervalとsource baselineを別々にcommitしない。

処理順は次のとおりとする。

1. 上位ownerを初期化または読み込み、現在snapshotを取得する
2. base routingが提案する初回interval昇格transactionを永続化せずメモリに捕捉する
3. 全lower ownerをread-onlyで読み込む
4. 各sourceの追加差分、解除差分、次baselineをメモリ上の完全snapshotへ適用する
5. 上位ownerの初期snapshotを`expected`、全差分と全baselineを含むsnapshotを`next`として、実repositoryへ1回だけCAS commitする
6. commit成功後だけ新owner sessionを返す

初期owner storageの作成、または現在contentに対してstaleな上位file stateの除去は、reconciliation transactionに先行するowner初期化・certainty処理である。lower ownerのinterval昇格とbaseline記録は、必ず同じCAS transactionへ含める。

## 4. 複数sourceの集約

Git ownerへ移行する場合、workspaceとexternal-fileの両sourceが存在し得る。sourceごとに実repositoryへcommitしてはならない。

```text
planned context/global snapshot
  ← workspace delta + workspace baseline
  ← external-file delta + external-file baseline
  ↓
1回のCAS commit
```

sourceの評価順は次のとおりとする。

1. workspace
2. external-file

各sourceは直前sourceを適用済みのplanned snapshotに対してdeltaを計算する。すべてのsourceを計画した後、完全なcontext・Global snapshotを1回commitする。

## 5. 失敗時の契約

最終CAS commitが失敗した場合:

- 上位ownerへ昇格対象intervalだけを残さない
- `ownerReconciliation` baselineだけを残さない
- 複数sourceの一部だけを反映しない
- 成功したsessionを返さない
- lower owner stateは変更しない

上位ownerの初期空snapshotが既に作成されている場合、その空snapshotは残ってよい。ただし昇格intervalとbaselineは両方とも存在しない状態でなければならない。

## 6. baseline更新

baseline省略は、次の全項目が現在snapshotと一致する場合だけ許可する。

- source owner
- source repository/context/file ID
- content hash
- line count
- source createdAt
- source updatedAt
- reviewed intervals

intervalが同じでもmetadataが変化した場合は、intervalを変更せずbaselineだけを最終CASの`next.contextState`へ含める。

## 7. テスト条件

- 別fileによって古いworkspace contextが作成済みでも、対象file state不在を空baselineとして記録する
- 空baseline後にfallback側で初めて追加した範囲をGit復旧時に反映する
- 空baseline後の解除と再追加が安定して差分反映される
- 初回workspaceからGitへの昇格で、intervalとbaselineの実CAS commit回数が1回である
- 初回昇格commit失敗時、Git ownerにintervalだけまたはbaselineだけが残らない
- workspaceとexternal-fileの両sourceが存在しても実CAS commit回数が1回である
- 複数sourceの全deltaと全baselineが同じ`next` snapshotに含まれる
- content hash変更後のmetadata-only baseline更新と、次回fallback追加が正しく反映される

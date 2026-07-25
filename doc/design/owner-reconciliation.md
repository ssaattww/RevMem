# Owner Reconciliation

## 1. 目的

本書は、documentのactive ownerが変化した場合に、下位ownerの確認済み範囲を上位ownerへ確実かつatomicに移行する規則を定義する。

ownerの解決規則は`document-context-routing.md`、保存先とtransaction contractは`review-state-storage.md`で定義する。

## 2. Owner優先順位

```text
pull-request > Git branch/detached > non-Git workspace > external-file
```

高いownerが利用可能になった時点で、以後のactive writeは高いownerだけへ行う。旧ownerへの恒久的な二重書き込みは行わない。

## 3. 移行元候補

Git ownerへ移行するとき:

1. 同じdocumentのworkspace state
2. 同じcanonical URIのexternal-file state

workspace ownerへ移行するとき:

1. 同じcanonical URIのexternal-file state

移行元候補はすべてread-onlyで読み込んでから、新ownerのnext snapshotを計算する。候補ごとに永続化commitを分けてはならない。

## 4. 確実性条件

次をすべて満たすsourceだけを移行または再調整の対象とする。

- 現在のcontent hashが一致する
- 現在のline countが一致する
- sourceのfile stateがsource revisionに対して確実である
- targetのfile stateがtarget revisionに対して確実である

不一致または曖昧な場合は範囲を変更しない。revision mappingまたはsnapshot diff mappingが確実に対応付けた範囲だけを移行できる。

## 5. Source baseline

上位contextはlower ownerごとに、最後に確実に確認したsource snapshotを`ownerReconciliation` metadataとして保持する。

baselineは次を含む。

- source owner
- source Repository ID
- source Context ID
- source File ID
- content hash
- line count
- reviewed intervals
- source context createdAt
- source updatedAt

baseline省略は、上記すべてが現在source snapshotと一致する場合だけ許可する。intervalが同じでもmetadataが変化した場合はbaselineを更新する。

## 6. 空baseline

lower owner contextが存在し、現在documentに対応するfile stateがcontext・Globalの両方に存在しない場合、現在の確認済み集合は確実な空集合である。

この場合も次のsource snapshotをbaselineとして記録する。

```text
reviewed = []
content hash = current content hash
line count = current line count
source identity and timestamps = current source context
```

lower owner context自体が存在しない場合はbaselineを作成しない。存在しないownerを空集合として推測しない。

空baseline確立後にfallback側でfile stateを新規作成した場合、追加差分を`current source - empty`として計算する。解除と再追加も通常のbaseline差分として扱う。

## 7. Baseline差分

共通baselineがある場合:

```text
追加差分 = 現在source - 前回source snapshot
解除差分 = 前回source snapshot - 現在source
移行先next = (現在移行先 - 解除差分) + 追加差分
```

これにより、fallback側の追加と解除を反映しつつ、target側で既に解除した範囲を古いsourceの単純unionで復活させない。

## 8. 初回reconciliation

baselineがない場合は次の保守規則を使用する。

- targetに対象file stateがない: 現在sourceを初期移行し、baselineを同じnext snapshotへ記録する
- sourceとtargetのintervalが一致する: intervalを変えずbaselineだけを記録する
- source contextがtarget fileの最終更新後に新規作成された: sourceの追加分だけを移行し、baselineを記録する
- その他のlegacyまたは曖昧状態: intervalを変更せず現在sourceをbaselineとして記録する

共通baselineがない状態でfallback側に行われた解除は、由来を安全に判定できないためtargetへ推測反映しない。baseline確立後の解除だけを差分として反映する。

## 9. 複数sourceの集約

複数のlower ownerが存在する場合は、全sourceのdeltaと次baselineをメモリ上の同じplanned context・Global snapshotへ順次適用する。

```text
planned snapshot
  ← workspace delta + workspace baseline
  ← external-file delta + external-file baseline
  ↓
1回のCAS commit
```

source評価順はworkspace、external-fileの順とする。各sourceは直前sourceを適用済みのplanned snapshotに対して評価する。

## 10. 初回昇格とatomicity

処理順:

1. 新owner stateを初期化または読み込み、必要ならstale file stateを先に無効化する
2. base owner resolverが初回昇格transactionを生成しても、直ちに永続化せずメモリ上へ捕捉する
3. 存在する全lower owner contextをread-onlyで読み込む
4. 初回昇格範囲、全source delta、全次baselineを1つの完全なnext context・Global snapshotへ集約する
5. reconciliation前の新owner snapshotを`expected`として、完全snapshot transactionを1回だけCAS commitする
6. commit成功後だけ、reconciliation済み新ownerをactive ownerとして返す

初回昇格範囲とbaselineを別commitにしてはならない。複数sourceのdeltaとbaselineもsource単位でcommitしてはならない。

## 11. Failure contract

最終CAS commitが失敗した場合:

- targetへ昇格範囲だけを残さない
- baselineだけを残さない
- 複数sourceの一部だけを反映しない
- 成功したsessionを返さない
- lower owner stateを変更しない

新ownerの初期空snapshotが作成済みの場合、その空snapshotは残ってよい。ただし昇格範囲とbaselineは両方とも存在しない状態でなければならない。

## 12. 検証条件

- external-file状態をworkspaceへ移行できる
- workspaceとexternal-file状態をGit ownerへ移行できる
- 既存Git stateがある復旧時もfallback側の追加を取り込める
- lower owner contextは存在するがfile stateがない場合、空baselineを記録する
- 空baseline後の追加、解除、再追加を反映できる
- baseline確立後のfallback解除を反映する
- baseline不在の曖昧な解除を推測反映しない
- content hashまたはline count不一致では移行しない
- metadata-onlyのbaseline更新を保存する
- 初回昇格範囲とbaselineを1回のCAS commitで保存する
- commit失敗時に範囲またはbaselineだけを残さない
- workspaceとexternal-fileの両sourceを1回のCAS commitへ集約する
- 複数source処理の途中失敗で一部sourceだけを保存しない

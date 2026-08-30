# Immutable revision review snapshot design

- 文書種別: 詳細設計
- 対象: Git revision間の確認済み範囲追従とexact revision復元
- 状態: 実装対象
- 関連: Issue #92 / PR #94

## 1. 目的

確認済み範囲を持つimmutable Git revisionへ後から戻った場合に、現在revisionから逆向きdiff mappingした結果ではなく、そのrevisionで最後に確定した確認状態を復元する。

例として、revision Aを全行確認済みにした後、AからB、BからCへ進み、それぞれの変更箇所を確認してCも全行確認済みにした場合を考える。Cからexact Aへ戻ったとき、AとCの差分を新たな未確認箇所として扱ってはならない。Aは以前に確認した同一immutable contentであるため、保存済みA snapshotが有効ならAで最後に確定した確認状態を復元する。

```text
A: 全行確認済み
A -> B: Aから変化した行だけ未確認
B: 全行確認済みに更新
B -> C: Bから変化した行だけ未確認
C: 全行確認済みに更新
C -> A: 保存済みexact A snapshotを復元し、Aは全行確認済み
```

## 2. 基本原則

### 2.1 Snapshot優先

revision遷移先について検証済みのexact snapshotが存在する場合、そのsnapshotを復元する。現在revisionから遷移先へdiff mappingしない。

遷移先snapshotが存在しない場合だけ、現在の確定状態をsourceとして既存のrevision mappingを行う。未変更部分だけを引き継ぎ、変更部分と追加部分を未確認にする。mapping後の確定状態を遷移先snapshotとして保存する。

### 2.2 Immutable identity

Git revision snapshot keyはlowercase full SHA-1またはfull SHA-256 commit object IDとする。branch、tag、`HEAD`、短縮SHA、revision rangeをkeyに使用しない。

GitHub PR contextはrepositoryとPR番号で継続し、modified側snapshotはPRのHEAD SHAで識別する。original側だけに存在する削除行は従来どおり`${baseSha}..${headSha}`の比較pairで識別する。

### 2.3 履歴と現在状態の分離

Append-only review historyをsnapshot復元の入力としてreplayしない。履歴はaudit evidenceであり、現在状態とrevision snapshotはstate repositoryが管理するauthoritative snapshotとする。

### 2.4 Fail closed

snapshotのschema、revision、file identity、path、line count、content hash、interval boundsのいずれかを検証できない場合、そのsnapshotを部分的に採用しない。不確実な範囲を確認済みにせず、通常のrevision mappingが安全に実行できる場合はmappingへ進み、mappingも成立しなければ未確認またはunresolvedとして扱う。

## 3. データモデル

### 3.1 Context revision snapshot

`ReviewContextState`は、現在の`files`とは別に、immutable revisionごとの確定Context状態を保持する。

```ts
interface ReviewContextRevisionSnapshot {
  schemaVersion: SchemaVersion;
  revisionId: string;
  files: Record<string, FileReviewState>;
  updatedAt: string;
}

interface ReviewContextState {
  // existing fields
  revisionSnapshots?: Record<string, ReviewContextRevisionSnapshot>;
}
```

snapshotの`files`はそのrevisionで確定したfile identity、path、line count、content hash、`modifiedReviewed`および既知の`originalReviewedByDiff`を保持する。snapshot内へ`revisionSnapshots`を再帰的に含めない。

### 3.2 Global revision snapshot

`RepositoryGlobalState`もimmutable revisionごとの確定Global状態を保持する。

```ts
interface RepositoryGlobalRevisionSnapshot {
  schemaVersion: SchemaVersion;
  revisionId: string;
  files: Record<string, GlobalFileReviewState>;
  updatedAt: string;
}

interface RepositoryGlobalState {
  // existing fields
  revisionSnapshots?: Record<string, RepositoryGlobalRevisionSnapshot>;
}
```

Global snapshotはrepository owner全体で共有し、同じrevisionへの後続操作があればそのrevision entryを最新の確定状態へ置換する。別revisionのentryを上書きしない。

### 3.3 Original側比較状態

Original側だけに存在する削除行または置換前行は、各`FileReviewState.originalReviewedByDiff[baseSha..headSha]`へ保持する。

同じHEADでBASEだけが変わった場合も、過去pairのentryを消去しない。PR進捗とdiff decorationは現在のexact pairだけを参照するため、過去pairを保持しても現在比較へ混入しない。

## 4. Snapshot更新規則

### 4.1 ユーザー操作

現在revision上で確認済みまたは確認済み解除が成功した場合、1回のatomic transactionで次を更新する。

1. 現在のContext `files`
2. 現在のGlobal `files`
3. Context `revisionSnapshots[currentRevision]`
4. Global `revisionSnapshots[currentRevision]`

Original側だけの操作でGlobalが変化しない場合も、Contextの現在revision snapshotは同じtransaction内で更新する。no-op、cancel、stale拒否、永続化失敗ではsnapshotを更新しない。

### 4.2 Revision遷移前

revision mappingまたはexact snapshot復元を開始する前に、sourceの現在状態がsource revision snapshotと一致していることを検証する。legacy state等でsource snapshotが未作成の場合は、現在状態からsource snapshotを作成する。

### 4.3 未知revisionへの遷移

遷移先のContextまたはGlobal snapshotが存在しない場合、そのlayerは現在状態からtarget revisionへmappingする。

- Context snapshotが存在しGlobal snapshotがない場合、Contextはexact snapshotを復元し、Globalだけmappingする。
- Global snapshotが存在しContext snapshotがない場合、Globalはexact snapshotを復元し、Contextだけmappingする。
- 両方存在する場合は両方を復元する。
- 両方存在しない場合は両方をmappingする。

各layerの結果は、最終的に同じContext/Global CAS transactionで公開する。片側だけ先に永続化してはならない。

### 4.4 Exact revisionへの復帰

遷移先snapshotを復元するときは、snapshot自身の`revisionId`とmap key、target descriptor、target immutable content evidenceを照合する。

検証後、current `files`をsnapshotのfile stateへ置換する。全revisionのsnapshot mapは保持し、復元したtarget entryも消さない。PR descriptor、Global `currentRevisionId`、各fileの`revisionId`をtarget revisionへ一致させる。

## 5. PR revision pair

PRでは次の2種類のidentityを分離する。

```text
modified/current review state: HEAD SHA
original-only review state:    BASE SHA..HEAD SHA
```

HEADがCで同じでもBASEがAからBへ変わる場合、modified側のC snapshotは共有する。Original側は`A..C`と`B..C`を別entryとして保持する。

PRのBASEまたはHEADが更新された後も、旧pairのdiff tabからの操作はstaleとして拒否する。Snapshotを保持していることは、旧tabから現在状態を書き換える権限を与えない。

## 6. A -> B -> C -> Aの期待動作

次のfileを例とする。

```text
A: AAA / BBB / CCC
B: AAA / BBB2 / CCC
C: AAA / BBB2 / CCC3
```

Aを全行確認済みにした時点で、Context/GlobalのA snapshotは全行確認済みとなる。

AからBへ初めて遷移した場合、B snapshotがないためAからBへmappingし、`BBB2`だけを未確認とする。Bを全行確認済みにするとB snapshotを更新する。

BからCへ初めて遷移した場合、C snapshotがないためBからCへmappingし、`CCC3`だけを未確認とする。Cを全行確認済みにするとC snapshotを更新する。

CからAへ戻る場合、A snapshotが有効ならCからAへのreverse mappingは行わず、A snapshotを復元する。表示は次のとおりとなる。

```text
A: AAA   確認済み
A: BBB   確認済み
A: CCC   確認済み
```

## 7. Legacy migration

`revisionSnapshots`が存在しない既存stateは、現在descriptorのrevisionについてのみ、現在の`files`からsnapshotをlazy作成する。

upgrade前に訪れた過去revisionの確認状態は、履歴から推測復元しない。そのrevisionへ初めて戻る時点ではsnapshot missとして現在revisionからmappingし、その結果を新しいsnapshotとして保存する。

既存の`schemaVersion` readerがoptional fieldを受理できない場合はschema versionを進め、旧versionから現在revision snapshotを作る明示migrationを追加する。未知future schemaは従来どおり拒否する。

## 8. Retention

初期実装では、正確性を優先して有効なrevision snapshotを自動削除しない。Context stateまたはrepository owner stateを明示削除する場合に、そのownerのsnapshotも同じ削除境界で削除する。

将来bounded retentionを導入する場合、削除済みsnapshotへの復帰はsnapshot missとして安全なmappingへfallbackする。保持上限によって別revisionのsnapshotを代用してはならない。

## 9. Atomicity and concurrency

Snapshot作成、復元、mapping、現在pointer更新は、既存Context/Global stateと同じstorage route、lock、complete snapshot CASを使用する。

CAS conflict時は最新stateと現在Git/PR descriptorを再読込し、source/target revisionおよびsnapshot hit/missを再判定する。競合前に作成したtarget snapshotを無条件に再利用しない。

Foreground open、poll、PR refreshのgenerationがstaleになった場合、現在state、revision snapshot、historyのいずれも更新しない。

## 10. History

Exact snapshot復元により現在stateが変化した場合、`context-revision-changed`とfile単位の`remapped-by-diff`相当eventを記録できる。ただしreasonは`exact-revision-snapshot-restored`として、diff mappingと区別する。

History eventはstate commit成功後に追加する。Snapshot hitであることを理由に履歴追加を省略せず、state commit失敗時にhistoryだけを追加しない。

## 11. テスト契約

最低限、次を固定する。

- Aを全確認、AからBへ初回遷移するとBの変更行だけ未確認になる
- Bを全確認、BからCへ初回遷移するとCの変更行だけ未確認になる
- Cを全確認後にAへ戻ると、CからAへreverse mappingせずAのexact snapshotを復元する
- Aへ戻った後に解除操作を行うとA snapshotだけが更新され、B/C snapshotは変化しない
- Aへ戻った後に再びCへ進むとCの最後に確定したsnapshotを復元する
- Context snapshot hitとGlobal snapshot miss、またはその逆をatomicに処理する
- 同じHEADで異なるBASE pairのmodified snapshotを共有し、original側rangeをpairごとに分離する
- 過去pairを保持しても現在PR進捗へ混入しない
- snapshot key/revision/file/path/hash/line count/interval不整合をfail closedで拒否する
- legacy stateから現在revision snapshotだけを作り、過去revisionをhistoryから推測しない
- concurrent updateまたはstale generationがsnapshotを公開しない
- exact snapshot復元と通常mappingを履歴reasonで区別する

## 12. 非目標

- Review history全件のreplayによる現在状態再構築
- 内容類似度による別revision snapshotの代用
- branch名、tag、短縮SHAをsnapshot identityにすること
- Snapshot miss時に変更行を確認済みと推測すること
- Snapshot保持を理由にstale diff tabからの操作を許可すること

# Diff editor selection projection design

- 文書種別: 詳細設計
- 対象: identity-bound diff editorの選択範囲確認操作
- 状態: 実装対象

## 1. 目的

Diff editorの左右どちらで選択しても、ユーザーが選んだ差分上の範囲を欠落なく確認済みまたは未確認へ変更する。

original側の選択は、original側にだけ存在する行だけでなく、modified側へ内容を変えずに存続する行も含む。存続行を無視せず対応するmodified側行へ投影し、削除行または置換前行だけを比較固有のoriginal側状態として保持する。

## 2. 前提となるidentity

操作は次のidentityがすべて一致するimmutable snapshotだけを対象とする。

- repository ID
- PR context ID
- file ID
- BASE SHA
- HEAD SHA
- original diff ID `${baseSha}..${headSha}`
- original/modifiedのdocument sideとrevision

PR context自体はrepositoryとPR番号で継続する。modified側の確認範囲は現在のHEAD revisionに属し、original側固有範囲はBASE/HEAD pairに属する。各commitへ独立した完全snapshotを保存しない。

## 3. 選択範囲の分類

### 3.1 Modified側

modified側で選択した行は、そのまま現在のmodified側座標として扱う。

- 確認: Contextの`modifiedReviewed`とGlobalの`reviewed`へ追加する
- 解除: Contextの`modifiedReviewed`とGlobalの`reviewed`から削除する

### 3.2 Original側

original側の選択範囲は、現在の検証済みdiffから次の2集合へ分割する。

1. modified側へ内容を変えずに存続する行
2. original側にだけ存在する削除行または置換前行

存続行は対応するmodified側座標へ投影し、ContextとGlobalを更新する。original側だけの行は`originalReviewedByDiff[originalDiffId]`を更新する。

1回の選択が両集合を含む場合、両方を同じ操作として処理する。置換前の削除行を選んだことによって、置換後の追加行を確認済みにしてはならない。

## 4. Original-to-modified mapping

Application層へ渡すmappingは、0始まり半開区間の連続segmentで表す。

```ts
interface OriginalToModifiedLineMapping {
  readonly originalStartLine: number;
  readonly modifiedStartLine: number;
  readonly lineCount: number;
}
```

各segmentは、同じ内容で存続する連続行を表す。original側区間との交差部分は、segment内offsetを保ってmodified側へ写像する。

```text
mappedStart = modifiedStartLine + (selectedStart - originalStartLine)
```

mappingは次の証拠だけから作る。

- 最初のhunkより前のold/new gap
- hunk内でoldLineとnewLineの両方を持つcontext行
- hunk間のold/new gap
- 最後のhunkより後のold/new tail

`deletion`にはmodified側mappingを作らない。`addition`にはoriginal側sourceを作らない。削除行と追加行を内容、近接、同一行数等から推測対応させない。

old/new gapまたはtailの長さが一致しない場合、hunk座標が後退・重複する場合、context行の座標が不連続な場合、またはmappingが文書範囲外になる場合はsnapshotを拒否する。zero-count hunkはGit unified diffのanchor座標として扱い、存在しない行をmappingへ含めない。

## 5. Atomic state transaction

original側の混在選択は、次を1つのcompare-and-swap transactionで更新する。

- Context `modifiedReviewed`
- Global `reviewed`
- Context `originalReviewedByDiff[originalDiffId]`

いずれかだけを先にcommitする二段階更新は禁止する。commit失敗時は全状態を不変に保つ。確認または解除後のsemantic stateが変わらない場合はno-opとし、commitと履歴追加を行わない。

永続化schemaは既存の`modifiedReviewed`、`reviewed`、`originalReviewedByDiff`を再利用するため変更しない。

## 6. History

混在選択のtransactionが成功した場合、実際に変化したsideだけを記録する。

1. modified側event。ContextとGlobalのbefore/afterを保持する
2. original側event。`originalDiffId`とoriginal範囲のbefore/afterを保持する

順序はmodified、originalで固定する。state commit前、cancel、no-op、stale拒否ではeventを追加しない。

## 7. UI provenanceとstale拒否

PR Progressから実際に開いた正確なdiff tab instanceだけに、次の4操作をeditor context menuへ表示する。

- 選択範囲を確認済みにする
- 選択範囲の確認済みを解除する
- ファイル全体を確認済みにする
- ファイル全体の確認済みを解除する

同じURIまたはmetadataを持つ別tab、PR Progress以外から開いたdiffへ権限を伝播しない。既存の`editor/context` contribution数は増やさず、既存commandの`when`条件へ統合する。

menu表示後であっても、command実行時に現在登録されたsnapshotとdocument identityを再検証する。HEAD追加、BASE変更、rebase、force-push等で不一致になった古いtabはstaleとして拒否し、Context、Global、original範囲、履歴を変更しない。

## 8. テスト契約

最低限、次を固定する。

- modified側選択の確認と解除
- original側の未変更行だけを選んだ場合のmodified/Global投影
- original側の削除行だけを選んだ場合のoriginal固有更新
- original側で未変更行と削除行を同時選択した場合の1 transaction更新
- 混在選択の部分解除と区間分割
- 複数hunk、hunk内context、hunk間・前後、追加、削除、置換、zero-count hunkのmapping
- mixed transactionの履歴順序と変化しないsideのevent非生成
- exact PR Progress tabだけで4操作が表示されること
- 同一URIの別tabとsnapshot更新後の古いtabが状態を変更できないこと

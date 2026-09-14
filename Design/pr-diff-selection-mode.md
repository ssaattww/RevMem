# PR差分の確認単位切替

## 目的

PR差分で選択範囲を確認済み/未確認にする際の単位を、設定で切り替えられるようにする。
従来の片側単位の動作は維持し、必要な利用者だけ変更ブロック単位の左右連動を有効化できるようにする。

## 設定

新しい設定キーを `reviewRange.prDiffSelectionMode` とする。
型は文字列enumとし、許可値は次の2つとする。

- `side`: 現在の動作。操作したdiff側の選択範囲だけを対象にする。
- `block`: 選択範囲が属する変更ブロックを単位として、original/modified両側を対象にする。

デフォルトは `side` とする。既存利用者の挙動を変更しないためである。
この設定はPR Progressから開いたRevMem管理下のPR差分にだけ適用する。
通常エディタ、任意のVS Code diff、ファイル全体の確認/解除には適用しない。

## 設定境界

`ReviewRangeConfiguration` にPR差分の選択モードを追加し、VS Code設定APIからapplication層へ文字列enumとして渡す。
製品ロジックがVS Code APIを直接参照して分岐する構造にはしない。
PR runtimeは設定値をsession生成時に読み取り、その操作中は同じ値を使用する。
不正値は設定読込境界で拒否し、暗黙に別モードへフォールバックしない。

## `side` モード

現在のselection処理をそのまま維持する。
modified側の選択はContextのmodified範囲とGlobalだけを更新する。
original側の選択は、既存の安全なunchanged-line mappingとoriginal-only deletionの処理を維持する。
変更ブロック境界の抽出は行わない。

## `block` モード

変更ブロックは「context行またはhunk境界で区切られた連続する追加・削除行」と定義する。
同一hunk全体をブロックとはしない。context行を挟む別変更を巻き込まないためである。

選択が一つ以上の変更ブロックに重なった場合、そのブロックのoriginal側削除行とmodified側追加行を対象とする。
追加のみのブロックではmodified側だけ、削除のみのブロックではoriginal側だけを対象とする。
反対側に存在しない行を推測・生成しない。
replacementのdeleted行とadded行を1行ずつ対応付ける推測は行わず、ブロック全体の対応だけを扱う。

context行だけを選択した場合は、既存のunchanged-line mappingに従う。
変更行とcontext行を同時選択した場合は、変更ブロック分とcontext分を正規化して一つのtransactionへ統合する。
複数selectionが同じブロックへ重なっても、そのブロックは1回だけ対象化する。

## 正常系ケース表

以下の「元」はoriginal側、「先」はmodified側を表す。
確認済み化と解除は対象範囲の決め方を共通とし、解除では同じ対象を未確認へ戻す。

| 元側 | 先側 | 操作位置・選択 | `side` の動作 | `block` の動作 |
| --- | --- | --- | --- | --- |
| 変更行あり | 変更行あり | 元側の変更行を1行以上選択 | 選択した元側だけを更新する | 重なった変更ブロック全体を元・先へ展開する |
| 変更行あり | 変更行あり | 先側の変更行を1行以上選択 | 選択した先側だけを更新する | 重なった変更ブロック全体を元・先へ展開する |
| 変更行あり | 変更行あり | 変更ブロックの一部だけを選択 | 選択範囲だけを更新する | 選択行数に関係なく、その変更ブロック全体を元・先へ展開する |
| 変更行あり | 変更行あり | 元と先の行数が同じ置換 | 操作した側の選択範囲だけを更新する | 行単位対応を推測せず、元ブロック全体と先ブロック全体を更新対象にする |
| 変更行あり | 変更行あり | 元と先の行数が異なる置換 | 操作した側の選択範囲だけを更新する | 行数差に関係なく、元ブロック全体と先ブロック全体を更新対象にする |
| 変更行なし | 変更行あり | 先側の追加行を1行以上選択 | 選択した先側だけを更新する | 追加ブロック全体を先側だけ更新対象にする |
| 変更行あり | 変更行なし | 元側の削除行を1行以上選択 | 選択した元側だけを更新する | 削除ブロック全体を元側だけ更新対象にする |
| context行あり | context行あり | 元側のcontext行だけを選択 | unchanged-line mappingで対応する実在行を更新する | `side` と同じ。変更ブロックへ拡張しない |
| context行あり | context行あり | 先側のcontext行だけを選択 | 選択した先側を更新する | `side` と同じ。変更ブロックへ拡張しない |
| 変更行あり | 変更行あり | 元側で変更行と隣接context行を同時選択 | 既存規則で選択範囲を更新する | 変更行はブロック全体へ拡張し、context行はunchanged-line mappingで統合する |
| 変更行あり | 変更行あり | 先側で変更行と隣接context行を同時選択 | 既存規則で選択範囲を更新する | 変更行はブロック全体へ拡張し、context行はmodified範囲として統合する |
| 複数ブロック | 複数ブロック | 1回の選択が複数変更ブロックに重なる | 選択範囲だけを更新する | 重なった各変更ブロックを独立に展開し、1回のtransactionへ統合する |
| 同一ブロック | 同一ブロック | 複数selectionが同じ変更ブロックに重なる | 各selectionを正規化して更新する | 同一ブロックは1回だけ対象化する |
| 異なるブロック | 異なるブロック | 複数selectionが別々の変更ブロックに重なる | 各selectionを正規化して更新する | 各変更ブロックを独立に展開して統合する |
| 変更行あり | 変更行あり | ファイル全体を確認済み/解除 | 現行のファイル全体操作を行う | 設定値に関係なく現行のファイル全体操作を行う |

## 選択範囲の正規化とブロック接触判定

`block` モードでもraw selectionを直接hunkへ当てない。
必ず既存の `selectionsToLineIntervals` で、操作側のline countを使ってzero-based half-open intervalへ正規化してから判定する。
変更ブロックとの接触は、正規化後intervalと操作側ブロックintervalの積集合が1行以上ある場合だけ成立する。

| 操作側 | raw selection | 正規化結果 | `block` の判定 | 確認/解除 |
| --- | --- | --- | --- | --- |
| 元側 | 変更行上のカーソルのみ | カーソル行1行 | その変更ブロックに重なる | 同じ規則 |
| 先側 | 変更行上のカーソルのみ | カーソル行1行 | その変更ブロックに重なる | 同じ規則 |
| 元側 | context行上のカーソルのみ | カーソル行1行 | 変更ブロックには重ならずcontext処理だけ | 同じ規則 |
| 先側 | context行上のカーソルのみ | カーソル行1行 | 変更ブロックには重ならずmodified処理だけ | 同じ規則 |
| 元側 | 順方向選択 | 文書順の半開区間 | 正規化後の重なりだけを見る | 同じ規則 |
| 元側 | 同じ範囲の逆向き選択 | 順方向と同じ半開区間 | 順方向と同じブロック集合 | 同じ規則 |
| 先側 | 順方向選択 | 文書順の半開区間 | 正規化後の重なりだけを見る | 同じ規則 |
| 先側 | 同じ範囲の逆向き選択 | 順方向と同じ半開区間 | 順方向と同じブロック集合 | 同じ規則 |
| 元側 | 次ブロック先頭行の列0で終わる非空選択 | 終点行を含まない | 次ブロックには重ならない | 同じ規則 |
| 先側 | 次ブロック先頭行の列0で終わる非空選択 | 終点行を含まない | 次ブロックには重ならない | 同じ規則 |
| 元側 | 空のselection配列 | 空interval配列 | sessionを開かずno-op | commit・履歴なし |
| 先側 | 空のselection配列 | 空interval配列 | sessionを開かずno-op | commit・履歴なし |

複数selectionは `selectionsToLineIntervals` の結果を先に正規化・結合し、その後にブロックとの重なりを判定する。
列0終端で除外された行を「近接している」ことだけでブロック対象へ含めてはならない。

## `block` モードの状態定義

変更ブロックは、永続化上は次の独立した状態成分を持つ。

- original: `originalReviewedByDiff[diffId]` 上の対象削除行。
- modified Context: `modifiedReviewed` 上の対象追加行。
- Global: `globalState.files[fileId].reviewed` 上の対象追加行。

各成分は、対象となる実在行に対して次の3状態を取る。

- `未確認`: 対象行が1行も確認済みでない。
- `一部確認`: 対象行の一部だけが確認済みである。対象が1行ならこの状態は発生しない。
- `全確認`: 対象行がすべて確認済みである。

original行が存在しない追加ブロックではoriginal成分を持たない。
modified行が存在しない削除ブロックではmodified ContextとGlobalの成分を持たない。
存在しない成分を`未確認`とは扱わない。

確認済みにする操作では、存在する全成分を`全確認`へ揃える。
解除する操作では、存在する全成分を`未確認`へ揃える。
操作した側がすでに目的状態でも、別成分に変化が必要ならno-opにはしない。

### 各状態成分の遷移

original、modified Context、Globalの各成分は、存在する場合に次の規則で遷移する。

| 現在状態 | 確認済みにした後 | 確認操作で変化するか | 解除した後 | 解除操作で変化するか |
| --- | --- | --- | --- | --- |
| 未確認 | 全確認 | 変化する | 未確認 | 変化しない |
| 一部確認 | 全確認 | 変化する | 未確認 | 変化する |
| 全確認 | 全確認 | 変化しない | 未確認 | 変化する |

この表を存在する全成分へ独立に適用した結果がtransactionのnext stateとなる。
PRの元側・先側だけを見てcommit有無を決めてはならない。

### commitと履歴の決定

ブロック展開後のexpectedとnextをContextとGlobalの両方について比較してsemantic changeを判定する。
modified履歴はmodified ContextまたはGlobalのどちらか一方でも変化した場合に1イベント記録し、ContextとGlobal双方のbefore/afterを保持する。
original履歴はoriginal成分が変化した場合だけ記録する。

| original変化 | modified Context変化 | Global変化 | commit | modified履歴 | original履歴 |
| --- | --- | --- | --- | --- | --- |
| なし | なし | なし | しない | なし | なし |
| あり | なし | なし | する | なし | あり |
| なし | あり | なし | する | あり | なし |
| なし | なし | あり | する | あり | なし |
| なし | あり | あり | する | あり | なし |
| あり | あり | なし | する | あり | あり |
| あり | なし | あり | する | あり | あり |
| あり | あり | あり | する | あり | あり |

### Globalを含む受入エッジケース

次のケースは操作元が元側でも先側でも同じ最終状態とする。

| original | modified Context | Global | 操作 | 最終状態 | commit・履歴 |
| --- | --- | --- | --- | --- | --- |
| 全確認 | 全確認 | 未確認 | 確認済みにする | 全成分が全確認 | commitする。modified履歴だけ記録する |
| 未確認 | 未確認 | 全確認 | 解除する | 全成分が未確認 | commitする。modified履歴だけ記録する |
| 未確認 | 全確認 | 未確認 | 確認済みにする | 全成分が全確認 | commitする。modified履歴とoriginal履歴を記録する |
| 全確認 | 未確認 | 全確認 | 解除する | 全成分が未確認 | commitする。modified履歴とoriginal履歴を記録する |
| 全確認 | 全確認 | 全確認 | 確認済みにする | 全成分が全確認 | semantic no-op。commit・履歴なし |
| 未確認 | 未確認 | 未確認 | 解除する | 全成分が未確認 | semantic no-op。commit・履歴なし |

実装時はoriginal、modified Context、Globalの3状態の直積を確認済み化・解除の双方でテストする。
表に個別列挙していない組み合わせも、各状態成分の遷移表とcommit・履歴表から一意に期待値を導出する。

### 追加のみ・削除のみ

追加のみではmodified ContextとGlobalだけを上記規則で揃える。
削除のみではoriginalだけを上記規則で揃える。
存在しない成分に状態、commit理由、履歴を生成しない。

## 変更ブロック生成と接続契約

### ブロック生成の責務

変更ブロックの導出は `application/review-commands` の純粋なprojectionとして実装する。
候補ファイル名は `diff-change-block-projection.ts` とし、PR runtimeやstate serviceへhunk走査を重複実装しない。

projectionはexactな `originalLineCount`、`modifiedLineCount`、完全なimmutable `DiffHunk[]` を入力に取り、各ブロックを次の形で返す。

```ts
interface DiffChangeBlock {
  readonly original?: LineInterval;
  readonly modified?: LineInterval;
}
```

context行またはhunk境界でブロックを閉じる。
originalとmodifiedの一方が存在しないaddition-only/deletion-onlyを許可するが、両方が存在しないブロックは生成しない。
既存のoriginal-to-modified unchanged-line mappingとは別projectionとし、replacement行の対応推測には使用しない。
既存hunkの座標・count検証と同等の不変条件を満たさない入力は拒否する。

### PR runtimeとsession

`PullRequestReviewRuntime.openSession` はexact base/head、対象file、hunk、両側line countをすでに所有するため、ここで変更ブロックprojectionを生成する。
`DiffEditorReviewStateSession` には次の入力を追加する。

```ts
readonly selectionMode: "side" | "block";
readonly changeBlocks?: readonly DiffChangeBlock[];
```

`selectionMode === "block"` のPR sessionでは `changeBlocks` を必須とする。
`selectionMode === "side"` では既存経路をそのまま使い、変更ブロックprojectionへ依存しない。
設定変更は次回sessionから反映し、開いたsessionの途中で動作単位を切り替えない。

PR以外で同じ `DiffEditorReviewCommandService` を使うlocal base/head runtimeは `selectionMode: "side"` を明示し、`changeBlocks` を渡さない。
したがって新しい`block`動作を共有サービスの全利用箇所へ暗黙に広げない。

### command serviceの処理順

`DiffEditorReviewCommandService` は次の順序を守る。

1. focused sideとline countを取得する。
2. raw selectionsを `selectionsToLineIntervals` で正規化する。
3. 空ならsessionを開く前にno-opを返す。
4. sessionを開き、line countとimmutable comparison identityを既存どおり検証する。
5. `side` なら現行処理を行う。
6. `block` なら正規化済みintervalと操作側のchange block intervalの積集合で対象ブロックを決める。
7. 変更ブロック分と、必要なcontext行の既存projectionを統合してstate mutation inputを作る。

### 左右ブロック更新用のstate API

既存の `OriginalSelectionReviewRangeMutationInput` はoriginal側起点のunchanged-line mappingを表す契約なので、modified側起点の変更ブロック操作へ流用しない。
操作元のsideを偽装せず、変更ブロック専用の入力と操作識別値を追加する。

候補契約は次のとおりとする。

```ts
interface DiffBlockReviewRangeMutationInput extends ReviewStateMutationInput {
  readonly diffId: string;
  readonly originalLineCount: number;
  readonly originalIntervals: readonly LineInterval[];
  readonly modifiedIntervals: readonly LineInterval[];
  readonly invokedFrom: "original" | "modified";
}
```

state serviceには `markDiffBlockReviewed` / `unmarkDiffBlockReviewed` を追加する。
transaction operationは `mark-diff-block-reviewed` / `unmark-diff-block-reviewed` とし、既存のoriginal selection操作と区別する。
`invokedFrom` は操作起点の証拠であり、更新対象や履歴対象を決める条件には使わない。

modifiedIntervalsはContextの`modifiedReviewed`とGlobalの`reviewed`へ同じ範囲を追加/削除する。
originalIntervalsは`originalReviewedByDiff[diffId]`へ追加/削除する。
これらを1つのexpected/next transactionにまとめ、CAS境界で原子的にcommitする。
永続化schemaは追加しない。

### historyの分岐契約

`ReviewHistoryRecorder` は新しいblock operationを明示的に扱う。
履歴対象は `invokedFrom` ではなく、transactionのexpected/next差分で決める。

- Contextのmodified範囲またはGlobal範囲が変化した場合、modifiedイベントを1件記録する。
- original範囲が変化した場合、対象`diffId`のoriginalイベントを1件記録する。
- 両方変化した場合、既存の複合更新と同様にmodifiedイベントを先に、originalイベントを後に記録する。
- どの成分にもsemantic changeがなければcommitせず、履歴も記録しない。

modifiedイベントは `rangeRepresentation: "context-and-global"` を使い、Globalだけが変化した場合もContextとGlobal双方のbefore/afterを保持する。
これによりPR両側が既に目的状態でもGlobalだけが変わる操作を履歴から失わない。

### unchanged-line mappingとの分離

既存の `createOriginalSelectionReviewPlan` はunchanged original行をmodified行へ投影するためだけに使用する。
変更ブロックprojectionはreplacement/addition/deletionのブロック連動だけを扱う。
両者を同じmappingとして表現せず、command planの統合段階でinterval集合だけを合成する。

## 更新の原子性と表示

`block` で複数の状態成分が対象になる場合、すべてを1つのtransactionで更新する。
途中でoriginalだけ、modified Contextだけ、Globalだけが新状態になる正常状態は作らない。
PR Progressと装飾の再計算はtransaction完了後の同一状態を参照する。

PR Progressは既存どおり、追加行をContextの`modifiedReviewed`、削除行を`originalReviewedByDiff[diffId]`から集計する。
GlobalはPR Progressの分子には直接加算しないが、同じmodified実在行のrepository-wide stateとしてblock操作に同期する。

## stale safety

ブロックprojectionは現在のPR runtimeが保持するexact base/headと対象fileのimmutable hunksだけから生成する。
古いdiff URI、別context、別base/head、別file identityは既存のsession検証境界で拒否する。
state transactionのcommit時にも現在登録されているimmutable PR snapshotとの一致を既存どおり再確認する。
設定変更時に既存の保存状態を書き換えず、次回の操作単位だけを変える。

## テストへの対応

本設計の各表を実装時の受入条件とする。
テストファイル名・テスト名は機能責務で命名し、作業管理番号を含めない。

実装時は少なくとも次を先にRedとして固定する。

- 設定enum、default、manifest、PR runtimeへの設定伝播。
- 正常系ケース表の各行。
- original / modified Context / Globalの状態直積について確認済み化と解除の期待状態、commit有無、履歴種別。
- Globalだけが変化する操作と、original＋Globalが変化する操作。
- カーソルのみ、正方向、逆方向、列0終端、空selection配列を元側・先側、確認・解除の双方で検証する境界表。
- change block projectionのcontext/hunk境界、replacement、addition-only、deletion-only、複数ブロック。
- PR sessionがexact hunks由来のchangeBlocksを渡し、local base/head sessionが`side`固定であること。
- block専用state operationがContext modified・Global・originalを1transactionで更新すること。
- historyがactual deltaからmodified/originalイベントを決め、Global-only差分をmodifiedイベントとして残すこと。
- stale URI、base/head更新、file identity不一致、CAS競合で部分更新しないこと。
- Extension Hostで設定切替、左右の装飾、PR Progress同期を確認すること。

## 実装順序（TDD）

1. 設定契約とPR限定のsession mode伝播のRedを追加する。
2. selection正規化境界表とchange block projectionのRedを追加する。
3. 状態成分・commit・履歴表のRedを追加する。
4. block projectionとcommand planを実装する。
5. block専用state transactionとhistory分岐を実装する。
6. PR runtimeへ結線し、local base/headが`side`のままであることを確認する。
7. 正常系ケース表、状態直積、stale safety、no-op、PR Progress、Globalの回帰を通す。
8. Extension Hostで設定切替と表示同期を確認する。

## transaction型の契約補足

block操作は既存の `ModifiedReviewStateTransaction` または `OriginalReviewStateTransaction` に偽装しない。
`ReviewStateTransaction` のdiscriminated unionへ、block専用のtransaction型を追加する。

```ts
interface DiffBlockReviewStateTransaction extends ReviewStateTransactionBase {
  readonly operation: "mark-diff-block-reviewed" | "unmark-diff-block-reviewed";
  readonly diffId: string;
  readonly invokedFrom: "original" | "modified";
}
```

`diffId` はoriginal stateの比較identityとして必須とし、`invokedFrom` は入力由来の監査情報として保持する。
state repositoryのCAS契約はexpected/next snapshotを扱う既存境界をそのまま利用するため、保存schemaやrepository protocolは増やさない。
history recorderはoperation discriminatorでblock transactionを判定し、実際のexpected/next差分からmodified/originalイベントを生成する。

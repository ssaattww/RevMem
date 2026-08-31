# Issue #92 PR Progress diffの選択範囲確認対応 report

## 概要

PR Progressから開いたimmutable diffで、ファイル全体だけでなく選択範囲を確認済み／未確認へ変更できるようにした。

original側で選択した場合は、ユーザー操作を左側だけの状態へ閉じ込めず、検証済みdiffの対応関係に従って次の2種類へ分割する。

- modified側にも存在するcontext行: 対応する現在行の`modifiedReviewed`とGlobal確認済み状態へ反映する。
- original側にしか存在しない削除行: 現在の`${baseSha}..${headSha}`に対応する`originalReviewedByDiff`へ反映する。

置換前の削除行を置換後の追加行へ推測で対応付けることはしない。

## 設計変更

`doc/design/vscode-review-range-tracker-design.md`をrev8へ更新し、次を明文化した。

1. original側の選択は、immutable diff hunkのold/new座標とhunk間contextから正確にmodified側へ写像する。
2. 同じ行番号という理由だけでは対応付けない。
3. modified側、Global、original側の更新は1回のatomic state transactionとしてcommitする。
4. state commit成功後に、modified側、original側の順で履歴を記録する。
5. PRのbase/head更新後に残ったstale diff tabからの操作は拒否する。

永続化schemaは変更していない。既存の`revisionId`、`modifiedReviewed`、`originalReviewedByDiff[baseSha..headSha]`を使用する。

## 実装

### originalからmodifiedへの行写像

`original-selection-review-plan.ts`を追加した。

- hunk外の不変区間を1対1で写像する。
- hunk内の`context`行は、明示された`oldLine`と`newLine`を使って写像する。
- `deletion`と`addition`は対応付けない。
- hunk順序、cursor、宣言count、document line countに矛盾があればfail closedとする。
- 隣接する写像区間と選択区間は正規化する。

### 選択操作

modified側の選択操作は従来どおりContextとGlobalを更新する。

original側の選択操作は、1回の選択を次へ分割する。

- 対応するmodified側区間
- original側の削除区間

両方に実効変更がある場合でも、最初のexpected snapshotから最後のnext snapshotまでを1件のcombined transactionとしてrepositoryへcommitする。repository commitは1回だけであり、片側だけ永続化される状態を作らない。実効変更のある履歴だけをstate commit後に順番に記録する。

### VS Codeメニュー

既存の`editor/context` 7項目を維持したまま、次の4操作をPR Progress由来の正確なdiff tabで利用可能にした。

- 選択範囲を確認済みにする
- 選択範囲の確認済みを解除する
- ファイル全体を確認済みにする
- ファイル全体の確認済みを解除する

同一URIや同一metadataを持つ別tab、PR Progress以外から開いたdiff、通常editorへの既存条件は変更していない。

## TDD

### Red

設計変更後、次のテストを先に追加し、実装moduleが存在しない状態および選択範囲メニューがdiffで無効な状態で`npm test`が失敗することを確認した。

- original側のcontext行と削除行を分離すること
- insertion後も同一行番号ではなく正しいmodified座標へ写像すること
- 置換前行を追加行へ推測で写像しないこと
- `editor/context`を7項目のまま4操作へ公開すること
- command serviceとPR runtimeが行写像を接続すること

標準出力、標準エラー、combined log、結果JSONは、一時worker workflowの`issue-92-selection-review-worker-*` artifactへ保存した。

### Green

実装後、同じ環境で次を実行し成功を確認した。

- `npm test`
- `npm run lint`
- `npm run build`

Green側についても標準出力、標準エラー、combined log、結果JSONを同artifactへ保存した。

## 回帰防止

- PR Progressから実際に開いたtab instanceだけに操作を公開する既存境界を維持した。
- `editor/context`の重複contributionを追加していない。
- original側の比較専用状態はcanonicalな`baseSha..headSha`だけへ保存する。
- current PR registrationとURI revisionが一致しないstale diffは既存runtime validationで拒否する。
- PR HEAD更新時の`modifiedReviewed` mappingと、base変更時のoriginal状態無効化は既存revision mapperを継続利用する。

## 最終CI方針

このreportを追加したcommitがPR current HEADになる。最終CIは、そのcurrent HEAD SHAとworkflow runの`head_sha`が一致するrunだけを確認対象とし、別SHAのrunを代用しない。

## レビュー状態

独立レビューは未実施。PRはdraftのまま維持し、mergeは行わない。

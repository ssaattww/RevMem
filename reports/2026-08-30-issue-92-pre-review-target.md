# Issue #92 レビュー前検証対象

## 対象

PR #94のレビュー開始前に、次の実装状態を検証対象として固定する。

- PR Progressから開いた正確なdiff tabで、選択範囲およびファイル全体の確認済み／解除操作が利用できる。
- modified側の選択は、現在のHEAD側行を更新する。
- original側の選択は、immutable diffの対応関係から、現存するcontext行をmodified側へ写像し、original側だけに存在する削除行を現在の`baseSha..headSha`へ記録する。
- 置換前の削除行を置換後の追加行へ推測で対応付けない。
- modified、Global、originalにまたがる1回の選択操作は、1回のatomic repository state commitとして永続化する。
- PR更新後のstale diff tabからは状態を更新できない。
- `editor/context`は既存7項目を維持し、重複contributionを追加しない。

## 検証

レビュー開始前に次を実行する。

- `npm test`
- `npm run lint`
- `npm run build`

最終CI判定には、PR current HEAD SHAとworkflow runの`head_sha`が一致する`.github/workflows/ci.yml`だけを使用する。一致するrunが存在しない場合はCI未実施として扱い、別SHAのrunを代用しない。

## 関連report

- `reports/2026-08-30-issue-92-pr-progress-context-menu.md`
- `reports/2026-08-30-issue-92-pr-progress-selection-review.md`

独立レビューおよびmergeは、この文書作成時点では実施していない。

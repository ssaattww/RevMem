# Issue #90 詳細診断・Global再計算stale cancellation 実装報告

## 概要

Issue #90では、PR Progressが進まない／遅い状況を調査しやすくするopt-in詳細診断、Global理解率再計算のstale cancellation、およびPR Progressが0件になる理由を特定できるfile単位diagnosticを追加した。PR Progress本体の性能アルゴリズムは変更していない。

## TDD

`test/unit/issue-90-diagnostics-and-cancellation.test.ts` を先に更新し、PR Progress zero-denominator診断helperが存在しないため `TS2307` で失敗するCI run `32949715317` を確認した。その後production実装を追加した。

追加したcontractは、excluded file、changed line 0のfile、aggregate denominator 0を区別できることである。

## 実装内容

### 詳細診断モード

`reviewRange.diagnostics.detailed` は既定 `false`。ON時のみoperation ID、同時実行operation、reason、phase、target file/pathを出す。通常モードではfile/pathを出さない。

### Global理解率再計算

150msの予約済みrefreshが存在する状態で即時refreshへ移る場合、その予約をcancelして最新requestだけを実行する。実行中generationは既存AbortSignal / generation validationでstale publishを抑止する。

### PR Progressが0件になる理由の診断

詳細モードではPR Progress operation開始時にsnapshotとshared exclusion policyから各fileを分類し、file名付きで次を出力する。

- `missing-pr-snapshot`
- `no-pr-files`
- `pr-snapshot-loaded`
- `included`
- `excluded:binary`
- `excluded:default-glob`
- `excluded:user-glob`
- `zero-changed-lines`
- aggregate `zero-denominator` / `calculated`

file detailには `total`, `additions`, `deletions` を含める。aggregateには `snapshotFiles`, `included`, `excluded`, `zeroFiles`, `reviewed`, `total` を含める。

これにより、表示が0件の場合に少なくとも「PR snapshotにfileがない」「全fileが除外された」「fileは存在するがchanged lineが0」をOutput logから区別できる。content取得へ進んだfileについては従来どおり `read-content` とfile名も出る。

分類はPR Progressと同じsnapshot additions/deletionsおよびshared exclusion policyを使うため、診断用の別ルールは持たない。

## PR Progress遅延の原因調査

PR Progressはrepository全体ではなく選択PR snapshotのfilesのみが対象。ただしReview Contexts refresh / runtime registration待ち、各fileのimmutable BASE/HEAD content取得、reviewability計算に直列部分があるため、対象file数が少なくても遅くなり得る。今回性能アルゴリズムは変更していない。

## CI failure artifact

失敗時workflowは `test-output`, `dist`, `test-dist`, `src`, `test`, `tools`, `type-fixtures`, package/tsconfig/eslint/workflow、およびcommand stdout/stderr/resultをartifact保存する。今回もRed確認と後続failure調査に使用した。

## 検証履歴

- `d6e3adac...`: TDD Red。unit compileでdiagnostic module未実装を確認。
- `99c75f8c...`: production途中。exclusion union narrowing不足をBuildで検出。
- `17d7e463...`: Build/typecheck/architecture/lint Green後、test fixture shapeの型誤りをunit compileで検出。
- 後続HEADでfixtureを修正し、設計書/reportを更新した。

最終Green判定はPR current HEADとworkflow run head SHAが一致するrunだけを使用する。別SHAのrunは代用しない。

## 残課題 / 次の候補

実機詳細ログで0件の分類結果とread-content停止点を取得した後、必要ならselected PR file contentのbounded parallelism、immutable content cache、Review Contexts待ちの分離、Global/PR間I/O priorityを別Issueで検討する。

## Merge

Mergeは実施していない。

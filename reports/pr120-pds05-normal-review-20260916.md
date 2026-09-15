# PR #120 PDS-05 通常レビュー

## 対象

- Repository: `ssaattww/RevMem`
- Pull Request: `#120`
- Task: `PDS-05`
- Review mode: initial normal review
- Reviewed implementation HEAD: `993c7d589d653ef878f41da795c54f98a7586262`
- PDS-05 implementation start HEAD: `49e395731724f7f3e8defef4a6bc8b21875e8c7f`
- PDS-05 core implementation commit: `a56499ecb0d339c651b18372625acf6894960bf1`
- PDS-05 technical HEAD: `7e01bd4c6c9f97acc78f93e45161fbee7c71bec6`
- PR base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`
- Reviewer worktree: `/home/ibis/RevMem-pr120-review-pds05`
- Reviewer worktree state: detached exact HEAD、clean

PDS-06以降の設定公開、PR Progress限定コマンド結線、結合受入、競合・再読込、実Extension Host受入は今回のレビュー対象外とした。未実装であること自体を指摘にはしていない。

## 確認した要求と設計

PDS-05の正本は `tasks/pr-diff-selection-mode/tasks-status.md` と `Design/pr-diff-selection-mode.md` とした。特に次を受入条件として照合した。

- original / modified Context / Globalを一つのexpected / next transactionで更新する。
- mark / unmarkは存在する成分を同じ目的状態へ揃える。
- semantic no-opではcommitも履歴も発生させない。
- modified ContextまたはGlobalが変化した場合だけmodified履歴を残す。
- originalが変化した場合だけoriginal履歴を残す。
- 両方が変化した場合はmodified、originalの順に履歴を残す。
- Globalだけが変わる場合もmodified履歴へContextとGlobal双方のbefore / afterを保持する。
- 保存失敗時に履歴を先行させない。
- 対象外範囲を保持し、存在しない成分を不要に生成しない。
- `updatedAt`だけの差はsemantic changeとしない一方、存在、path、revision、hash等の意味のある差は保持する。

## 確認範囲

PDS-05の実装差分、検証修正、管理差分、および直接依存を確認した。

- `src/core/review-state/review-state-service.ts`
- `src/core/review-state/pull-request-review-state-service.ts`
- `src/core/review-state/index.ts`
- `src/application/review-history/review-history-recorder.ts`
- `src/application/repository-global-state/repository-global-state-repository.ts`
- `src/adapters/document-review-state/reconciled-document-review-state-session-provider.ts`
- `test/unit/diff-block-review-state.test.ts`
- PDS-05後に修正されたWindows POSIX fixture、immutable diff fixture、Extension Host待機fixture
- `package.json`
- `Design/pr-diff-selection-mode.md`
- `tasks/pr-diff-selection-mode/tasks-status.md`
- `tasks/pr-diff-selection-mode/phases-status.md`
- `reports/pr-diff-block-review-state-implementation-20260915.md`
- `handoffs/pr-diff-block-review-state-20260915.yaml`
- 既存 `DiffEditorReviewCommandService` のsemantic change判定とcommit / history境界
- PR runtimeのhistory呼出境界
- CI workflowと診断出力ラッパー

## 指摘事項

### PDS05-NR1-001 — P2 / medium — 未作成original diff keyの解除がsemantic no-opにならない

- Origin: introduced by PDS-05 change
- Location: `src/core/review-state/review-state-service.ts:468-500`
- Description: `currentOriginal` は対象 `diffId` が存在しない場合も空配列として扱うが、`originalIntervals` が1件以上あれば484行で無条件に `originalReviewedByDiff[input.diffId] = nextOriginal` を実行する。したがって、既存Context fileの `originalReviewedByDiff` に対象keyがなく、対象original範囲も既に未確認の状態でunmarkすると、確認済み範囲は何も変わらないにもかかわらず `{}` が `{ [diffId]: [] }` に変わる。`hasReviewStateSemanticChange` はこの構造差を意味のある差として扱うため `true` になる。
- Impact: 設計の「全成分が未確認の解除はsemantic no-op。commit・履歴なし」に反して不要なstate commitが発生する。保存上は空のoriginal diff keyとtimestamp更新が残り、同じ解除操作が状態変更として扱われる。履歴recorder側はbefore / afterのoriginal rangesをどちらも `[]` と見るためoriginal履歴を生成せず、state commitだけが発生する不整合にもなる。
- Evidence: exact reviewed HEADから作成したscratch snapshotで、既存Context fileを保持したまま `originalReviewedByDiff: {}`、Globalなし、original target `[1,3)` に `unmarkDiffBlockReviewed` を実行した。結果は `beforeHasDiffKey=false`、`afterHasDiffKey=true`、`afterRanges=[]`、`semanticChange=true` だった。現行focused suiteの108置換ケースは、`unreviewed` originalを `{ [diffId]: [] }` としてfixture化しているため、この「key自体が未作成」の状態を通っていない。
- Required action: 対象diff keyが未作成かつunmark後もoriginal rangesが空なら、空keyを新規生成せずsemantic no-opを維持する。少なくとも「Context fileは存在する / 対象diff keyは不存在 / original targetは非空 / unmark / modified targetなし」の回帰testを追加し、transactionのsemantic changeがfalse、original keyが生成されない、commitとhistoryが発生しないことを検証する。既存keyを全解除した場合の正規化方針も同じsemantic no-op規則と矛盾しないよう固定する。

## 検証

### Reviewer focused verification

reviewed implementation HEAD `993c7d589d653ef878f41da795c54f98a7586262` を `git archive` したscratch snapshotへ既存依存を参照させ、製品sourceを変更せずに実行した。

- `npm run test:diff-block-state`: 12 passed / 0 failed
- `git diff --check 49e395731724f7f3e8defef4a6bc8b21875e8c7f..993c7d589d653ef878f41da795c54f98a7586262`: success
- 追加の読み取り専用再現probe: `beforeHasDiffKey=false` → `afterHasDiffKey=true`、`afterRanges=[]`、`semanticChange=true`
- reviewer target worktreeは検証後もclean

再現probeと実行logは対象branchへ追加せず、review scratch `/tmp/revmem-pr120-pds05-review-993c7d5/review-evidence/` に保持した。

### Exact-head CI

reviewed implementation HEADと一致するrunだけを確認した。

- Workflow: `CI`
- run id: `34970867836`
- run number: `4518`
- event: `pull_request`
- `head_sha`: `993c7d589d653ef878f41da795c54f98a7586262`
- result: `completed / success`
- user validation artifact: `review-range-user-validation-0.1.53-pre+993c7d5`
- artifact id: `10397348160`
- artifact側のworkflow run head SHAも `993c7d589d653ef878f41da795c54f98a7586262`

別SHAのworkflow runは代用していない。

### 診断artifact workflow

作業開始時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。CIの主要コマンドはラッパー経由で `*.result.json`、標準出力、標準エラー、結合logを `test-output/ci` へ保存し、failure時は `test-output/` を診断artifactとしてuploadする構成が存在する。今回のreviewではworkflow追加は不要と判断した。

## TDD時系列

実装reportが明示しているとおり、PDS-05の新規test file自体はcore実装より先に作成されたが、製品Redを有効な形で確認した時点ではcore実装断片の編集が始まっていた。開始HEADへ最終testを戻したcompile failureは未実装状態の再現証拠ではあるが、strictな「Red確認後に実装開始」の時系列証拠ではない。

これはRevMemのTDD方針に対する既知のprocess deviationとして残る。実装reportが成功扱いへ書き換えず明示しているため、本reviewではPDS05-NR1-001とは別の製品code findingには重複計上しない。

## Coverage

| 観点 | 結果 | 根拠 |
| --- | --- | --- |
| 要求・設計整合 | finding | semantic no-op表にPDS05-NR1-001 |
| 正確性・edge case | finding | 未作成original diff keyのunmarkを再現 |
| 変更範囲 | no finding | PDS-05本体と検証修正・証拠更新に限定。PDS-06未実装を指摘化していない |
| 直接依存 | finding | existing command semantic判定でも構造差がcommit対象になるためPDS05-NR1-001が実接続後も残る |
| API・data compatibility | finding | `{}` と `{ [diffId]: [] }` の表現差を新block transactionが不要に生成する |
| error handling・原子性 | no finding | expected / next一括transaction、commit後history、保存失敗時historyなしを確認 |
| history内容・順序 | no finding | modified / originalの差分判定と順序、Global-only evidenceを確認 |
| security・secret | not applicable | 認証、権限、secret処理の変更なし |
| tests・validation | finding | 132基本ケースは成功するが未作成diff key状態がfixtureから欠落 |
| exact-head CI | success | run `34970867836` のhead SHAがreviewed implementation HEADと一致 |
| report・tracking | no finding | PDS-06以降を未着手としており、TDD時系列逸脱もreportに明記 |
| regression・maintainability | finding | key有無を状態意味と混同する境界がPDS05-NR1-001を生成 |

## Verdict

`fail`

PDS05-NR1-001の必須修正があるため、PDS-05をreview passとは判定しない。修正後は同じfinding IDを引き継ぎ、同じreviewer文脈でfix verificationする。

## 次回確認

PDS05-NR1-001の修正HEADでは、次だけを最低限再確認する。

1. 未作成original diff keyのunmarkがsemantic no-opとなること。
2. 空keyを新規生成しないこと。
3. commitとhistoryが発生しないこと。
4. 既存132基本ケースとGlobal-only / original+Global / owner Global snapshot回帰が維持されること。
5. 修正HEADに対するローカル検証証拠と、必要な公開時点でcurrent HEAD一致のCIだけを使用すること。

mergeは行っていない。

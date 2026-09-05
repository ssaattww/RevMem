# PR #108 独立レビュー追記 — 最新対応範囲との照合

## 対象と更新の検出

元レポート: `reports/2026-09-05-pr108-independent-review.md`（保存commit `beac659d3758a486fafd283b14a097ee780baa96`）。技術レビュー対象は `0e15ac16809af71bba09694453e7a665c7c452a1`。

PRコメント投稿後の再取得で、PR current HEADが `a6a86600ae4089242aefe4151aea9442645179ac` へ更新されていることを確認した。差分は次のレポート2ファイル・2commitだけで、production code・test・workflowの変更はない。このチャットが行った書込みは別branch `review/pr108-independent-0e15ac1` のレポートとPRコメントであり、対象PRのHEAD更新ではない。

- `reports/2026-09-05-pr108-independent-final-review.md`
- `reports/2026-09-05-pr108-review-action-scope.md`

後者は、利用者の指示を受けて次回修正の必須対象を製品影響のある3件へ限定している。**元レポートの6件は技術的観測の履歴として維持するが、6件すべてを次回の必須修正・release blockerとする記述は、最新の対応範囲に置き換える。** severityを書き換えるのではなく、対応義務の範囲を区別する。プロセス・report整備だけの項目や、極端なケースのための追加防御を必須へ追加しない。

## 今回の必須対応

| ID | 優先度 | 必須対応 | 最低限の受け入れ条件 |
|---|---|---|---|
| PR108-ACTION-001 | P1 | owner publication後のhistory途中失敗を回復可能にする | 2Contextのうち1件目のhistory記録後に2件目を失敗させ、失敗・再試行後に新stateと一部historyの状態が恒久的に残らない |
| PR108-ACTION-002 | P1 | actual T405 production compositionでowner同期を固定する | 実registration/command経路、同一ownerの2Context以上、両ContextとGlobalの結果、および1 owner CAS/publicationをassertする |
| PR108-ACTION-003 | P3 | ユーザー向け日本語メッセージを修正する | `対豈PR`→`対象PR`、`cacheほ保存`→`cacheへ保存`を正し、focusedな検証を行う |

ACTION-002は「既存のactual composition testが全くない」という指摘ではない。既存T405 compositionは実行して成功している。新しいowner contractの直接helperテストやsource文字列assertだけでは、上表のproduction配線・publication回数の受け入れ条件を固定できないことが対象である。

## ACTION-001の追加再現

最新対応範囲の確認後、元のレビューsourceに対して追加probe `history-recovery-probe.cjs` を実行した。current HEADへの差分がreportだけであり、対象production codeは同一である。

実FS repository・debounce・immutable mapper・context serviceと、ファイルに記録するhistory sinkを使用し、2件目のappendのみを故意に失敗させた。製品コードを変更せず、production `synchronizePullRequestOwner` を呼び出した。

```text
初期: PR52=B, PR53=B, Global=B
2件目のhistory append失敗後: PR52=C, PR53=C, Global=C, history=1件
障害を解除して再試行後: PR52=C, PR53=C, Global=C, history=1件
retry: committed=false, mappedContextIds=[]
期待するhistory=2に対し実測1でassertion失敗（exit 1）
```

history sinkの故障注入を伴う再現であり、実ディスク障害の発生頻度を測ったものでも、既存JsonlReviewHistoryStore全体の再検証でもない。結果は `logs/review108-history-scope.*` にstdout・stderr・combined log・result JSONとして保存した。

元設計はpost-commit history failureをstateと同一transactionに含めないため、最初の独立レビューではこれを設計違反の独立指摘にしなかった。今回は利用者が最新scopeで回復保証を明示的に必須としたため、その受け入れ条件に対する不足として扱う。過去レポートの判定理由は改変しない。

## CI・保存・次の作業

旧HEADのrun `33687437781` は旧HEADに対する成功証拠であり、新HEADへ流用しない。新HEADと完全一致するpull_request CI run `33961347314` を確認し、この追記の生成時点では `in_progress` だった。最終状態はPRコメントと外部handoffに別途記録する。

この追記もレポート専用branchへの保存で、passing attestationではない。元のレビュー報告書・今回取得した2レポート・製品コード・task trackingは変更しない。追加の網羅レビューや実装修正は行わず、最新3項目の確認に範囲を限定した。

次回は上記3項目の実装・normal fix verificationを行い、required action / production path / actual fixture / focused evidenceを対応付けてから、同じ独立レビューチャットへbounded closureとして戻す。元レポートの他の観点を、新たな必須修正として追加しない。mergeは利用者が行う。

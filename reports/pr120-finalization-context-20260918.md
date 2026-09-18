# PR #120 最終検証前の作業方針

## 対象と権限

- repository: `ssaattww/RevMem`、PR #120、Issue #119。
- branch: `investigation/issue-119-linked-diff-blocks`、base: `main`。
- 本記録作成時のtechnical HEAD: `0feb9819572828b8a3366dc4f7ef1cb839a8d1f0`。PDS-09の指摘対応をcommit・push済み。同一通常レビュワーは必須3件をP2のままfixed、pass_with_heldと確認した。
- 現チャットの利用者は「独立レビューまで完了後マージして下さい」と明示している。同期した文書の「mergeは利用者が行う」とSkill既定の非merge境界より、この依頼を優先する。独立レビュー、最終公開HEAD一致の必須CI、成果物確認を経て親がマージする。子workerはマージしない。
- 利用者指定は実装 `gpt-5.6-terra / high`、レビュー `gpt-5.6-sol / high`。既存agentの継続時は元のprofile証拠を保持し、非公開の実適用値を推測しない。
- タスク完了ごとのpush、レビュー前・後・指摘対応後のcommitを行う。これはSkill既定のローカルレビュー中のpush省略に対する明示overrideである。

## 低頻度の問題

- 利用者の2026-09-18指示: 100人の利用者全体で月1回程度以下の問題は修正せずIssueへ記録する。
- Issueには頻度、根拠と仮定、何が起きるかを記す。計測と推定を区別し、頻度不明を低頻度と扱わない。
- PDS08-NR1-001 / P2は[Issue #121](https://github.com/ssaattww/RevMem/issues/121)で保留する。severityを下げず、既存のqueue/CAS保護と回帰試験の不足を区別する。将来ガードを迂回した場合の推定は仮定付きであり、実測値ではない。
- PDS09-NR1-001/002/003は通常操作の完了境界・必須受入試験・本番の試験観測漏出に関する指摘で、今回修正する対象である。

- PDS10-NR1-001 / P2は[Issue #122](https://github.com/ssaattww/RevMem/issues/122)へ保留。通常providerの完全hunkとcache parserの統計検査が維持される限り、末尾改行差と空hunkの不正組合せに到達する影響は月0回を期待する条件付き推定。実測なし、内部bypassや統計も整合した改ざんの頻度は不明であり、通常到達経路が判明すれば再評価する。PDS10-NR1-002 / P1のoffline-cache更新不能は実経路で頻度不明なので修正する。

## Skill不足とプロセスの振り返り

- `development-orchestrator` と `feedback-points-manager` を通じた親の判断: **no skill action needed**。
- 記録起点: モデル指定、段階commit/push、低頻度Issue方針は利用者明示指示。診断log保持の改善は親・実装workerが検出した実行上の反省。
- 重複グループ: dispatch override、publication cadence、review disposition、validation evidence preservation。既存の委譲・Git・レビュー・報告Skillがこれらの個別overrideと証拠保持を既に扱うため、新規Skillや共通規則の重複追加はしない。
- 最初のPDS-09では同名wrapper logの一部を上書きした。個別Host診断JSONは残るが完全なwrapper履歴は復元できない。指摘対応では各試行に固有labelを使用し、失敗を保持した。これは既存証拠保持規則の遵守改善であり、規則不足ではない。
- 次アクション対応: 本記録とタスク追跡を通常レビュー対象としてcommitし、今後の判定にも利用者方針を適用する。プロセス改善Issueは作らない。理由は既存Skillに不足がなく、このPR固有の運用指定が本記録に残るため。製品側の保留Issue #121とは区別する。
- active FP ledgerの既存IbisDuck固有行は別案件であり変更しない。今回の行追加・統合・削除・backlog移動はない。本記録はcommit_pendingであり、自身の将来SHAを要求しない。

## 現在のCI証拠

- technical HEAD `0feb9819572828b8a3366dc4f7ef1cb839a8d1f0` のpull_request CI run `35289494999`、job `105429048589` はT506 step 24でfailure。それ以前のbuild・型・構造・lint・unit等は成功、T610と後続Host・packagingはskipped。原因は限定調査中で、旧T610失敗の再発と推定しない。

- 後続の管理commit `38c9e6e7d7b260761bd92e06dbdd4f1309737a1b` は製品・試験sourceが0feb981と同じで、pull_request CI run `35290071932` がsuccess。Linuxの同HEAD focused T506も `pds10-t506-baseline-20260918` でexit 0、Node3/3、全Host phaseとcleanup成功、実行後clean。旧失敗は再現できず、QuickPick待機仮説だけでsourceを変更しない。旧2回のartifactではinner `refresh current context after restart` の10秒timeoutが確定し、それより下位の待機原因は不明。全体gateとは区別する。

## 終了までの境界

- PDS-09解消確認後にPDS-10のCI discovery監査と統合通常レビューを行う。必要修正は同じ通常レビュワーで確認する。
- 全非最終報告・追跡・引継ぎをcommitし、最終候補HEADでrepository定義の全体ローカル検証を実行する。現在は独立レビューのfreezeも報告path予約も行っていない。
- `review-enforcer` が独立最終報告pathをmetadataだけで一度予約し、異なる新規Sol high reviewerが一回の全体独立レビューを行う。指摘があれば同じ独立reviewerが限定的に解消確認する。
- 合格後に予約pathだけの報告attestation commitを一回作成する。それ以降の追跡更新はPR本文またはチャットへ残し、報告以外の追加commitを作らない。
- 最終push後に一致する必須 `pull_request` CIとVSIX/source/manifest成果物を確認する。旧HEADのCI成功や、失敗runの後続skipを合格証拠にしない。
- Markdown専用の `tools/lint` と `lint:md` は未構成でunsupported。新規ツールは追加せず、文書・リンクは通常レビューで確認する。

## 継続に必要な参照

- 正本: [タスク](../tasks/pr-diff-selection-mode/tasks-status.md)、[フェーズ](../tasks/pr-diff-selection-mode/phases-status.md)、[設計](../Design/pr-diff-selection-mode.md)。
- PDS-09: [元通常レビュー](pr120-pds09-normal-review-20260918.md)、[修正証拠](pr120-pds09-fix-verification-20260918.md)、[再レビュー](pr120-pds09-normal-rereview-20260918.md)。
- 実行環境とLinux検証用clone: [環境記録](pr-diff-selection-verification-route-20260915.md)。
- 最終技術判定と公開結果は後続の独立報告およびPR本文を参照する。本記録は未実施の全体gate、独立レビュー、最終CI、mergeを完了とは扱わない。

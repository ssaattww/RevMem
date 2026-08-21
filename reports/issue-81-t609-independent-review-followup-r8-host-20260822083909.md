# Sub-agent実行レポート

## タスク

Issue #81 / T609 の IFR005 に限定し、mapping transition 用の初期確認済み状態を Extension Host 起動前に runner で production persistence path へ準備した。technical HEAD は未commit の `5bb1dbaa9faee918d43982eeffa06b7ae6abee52` を親とする作業ツリーである。

## sub-agentを使う理由

Host 内 Test-only seed が UI/runtime と同時に走り、公開 command matrix の同期境界を不安定化していたため。起動前状態を同じ repository/storage session で準備し、Host は production load と公開 command の検証だけを担うよう分離する。

## 対象範囲

`test/vscode/run-extension-host.ts` の T609 fixture、`test/vscode/t609-suite/index.ts` の Host 消費、obsolete Test-only seed API の削除、契約 gate `test/unit/t609-gate-wiring.test.ts`。初期3ファイル（rename-source、whitespace、EOL）は runner が `DocumentReviewStateSessionProvider`、`FileSystemReviewStateRepository`、`DebouncedReviewStateRepository`、`JsonlReviewHistoryStore` を通じ、Host と同じ user-data global storage に一 transaction で永続化する。Git identity、revision、file ID は production session が決定する。

## 対象外

production の Current Context、normal-editor command、storage schema、CI、GitHub、tracking/design、commit/push/review は変更していない。固定 sleep、timeout 延長、public command の direct seam 迂回も行っていない。

## 実行コマンド

Red: `node --experimental-strip-types --test test/unit/t609-gate-wiring.test.ts` は新契約2件が fail（runner preseed 不在、obsolete Host seed 残存）。Green: 同コマンドは13/13 pass。`npm run test:t609` は58/58 pass。`npm run build` pass、`npm run compile:test` pass、`npm run lint` pass、`git diff --check` pass。exact `npm run test:t609:extension-host` は一回のみ実行し、`t609-single-root` が `drain Shift-JIS review-state dependents` の10秒 timeout で fail、`prepare` と `restart-reopen` は未到達、fixture cleanup は succeeded。再試行していない。

## 対象ファイル

`src/extension.ts`: obsolete Test-only `seedT609InitialReviewedRanges` API/helper を削除。`test/vscode/run-extension-host.ts`: production persistence adapter/session による起動前 seed を追加。`test/vscode/t609-suite/index.ts`: seed API 呼出を除去し、actual activation/load/public command のみを消費。`test/unit/t609-gate-wiring.test.ts`: runner-prepares/Host-consumes 契約と obsolete API 非存在を固定。本 report。

## 指摘事項

新規の独立review指摘は行っていない。IFR005 の actual Host matrix は未完了。preseed 後の public Shift-JIS command は timeout 前まで到達したため、以前の Host seed競合は解消方向だが、review-state dependent refresh の未完了が残る。

## 提案内容

次の限定 follow-up は `drainReviewStateDependentsForTest` の Global/PR Progress/Review Contexts refresh 連鎖を、public command 後に完了しない production/dependent path として診断する。Host seed を復活させず、既存の public command と event-driven completion signal を維持する。

## 未解決事項

IFR005 は incomplete。exact Host の後続 phase（Git rename/new/whitespace/EOL、Current Context cancel/stale/post-pick、invalid isolation、restart/reopen、Context/Global decoration）に到達していない。診断は `test-output/vscode-launch-diagnostics/t609-single-root-1787356385424.json`。親がこの未commit差分と report を確認し、次の限定実装か checkpoint commit を決定する。

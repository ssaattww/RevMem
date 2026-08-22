# Sub-agent実行レポート

## タスク

- 目的: multi-root startupとTest-mode cancellation injectionでT609 Extension Host blockerを閉じる
- タスク種別: bounded fixture follow-up・exact verification

## sub-agentを使う理由

- 理由: 同じterra highが直前診断を保持し、Host再起動とQuick Pick timing依存だけを除去するため

## 対象範囲

- 対象: T609 multi-root workspace startup、Test-mode selection cancellation port、exact `--t609` phase

## 対象外

- 対象外: product behavior、core findings、gate配線、tracking/design、full suite、CI、commit、push、review、merge

## 実行コマンド

- 実行コマンド: R4 diagnosticとcurrent fixture/activation compositionをread-only確認後、`npm run compile:test`を1回実行（pass）。続けてcache済みrunnerで`node test-dist/test/vscode/run-extension-host.js --t609`をcurrent candidateに対して1回だけ実行（fail）。full suite、他test/static suite、CI、download、commit/push/PR/review/merge、追加修正・再実行・diff-checkは実施していない。

## 対象ファイル

- 変更または確認したファイル: `test/vscode/run-extension-host.ts`（single-root/multi-root phase launch分離）、`test/vscode/t609-suite/index.ts`（workspace folder更新待機を除去しTest APIでcancel/staleを注入）、`src/t305-extension.ts`、`src/t405-review-contexts-runtime.ts`（Test extension modeに限るrepository selection port）、本report。production modeのQuick Pick path、core findings、gate配線、tracking/design/他reportは未変更。

## 指摘事項

- 指摘要約または「指摘なし」: R4 diagnosticは二根workspace startup自体ではなく、その直後にsingle-root成功用の`reviewRange.refreshContext`を実行したことによるambiguous-root Quick Pick待機でtimeoutした。R5はsingle-root成功を専用phaseに分離し、multi-root phaseではReview Contextsの実activation compositionへTest-mode限定selection portを渡して`undefined`とstale copyを同期的に注入する。production modeは従来どおりQuick Pick hostを使用する。workspace folder更新・そのevent待機は使用しない。

## 結果

- 結果: `npm run compile:test`はpass。exact Hostは`single-root` phaseがpassした後、`t609-prepare` phaseでfailした。active extension entrypointは`src/extension.ts`であり、追加したTest-mode APIは`src/t305-extension.ts`からのみ返るため、extension exportに`setReviewContextsRepositorySelection`が存在せず`TypeError`となった。multi-root cancellation/stale assertionとrestart-reopen phaseは未到達。NR-006はincomplete。

## リスク

- 未解決のリスクまたは後続対応: exact failure diagnosticは`test-output/vscode-launch-diagnostics/t609-prepare-1787336719892.json`。後続cleanupも失敗Hostの残存により10秒timeoutし、diagnosticは`test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787336731924.json`。未解決blockerは実際の`src/extension.ts` Test-mode activation compositionへ最小selection injectionを接続していないこと。指示により追加修正・追加Host実行は行っていない。NR-006 ready evidence、restart/reopen evidence、full local equivalence、remote CI、commit/push/review verdict/mergeは未実施。

# Sub-agent実行レポート

## タスク

Issue #81 / T609 の IFR005 に限定し、R8 exact Host の `drain Shift-JIS review-state dependents` timeout を解消した。technical HEAD は未commit の `5ff818b326156e56b6fe55db7d5af4b202670568` を親とする作業ツリーである。

## sub-agentを使う理由

公開 mark command は durable state/history commit で完了すべきであり、Test-mode の Global、PR Progress、Review Contexts 全refresh待機を command completion condition にしてはならないため。各background dependentは名前付きTest fakeとして隔離し、Hostでは必要な実更新だけを明示確認する。

## 対象範囲

Test-only dependent queue、T609 Host fixture、T609 focused gate、package test wiring。本番のreview-state event/listenerとCurrent Context/Global/PR production refresh挙動は変更していない。Hostはpublic normal-editor command、visible decoration refresh/drain、Global recalc/snapshot、Current Context public commandを引き続き通す。

## 対象外

production dependent listener、Current Context runtime、storage schema、GitHub、CI、tracking/design、review、commit、push、remote CIは変更していない。固定sleep、timeout延長、public commandをTest seamで置換する迂回は行っていない。

## 実行コマンド

Red: `node --experimental-strip-types --test test/unit/t609-test-review-state-dependent-queue.test.ts test/unit/t609-gate-wiring.test.ts` は新queue不在・旧all-drain契約により3 failure。Green: `npm run compile:test && node --test test-dist/test/unit/t609-test-review-state-dependent-queue.test.js test-dist/test/unit/t609-gate-wiring.test.js` は15/15 pass。`npm run test:t609` は60/60 pass。`npm run build`、`npm run compile:test`、`npm run lint`、`git diff --check` はpass。exact `npm run test:t609:extension-host` は一回のみ実行し、`t609-single-root` succeeded、`t609-prepare` は `drain startup Current Context` 10秒 timeoutでfailed、`restart-reopen`未到達、fixture cleanup succeeded。再試行していない。

## 対象ファイル

`src/test-only-review-state-dependent-queue.ts`: Global、PR Progress、Review Contexts の名前付きTest fakeを直列化し、abort/dispose後のstale publishとrejectionをcontainするqueueを追加。`src/t305-extension.ts`: Test modeだけがこのqueueを使い、production event/listenerを保持。`test/vscode/t609-suite/index.ts`: all-dependent drain APIを削除し、document state、visible decorations、Global snapshotの対象別assertのみを待機。`test/unit/t609-test-review-state-dependent-queue.test.ts`: named/nonblocking/abort/rejection契約。`test/unit/t609-gate-wiring.test.ts`・`package.json`: gate wiring。本 report。

## 指摘事項

R8の `drain Shift-JIS review-state dependents` timeoutは再現せず、single-root phaseは成功した。新しい独立review findingは出していない。multi-root `t609-prepare` は startup Current Context の別timeoutで止まり、mapping transition、cancel/stale、restart assertionは未到達である。

## 提案内容

次の限定follow-upは、multi-root activationのstartup Current Context refreshがQuick Pickまたは依存refreshへ停滞する原因を、public commandと同じtyped cancellation/revalidation contractで診断する。R9のTest queueを再びall-drain completion gateへ戻さない。

## 未解決事項

IFR005はincomplete。single-rootの公開Shift-JIS/BOM、actual Global/decorationsはreadyだが、multi-root Current Context cancel/stale/post-pick、rename/new/whitespace/EOL、invalid isolation、restart/reopenのHost evidenceは未完了。診断は `test-output/vscode-launch-diagnostics/t609-prepare-1787357182498.json`。親がこの未commit差分とreportを確認し、次の限定実装またはcheckpoint commitを決定する。

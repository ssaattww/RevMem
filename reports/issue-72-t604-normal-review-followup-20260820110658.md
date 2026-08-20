# T604 normal review follow-up report

## タスク

T604 / Issue #72 / PR #73 のnormal review finding follow-up。reviewed implementation HEAD `4ac8491172dffa7eb0e396f88c5040b035a900f8`に対するT604-R001〜R009だけを同一batchで対応した。実装後は同一reviewerのfinding限定closure待ちである。

## sub-agentを使う理由

使用しない。依頼でsub-agentは禁止され、通常reviewの新規観点探索も禁止されている。

## 対象範囲

T604-R001〜R009のみ。lease lockのbounded stale recovery、custom AtomicTextFileStore namespace coordinator、startup migration lock、snapshot current-pointer保護、lock diagnostic production composition、CI focused wiring、design/JSDoc/tracking/handoff同期を対象とした。

## 対象外

T605以降、history UI/export/expiry、full CI、Extension Host、commit/push/PR/merge、independent review、新規finding探索。

## 実行コマンド

Red batch: `npm run test:t604`をreview follow-up開始時に実行。Green batch: `npm run test:t604`でT604 7件とT506 custom-store multi-instance 2件、計9件がpass。静的検証はbuild、compile:test、contracts typecheck、lint、architecture正負、diff checkを各1回実行する。CIは未実行。

## 対象ファイル

`storage-root-lock.ts`、state contracts/index/validated/history、startup migration、snapshot/cache adapter、production composition、CI wiring、T604 test、design、README/tracking/handoff、本report。

## 指摘事項

R001: lease expiryをinclusiveにしrenew/release/recoveryをroot lock protocolへ集約、R002: malformed lockをmtime-based bounded stale recovery、R003/R004: startup mutationをroot lockへ、R005: latest pointerを再確認してactive snapshotをdeleteしない、R006: custom AtomicTextFileStoreでは同namespaceのin-process coordinator、R007: focused CI stepとT506 regressionをtest:t604へ、R008: state/history/cache/snapshot compositionへprivacy-safe kind-only sink、R009: history quarantine/reset decisionとroute JSDocを同期。既存public schemaを破壊しないためBreakingChanges追加は不要。

## 結果

T604-R001〜R009を同一follow-up batchで対応し、focused Green後に同一reviewer closure待ちへ更新した。

## リスク

OS child-processとWindows junction/reparse swapの専用fixtureは追加していない。Node filesystemのlease ownership/fencingの更なる強化は同一reviewer closureで既存findingだけとして確認する。Markdown wording lintはrepository wiring不在のためunsupportedである。

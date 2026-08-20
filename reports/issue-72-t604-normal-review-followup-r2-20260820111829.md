# T604 normal review follow-up R2 report

## タスク

T604 / Issue #72 / PR #73 のnormal closure R1で`open`だった既存T604-R001〜R009だけを同一R2 batchで閉じた。sourceは`issue-72-t604-normal-finding-closure-20260820111448.md`、technical fix HEADは`f1cb025e3008bb861ac6c673831a3c7b2d8e30e8`である。CIは明示方針により起動・待機していない。

## sub-agentを使う理由

追加sub-agentは使用していない。source normal reviewerへ同一finding lineageだけを渡す。

## 対象範囲

R001〜R008のowner-fenced lease、partial-lock recovery、root-confined Node mutation、startup transaction、snapshot cleanup、custom-store/child-process matrix、Output lifecycle sinkと、R009のdesign/JSDoc/handoff/trackingを対象にした。新規review観点は追加していない。

## 対象外

T604-R001〜R009以外、T605以降、履歴削除、BreakingChanges追加、CI、Extension Host、commit/push/PR/merge/self-reviewは対象外である。

## 実行コマンド

Redは前任R2の`npm run test:t604`のmonotonic clock binding failureを引き継いだ。Greenは`npm run test:t604`、`npm run build`、`npm run compile:test`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check`を各1回実行し成功した。Markdown wordingは`tools/lint/`と`lint:md`がなくfocused/fullとも`unsupported`（source reviewのH604-001を維持）である。CIはnot-run / merge-gate-heldである。

## 対象ファイル

`storage-root-lock.ts`、root-confined atomic store、history/snapshot/cache/startup composition、snapshot tracker、operation feedback、extension/runtime composition、T604 focused fixture、design、handoff、trackingを更新した。`Design/BreakingChanges.md`は新規の破壊的外部契約変更がないため未変更である。

## 指摘事項

### T604-R001 — High — closed

acquire boundはmonotonic elapsed timeへ切替えた。所有者descriptorとtokenを保持し、recoveryは旧inodeをrenameしてもsuccessorを復元・削除しない。leaseはoperation前後とpublish前に`assertOwned`でcurrent owner generationを照合し、detached ownerを`StorageRootLeaseLostError`でfail closedにする。releaseはsuccessor pathを削除せずexpired化する。deterministic expiry/recovery/fencing fixtureがGreenである。

### T604-R002 — High — closed

`writeLease`、`syncLease`、`closeLease` fault seamでpartial acquireをinjectし、作成ownerがbest-effort cleanup後にrootを再取得できることを固定した。malformed lockはmtime+leaseでのみ回復し、owned child-process kill後もexpiry前はlive lockを奪わず、expiry後にbounded recoveryする。

### T604-R003 — High — closed

Node atomic storeはconfigured rootのphysical descendantへ最終read/write/delete/renameを解決し、logical ancestor link/junctionを拒否する。history、snapshot、cache、startup migrationは同じroot guardを通す。POSIX symlink / Windows junction fixtureは外部sentinel不変を固定する。

### T604-R004 — High — closed

startup rootごとのstate migration、history migration、snapshot metadata migrationを一つのcross-process lease transactionへ統合し、phase間でowner fenceを確認する。通常state/history/snapshot writerと同一root lockを共有するため、古いstartup planが後続publishを覆わない。

### T604-R005 — High — closed

production trackerはNode storageの`putAndCleanup` transactionを用い、snapshot write、latest-pointer read、protected set、retention/count/byte plan、delete直前pointer postconditionを単一root leaseに統合した。複数active pointerとbyte-bounded unreferenced generation fixtureがGreenである。

### T604-R006 — High — closed

custom `AtomicTextFileStore`は既存in-process coordinatorでhost filesystem lockを作成せず、T506 custom-store 2 regressionは`test:t604`に含めてGreenを維持した。default Node storeはowned child-process live refusal/release/kill recoveryを実processで固定した。exact-head CIは実行禁止のためmerge gateとしてのみheldである。

### T604-R007 — Medium — closed

`test:t604`はCI required stepに配線済みで、R001/R002のowner/partial/kill、R003 root escape、R005 active pointers、T506 custom-storeを一つのowned/bounded commandに含める。same-process queueだけに依存しないchild-process fixtureを追加した。

### T604-R008 — Medium — closed

startup/state/history/cache/snapshotは一つのkind-only sinkで`Review Range` Output lifecycleへ接続した。startupがOutput hostより先でもpending kind-only eventを一度だけflushし、path、repository ID、source、owner tokenを出力しない。

### T604-R009 — Low — closed

designはmonotonic owner fencing、successor-safe recovery、Output lifecycleを表現し、JSDoc、handoff、tasks/phasesをR2 evidenceへ同期した。handoffはtechnical fix HEAD `f1cb025e3008bb861ac6c673831a3c7b2d8e30e8`、CIをnot-run/merge-gate-heldとしている。

## 結果

`npm run test:t604`はT604 13件とT506 custom-store 2件、計15件pass。build、compile:test、contracts typecheck、lint、architecture positive/negative、diff checkは成功した。R001〜R009のclosure conditionをこのevidenceで満たす。CIは未実行であり、exact-head CI successだけをPR merge gateとしてheldにする。

## リスク

このfollow-upの既存findingに未達closure conditionはない。CIは本タスクの明示禁止により起動・待機していないため、commit/push後のexact-head CIだけがmerge前の外部gateである。

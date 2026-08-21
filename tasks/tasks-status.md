# Review Range Tracker タスク状況

> 更新ルール: このファイルは `task-breakdown-planner`、`task-consistency-manager`、または `progress-sync-manager` を通してのみ更新する。

## 現在位置

- 設計根拠: `doc/design/vscode-review-range-tracker-design.md` rev5
- GitHub Issue: #81
- 現在のPhase: P1 ローカル行範囲管理（完了）、P2 編集・Git差分追従（完了）、P3 diff editorとPR進捗（完了）、P4 GitHub PR連携（完了）、P5 Global確認済みと理解率（完了）、P6 Gitなし対応と堅牢化（進行中）
- 直近実装タスク: T607 大規模処理の段階表示と性能改善（Issue #79、PR #80、squash merge `3bba5defe32b7da134817492427e09c70c97beaf`）
- 現在のタスク: T609 / Issue #81 Git repository解決とmixed encoding耐障害化
- 次のタスク: T609の一度限りの全範囲independent final reviewをfresh sol high reviewerで実施する
- 実装状態: T405、T406、T506、T603〜T607はmainへ統合済み。T607はPR #80をsquash mergeし、merge commit `3bba5defe32b7da134817492427e09c70c97beaf`で統合済み
- 独立review verdict: T506とT603はいずれも一度限りの全範囲独立review後、同一reviewerのfinding限定closureで`pass_with_held`。T604はPR #73をsquash mergeし、merge `64e47c590960a810a2439bd33f250ecbda9c41bf`、exact-head CI `32367553522` Greenで統合済み。T605は一度限りのindependent reviewでIFR001〜003を確定し、same reviewer closure R2で全件closed、`pass_with_held`
- ブロッカー: なし
- Gitブランチ: `task/issue-81-repository-encoding`
- Pull Request: #82（draft。設計commit `68951cd`を公開済み。通常review 7 findingsは全件closed。full local gate実施済みで、独立review・final exact-head CIは未完了）
- T609 reports: 通常review 7 findingsはR3 closureで全件closed。`test:t609` 52/52、actual Extension Host functional phaseはGreen。full local gateはstatic 6/6、Git 35/35、GitHub 48/48、T502 11/11、通常VS Code Host全phase Green。unitは既知Windows/POSIX path 19件、SIGKILL診断1件、owned Host cleanup 2件の計22件でfailしheld。T609/changed-file failureは0。Markdown lintとexact-head CIもheld
- T605 R2 follow-up: `reports/issue-74-t605-normal-review-followup-r2-20260820215110.md`。R001のtyped snapshot-aware commit/receiver保持とR006のconcrete focused compositionを記録
- T605 independent R2 follow-up: `reports/issue-74-t605-independent-review-followup-r2-20260820223327.md`。IFR001〜003のRed/Greenとlocal validationを記録
- PR #68 R2実装: `reports/issue-66-pr68-review-followup-r2-20260820081608.md`。`origin/main`（PR #69）統合とPR68-R002/R003のRed/Green/local validationを記録
- PR #68 R2通常closure: `reports/issue-66-pr68-finding-closure-r2-20260820082607.md`。PR68-R002/R003はclosed、normal verdictは`pass_with_held`
- PR #68独立review: `reports/issue-66-pr68-independent-final-review-20260820082950.md`。IFR001 High、IFR002 Medium、IFR003 Lowで`fail`
- PR #68独立finding対応: `reports/issue-66-pr68-independent-review-followup-20260820083815.md` と `handoffs/issue-66-pr68-independent-review-followup-20260820083815.yaml`。IFR001〜003の実装・tracking/handoff同期・外部metadata更新factsを記録
- PR #68 IFR001 R2対応: `reports/issue-66-pr68-independent-review-followup-r2-20260820085010.md`。copied original source reuseを許可しつつcase-fold current identity collisionをfail-closedに維持する
- PR #69 independent final review: `reports/issue-67-pr69-independent-final-review-20260820074231.md` は High finding 2件で`fail`
- PR #69 finding follow-up: `reports/issue-67-pr69-independent-review-followup-20260820075225.md`。immutable present-side open、公開host/selection contract、Breaking Changes、回帰testを同一batchで更新し、通常review・fix verification待ち
- T404実装レポート: `reports/issue-1-t404-implementation-20260806185200.md`
- T404 implementation handoff: `reports/issue-1-t404-handoff-20260806185200.yaml`
- T404初回通常レビューレポート: `reports/issue-1-t404-review-20260806191327.md`
- T404 review handoff: `reports/issue-1-t404-review-handoff-20260806191327.yaml`
- T404通常review指摘対応レポート: `reports/issue-1-t404-review-followup-20260806194000.md`
- T404初回finding fix verificationレポート: `reports/issue-1-t404-fix-verification-20260806194858.md`
- T404 fix verification handoff: `reports/issue-1-t404-fix-verification-handoff-20260806194858.yaml`
- T404通常review指摘対応R2レポート: `reports/issue-1-t404-review-followup-r2-20260806204500.md`
- T404通常review指摘対応R2 handoff: `reports/issue-1-t404-review-followup-r2-handoff-20260806204500.yaml`
- T404 fix verification R2レポート: `reports/issue-1-t404-fix-verification-r2-20260807052300.md`
- T404 fix verification R2 handoff: `reports/issue-1-t404-fix-verification-r2-handoff-20260807052300.yaml`
- T404通常review指摘対応R3レポート: `reports/issue-1-t404-review-followup-r3-20260807054902.md`
- T404通常review指摘対応R3 handoff: `reports/issue-1-t404-review-followup-r3-handoff-20260807054902.yaml`
- T404 fix verification R3レポート: `reports/issue-1-t404-fix-verification-r3-20260807062200.md`
- T404 fix verification R3 handoff: `reports/issue-1-t404-fix-verification-r3-handoff-20260807062200.yaml`
- T404 fix verification R4レポート: `reports/issue-1-t404-fix-verification-r4-20260808124303.md`
- T404独立最終reviewレポート（予約済み）: `reports/issue-1-t404-independent-final-review-20260808124303.md`
- T404 merge commit: `b71db2f0f5230903c8fb5d4d92d4b8fcc7b5447b`
- T602実装レポート: `reports/issue-1-t602-implementation-20260806195000.md`
- T602通常reviewレポート: `reports/issue-1-t602-review-20260806203300.md`
- T602 fix verification R3レポート: `reports/issue-1-t602-fix-verification-r3-20260808130824.md`
- T602独立最終reviewレポート（予約済み）: `reports/issue-1-t602-independent-final-review-20260808130824.md`
- T602 merge commit: `3ec96646442e8b05c39eb8c68b15918b0a038536`
- T505通常review finding closureレポート: `reports/issue-1-t505-fix-verification-r2-20260808135616.md`
- T505独立最終reviewレポート（予約済み）: `reports/issue-1-t505-independent-final-review-20260808135616.md`
- T505 merge commit: `c4788314cec0dc1d05c86451caa33ba3f9554cb0`
- T405独立reviewレポート: `reports/issue-1-t405-independent-final-review-20260817080505.md`
- T405独立review finding対応レポート: `reports/issue-1-t405-independent-review-followup-20260817081448.md`
- T405独立review finding対応R2レポート: `reports/issue-1-t405-independent-review-followup-r2-20260817083317.md`
- T506独立reviewレポート: `reports/issue-1-t506-independent-final-review-20260817085641.md`
- T506独立review finding closureレポート: `reports/issue-1-t506-independent-finding-closure-20260817091926.md`
- T506 merge commit: `8dd8aacbce3c0afb7a2d15091f970e96ec141561`
- T603独立reviewレポート: `reports/issue-1-t603-independent-final-review-20260817093112.md`
- T603独立review finding closure R3レポート: `reports/issue-1-t603-independent-finding-closure-r3-20260817100415.md`
- T604通常review finding closure R3レポート: `reports/issue-72-t604-normal-finding-closure-r3-20260820195213.md`
- T604 independent finding follow-up report: `reports/issue-72-t604-independent-review-followup-20260820201341.md`
- T603 merge commit: `8cbdaa55176105cb02dcd071f2fd9bbcb8484706`
- T306実装レポート: `reports/issue-1-t306-implementation-20260806113611.md`
- T306 Extension Host runner follow-upレポート: `reports/issue-1-t306-extension-host-runner-followup-20260806115832.md`
- T306通常レビューレポート: `reports/issue-1-t306-review-20260806120847.md`
- T306通常review指摘対応レポート: `reports/issue-1-t306-review-followup-20260806121906.md`
- T306通常review finding修正確認レポート: `reports/issue-1-t306-fix-verification-20260806131859.md`
- T306通常review指摘対応R2レポート: `reports/issue-1-t306-review-followup-r2-20260806132432.md`
- T306通常review finding修正確認R2レポート: `reports/issue-1-t306-fix-verification-r2-20260806134727.md`
- T306独立最終レビューレポート: `reports/issue-1-t306-independent-final-review-20260806135357.md`
- T403実装レポート: `reports/issue-1-t403-implementation-20260805050632.md`
- T403 handoff: `reports/issue-1-t403-handoff-20260805050632.yaml`
- T403通常レビューレポート: `reports/issue-1-t403-review-20260805061700.md`
- T403 review follow-upレポート: `reports/issue-1-t403-review-followup-20260805063000.md`
- T403 review follow-up handoff: `reports/issue-1-t403-review-followup-handoff-20260805063000.yaml`
- T501独立レビューレポート: `reports/issue-1-t501-independent-final-review-20260802090100.md`
- T501独立レビュー指摘対応レポート: `reports/issue-1-t501-independent-review-followup-20260802134500.md`
- T501独立finding closureレポート: `reports/issue-1-t501-independent-fix-verification-20260802141500.md`
- T501独立レビュー指摘対応R2レポート: `reports/issue-1-t501-independent-review-followup-r2-20260802144500.md`
- T501独立finding closure R2レポート: `reports/issue-1-t501-independent-fix-verification-r2-20260802150000.md`
- T504実装レポート: `reports/issue-1-t504-implementation-20260802211500.md`
- T504通常レビューレポート: `reports/issue-1-t504-review-20260802214103.md`
- T504 review follow-up R2レポート: `reports/issue-1-t504-review-followup-r2-20260802224000.md`
- T504 fix verification R2レポート: `reports/issue-1-t504-fix-verification-r2-20260802224600.md`
- T504独立最終レビューレポート: `reports/issue-1-t504-independent-final-review-20260803062200.md`
- T504独立review follow-upレポート: `reports/issue-1-t504-independent-review-followup-20260803083000.md`
- T402実装レポート: `reports/issue-1-t402-implementation-20260802215000.md`
- T402通常レビューレポート: `reports/issue-1-t402-review-20260802221650.md`
- T402 review follow-upレポート: `reports/issue-1-t402-review-followup-20260802225300.md`
- T402 fix verificationレポート: `reports/issue-1-t402-fix-verification-20260802230000.md`
- T402残存finding follow-upレポート: `reports/issue-1-t402-fix-verification-followup-20260802233000.md`
- T402独立最終レビューレポート: `reports/issue-1-t402-independent-final-review-20260803062300.md`
- T402独立review follow-upレポート: `reports/issue-1-t402-independent-review-followup-20260803091500.md`
- T001実装レポート: `reports/issue-1-t001-implementation-20260723104931.md`
- T001レビューレポート: `reports/issue-1-t001-review-20260723110231.md`
- T002実装レポート: `reports/issue-1-t002-implementation-20260723111412.md`
- T002初回レビューレポート: `reports/issue-1-t002-review-20260723112423.md`
- T002修正レポート: `reports/issue-1-t002-rework-20260723112951.md`
- T002再レビューレポート: `reports/issue-1-t002-rereview-20260723113759.md`
- T002追加修正レポート: `reports/issue-1-t002-rework-2-20260723114207.md`
- T002最終レビューレポート: `reports/issue-1-t002-rereview-2-20260723114440.md`
- T003実装レポート: `reports/issue-1-t003-implementation-20260723114808.md`
- T003初回レビューレポート: `reports/issue-1-t003-review-20260723115746.md`
- T003修正レポート: `reports/issue-1-t003-rework-20260723120313.md`
- T003最終レビューレポート: `reports/issue-1-t003-rereview-20260723120507.md`
- T101実装レポート: `reports/issue-1-t101-implementation-20260723123000.md`
- T101レビューレポート: `reports/issue-1-t101-review-20260723123200.md`
- T101独立再レビューレポート: `reports/issue-1-t101-review-r2-20260723123638.md`
- T101 review follow-upレポート: `reports/issue-1-t101-review-followup-20260723124645.md`
- T101最終再レビューレポート: `reports/issue-1-t101-review-r3-20260723125125.md`
- T102実装レポート: `reports/issue-1-t102-implementation-20260723132500.md`
- T102レビューレポート: `reports/issue-1-t102-review-20260723133000.md`
- T102初回レビューレポート: `reports/issue-1-t102-review-20260723132249.md`
- T102 review follow-upレポート: `reports/issue-1-t102-review-followup-20260723133429.md`
- T102最終再レビューレポート: `reports/issue-1-t102-review-r2-20260723134447.md`
- T103実装レポート: `reports/issue-1-t103-implementation-20260723135000.md`
- T103レビューレポート: `reports/issue-1-t103-review-20260723135500.md`
- T103独立再レビューレポート: `reports/issue-1-t103-review-r2-20260723140033.md`
- T103 review follow-upレポート: `reports/issue-1-t103-review-followup-20260723140931.md`
- T103最終再レビューレポート: `reports/issue-1-t103-review-r3-20260723141902.md`
- T104実装レポート: `reports/issue-1-t104-implementation-20260723142500.md`
- T104レビューレポート: `reports/issue-1-t104-review-20260723143000.md`
- T104独立再レビューレポート: `reports/issue-1-t104-review-r2-20260723144001.md`
- T104 review follow-upレポート: `reports/issue-1-t104-review-followup-20260723144622.md`
- T104再レビューレポート: `reports/issue-1-t104-review-r3-20260723145327.md`
- T104追加review follow-upレポート: `reports/issue-1-t104-review-followup-r2-20260723145703.md`
- T104最終再レビューレポート: `reports/issue-1-t104-review-r4-20260723150344.md`
- T104-2復旧実装レポート: `reports/issue-1-t104-2-implementation-20260724205127.md`
- T104-2初回レビューレポート: `reports/issue-1-t104-2-review-20260724210309.md`
- T104-2最終再レビューレポート: `reports/issue-1-t104-2-review-r2-20260724211200.md`
- T105実装レポート: `reports/issue-1-t105-implementation-20260723155600.md`
- T105レビューレポート: `reports/issue-1-t105-review-20260723155800.md`
- T106実装レポート: `reports/issue-1-t106-implementation-20260723175644.md`
- T106レビューレポート: `reports/issue-1-t106-review-20260723175800.md`
- T107実装レポート: `reports/issue-1-t107-implementation-20260723201924.md`
- T107レビューレポート: `reports/issue-1-t107-review-20260723201924.md`
- T108調査レポート: `reports/issue-1-t108-investigation-20260723225437.md`
- T108実装レポート: `reports/issue-1-t108-implementation-20260723230550.md`
- T108初回レビューレポート: `reports/issue-1-t108-review-20260723231514.md`
- T108 review follow-upレポート: `reports/issue-1-t108-review-followup-20260723232037.md`
- T108最終再レビューレポート: `reports/issue-1-t108-review-r2-20260723232331.md`
- T109調査レポート: `reports/issue-1-t109-investigation-20260724201518.md`
- T109実装レポート: `reports/issue-1-t109-implementation-20260724202210.md`
- T109要件変更follow-upレポート: `reports/issue-1-t109-requirement-followup-20260724203235.md`
- T109レビューレポート: `reports/issue-1-t109-review-20260724202930.md`
- T201実装レポート: `reports/issue-1-t201-implementation-20260723142751.md`
- T201初回レビューレポート: `reports/issue-1-t201-review-20260723142751.md`
- T201独立再レビューレポート: `reports/issue-1-t201-review-r2-20260724193522.md`
- T201 review follow-upレポート: `reports/issue-1-t201-review-followup-20260724194226.md`
- T201最終再レビューレポート: `reports/issue-1-t201-review-r3-20260724194817.md`
- T202実装レポート: `reports/issue-1-t202-implementation-20260723143500.md`
- T202初回レビューレポート: `reports/issue-1-t202-review-20260723144000.md`
- T202独立再レビューレポート: `reports/issue-1-t202-review-r2-20260724195352.md`
- T202 review follow-upレポート: `reports/issue-1-t202-review-followup-20260724200119.md`
- T202最終再レビューレポート: `reports/issue-1-t202-review-r3-20260724200649.md`
- T300実装レポート: `reports/issue-1-t300-implementation-20260724205000.md`
- T300初回レビューレポート: `reports/issue-1-t300-review-20260724205100.md`
- T300 R2レビューレポート: `reports/issue-1-t300-review-r2-20260724212500.md`
- T300 review follow-upレポート: `reports/issue-1-t300-review-followup-20260724214500.md`
- T203実装レポート: `reports/issue-1-t203-implementation-20260724204000.md`
- T203初回レビューレポート: `reports/issue-1-t203-review-20260724212419.md`
- T203 review follow-upレポート: `reports/issue-1-t203-review-followup-20260724213540.md`
- T203再レビューレポート: `reports/issue-1-t203-review-r2-20260724214315.md`
- T203追加review follow-upレポート: `reports/issue-1-t203-review-followup-r2-20260724215028.md`
- T203最終再レビューレポート: `reports/issue-1-t203-review-r3-20260724215350.md`
- T300 R5レビューレポート: `reports/issue-1-t300-review-r5-20260725074608.md`
- T300 R5 review follow-upレポート: `reports/issue-1-t300-review-followup-r5-20260725080046.md`
- T300 R6レビューレポート: `reports/issue-1-t300-review-r6-20260725081226.md`
- T300 R6 review follow-upレポート: `reports/issue-1-t300-review-followup-r6-20260725082128.md`
- T300 R7最終再レビューレポート: `reports/issue-1-t300-review-r7-20260725082924.md`
- T302実装レポート: `reports/issue-1-t302-implementation-20260725102242.md`
- T302レビューレポート: `reports/issue-1-t302-review-20260725102242.md`
- T302再レビュー対応レポートR2: `reports/issue-1-t302-review-followup-r2-20260725143000.md`
- T302最終再レビューレポートR2: `reports/issue-1-t302-review-r2-20260725143500.md`
- T302レビュー対応レポートR3: `reports/issue-1-t302-review-followup-r3-20260725160000.md`
- T302最終再レビューレポートR3: `reports/issue-1-t302-review-r3-20260725160500.md`
- T302レビュー対応レポートR4: `reports/issue-1-t302-review-followup-r4-20260725164000.md`
- T302最終再レビューレポートR4: `reports/issue-1-t302-review-r4-20260725164500.md`
- T302レビュー対応レポートR5: `reports/issue-1-t302-review-followup-r5-20260726113000.md`
- T302最終再レビューレポートR5: `reports/issue-1-t302-review-r5-20260726113500.md`
- T302 current main統合レポート: `reports/issue-1-t302-main-integration-20260726160000.md`
- T302 R6レビューレポート: `reports/issue-1-t302-review-r6-20260726160636.md`
- T302 R6 review follow-upレポート: `reports/issue-1-t302-review-followup-r6-20260726163000.md`
- T302 R7最終再レビューレポート: `reports/issue-1-t302-review-r7-20260726162652.md`
- T302進捗同期レポート: `reports/issue-1-t302-progress-sync-20260726162652.md`
- T204 current main統合レポート: `reports/issue-1-t204-main-integration-20260726131355.md`
- T204設計更新レポート: `reports/issue-1-t204-design-update-20260726132156.md`
- T204 R9レビューレポート: `reports/issue-1-t204-review-r9-20260726132635.md`
- T204 R9 review follow-upレポート: `reports/issue-1-t204-review-followup-r9-20260726133527.md`
- T204 R10レビューレポート: `reports/issue-1-t204-review-r10-20260726134419.md`
- T204 R10 review follow-upレポート: `reports/issue-1-t204-review-followup-r10-20260726135004.md`
- T204 R11レビューレポート: `reports/issue-1-t204-review-r11-20260726135810.md`
- T204 R11 review follow-upレポート: `reports/issue-1-t204-review-followup-r11-20260726140411.md`
- T204 R12レビューレポート: `reports/issue-1-t204-review-r12-20260726141246.md`
- T204 R12 review follow-upレポート: `reports/issue-1-t204-review-followup-r12-20260726143000.md`
- T204 R13最終再レビューレポート: `reports/issue-1-t204-review-r13-20260726142730.md`
- T204進捗同期レポート: `reports/issue-1-t204-progress-sync-20260726142730.md`
- T205実装レポート: `reports/issue-1-t205-implementation-20260801150646.md`
- T205初回レビューレポート: `reports/issue-1-t205-review-20260801155600.md`
- T205 review follow-upレポート: `reports/issue-1-t205-review-followup-20260801160638.md`
- T205 fix verificationレポート: `reports/issue-1-t205-review-r2-20260801164200.md`
- T205進捗同期レポート: `reports/issue-1-t205-progress-sync-20260801172324.md`
- T205 R3レビューレポート: `reports/issue-1-t205-review-r3-20260801173000.md`
- T205 R3 review follow-upレポート: `reports/issue-1-t205-review-followup-r3-20260801180000.md`
- T205 R4 fix verificationレポート: `reports/issue-1-t205-review-r4-20260801190000.md`
- T205 R4 review follow-upレポート: `reports/issue-1-t205-review-followup-r4-20260801193000.md`
- T205 R5 fix verificationレポート: `reports/issue-1-t205-review-r5-20260801202000.md`
- T205 R5 review follow-upレポート: `reports/issue-1-t205-review-followup-r5-20260801210000.md`
- T205 R6 fix verificationレポート: `reports/issue-1-t205-review-r6-20260801214000.md`
- T205 R6 review follow-upレポート: `reports/issue-1-t205-review-followup-r6-20260801221000.md`
- T205 R7 fix verificationレポート: `reports/issue-1-t205-review-r7-20260801224000.md`
- T205 R7 review follow-upレポート: `reports/issue-1-t205-review-followup-r7-20260801231000.md`
- T205 R8最終fix verificationレポート: `reports/issue-1-t205-review-r8-20260801234000.md`
- T205独立レビュー1回目レポート: `reports/issue-1-t205-independent-final-review-20260801172324.md`
- T205 IFR1設計更新レポート: `reports/issue-1-t205-ifr1-design-update-20260801194500.md`
- T205 IFR1-P1 review follow-upレポート: `reports/issue-1-t205-independent-review-followup-20260801194000.md`
- T205 IFR1-P2 review follow-upレポート: `reports/issue-1-t205-independent-review-followup-p2-20260801201500.md`
- T205 IFR1検証レポート: `reports/issue-1-t205-ifr1-verification-20260801204500.md`
- T205 IFR1 focused fix verificationレポート: `reports/issue-1-t205-ifr1-fix-verification-20260801213000.md`
- T205 IFR1-P2 R2 review follow-upレポート: `reports/issue-1-t205-independent-review-followup-p2-r2-20260801215500.md`
- T205 IFR1 focused fix verification R2レポート: `reports/issue-1-t205-ifr1-fix-verification-r2-20260801222500.md`
- T205独立最終レビュー2回目レポート: `reports/issue-1-t205-independent-final-review-r2-20260801192938.md`
- T206実装レポート: `reports/issue-1-t206-implementation-20260801215844.md`
- T206初回通常レビューレポート: `reports/issue-1-t206-review-20260801223000.md`
- T206 review follow-upレポート: `reports/issue-1-t206-review-followup-20260801224500.md`
- T206 fix verificationレポート: `reports/issue-1-t206-fix-verification-20260801230500.md`
- T206独立最終レビューレポート: `reports/issue-1-t206-independent-final-review-20260801233000.md`
- T206独立review follow-upレポート: `reports/issue-1-t206-independent-review-followup-20260801235500.md`
- T206独立finding fix verificationレポート: `reports/issue-1-t206-independent-fix-verification-20260802002000.md`
- T206独立review follow-up R2レポート: `reports/issue-1-t206-independent-review-followup-r2-20260802003500.md`
- T206独立finding最終fix verificationレポート: `reports/issue-1-t206-independent-fix-verification-r2-20260802005000.md`
- T207実装レポート: `reports/issue-1-t207-implementation-20260802011000.md`
- T207通常レビューレポート: `reports/issue-1-t207-review-20260802013500.md`
- T207 review follow-upレポート: `reports/issue-1-t207-review-followup-20260802015000.md`
- T207 fix verificationレポート: `reports/issue-1-t207-fix-verification-20260802021500.md`
- T207独立最終レビューレポート: `reports/issue-1-t207-independent-final-review-20260802024500.md`
- T207独立review follow-upレポート: `reports/issue-1-t207-independent-review-followup-20260802031000.md`
- T207独立finding通常verificationレポート: `reports/issue-1-t207-independent-finding-normal-verification-20260802034500.md`
- T207独立finding closure限定verificationレポート: `reports/issue-1-t207-independent-fix-verification-20260802034530.md`
- T303独立最終レビューレポート: `reports/issue-1-t303-independent-final-review-20260802090000.md`
- T303独立review follow-upレポート: `reports/issue-1-t303-independent-review-followup-20260802093100.md`
- T303独立finding fix verificationレポート: `reports/issue-1-t303-independent-fix-verification-20260802103000.md`
- T303独立review follow-up R2レポート: `reports/issue-1-t303-independent-review-followup-r2-20260802110000.md`
- T303独立finding closure R2レポート: `reports/issue-1-t303-independent-fix-verification-r2-20260802113000.md`
- T401独立最終レビューレポート: `reports/issue-1-t401-independent-final-review-20260802090030.md`
- T401独立review follow-upレポート: `reports/issue-1-t401-independent-review-followup-20260802121500.md`
- T401独立finding closureレポート: `reports/issue-1-t401-independent-fix-verification-20260802124500.md`
- T601独立最終レビューレポート: `reports/issue-1-t601-independent-final-review-20260802093000.md`
- T601独立review follow-upレポート: `reports/issue-1-t601-independent-review-followup-20260802154500.md`
- T601独立finding closureレポート: `reports/issue-1-t601-independent-fix-verification-20260802163000.md`
- T601独立review follow-up R2レポート: `reports/issue-1-t601-independent-review-followup-r2-20260802170000.md`
- T601独立finding closure R2レポート: `reports/issue-1-t601-independent-fix-verification-r2-20260802173000.md`
- T503独立最終レビューレポート: `reports/issue-1-t503-independent-final-review-20260802093030.md`
- T503独立review follow-upレポート: `reports/issue-1-t503-independent-review-followup-20260802181500.md`
- T301実装レポート: `reports/issue-1-t301-implementation-20260725094000.md`
- T301 current main統合レポート: `reports/issue-1-t301-main-integration-20260726144530.md`
- T301設計更新レポート: `reports/issue-1-t301-design-update-20260726145300.md`
- T301初回レビューレポート: `reports/issue-1-t301-review-20260725095025.md`
- T301 R2レビューレポート: `reports/issue-1-t301-review-r2-20260725101507.md`
- T301 R3レビューレポート: `reports/issue-1-t301-review-r3-20260725131530.md`
- T301 R4レビューレポート: `reports/issue-1-t301-review-r4-20260725134500.md`
- T301 R5レビューレポート: `reports/issue-1-t301-review-r5-20260725151610.md`
- T301 R6レビューレポート: `reports/issue-1-t301-review-r6-20260725154116.md`
- T301 R7レビューレポート: `reports/issue-1-t301-review-r7-20260725162649.md`
- T301 R8レビューレポート: `reports/issue-1-t301-review-r8-20260726145022.md`
- T301 R8 review follow-upレポート: `reports/issue-1-t301-review-followup-r8-20260726151000.md`
- T301 R9レビューレポート: `reports/issue-1-t301-review-r9-20260726151101.md`
- T301 R9 review follow-upレポート: `reports/issue-1-t301-review-followup-r9-20260726152000.md`
- T301 R10最終再レビューレポート: `reports/issue-1-t301-review-r10-20260726152625.md`
- T301進捗同期レポート: `reports/issue-1-t301-progress-sync-20260726152625.md`
- PR方針: 完了済み通常reviewと1名の独立reviewerによる証跡を保持する。独立reviewの広域確認は1回とし、fail後は同じ独立reviewerが既存findingのclosureだけを確認して新規観点・新規findingを追加しない。全finding closureと対象HEAD一致CI成功後に利用者がmergeする

## 状態と規模

| 値 | 意味 |
| --- | --- |
| 次 | 依存関係が解消済みで、次回選択する唯一のタスク |
| 未着手 | 依存タスクまたは前段の完了を待つタスク |
| 進行中 | 現在実装しているタスク。常に最大1件 |
| 完了 | 必要な検証、レビュー、進捗同期、task commitまで完了したタスク。Phase単位PRを指定された場合は最終task後にまとめて提出する |
| S | 0.5〜1日程度 |
| M | 2〜3日程度 |
| L | 4〜5日程度。超過見込みなら再分解する |

各タスクは、記載した検証に加えて、挙動実装では変更範囲の単体テスト、全タスクで専用レビューと進捗同期を通過してから完了とする。Markdown lintは本repositoryの完了条件に含めない。環境・scaffold-onlyタスクはテスト適用可否を明示し、test harnessを担当する後続タスクと重複させない。

## P0 開発基盤

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T001 | 完了 | M | VS Code TypeScript拡張のmanifest、ビルド、lint、CIを初期化する。現在`package.json`とlockfileを除外している`.gitignore`を修正し、再現可能な依存管理にする | なし | clean checkoutでinstall、build、lintが成功し、Extension Development Hostでactivationできる構造になっている |
| T002 | 完了 | M | `core`、`application`、`adapters`、`ui`の依存方向を定義し、設計書13章のlayer contractと共通model・設定contractを配置する | T001 | coreからVS Code、GitHub、Node filesystemへのimportがなく、設計依存行列とvalidatorが一致し、全型fixtureがcompileする |
| T003 | 完了 | M | 単体テスト、temporary Git repository統合テスト、mock GitHub、VS Code Extension Hostの共通fixtureと実行コマンドを整備する | T001、T002 | 4種類の最小テストが独立実行でき、失敗時にfixtureを後始末し、CIから同じコマンドを実行できる |

## P1 ローカル行範囲管理

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T101 | 完了 | M | 0始まり半開区間の正規化、長さ、検索、重複・隣接結合、減算・分割と、空選択・複数選択の行範囲変換を純粋ロジックで実装する | T003 | 0行、最終行、逆向き選択、重複、隣接、包含、部分解除の境界テストが通る。AC-04、AC-05を満たす |
| T102 | 完了 | M | Review State Serviceの範囲確認、解除、ファイル全体確認・解除、context/global更新用transaction contractを実装する | T101、T002 | 状態更新が正規化済みintervalだけを返し、ファイル全解除でoriginal側を含む全状態を消去し、未mapping revisionを拒否し、storage adapterがstale transactionを確実に検出でき、部分失敗で片側だけ更新されない。AC-01、AC-03〜AC-05のcore部分を満たす |
| T103 | 完了 | M | workspace folder、document URI、相対pathからworkspace context、file ID、非Git repository IDを安定生成する | T002、T003 | 同じworkspace/fileは再起動後も同じID、別rootは別IDとなり、Windows・POSIX・remote URI fixtureが通る |
| T104 | 完了 | L | Git・PR用`globalStorageUri`とGitなし用`storageUri`を選択する共通状態repositoryを実装し、manifest、context、schema version、atomic temp-write/flush/replace、書き込み失敗通知contractを定義する | T002、T003 | repository種別ごとに設計どおり保存先が分離され、保存中断で直前状態を壊さず、成功時だけメモリ状態を確定し、再読み込み結果が一致する。後続のhistory、cache、Global保存も同じrouting contractを利用できる |
| T104-2 | 完了 | M | T104のsquash merge後に旧worktreeへ残った最終レビュー修正を最新mainへ復旧し、同一instanceのsave/commit直列化、complete snapshot CAS、target/context identity、公開API documentationと恒久回帰testを反映する | T104、T105 | T104 focused test、T105の通常エディタ操作、T106の装飾、T107の保存・再起動復元が通り、全unit testにT104-2起因の新規失敗がない。origin/main由来のrelease contract既知失敗はheldとして明示し、build、lint、contract typecheck、architecture検証、専用レビューが通る |
| T105 | 完了 | M | 選択確認・解除、ファイル全体確認・解除の4コマンドを通常エディタへ接続し、ファイル全体操作だけ仕様どおり確認ダイアログを表示する | T102、T103、T104 | 単一・複数選択とカーソル1行が動き、キャンセル時は状態と履歴要求を変更しない。AC-01、AC-03、AC-06を満たす |
| T106 | 完了 | M | visible editorだけを対象に、テーマ対応グレー背景、ガター、任意overview ruler、確認日時とcontextのhoverを描画する | T102、T105 | editor切替・状態更新後100ms目標で装飾が更新され、未確認は通常背景になる。AC-02を満たす |
| T107 | 完了 | M | activation、deactivation、保存デバウンス、確認直後の即時保存、再起動復元を結ぶExtension Host試験を追加する | T101〜T106 | 再起動後に確認・解除状態と装飾が復元され、未保存の確認操作を成功表示しない。AC-23のローカル部分を満たす |
| T108 | 完了 | S | 初回`main`マージ時に`0.0.1-pre`のGitHub prereleaseを作成して同版のVSIXをRelease assetとして添付し、現時点で利用できる機能、インストール方法、使い方を日本語READMEへ記載する | T001、T107 | Release workflowが再現可能な依存導入、検証、`review-range-tracker-0.0.1-pre.vsix`生成・冪等な添付を行い、ローカルpackage検証が成功し、READMEの説明がmanifestと実装に一致し、専用レビューと進捗同期を通過する |
| T109 | 完了 | S | SSCのRelease workflowを基準に、`release: published`、`push: main`、version指定の`workflow_dispatch`、main更新ごとの動的pre-release version解決を移植し、NuGet配布部分だけをVSIXのGitHub Release assetへ置換する | T108 | 既存最新`0.0.1-pre`の次を`0.0.2-pre`とし、過去の未配布commitは補填せず、以後の各main pushでpatchを1ずつ進めたpre-releaseと同版VSIXを作成する。契約test、package検証、専用review、進捗同期を通過する |

## P2 編集・Git差分追従

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T201 | 完了 | L | `TextDocumentContentChangeEvent`相当の変更列を後方から適用するRange Mapping Engineを実装し、前方維持、後方shift、重複部分無効化、挿入未確認と`ignoreWhitespaceChanges`・`ignoreEolChanges`を扱う | T101、T102 | 挿入、削除、置換、複数変更、CRLF/LF、CR、空白変更を既定値`false`では無効化し、各設定が`true`の場合だけ該当差分を無視する。末尾改行1個の差と追加・削除空行を区別する単体テストを含め、最新`main`上の全検証と専用レビューが通る |
| T202 | 完了 | L | 引数配列で実行するLocal Git Adapterを実装し、Git可否、root、remote正規化、Repository ID、branch完全ref、detached HEAD、HEAD、merge-base、object有無を取得する | T003 | shell文字列連結がなく、remote有無、fork、detached HEAD、Git未導入をfixtureで識別できる。Windowsを含む最新`main`上のfocused・Git・全回帰testと専用レビューが通る |
| T203 | 完了 | L | `--unified=0 --find-renames`のdiff parserとrevision間interval mappingを実装し、hunk前後・重複・追加・削除と空白・EOL無視設定を処理する | T201、T202 | 連続commitと複数hunkで未変更行を維持し変更行だけを解除する。空白・EOLは既定値`false`で変更扱い、設定`true`でのみ無視される。AC-07、AC-08を満たす |
| T204 | 完了 | M | rename、directory move、rename同時変更、deleteをfile stateへ適用し、copy・分割・統合・複数候補を新規未確認にする | T203 | 100% renameと一意なrenameだけを追従し、曖昧なケースを確認済みにしない。AC-09、AC-10を満たす |
| T205 | 完了 | L | branch context resolver、detached commit context、Git状態監視、context revision更新と再計算を実装する | T104、T202〜T204 | branch切替で状態が分離され、commit追加後に正しいcontextへmappingされる。AC-12を満たす |
| T206 | 完了 | M | 設計書15.4のイベントをJSON Linesへ追記し、session、repository、context、revision、side、前後範囲、理由を保存する | T102、T104、T201〜T205 | 全操作とedit・Git diff・rename・context revision mapping結果が1イベントとして適切な保存先へ追記され、現在状態を履歴から毎回再構築しない |
| T207 | 完了 | L | edit、commit追加、branch切替、rename、deleteを連続実行するtemporary Git repository統合試験を追加する | T201〜T206 | AC-07〜AC-10、AC-12を一連の操作で再現し、再起動後もstateとhistoryが整合する |

## P3 diff editorとPR進捗

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T300 | 完了 | M | GitHub/Git変更fileに適用できる共通除外policyを実装し、既定glob、ユーザーglob、binary、除外理由、設定変更通知を定義する | T202 | pathとfile属性から除外理由を決定でき、VS Code設定変更で再評価され、上書き可能なeffective globと常時除外を分離し、単一backslash separatorと二重backslash literalを区別し、replay-safe canonical snapshotと設定入力上限を設け、PR進捗と後続Global集計が同じpolicyを利用できる |
| T301 | 完了 | L | PR change/hunk/lineモデルと、ユーザー除外を除いた追加・削除行だけを分母にするPR・file進捗calculatorを純粋ロジックで実装する | T102、T203、T300 | 追加、削除、置換、未変更周辺、Global混入防止、ユーザー除外、binary、rename-onlyのテストが通る。除外対象を分母に含めず理由を返す。AC-16を満たす |
| T302 | 完了 | L | context、file、filesystem semantics、side、immutable revision sourceを復元できる仮想URI codecとoriginal/modified content providerを実装する | T104、T202、T203 | URI round-trip、full commit別内容、missing/fatal分離、POSIX/Windows path、共通Git runtime、design test discovery、architecture positive/negative CI gate、metadata/blob timeout lifecycle、4 MiB超UTF-8、invalid encoding、actual VS Code URI、公開contractが決定的で、異なるcontextが衝突しない |
| T303 | 完了 | L | diff editorを開く処理と両側の選択・ファイル操作を実装し、T102 transaction contractをoriginal側のside・diff ID・削除範囲へ拡張して`originalReviewedByDiff`へ保存する | T206、T301、T302 | 両側で選択確認・解除が動く。ファイル全体確認はfocused sideに関係なくmodified全行とoriginal-only削除行を同時に確認し、全解除はcontext・Global・original削除行をすべて解除する。削除行が進捗へ反映される。AC-14、AC-15を満たす。PR #30の独立review全5 findingをclosureし、exact-head CI成功済み |
| T304 | 完了 | M | PR Progress Tree Viewを実装し、未確認、完了、除外、行以外の変更、行対象外を分類し、未確認数降順・path昇順で表示する。PR #38独立reviewの`T304-IFR-P1`〜`P4`をclosureしcurrent mainへ統合済み | T300、T301、T303 | 各fileの確認数、全変更数、率、追加、削除が一致し、ユーザー除外を理由付きで別表示し、選択でdiffを開く。AC-17を満たす。独立review全4 findingをclosureし、current mainへ統合済み |
| T305 | 完了 | M | Activity Bar、Current Context View、Status Bar、refresh/select contextの最小UIを実装する | T103、T205、T304 | PR相当、branch、workspaceの表示が切り替わり、再計算後にTreeとStatus Barが同期する。独立review findingsをclosureし、PR #42をcurrent mainへ統合済み |
| T306 | 完了 | L | local base/headをPR相当として、diff両側操作から進捗UI更新までのExtension Host試験を追加する | T300〜T305 | AC-14〜AC-17の実UI/runtime操作、両paneのファイル全体確認・全解除、ユーザー除外の分母除外と別表示、rename-only、binary、bounded runner/cleanupを検証した。通常review findingsをclosedし、全範囲独立review `pass_with_held`、exact-head CI成功後にPR #45をcurrent mainへsquash merge済み |

## P4 GitHub PR連携

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T401 | 完了 | L | VS Code認証APIとGitHub Adapter、remoteからのhost/owner/repository解決、認証sessionまたは公開repositoryの未認証APIによるHEAD対応PR検索、0・1・複数候補のresolverを実装する。PR #31で通常review済み後、独立reviewの7 findingを一括修正した | T202、T205 | 1件は自動選択、複数はユーザー選択、0件または選択取消はbranchへ戻る。認証なしでも公開repository APIを試し、rate limit・network・API失敗時だけbranchへフォールバックしてローカル操作を止めない。configured Enterprise authority以外へtokenを渡さず、T202 canonical remote identity（case/default・nondefault port）を共有し、malformed/cyclic API応答もbranch fallbackへ遷移する。独立review全7 findingをaddressed、exact-head CI成功済み |
| T402 | 完了 | L | PR metadata/file取得と、local Git diff、PR files API patch、base/head内容差分の3段フォールバックを実装する。local Gitのtextconv無効化、rename/copy検出上限、patchless binary分類、GitHub pagination・changed file完全性、duplicate lineの曖昧alignmentをfail closedにする | T203、T301、T401 | raw blob座標に基づくcomplete immutable snapshotだけを返し、不完全、stale、曖昧、上限超過は理由付きで拒否する。通常review、fix verification、独立review findingをclosureし、PR #40をcurrent mainへ統合済み |
| T403 | 完了 | M | GitHub metadata・source-redacted diff cache、期限、最終更新時刻、429・network failure限定offline読込、fresh/stale表示、pointer-last atomic publicationを実装した | T104、T402 | tokenとsource本文を永続化せず、exact context/repository/PR/base/head cacheだけを利用する。mixed `rate-limit/network`・`api`ではfail closed、patch欠落・不完全後のnetwork failureではfallbackを維持する。通常reviewと一度限りの独立review findingsをclosureし、PR #44をcurrent mainへ統合済み |
| T404 | 完了 | L | host/owner/repository/PR番号のcontext ID、base/head revision更新、open/closed/merged保存、複数PRレイヤー状態を`globalStorageUri`へ実装した | T104、T205、T401、T403 | 通常reviewと一度限りの全範囲独立review findingsをclosedし、PR #48をcurrent mainへsquash merge済み |
| T405 | 完了 | L | Review Contexts View、PR再検出、GitHub再接続、cache更新、layer切替、context表示削除、closed PR diff表示を実装した | T302、T304、T305、T404 | 通常reviewと独立review closureを完了し、PR #54をmerge commit `11c2d517` でmainへ統合済み |
| T406 | 完了 | L | GitHub障害・複数PR・closed PR統合試験を実装した | T401〜T405 | PR #71のreview closureを完了し、merge commit `96057f9edc95a8f38bfc01da39eae350c29e9c39`でmainへ統合済み |

## P5 Global確認済みと理解率

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T501 | 完了 | L | Repository Global State repositoryを実装し、確認・解除・ファイル操作を現在contextとGlobalへatomicに反映して履歴を残す | T102、T104、T206 | PR、branch、workspaceの確認がGlobalへ反映され、解除は参照数に関係なくGlobalからも消える。独立review findingをclosed、exact-head CI成功済み |
| T502 | 完了 | L | edit、Git diff、renameによるGlobal mappingと、現在PR未確認変更を最優先する6段階の表示優先順位を実装する | T106、T201、T203、T204、T501 | 現在PR変更行はGlobalだけでグレーにならず、曖昧・変更済みは通常背景になる。通常review・独立review findingをclosureし、PR #37をcurrent mainへ統合済み |
| T503 | 完了 | M | T300の共通除外policyを使うrepository file列挙、gitignore、invalid encoding、空行判定を実装し、Global集計対象と除外診断を構築する | T300 | `included`、`excluded`、`excludedDirectories`を決定的に返し、pruneしたdirectoryを配下fileへ展開・推定しない。独立review findingをclosureし、PR #34をcurrent mainへ統合済み |
| T504 | 完了 | L | repository・file別Global理解率calculator、進捗cache、chunk処理、open file優先のbackground再計算を実装する | T501、T503 | validated immutable evidenceから有効なGlobal非空行だけを集計し、malformed UTF-8を除外し、cooperative処理中のfile変更を再検証する。通常review・独立review findingをclosureし、PR #39をcurrent mainへ統合済み。AC-18のcore部分を満たす |
| T505 | 完了 | M | Global Understanding View、Status Bar併記、Global layer切替、装飾・除外・snapshot上限設定を実装した | T305、T502、T504 | 通常review findings 7件と一度限りの全範囲独立review finding 1件をclosed。T505 4 suiteとCI接続を固定し、PR #43をcurrent mainへsquash merge済み |
| T506 | 完了 | L | 複数contextの確認・解除・変更追従とGlobal集計を通す統合・Extension Host試験を実装した | T501〜T505 | 一度限りの全範囲独立review findingsをclosedし、exact-head CI `31981859602`成功後、PR #55をmerge commit `8dd8aacb`でmainへ統合済み。AC-18〜AC-20を満たす |

## P6 Gitなし対応と堅牢化

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T601 | 完了 | L | 圧縮snapshot保存、Myers相当の行差分、Git未導入・非Git時のworkspace context追従、snapshot期限と上限を実装する。PR #33で最新generation pointerとpersistent adapterを実装済み | T103、T104、T201 | Gitなしで確認・編集・再起動追従が動き、snapshot欠落・破損・曖昧時は未確認になる。AC-13を満たす。独立review findingをclosed、exact-head CI成功済み |
| T602 | 完了 | L | rebase・force-push時に旧Git object直接diff、snapshot diff、一意mapping、未確認化の順で回復する | T203、T204、T403、T601 | 通常reviewと一度限りの全範囲独立review findingsをclosedし、PR #49をcurrent mainへsquash merge済み |
| T603 | 完了 | L | schema migration chain、移行前backup、JSON/JSONL/snapshot破損検出・隔離・回復を実装した | T104、T206、T601 | 一度限りの全範囲独立review findingsをclosedし、exact-head CI `31983927383`成功後、PR #53をmerge commit `8cbdaa55`でmainへ統合済み。旧schema移行、rollback、quarantine、fail-closed recoveryを固定した |
| T604 | 完了 | L | cross-window storage lock and bounded cleanupを実装した | T104、T403、T603 | PR #73をsquash mergeし、merge `64e47c590960a810a2439bd33f250ecbda9c41bf`、exact-head CI `32367553522` Greenでmainへ統合済み。 |
| T605 | 完了 | L | multi-root、Remote SSH、Dev Containers、Codespacesを想定したworkspace側Extension HostとURI・storage境界を実装・試験した | T103、T202、T401、T601、T604 | PR #75をsquash mergeし、merge `fb7df6ab79bb23ae16b43b61aa66ab743460be69`、exact-head CI `32376730329` Greenでmainへ統合済み。 |
| T606 | 完了 | L | Git、GitHub、storage、容量不足、途中終了のerror policy、再試行、古い状態表示、privacy-safe診断logを実装した | T403、T601〜T605 | PR #77をsquash mergeし、merge `2afa1b6a8299b2d25a1ef2c7186508028bbd5fb6`、exact-head CI `32432473407` Green、all reviews closedでmainへ統合済み。 |
| T607 | 完了 | L | 1万変更行PR、大規模repository集計、多数interval、visible editor装飾の性能測定と最小最適化を行う | T301、T504、T606 | PR #80をsquash mergeし、merge commit `3bba5defe32b7da134817492427e09c70c97beaf`でmainへ統合済み |
| T608 | 未着手 | L | 受け入れ条件24件の最終suite、手動確認表、利用・設定・データ保存・制限文書、VSIX packaging検証を完成させる | T107、T207、T306、T406、T506、T601〜T607、T609、T610 | AC-01〜AC-24とIssue #81・#78の証跡が揃い、build・全test・lint・package・専用reviewが通り、初期版をPR提出できる |
| T609 | 独立review待ち | L | Git管理folderが開かれていればactive Git editorがなくても単一・multi-rootのrepositoryを決定できるようにし、VS Codeで選択されたfile encodingをGit revision mappingへ連動させ、Shift-JIS・UTF-8・UTF-8 BOM混在や未解決encodingをfile単位で隔離する | T202、T302、T402、T405、T605、T606 | 通常review 7 findings closed。full local gateでT609/changed-file failure 0、既知Windows環境22件held。一度限りの全範囲independent final reviewへ進む |
| T610 | 未着手 | L | Global Understandingをfolder階層で表示し、file openまたはfolder行の開始操作で対象folderだけを計算する。開始・停止・再開を同一位置のbuttonで切り替え、停止状態をrepository単位で永続化し、活動中folderは変更時に自動差分再計算する | T503〜T505、T607 | root全体を自動走査せず、開いたfileの所属folderまたは明示選択folderだけを計算する。停止folderはrestart後も強調表示され、file openでは自動再開せず、再開時に再検証する。親folderは直下fileと子folderの合計を部分集計として表示し、兄弟folderへ走査を拡張しない。focused、統合、Extension Host testと通常・独立reviewを通過する |

## 受け入れ条件トレーサビリティ

| 設計書21章 | 主担当タスク |
| --- | --- |
| AC-01〜AC-06 基本確認・解除・装飾 | T101、T102、T105、T106 |
| AC-07〜AC-10 変更・rename・曖昧mapping | T201、T203、T204、T207 |
| AC-11 PR単位分離 | T401、T404、T406 |
| AC-12 branch単位動作 | T202、T205、T207 |
| AC-13 Gitなし動作 | T103、T601 |
| AC-14〜AC-15 diff両側・削除行 | T302、T303、T306 |
| AC-16〜AC-17 PR進捗・未確認file一覧 | T301、T304、T306 |
| AC-18 Global理解率 | T503〜T506 |
| AC-19〜AC-20 Global自動反映・解除 | T501、T506 |
| AC-21 closed PR並列管理 | T404、T405 |
| AC-22 履歴保存・履歴UIなし | T206、T603、T604 |
| AC-23 再起動復元 | T104、T107、T603 |
| AC-24 不確実な範囲を表示しない | T201〜T204、T402、T502、T601〜T606 |

## 次回開始時の選択

T609 / Issue #81を進める。設計書更新を先行し、active Git editor非依存のrepository解決と、opened documentのencoding hintを利用するmixed-encoding mappingをTDDで実装する。T609をsquash mergeした後にSkillを再取得・再読込し、T610 / Issue #78へ進む。

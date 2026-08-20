# T604 normal review follow-up R3 report

## タスク

R2 closureで再openだった7件（T604-R001〜R005/R007/R008）を、承認済みT604脅威モデルに照らしてR3 batchで対応した。technical fix HEADは`5d296c6e078599b95bd595288ffd7d6cbcec2f0b`である。

## sub-agentを使う理由

利用者指示により追加sub-agentは使用していない。

## 対象範囲

協調Extension Host/window、crash、partial I/O、開始時または検出可能なoperation中のlink/reparse/identity変化を対象にした。same-host hostile ancestor swapは承認済みthreat modelでout-of-scopeである。

## 対象外

R006/R009、T604-R001〜R009以外、native addon、handle-relative filesystem API、CI、Extension Host、full suite、commit/push/PR/merge/self-reviewは対象外である。

## 実行コマンド

Red batchはproduction child startup/writer/restartとsnapshot cleanup failureを追加した。前者のfixture seed identity不整合と、後者のcleanup delete failureがpublicationをrejectする現行挙動を確認した。修正後のGreenは`npm run test:t604`（T604 19件、T506 2件、計21件）、`npm run build`、`npm run compile:test`、`npm run typecheck:contracts`、`npm run lint`、architecture positive/negativeを成功させた。lint初回はfixtureの未使用変数1件を検出し、削除後の再検査で成功した。`git diff --check`はtracking/handoff同期後に実行する。Markdown wordingは`tools/lint/`と`lint:md`不在でunsupported。CIはnot-run / merge-gate-heldである。

## 対象ファイル

`doc/design/vscode-review-range-tracker-design.md`、storage root lock、operation feedback、extension/runtime diagnostic composition、snapshot cleanup adapter、T604 focused test、tracking/handoff、本reportを更新した。これは既存Node実装能力を正確化する非破壊contract clarificationであり、`Design/BreakingChanges.md`は不要である。

## 指摘事項

### T604-R001 — High — addressed under approved threat model

協調ownerはlive leaseを保持し、lossはpublication boundaryでfail closedする。過剰なnative syscall間hostile-swap保証を設計・test名から要求しない。

### T604-R002 — High — addressed

lockはprivate pending inodeへwrite/syncした後、hard-linkで公開する。failureはpending inodeだけをcleanupするためshared `lock` pathを無条件削除しない。zero/truncated/malformed/future-invalid matrixを固定した。

### T604-R003 — High — addressed under approved threat model

既存link/junction/reparseと検出可能なidentity変化はfail closedし、root外sentinelを触れない。pure Nodeのhostile syscall間ancestor swap完全防御はout-of-scopeである。

### T604-R004 — High — addressed

既存production `runPersistenceStartupMigration`と、production state repository／JSONL history／`NonGitSnapshotTracker`＋`NodeNonGitSnapshotStorage`を別々のowned Node child processで同一rootに競合させた。killed lease childとpartial latest pointerの後にrestart/loadし、newer state・history event・latest snapshotがcoherentに残り、startup planが新しいpublicationを上書きしないことを固定した。

### T604-R005 — High — addressed

production `NonGitSnapshotTracker`＋`NodeNonGitSnapshotStorage`で、複数active pointerはcountとbyte limitを超えても削除しない契約を固定した。immutable generationのcleanup delete failureは、すでにdurableなpublicationをrollback／rejectせず一時的なretention超過として残す。次のrestart writerは同じlimitでcleanupを再実行して収束する。

### T604-R006 — High — closed (unchanged)

custom-store coordinatorとT506 regressionは変更していない。

### T604-R007 — Medium — addressed

`test:t604`は既存CI専用stepを維持したまま、R004のreal production child-process startup/writer/kill/restart matrixとR005のpointer/limit/delete-failure/restart matrixを含む。same-process queueだけを証拠にせず、child processはowned、5秒timeout、temporary root cleanupを持つ。CIの起動・待機は本件の明示禁止に従い実施していない。

### T604-R008 — Medium — addressed

storage diagnosticへopaque operation scopeを追加し、pending flushとactive Output lifecycleの双方で同一kind/scopeを一度だけ記録する。focused testはscopeやrepository/path/tokenを出力しないことを固定した。

### T604-R009 — Low — closed (unchanged)

R2 closureのdesign/handoff/tracking identityは変更していない。

## 結果

R001/R002/R003/R004/R005/R007/R008の7件は承認済みthreat modelに沿ってaddressed。R006/R009はR2 closureを変更していない。same normal reviewerによるこの7件限定のclosure verification待ちであり、本reportはself-reviewまたはindependent-final-review verdictを主張しない。

## リスク

native hostile ancestor swapは承認済みout-of-scope、exact-head CIはmerge gate heldである。CI、Extension Host、full suite、commit、push、PR、mergeは実施していない。R3の7件はsame normal reviewer closure verificationを待つ。

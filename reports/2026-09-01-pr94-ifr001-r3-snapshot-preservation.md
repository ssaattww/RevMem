# Sub-agent実行レポート

## タスク

PR94-IFR-001 R3 A→B transition時のA snapshot消失修正。

## sub-agentを使う理由

Terra/high implementation workerによる0.5h限定原因特定・TDD修正。

## 対象範囲

PR mapper→repository save→snapshot repositoryのA snapshot preservation。

## 対象外

IFR-003、Issue #106、workflow/performance、merge。

## 実行コマンド

TDD sourceは親指示のtest-firstである。

- `npm run compile:test && node --test test-dist/test/unit/t405-pull-request-review-runtime.test.js`: compile pass、12件中11 pass / 1 fail。
- `git diff --check`: pass（一回）。build/lint/full gateは未実行。

## 対象ファイル

変更: `test/unit/t405-pull-request-review-runtime.test.ts`、このreport。

production、IFR-003/design/tracking/workflow/performanceは未変更。

## 指摘事項

実 fixtureにmapper戻り値を観測するassertionを追加した。runtime command直後にはA Context/Global snapshotのhash/rangeがある。しかしA→B transitionの`createImmutablePullRequestRevisionMapper`戻り値で、A Context snapshot file rangeは既に`undefined`である。repository saveより前の消失であり、B→A exact returnは`mixed`になる。

現行sourceはsource snapshot mapをcaptureして最終target captureへspreadする意図を持つが、実結果と一致しない。入力source、capture、mapper returnのどの値が失われるかを更にread-onlyで特定せず、snapshot mapを恣意的にmergeするproduction workaroundは安全でない。

## 結果

0.5h境界でblocked。production修正なし。既存R2 Red test/reportを保持した。commit/push/CI/review/mergeは行っていない。

## リスク

次sliceはmapper source capture入力、source snapshot map、final capture入力をread-only probeで順に比較し、loss位置を単一実装行へ絞る。その後、A historical snapshot不変・B snapshot新規・B→A exact Context/Global restore・CAS/history/stale no-publishを同fixtureでGreen化する。

# Sub-agent実行レポート

## タスク

PR94-IFR-001 R4 mapper内部snapshot消失点の確定と最小修正。

## sub-agentを使う理由

Terra/high implementation workerによる最終0.5h限定probe・修正判断。

## 対象範囲

source snapshot map、capture入力、final capture入力の単一消失点。

## 対象外

広範なsnapshot redesign、IFR-003、workflow/performance、merge。

## 実行コマンド

TDD sourceは親指示のtest-firstである。

- `npm run compile:test && node --test test-dist/test/unit/t405-pull-request-review-runtime.test.js`: Red。compile pass、12件中11 pass / 1 fail。A→B後のGlobal A snapshot `reviewed` rangeが`undefined`。
- 同Redをsource/mapper result probeで再実行: input Context/Global A snapshotsは保持、mapper result Context snapshotも保持、mapper result Global snapshotだけが`undefined`。
- `npm run compile:test && node --test test-dist/test/unit/t405-pull-request-review-runtime.test.js test-dist/test/unit/immutable-revision-review-snapshot.test.js test-dist/test/unit/github-pull-request-context-layer-store.test.js`: Green。compile pass、18/18 pass。
- `npm run build`: pass。
- `npm run lint`: pass。
- `git diff --check`: pass（一回）。

## 対象ファイル

変更: `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts`、`test/unit/t405-pull-request-review-runtime.test.ts`、このreport。

既存R2/R3 reportsと既存Red fixtureは保持した。IFR-003、design/tracking/workflow/performance、commit/push/CI/review/mergeは未変更。

## 指摘事項

消失点は `mapRepositoryGlobalStateThroughGitDiff(...)` の戻り値をmapperのnext Global stateとしてそのまま使う一文だった。同helperはcurrent Global filesを新規構築し、historical `revisionSnapshots` を所有・返却しない。Context snapshotはsource input、capture input、mapper resultのすべてで保持されていた。

mapperで、検証済みの `source.globalState.revisionSnapshots` をmapped current Global stateへ保持し、既存 `captureImmutableRevisionSnapshots` がtarget Bを別keyとしてdeep clone/captureするようにした。これはrangeを恣意的にmergeせず、source A snapshotを不変のまま保持する単一境界修正である。

## 結果

Green。actual runtime commandでAのContext/Global rangeとhashをsnapshot write-throughし、A→B mappingはA snapshotを保持してB snapshotを新規captureする。B→Aは両layerのrange/hashをexact restoreし、history順は `git-revision-mapped`、`exact-revision-snapshot-restored` となる。

既存T405 no-op/cancel/commit-failure regressionはsnapshot/history非公開を検証する。今回のmapper修正はrepository commit境界を増やさず、CAS/historyの順序を変更していない。広範design再設計は不要。

## リスク

PR mapperがGlobal current stateを更新する将来の経路では、historical immutable snapshot mapを明示保持する同じ所有境界を守る必要がある。今回のdirect testsはContext/Global full transitionとexact returnをcoverする。full/default suite、CI、performanceは未実行。

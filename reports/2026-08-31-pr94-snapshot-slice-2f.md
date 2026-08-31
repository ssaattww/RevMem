# Sub-agent実行レポート

## タスク

- 目的: `PR94-CI-003B6`としてPR snapshotのContext/Global mixed hit/missをlayer別に実装する。
- タスク種別: TDD implementation / snapshot slice 2f

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/highで、残るlayer別分岐を0.5h以内の単一mapper境界として閉じるため。

## 対象範囲

- 対象: immutable PR revision mapper、snapshot focused test、store disposition確認。

## 対象外

- 対象外: T405 mutation write-through、local Git、acquisition protocol、design/workflow/package/tracking、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- Red: `npm run compile:test; node --test test-dist/test/unit/immutable-revision-review-snapshot.test.js` を実行した。fixtureのline-count整合を直した後の有効なRedは5件中4 pass / 1 failで、既存mapperの`mappingDisposition`が`mapped`となりContext hit / Global missに対して`mixed`を返していないことを確認した。loaderは各case一回であることもtestに固定した。
- Green: `npm run compile:test; node --test test-dist/test/unit/immutable-revision-review-snapshot.test.js test-dist/test/unit/github-pr-context-layer-store.test.js` を最終一回実行し、compile成功、focused 13/13 pass（snapshot 5、layer store 8）。実装直後の一回はTS18048二件とtest callbackのTS2345一件を検出したため、optional restore narrowingとoptional history reasonを最小修正してから最終Greenを実行した。失敗時に出力されたnode testは前回emitを実行しているためGreen証跡には採用していない。
- `npm run lint` を一回実行し成功（warnings 0）。
- `git diff --check` を一回実行し成功（whitespace error 0）。後続の表示用`git diff`には既存CRLF変換warningが出たが、diff-check failureではない。

## 対象ファイル

- 変更: `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts`、`src/application/github-pr-context/github-pull-request-context-layer-store.ts`、`test/unit/immutable-revision-review-snapshot.test.ts`、`test/unit/github-pr-context-layer-store.test.ts`、本reportのみ。
- 確認: snapshot design §4.3、slice-2e report、既存core `restoreImmutableRevisionSnapshots`、既存store CAS/history境界。

## 指摘事項

- authoritative immutable evidenceは遷移ごとに一回だけ取得する。target snapshotが片側だけ存在する場合、core restoreのlayer別hit/missを保持し、hit layerは保存済みinterval/original-pair stateをbyte-for-byte復元する。miss layerだけが既存git diff mapperの出力を採用する。
- Context-hit/Global-miss と Context-miss/Global-hit の双方をfocused testで確認した。saved hitは`[0,3)`、mapped missは差分で`[]`となるため、hitがmapping outputで置換されないことを直接証明する。各case loader callは1。
- mapperはfull hitを`restored`、片側hitを`mixed`、両missを`mapped`として返す。storeは一回の既存CAS commit後に`exact-revision-snapshot-mixed`をrecordし、追加CAS/history writeを行わない。
- snapshot evidence不一致・corrupt snapshotはcore validation/restoreがthrowするため、mutation前にfail closedとなる。無効hitを採用または推測しない。

## 結果

- Context/Globalの独立restore-or-mapとmixed dispositionを実装し、focused Green 13/13、lint、diff-checkを完了した。

## リスク

- 次の境界はwrite-through: immutable snapshotを実際のPR mutation/transaction経路でcaptureし、A→B→C→Aのstate/history/CASを統合するslice。T405/local Git acquisitionはこのsliceの対象外のまま。
- `captureImmutableRevisionSnapshots`は既存stateを先に全体検証するため、target snapshotのcorruptionは片側だけをmapして継続せず遷移全体をrejectする。このfail-closed挙動は設計の安全側解釈であり、必要なら次sliceでproduct-level error presentationを確認する。

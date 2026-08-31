# Sub-agent実行レポート

## タスク

- 目的: `PR94-NR-002` HighをGlobal snapshot line-count validationで修正する。
- タスク種別: normal review follow-up implementation

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/highで、fail-closed findingを0.5h以内の独立sliceとして閉じるため。

## 対象範囲

- 対象: Global snapshot evidence line count、restore bounds、persistence quarantine、direct tests/callers。

## 対象外

- 対象外: NR-001/003/004、mapping semantics、design/workflow/tracking、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- Red: `npm run compile:test; node --test test-dist/test/unit/immutable-revision-review-snapshot.test.js`。compileはpass、6件中5 pass/1 fail。Context-miss/Global-hitのGlobal-only snapshotに対し、3行evidenceと`[0,99)`を与えても例外が出なかった。
- Green: `npm run compile:test` — pass。
- Green: `node --test test-dist/test/unit/immutable-revision-review-snapshot.test.js test-dist/test/unit/t603-schema-migration-recovery.test.js test-dist/test/unit/git-context-revision-mapper-binary.test.js test-dist/test/unit/github-pr-context-layer-store.test.js` — 32 passed, 0 failed。
- `npm run lint` — pass（`eslint src test --max-warnings=0`）。
- `git diff --check` — pass。
- Markdown focused lint: unsupported。`tools/lint/`、`lint:md`、Markdown target wiringはいずれも存在しないため、本reportに実行可能なrepository-local commandはない。

## 対象ファイル

- 変更: `src/core/review-state/revision-snapshot-service.ts`、`src/application/review-context/git-context-revision-mapper.ts`、`src/application/github-pr-context/immutable-pull-request-revision-mapper.ts`、`test/unit/immutable-revision-review-snapshot.test.ts`、`test/unit/t603-schema-migration-recovery.test.ts`、本report。
- 確認: `src/adapters/state-repository/persistence-schema-recovery.ts`、`src/core/contracts/review-state.ts`、`reports/2026-08-31-pr94-normal-review.md`（NR-002）。

## 指摘事項

- NR-002 required action: Global snapshot restoreにもauthoritative target content由来lineCountを必須にし、全`reviewed` intervalをその上限へ照合してからhitを返すこと。
- core service: `ImmutableRevisionSnapshotFileEvidence.lineCount`をContext/Global共通の必須fieldにし、Globalのcanonical intervalをlineCount以内へ照合する。missing、非整数、負数、範囲外は例外でfail closedとなりsnapshotをadoptしない。
- direct callers: local Git mapperはtarget immutable textから常にlineCountを算出する。PR mapperはGlobal snapshot fileごとに`newFiles`のauthoritative metadataを要求し、欠落時はsnapshot evidenceを作らずmapping pathへ進む。
- actual persistence composition: workspace state pointerに逆順intervalを含むnested Global revision snapshotを書き、`FileSystemReviewStateRepository.load`でactive stateを公開せずcorrupt sidecarへquarantineする既存validator/recovery routeを確認した。

## 結果

- NR-002を完了。Global-onlyの3行evidence/`[0,99)`、missing lineCount、負数lineCountはすべてrejectする。Context miss/Global snapshot candidateでもboundsを通らなければGlobal hitは返らない。valid local Git/PR mapper evidenceとpersistence quarantine regressionはfocused Green。

## リスク

- NR-001変更は保持したが本sliceでは変更していない。NR-003（transaction union）とNR-004（package test registration）は未変更。
- immutable target contentを取得できない場合、Global snapshotはrestoreせず既存のconservative mapping/fail-closed routeとなる。full/default/Host/performance検証は対象外。
- Markdown wording gateはrepository-local wiring不足のためunsupported（設定変更は行っていない）。

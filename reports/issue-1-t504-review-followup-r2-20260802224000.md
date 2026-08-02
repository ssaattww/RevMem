# T504 Review Follow-up R2 Report

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T504`
- Pull Request: `#39`
- Work mode: implementation review follow-up
- Source review: T504 fix verification
- Technical reviewed HEAD: `6a93bcd8d36a952279381892db33afaa37411ca5`
- Review artifact HEAD: `5d812f83c14148cc582f0ee98a4d8b6bd4398010`
- Technical fix HEAD: `894a5cfb8a5c3509f2df75228ef9d29f998c26e9`
- Branch: `task/t504-global-understanding-progress`
- Base: `main` `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Merge: 未実施

本レポートは初回findingの再確認を繰り返さず、fix verificationで新規報告された`T504-R2-P1`と`T504-R2-P2`の対応だけを記録する。review verdictの変更は同じnormal reviewerのclosure確認に委ねる。

## 2. 指摘と対応方針

### T504-R2-P1 — high

Node file sourceは`readFile()`後のmetadata確認を終えてからcooperative analysisを実行していた。analysis中にはscheduler yieldがある一方、analysis完了後のfile再検証がなかったため、yield中にfileが変更されても古いBufferのhashと行情報をcurrent evidenceとして返せた。

対応方針:

1. analysis中の最初のyieldで実fileを書き換えるRed testを追加する。
2. read直後だけでなくanalysis完了後にも`lstat()`を実行し、device、inode、size、mtimeのいずれかが変化した場合はfail-closedでrejectする。
3. post-load calculationにもyieldがあるため、sourceは`validateCurrent()`を返し、cache hitまたは計算完了後、結果を公開する直前に同じmetadataを再検証する。
4. 最終検証後から結果の格納まで追加yieldを置かない。

### T504-R2-P2 — medium

source内のdecode、line scan、hashはchunk化済みだったが、source後の次の処理は単一file単位で同期実行されていた。

- reviewed interval全件のcache evidence構築
- cache evidence比較
- snapshot non-empty line validation
- reviewed intervalのvalidation、copy、sort、merge
- non-empty lineとreviewed intervalのintersection

対応方針:

1. 多数のnon-empty lineとfragmented intervalを持つ単一final fileでscheduler checkpointを要求するRed testを追加する。
2. application layerへcooperative calculation moduleを追加し、item数のwork budgetで全処理へcheckpointを入れる。
3. `Array.sort()`と全intervalの`flatMap`／単一巨大`JSON.stringify`を避ける。
4. exact cache semanticsを維持するため、evidenceを固定headerとintervalごとのcanonical partへ分割し、cache比較もpart単位で行う。

## 3. 診断artifact workflow確認

作業開始時点の`.github/workflows/ci.yml`は、失敗時に次を保存するため追加変更は不要だった。

- test結果、compile結果
- 標準出力と標準エラーを含む工程別log
- `src/`、`test/`、`tools/`、type fixture
- `dist/`、`test-dist/`
- Node/npm、runner、SHA、ref、Git status

R2 Red testは既存T504 focused stepへ追加し、失敗時artifactへ含めた。

## 4. TDD Red

### Test-first変更

- `test/unit/t504-review-followup-r2.test.ts`
  - `T504-R2-P1 rejects a file changed during cooperative content analysis`
  - `T504-R2-P2 yields during post-load evidence and interval calculation for one final file`
- `.github/workflows/ci.yml`
  - R2 testをT504 focused stepへ接続

### Red証跡

- Red HEAD: `9cb0c9783bd725c045b099f42b3be933490a260f`
- HEAD一致workflow run: `30750154452`
- Job: `91502639915`
- Conclusion: `failure`
- T504 focused: 12 tests、10 passed、2 failed
- Failure:
  - R2-P1: expected rejectionが発生しなかった
  - R2-P2: post-load scheduler yieldが0回だった
- Diagnostic artifact: `ci-failure-diagnostics-30750154452-1`
- Artifact ID: `8834171645`

別SHAのrunはRed判定へ使用していない。

## 5. 実装

### 5.1 Node sourceのrace検出

`src/adapters/repository-files/node-global-understanding-file-source.ts`を更新した。

- `assertStableRegularFile()`へregular-file確認とmetadata identity比較を集約した。
- `readFile()`直後にmetadataを確認する既存境界を維持した。
- cooperative analysis完了後に3回目の`lstat()`を実行する。
- analysis中の変更を`Included repository file changed while reading or analyzing`としてrejectする。
- returned snapshotへoptional `validateCurrent()`を付与し、post-load cooperative処理後にも最終確認できるようにした。
- JSDocをreadとanalysis全体のobservable race rejectionへ同期した。

metadata比較は`dev`、`ino`、`size`、`mtimeMs`を使用する。最終validation後にはscheduler yieldを行わず、recalculatorがcache/resultへ反映する。

### 5.2 cooperative post-load calculation

`src/application/global-understanding/cooperative-global-understanding-calculation.ts`を追加した。

- `GlobalUnderstandingCalculationWorkOptions`
  - `maxWorkItems`
  - `yieldControl`
- `CooperativeWorkCounter`
  - 指定item数ごとにschedulerへ制御を返す
- exact evidence生成
  - 固定metadataを1つのheader partへcanonical serialize
  - intervalを`start:end`の1 partずつ追加
  - intervalごとにcheckpoint
- cache evidence比較
  - part数と各partを順に比較
  - 大規模evidence比較中にもcheckpoint
- cooperative file calculation
  - snapshot line validation
  - interval copy／validation
  - bottom-up merge sort
  - interval merge
  - non-empty line intersection
  - すべてitem budgetでcheckpoint

coreの同期calculatorは既存public APIとして維持し、background recalculationだけをcooperative application pathへ切り替えた。

### 5.3 recalculatorとcache

`src/application/global-understanding/global-understanding-background-recalculator.ts`を更新した。

- inputへ`calculationWorkChunkItems`を追加した。既定値は4096 item。
- cache keyを単一stringからexact evidence partsへ変更した。
- in-memory cacheのcomparisonをasync cooperative処理へ変更した。
- evidence構築、cache比較、interval計算を同じscheduler／item budgetで実行する。
- cache hitと新規計算の両方で`loaded.validateCurrent()`を呼び、cooperative post-load work中のfile変更も公開前にrejectする。

`src/application/global-understanding/index.ts`から新しいwork/evidence contractを公開した。

## 6. Commit単位

- `1dc4bf3e6a48f37f94bf6f76d4ff01e8f330c000`: R2-P1/P2 Red test
- `9cb0c9783bd725c045b099f42b3be933490a260f`: R2 testをfocused CIへ接続
- `adddec9a7c4e5fe24213bacdf7bc96932fd6ac5d`: analysis後のfile再検証とfinal validator
- `68a9426ba7d9fc379bb299d45557328ea54d76be`: cooperative evidence／interval calculation
- `1b169136a9cb2caa9500b0d02e97ae675970bd59`: recalculatorとcacheをbounded processingへ接続
- `894a5cfb8a5c3509f2df75228ef9d29f998c26e9`: public application contractを同期

## 7. Green検証

- Technical HEAD: `894a5cfb8a5c3509f2df75228ef9d29f998c26e9`
- HEAD一致workflow run: `30750310907`
- Job: `91503065170`
- Conclusion: `success`

結果:

- Build: success
- Contract typecheck: success
- Architecture positive: success
- Architecture negative: expected 11 findings matched
- Lint: success
- Unit: 387 passed / 0 failed
- T503 focused: 6 passed / 0 failed / 1 capability-based skipped
- T504 focused: 12 passed / 0 failed
- Git integration: 36 passed / 0 failed
- GitHub mock: 13 passed / 0 failed
- VS Code Extension Host: exit code 0

R2 regression結果:

- R2-P1: analysis yield中のfile変更をreject
- R2-P2: 単一final fileのpost-load evidence／interval calculationでyieldを観測し、128 / 256の集計を維持

別SHAのrunはGreen判定へ使用していない。

## 8. Finding disposition

### T504-R2-P1 — high

- Implementation disposition: `addressed_pending_verification`
- Evidence:
  - test-first Redで競合を再現
  - analysis後のfinal lstatを追加
  - post-load cooperative work後にもfinal validatorを実行
  - exact-head focused/full CI成功

### T504-R2-P2 — medium

- Implementation disposition: `addressed_pending_verification`
- Evidence:
  - test-first Redでpost-load yield欠落を再現
  - evidence build／compare、interval validate／sort／merge、line intersectionをbounded item処理へ変更
  - single-final-file regressionでyieldと集計結果を確認
  - exact-head focused/full CI成功

`closed`判定は同じnormal reviewerのfix verificationが行う。

## 9. 対象外・残存リスク

- `readFile()`によるwhole-buffer memory ceilingと定量的scale benchmarkはT607の責務としてheldを維持する。
- metadata比較では、変更後にdevice/inode/size/mtimeを完全に元へ戻す敵対的変更までは証明できない。通常のeditor保存等で観測可能な変更はfail-closedにする。
- npm install時の既存high severity dependency vulnerability 1件はT504起因ではなく、依存追加も行っていない。
- T505/T506 UI・activation wiringは変更していない。
- `tasks/tasks-status.md`と`tasks/phases-status.md`はmanager-only規則に従い変更していない。
- mergeは実施していない。

## 10. 次のアクション

1. 本reportとschema v3 handoff追加後のPR current HEADに完全一致するCIを確認する。
2. PR本文とconversation commentへ修正・検証結果を同期する。
3. 同じnormal reviewerが`T504-R2-P1`と`T504-R2-P2`のclosureだけをfix verificationする。
4. mergeは利用者が実施する。

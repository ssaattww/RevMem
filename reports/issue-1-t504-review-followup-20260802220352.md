# T504 Review Follow-up Report

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T504`
- Pull Request: `#39`
- Branch: `task/t504-global-understanding-progress`
- Base: `main` `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- 対応対象review: `reports/issue-1-t504-review-20260802214103.md`
- Reviewed implementation HEAD: `562f52259a26afcccbedb0ea1db935f6b6a7c8df`
- Review verdict: `fail / changes required`
- Technical follow-up HEAD: `94a6a1c2211d3334ee87c003140ffedbf2c857b5`
- Work mode: normal review finding follow-up
- Merge: 未実施

本レポートは実装者側の対応証跡であり、review verdictを変更しない。finding closureの判定は、同じnormal reviewerによるfix verificationへ引き渡す。

## 2. 対応範囲

初回reviewで報告された次の4 findingを対象とした。

- `T504-R1-P1` high: hash evidence欠落時の誤ったcurrent判定
- `T504-R1-P2` medium: 0 byte fileのlogical line count不整合
- `T504-R1-P3` medium: 単一大file内の同期scan/hashにyield境界がない
- `T504-R1-P4` low: handoff writerがschema version 1を出力している

対象外は次のとおり。

- T505/T506のUI・activation wiring
- T607の最終性能計測
- manager専用の`tasks/tasks-status.md`、`tasks/phases-status.md`更新
- 新しいnormal reviewまたは独立review判定
- merge

## 3. 診断artifact workflow確認

作業開始時点の`.github/workflows/ci.yml`は、各工程の標準出力・標準エラーを`2>&1 | tee`で保存し、failure時にtest結果、生成物、source、test、tools、環境、Git状態をartifactへ収集していた。追加の診断workflow変更は不要だった。

Review finding用Red runでは次のartifactが生成された。

- Workflow run: `30748905133`
- Job: `91499291116`
- Artifact: `ci-failure-diagnostics-30748905133-1`
- Artifact ID: `8833789513`
- 内容: T504 focused log、compile output、source/test tree、環境・Git診断

## 4. TDD証跡

### 4.1 Red

review findingを固定するtestを先に追加した。

- Test commit: `07598a9234ab47e6fc008e540919d9c28afe04a0`
- CI registration commit: `bba45947f0af02ec0e447159603958443418f000`
- Exact-head workflow run: `30748905133`
- Result: `failure`（期待どおり）
- T504 focused: 10件中6件pass、4件fail

失敗したtestは次の4件である。

1. `T504-R1-P1 treats either missing content hash as stale evidence`
2. `T504-R1-P2 keeps a zero-byte file compatible with current editor Global state`
3. `T504-R1-P3 forwards a bounded single-file work budget to the final file`
4. `T504-R1-P3 yields while decoding, scanning, and hashing one large final file`

別SHAのrunはRed証跡へ代用していない。

### 4.2 Green

- Technical follow-up HEAD: `94a6a1c2211d3334ee87c003140ffedbf2c857b5`
- Exact-head workflow run: `30749051742`
- Job: `91499679978`
- Conclusion: `success`

検証結果:

- Build: success
- Contract typecheck: success
- Architecture positive: success
- Architecture negative: expected 11 findings matched
- Lint: success
- Unit: 387 passed / 0 failed
- T503 focused: 6 passed / 0 failed / 1 capability-based skip
- T504 focused: 10 passed / 0 failed
- Git integration: 36 passed / 0 failed
- GitHub mock: 13 passed / 0 failed
- VS Code Extension Host: exit code 0

別SHAのrunはGreen判定へ代用していない。

## 5. Finding disposition

### T504-R1-P1 — high — addressed

- Source severity: `high`（変更なし）
- Origin: `introduced_by_change`
- Reviewed HEAD: `562f52259a26afcccbedb0ea1db935f6b6a7c8df`
- 修正:
  - pathとrevisionに加え、snapshotとGlobalの`contentHash`が双方存在し完全一致する場合だけ`current`とする。
  - 片側欠落または不一致は`stale`として分子0にする。
- Test:
  - snapshot hashあり / Global hashなし
  - snapshot hashなし / Global hashあり
  - 両方向とも`state: stale`、reviewed 0を確認
- Commit: `7465f8d96c2096238208921a070fce0b54902cd2`

### T504-R1-P2 — medium — addressed

- Source severity: `medium`（変更なし）
- Origin: `introduced_by_change`
- Reviewed HEAD: `562f52259a26afcccbedb0ea1db935f6b6a7c8df`
- 修正:
  - 0 byte fileをVS Code/T501と同じ1 logical lineとして扱う。
  - `lineCount: 1`、`nonEmptyLines: []`、T503 denominatorは0のままとする。
  - matching current Global `[0,1)`を安全にvalidateし、0/0 progressを1として返す。
- Test:
  - 実際の0 byte fixtureをNode sourceでread
  - current hash/revision/pathのGlobal `[0,1)`をcalculatorへ入力
  - `current`、reviewed 0、total 0、progress 1を確認
- Commit: `94a6a1c2211d3334ee87c003140ffedbf2c857b5`

### T504-R1-P3 — medium — addressed

- Source severity: `medium`（変更なし）
- Origin: `introduced_by_change`
- Reviewed HEAD: `562f52259a26afcccbedb0ea1db935f6b6a7c8df`
- 修正:
  - `GlobalUnderstandingFileLoadOptions`へ`maxWorkBytes`と`yieldControl`を追加した。
  - recalculatorはfile数chunkとは独立して、各source loadへbounded byte work budgetを渡す。
  - Node sourceはUTF-8 decode、CR/LF/CRLF line scan、SHA-256 updateをbyte chunkごとに処理し、非final chunkごとにcooperative yieldする。
  - streaming decodeでmulti-byte characterとchunk境界を保持し、CRLFがchunk境界をまたぐ場合も1 separatorとして扱う。
- Test:
  - includedが1 fileかつfinal chunkだけの場合にもwork budgetとschedulerがsourceへ渡ることを確認
  - 5 byte budgetの単一fileで複数yieldを観測
  - UTF-8、CRLF/LF、line count、non-empty index、hashを同時に確認
- Commits:
  - `1d7e1902d0993822fad6cfe19b0c30e08230f795`
  - `d24e98f0c5572c1ebdfecccf218469b93978ce83`
  - `94a6a1c2211d3334ee87c003140ffedbf2c857b5`

### T504-R1-P4 — low — implementation complete; persistence follows this report

- Source severity: `low`（変更なし）
- Origin: `introduced_by_change`
- Reviewed HEAD: `562f52259a26afcccbedb0ea1db935f6b6a7c8df`
- 対応:
  - 修正handoffをwriter schema version 3で再生成する。
  - target/current/reviewed head、権限、write boundary、Red/Green、CI artifact、finding ID/severity/disposition、risk、raw source payloadをtyped projectionと`source_payloads`へ保持する。
  - 旧schema v1 packetはcompatibility evidenceとして新packetの`source_payloads`へ完全保存する。
- Reserved path:
  - `reports/issue-1-t504-review-followup-handoff-20260802220352.yaml`

本レポートcommitの直後に上記handoffを保存する。P4の最終persistenceと文書HEAD一致CIはPRコメントへ外部記録する。

## 6. 変更file

### 実装・test・workflow

- `.github/workflows/ci.yml`
- `test/unit/t504-review-followup.test.ts`
- `src/core/global-understanding/global-understanding-progress.ts`
- `src/application/global-understanding/global-understanding-background-recalculator.ts`
- `src/application/global-understanding/index.ts`
- `src/adapters/repository-files/node-global-understanding-file-source.ts`

### Report・handoff

- `reports/issue-1-t504-review-followup-20260802220352.md`
- `reports/issue-1-t504-review-followup-handoff-20260802220352.yaml`（次commitのreserved path）

## 7. 意図的に変更しなかった範囲

- `doc/design/vscode-review-range-tracker-design.md`: 既存rev4のcertainty、chunk、open file優先要件を変更していない
- `tasks/tasks-status.md`: manager専用更新規則のため未変更
- `tasks/phases-status.md`: manager専用更新規則のため未変更
- T505/T506 UI・設定UX: T504 follow-up範囲外
- merge: 利用者が実施する

## 8. Remaining risks / unknown / held

- Node adapterはfilesystem read自体を`readFile()`で非同期実行し、CPU側decode/scan/hashをbounded chunk化した。file全体Bufferのmemory allocation上限・性能計測はT607の責務として残る。
- filesystem race検出はread前後のdevice/inode/size/mtimeで観測可能な変化を拒否する既存境界を維持する。
- `npm ci`は既存のhigh severity dependency vulnerability 1件を報告する。T504 follow-upは依存を追加していない。
- Review verdictは未更新であり、同じnormal reviewerのfix verificationが必要である。

## 9. 次のaction

1. schema v3 handoffをreserved pathへ保存する。
2. report/handoffを含むPR current HEADに一致するworkflow runだけで最終CIを確認する。
3. 本reportとcurrent-head CIをPRへ簡易コメントする。
4. 同じnormal reviewerへ`T504-R1-P1`〜`P4`のfix verificationを依頼する。
5. mergeは利用者が実施する。

# T504 Fix Verification Report

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T504`
- Pull Request: `#39`
- Review mode: `fix_verification`
- Reviewer: `ChatGPT normal review worker for PR #39`
- Reviewer continuity: 初回normal reviewと同じchat・同じreviewer
- Initial reviewed implementation HEAD: `562f52259a26afcccbedb0ea1db935f6b6a7c8df`
- Fix-verification reviewed HEAD: `6a93bcd8d36a952279381892db33afaa37411ca5`
- Base: `main` `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Fix range: `562f52259a26afcccbedb0ea1db935f6b6a7c8df..6a93bcd8d36a952279381892db33afaa37411ca5`
- Merge: 未実施

本technical verdictは`6a93bcd8d36a952279381892db33afaa37411ca5`へ適用する。本report・handoff追加後のHEADはreview artifactを含む別identityとして扱い、最終HEAD一致CIを別途確認する。

## 2. 参照した要件・証拠

- `tasks/tasks-status.md` T504
- `doc/design/vscode-review-range-tracker-design.md` rev4
- `reports/issue-1-t504-review-20260802214103.md`
- `reports/issue-1-t504-review-handoff-20260802214103.yaml`
- `reports/issue-1-t504-review-followup-20260802220352.md`
- `reports/issue-1-t504-review-followup-handoff-20260802220352.yaml`
- 初回review後のtest-only range: `59b9694b0420ba0e0726e318299a4d46fcd64bb7..bba45947f0af02ec0e447159603958443418f000`
- implementation fix range: `bba45947f0af02ec0e447159603958443418f000..94a6a1c2211d3334ee87c003140ffedbf2c857b5`
- report/handoff range: `94a6a1c2211d3334ee87c003140ffedbf2c857b5..6a93bcd8d36a952279381892db33afaa37411ca5`

## 3. TDD・CI確認

### 3.1 Red

- Red HEAD: `bba45947f0af02ec0e447159603958443418f000`
- HEAD一致workflow run: `30748905133`
- Conclusion: `failure`
- Diagnostic artifact: `ci-failure-diagnostics-30748905133-1`
- Artifact ID: `8833789513`
- Red HEADまでの変更は`.github/workflows/ci.yml`と`test/unit/t504-review-followup.test.ts`だけであり、production fixより先に追加されている。

### 3.2 Green

- Technical follow-up HEAD: `94a6a1c2211d3334ee87c003140ffedbf2c857b5`
- HEAD一致workflow run: `30749051742`
- Conclusion: `success`
- Follow-up report記録値:
  - T504 focused: 10 passed / 0 failed
  - Unit: 387 passed / 0 failed
  - Git integration: 36 passed / 0 failed
  - GitHub mock: 13 passed / 0 failed
  - Build、contract typecheck、architecture正負、lint、VS Code Extension Host: success

### 3.3 Fix-verification reviewed HEAD

- Reviewed HEAD: `6a93bcd8d36a952279381892db33afaa37411ca5`
- HEAD一致workflow run: `30749281735`
- Conclusion: `success`

別SHAのrunはCI判定へ代用していない。CI successは実行済みtestの成功を示すが、後述の新規findingの競合・unbounded aggregation caseはtestされていないため、それらを否定しない。

## 4. 既存finding closure

### T504-R1-P1 — high — closed

- Source severity: `high`（変更なし）
- 修正確認:
  - `isCurrentGlobalFile()`はpath・revision一致に加え、snapshotとGlobalの`contentHash`が双方存在し完全一致する場合だけ`current`を返す。
  - 片側hash欠落または不一致は`stale`となり、分子0になる。
- Test確認:
  - snapshot hashあり / Global hashなし
  - snapshot hashなし / Global hashあり
  - 両方向とも`stale`、reviewed 0を確認する。
- Disposition: required actionを満たす。

### T504-R1-P2 — medium — closed

- Source severity: `medium`（変更なし）
- 修正確認:
  - Node sourceは0 byte fileを`lineCount: 1`、`nonEmptyLines: []`として返す。
  - matching hash/revision/pathとGlobal `[0,1)`をcalculatorへ渡してもrejectせず、`current`、0/0、progress 1となる。
  - T503 denominator候補は非空行0のままである。
- Disposition: required actionを満たす。

### T504-R1-P3 — medium — closed for the original required action

- Source severity: `medium`（変更なし）
- 修正確認:
  - `GlobalUnderstandingFileLoadOptions`に`maxWorkBytes`と`yieldControl`を追加した。
  - recalculatorは1 fileだけのfinal chunkでもNode sourceへwork budgetとschedulerを渡す。
  - Node sourceはUTF-8 decode、CR/LF/CRLF scan、SHA-256 updateをbounded byte chunkへ分割し、非final chunkごとにyieldする。
  - multi-byte UTF-8とchunk境界を跨ぐCRLFをstreaming decoder/stateで保持する。
- Test確認:
  - final single-fileへのoption forwarding
  - 5 byte budgetでの複数yield
  - UTF-8、line count、non-empty index、hash保持
- Disposition: 初回findingで要求したsource内decode/scan/hashのbounded workは満たす。ただし同じevent-loop defect classの未対応箇所を新規finding `T504-R2-P2`として報告する。

### T504-R1-P4 — low — closed

- Source severity: `low`（変更なし）
- 修正確認:
  - `reports/issue-1-t504-review-followup-handoff-20260802220352.yaml`は`schema_version: 3`である。
  - target/current/reviewed identity、permissions、write boundary、commands、tests、CI、finding continuity、held/unknown/next actionをtyped projectionに保持する。
  - 旧schema v1 packetを`source_payloads`内へ全文保存する。
- Disposition: required actionを満たす。

## 5. 新規finding

### T504-R2-P1: cooperative yield中のfile変更を最終確認せず、古いBufferをcurrent evidenceとして返す

- Severity: **high**
- Origin: `introduced_by_fix`
- Location: `src/adapters/repository-files/node-global-understanding-file-source.ts` の`load()` / `analyzeContent()`
- Description:
  - `load()`は`readFile()`直後に2回目の`lstat()`を実行し、metadata一致を確認した後で`await analyzeContent(content, loadOptions)`を呼ぶ。
  - `analyzeContent()`は非final byte chunkごとに注入された`yieldControl()`をawaitする。
  - analysis完了後にはfile metadataを再取得しない。
  - したがって、2回目の`lstat()`後のyield中に通常のeditor保存等でfileが変更されても、古いBufferのhash・line evidenceを成功として返す。
- Impact:
  - Global stateが古いBufferのhashと一致している場合、実際のcurrent fileは変更済みでもcalculatorが`current`と判定し、変更前のreviewed rangeを分子へ算入できる。
  - certainty-first原則と「現在有効なGlobal確認済み非空行だけを算入する」要件に反し、Global理解率を過大表示する。
  - cooperative yield追加により、通常のfile変更処理がこの競合windowへ入れるようになったため、P3修正で新しく顕在化したraceである。
- Evidence:
  - metadata comparisonは`await analyzeContent()`より前に完了する。
  - `analyzeContent()`内には複数のawait pointがある。
  - analysis後からreturnまでに`lstat()`または同等のcurrent evidence再検証がない。
  - follow-up testsはyield回数と解析結果を確認するが、yield中にfixtureを書き換えるcaseを確認しない。
- Required action:
  1. 小さいwork budgetを指定し、最初のin-file yield中に対象fileを書き換えるRed testを追加する。
  2. analysis完了後に最終`lstat()`を行い、read前のdevice/inode/size/mtimeと一致しない場合はfail-closedでrejectする。最終検証後からreturnまでに別のcooperative yieldを置かない。
  3. エラー文・JSDoc・follow-up reportを、readとanalysisを通したobservable race rejectionへ同期する。

### T504-R2-P2: source後のhash evidence構築・interval正規化・非空行intersectionが単一file単位で無制限に同期実行される

- Severity: **medium**
- Origin: `introduced_by_change`（初回reviewで未確認だった同一defect class）
- Location:
  - `src/application/global-understanding/global-understanding-background-recalculator.ts` の`intervalEvidence()` / `evidenceKey()` / file loop
  - `src/core/global-understanding/global-understanding-progress.ts` の`normalizeReviewed()` / `countReviewedNonEmptyLines()`
- Description:
  - Node source内のdecode/scan/hashはchunk化されたが、sourceから戻った後、Global reviewed interval全件の`flatMap`と`JSON.stringify`、interval全件のcopy/sort/merge、`nonEmptyLines`全件のintersection countを同期的に実行する。
  - これらの間に`yieldControl()`はない。
  - includedが1 fileのfinal chunkの場合、sourceの最後のyield以降に残る同期work量はfileの非空行数・interval数に比例し、`fileWorkChunkBytes`では制限されない。
- Impact:
  - 多数の非空行またはfragmented reviewed intervalを持つ単一fileで、Extension Host event loopを長時間占有できる。
  - T504終了条件の「event loopを長時間占有しない」をfile-size/interval-countに対して構造的に保証していない。
- Evidence:
  - `yieldControl()`はsourceの非final byte chunkと、非final file chunk終了後にだけ呼ばれる。
  - `calculateGlobalUnderstandingFileProgress()`は同期APIで、全`nonEmptyLines`と全reviewed intervalを一度に処理する。
  - P3 follow-up testsはsource内yieldを観測するだけで、source return後の大規模intersection/evidence処理中のscheduler checkpointを確認しない。
- Required action:
  1. 単一fileで多数の`nonEmptyLines`とreviewed intervalを与え、calculator/evidence処理にもbounded checkpointが存在することを固定するRed testを追加する。
  2. evidence生成、interval validation/normalization、intersection countをincremental/chunked application処理へ移すか、同等のbounded scheduler境界を設ける。
  3. 明示的なfile line/interval上限で除外する方針を採る場合は、設計、除外診断、分母契約へ反映し、暗黙にT607へ先送りしない。

## 6. Required coverage disposition

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | `checked_finding` | R2-P1 certainty-first違反、R2-P2 event-loop終了条件不足 |
| correctness / edge cases | `checked_finding` | yield中file変更raceを確認 |
| scope discipline / unrelated changes | `checked_no_finding` | fixはT504 implementation、test、workflow、report/handoffへ限定 |
| changed files / direct dependencies | `checked_finding` | T501 hash/state contract、T503 denominator、Node filesystem競合、core calculatorを確認 |
| API / data / configuration / workflow compatibility | `checked_no_finding` | optional third load parameterは既存2-arg sourceと互換。focused CIへtestを接続 |
| error handling / failure diagnostics | `checked_finding` | 診断artifactは適切だが、R2-P1のobservable raceを検出せず成功する |
| security / secret handling | `checked_no_finding` | credential処理追加なし。source本文をreport/logへ出していない |
| tests / validation adequacy | `checked_finding` | R2-P1競合testとR2-P2 post-load bounded-work testが欠落 |
| current-HEAD CI | `checked_no_finding` | `6a93bcd8...`一致run `30749281735` success |
| report / tracking / documentation accuracy | `checked_no_finding` | follow-up reportはreview verdict未変更を明記。schema v3 handoffとlegacy packet保持を確認 |
| regression / maintainability | `checked_finding` | source load完了時点のcurrent evidence保証と、application/coreのwork budgetが分離し不完全 |

## 7. Held / unexplored

### Held

- Whole-buffer memory ceiling and final scale benchmark
  - Owner: `T607`
  - Reason: `readFile()`による全Buffer保持のmemory上限と定量性能目標はT607の責務。
  - Remaining risk: 大fileでmemory pressureが発生し得る。
  - Verdict impact: R2-P1/P2とは別であり、今回のfail理由へは使用しない。

### Unexplored

- なし。

## 8. Verdict

- Verdict: **fail / changes required**
- Existing finding closure:
  - `T504-R1-P1` high: closed
  - `T504-R1-P2` medium: closed
  - `T504-R1-P3` medium: closed for original required action
  - `T504-R1-P4` low: closed
- New required findings:
  - `T504-R2-P1` high
  - `T504-R2-P2` medium

## 9. 次のaction

1. implementation workerが`T504-R2-P1`と`T504-R2-P2`のRed testを先に追加する。
2. observable file raceをfinal metadata checkでfail-closedにする。
3. source return後のevidence/interval/intersection処理へbounded scheduler境界を追加する。
4. 新しいtechnical HEADと完全一致するfocused/full CIを確認し、診断artifactを保持する。
5. 同じnormal reviewerがfinding ID/severityを保持して再度fix verificationする。
6. mergeは利用者が行う。

# T506 通常レビュー finding 修正確認 R2

## Identity

- Repository: `ssaattww/RevMem`
- Issue / Task: Issue #1 / T506
- Pull Request: #55 `T506: Global複数context統合・Extension Host試験`
- Review mode: normal review / fix verification R2
- Reviewer continuity: T506初回通常reviewおよび前回fix verificationと同一reviewer
- Base: `146aec15783294da1795f268315c85d1a0dffa56`
- Previous review-artifact HEAD: `4cd1f3540fe160865e4981baf8e924034f054dca`
- Reviewed implementation HEAD: `96ac0e3f238f50ada33a13de0452fdd999b4b7d2`
- Fix range: `4cd1f3540fe160865e4981baf8e924034f054dca..96ac0e3f238f50ada33a13de0452fdd999b4b7d2`
- Generated at: `2026-08-16T22:47:00+09:00`
- Verdict: **fail**

今回のfix verificationは既存finding `T506-REV-001` / High と `T506-REV-002` / High / introduced_by_fix のclosureを主対象とし、fix rangeの新規変更について直接影響・sibling case・test/CI wiringも確認した。reviewerはproduct/test/workflowの修正を行っていない。

## 1. Fix range / changed files

`4cd1f354...`から`96ac0e3f...`は10 commits / 10 changed filesである。全changed fileを確認した。

| Path | Disposition |
| --- | --- |
| `src/adapters/state-repository/validated-file-system-review-state-repository.ts` | same-process state write queueをmodule共有へ変更。`T506-REV-002`に関連 |
| `src/adapters/state-repository/jsonl-review-history-store.ts` | same-process JSONL append queueをmodule共有へ変更。`T506-REV-002`に関連 |
| `src/application/review-history/review-history-recorder.ts` | live edit用`recordDocumentEditMapping()`を共通history境界へ追加 |
| `src/document-review-edit-runtime.ts` | Git + workspace owner、repository/history注入境界、CAS stale retryを追加。両findingに関連 |
| `src/t305-extension.ts` | live edit snapshotへworkspace folder identityを追加。`T506-REV-001`に関連 |
| `test/integration/t506-live-edit-concurrency.integration.test.ts` | command/edit concurrency回帰。`T506-REV-002`はこのtest adequacyが未充足 |
| `test/vscode/t506-workspace-suite/index.ts` | 非Gitworkspace実Extension Host edit/restart回帰。`T506-REV-001` closure evidence |
| `test/vscode/run-extension-host.ts` | T506 focused suiteへGit 3-phase + workspace 2-phase + concurrency testを接続 |
| `reports/issue-1-t506-review-followup-r2-20260816220232.md` | implementation response evidenceを確認 |
| `handoffs/issue-1-t506-review-followup-r2-20260816220232.yaml` | implementation continuation evidenceを確認 |

直接依存として`WorkspaceReviewStateSessionProvider`、`SnapshotTrackingWorkspaceReviewStateSessionProvider`、base extensionの`DebouncedReviewStateRepository`/normal-editor command persistence、T501/T502/T504/T505のGlobal contract、CI focused wiringを確認した。

## 2. TDD / failure diagnostics

作業開始時点の`.github/workflows/ci.yml`と`tools/run-ci-command.mjs`は、command別stdout、stderr、combined log、result metadataおよびfailure investigation contextをartifactへ保存するため、追加workflowは不要である。

今回、implementation reportの記載だけでなくRED artifactを実際に取得・展開した。

### T506-REV-002 RED

- Test-only HEAD: `18c3a3e3c6195919a30f03058183cd548e8f63d1`
- Run: `31947728345`
- Artifact: `9263778874`
- `test-output/ci/test-t506.result.json`: exit code `1`
- stdout: `T506 live edit and command share one serialized state/history boundary`がfailure
- actual error: `DocumentReviewEditRuntime did not use the injected shared repository.`
- stderrは独立fileとして保存済み

### T506-REV-001 non-Git RED

- Test-only HEAD: `6a945b2a536f7167c99b21b529505a4090f6c826`
- Run: `31947812044`
- Artifact: `9263810873`
- `test-output/ci/test-t506.result.json`: exit code `1`
- Git側3 phaseは先に成功
- non-Git Extension Host `t506-workspace-mark-edit`でfailure
- Extension Host diagnosticのactual assertion: Global Understanding `0 !== 2`

したがって、両findingについてproduction変更前の意図したREDは確認できる。

## 3. T506-REV-001 — High — **closed**

### Source finding

Git working tree向けlive edit修正後も、非Gitworkspaceでは`DocumentReviewEditRuntime`が`unsupported-owner`で終了し、実`TextDocumentContentChangeEvent`からContext/Global mapping、Global Understanding、restartまで同じdefect classが残っていた。

### Verification

現HEADでは`DocumentReviewEditRuntime`がGit inspection結果がrepositoryでない場合、workspace evidenceから`WorkspaceIdentityService`を使ってownerを解決する。repository/context/file identityとrevision `workspace-live:<workspaceId>`は既存`WorkspaceReviewStateSessionProvider`と同じcontractである。

`t305-extension.ts`は実document snapshotへ`workspaceFolderUri`とworkspace-relative pathを付加し、actual `TextDocumentContentChangeEvent`をedit runtimeへ渡す。

新しい`test/vscode/t506-workspace-suite/index.ts`はGitを初期化しない実Extension Host workspaceで次を通す。

1. 2行をproduction normal-editor commandで確認済みにする。
2. 実`TextEditor.edit()`で途中へ1行挿入する。
3. Global Understandingが`2/3`になるまでproduction sourceを観測する。
4. decorationが`[0,1), [2,3)`で、挿入行だけ未確認になることを確認する。
5. saveし、同じworkspace/user-data/storageでExtension Hostを再起動する。
6. restart後も同じGlobal Understanding `2/3`とmapped decorationを確認する。

`run-extension-host.ts --t506`がこのworkspace 2-phaseを実行し、current implementation HEAD一致CI `31948788255`のjob logで`workspace-mark-edit` / `workspace-restore`双方のsuccessを確認した。

### Disposition

**closed**。severityはsourceのHighを保持したままclosureする。Git working treeと非Gitworkspaceの対象live-edit/restart経路がproduction compositionと実Extension Hostで立証された。

## 4. T506-REV-002 — High / introduced_by_fix — **partial / open**

### Source finding

前回fixがbase extensionとは別の`FileSystemReviewStateRepository` / `JsonlReviewHistoryStore` instanceを作り、instance-localなwrite/history serializationを回避したため、同一Extension Host内のedit mappingとreview command等が並行するとstate/history lost updateが可能だった。

Required actionは、same-processで共有されるserialized persistence/history boundaryを実装し、**edit処理とreview commandを意図的に並行させて、production相当の境界で両state/historyが失われないRed/Green regressionを固定すること**である。

### Production fix inspection

実装側は次を追加している。

- `validated-file-system-review-state-repository.ts`: `sharedOuterWriteTailByStorageRoot`をmodule-levelにし、複数repository instanceの`save/commit/create`をstorage root単位で直列化。
- `jsonl-review-history-store.ts`: `sharedHistoryTailByFilePath`をmodule-levelにし、複数store instanceのJSONL read-modify-replaceをfile path単位で直列化。
- `DocumentReviewEditRuntime`: repository/history recorder注入境界と`StaleReviewStateError`後のreload/replan。

この修正方針自体はsource findingに対応しており、コード上の明白な新規lost-update pathは追加確認できなかった。

### Remaining closure gap: regression bypasses the production fix

しかし、新規`test/integration/t506-live-edit-concurrency.integration.test.ts`は、productionで変更したmulti-instance persistence境界を実行していない。

- state側はreal `FileSystemReviewStateRepository`を2 instance生成せず、test専用`ControlledSharedRepository`を**1つ**作り、commandとedit runtimeへ同じinstanceを渡す。
- そのfake repository自身がdeep-equal CASとcommand-before-edit orderingを実装しており、productionの`sharedOuterWriteTailByStorageRoot`を一切通らない。
- history側も別`JsonlReviewHistoryStore`を2 instance生成せず、**1つの`ReviewHistoryRecorder` / 1つのstore**をcommandとedit runtimeで共有するため、productionの`sharedHistoryTailByFilePath`が壊れてもtestは影響を受けない。
- production `t305-extension.ts`はbase extension repository/historyをedit runtimeへ注入しておらず、実際には別default instanceを生成し、まさにmodule共有queueへ依存する。したがってtest compositionとproduction compositionが異なる。

つまり、`sharedOuterWriteTailByStorageRoot`または`sharedHistoryTailByFilePath`をinstance-localへ戻しても、現在のconcurrency regressionはその変更を検出できない。REDも「production multi-instance queueが壊れていること」ではなく「runtimeにinjection boundaryがないこと」で失敗している。

current HEADのT506 focused CIがsuccessであることは確認したが、このtest gapによりsource findingの恒久回帰証拠としては不足する。

### Required action

High finding identity/severityを維持し、次を追加する。

1. **real multi-instance state regression**: 同じstorage rootを共有する2つの`FileSystemReviewStateRepository`（またはproduction base wrapper delegateとedit runtime側instance）を使用し、command/editを決定的に競合させる。片方がold expectedを保持した状態でも共有queue/CASによってstale → reload/replanとなり、両file/Global stateが残ることを確認する。
2. **real multi-instance history regression**: 同じhistory fileへ書く別々の`JsonlReviewHistoryStore` / recorder instanceを並行appendさせ、`marked-reviewed`と`invalidated-by-edit`の両eventが残ることを確認する。
3. 代替としてproduction composition自体をbase extensionと同じrepository/history instance注入へ変更する場合は、そのactual wiringをtestで通す。
4. 修正後current PR HEADと`head_sha`が一致するCIでfocused/full regressionを確認する。

### Disposition

**partial / open**。production fixは存在するが、required concurrency regressionが実fix boundaryを保護しておらず、closure条件を満たさない。severityはHighを維持する。

## 5. Current implementation HEAD CI

Reviewed implementation HEAD `96ac0e3f238f50ada33a13de0452fdd999b4b7d2`に関連付けられたpull-request CIだけを使用した。

- Workflow: `CI`
- Run: `31948788255`
- Job: `95168909165`
- Conclusion: `success`
- Build / contract typecheck / architecture positive+negative / lint / unit: success
- T502/T503/T504/T505/T506 focused: success
- T506 Git 3-phase Extension Host: success
- T506 non-Git workspace 2-phase Extension Host: success
- T506 concurrency test process: exit success（runnerから実行され、failureならfocused stepがrejectする構造）
- Temporary Git / Mock GitHub / standard VS Code Extension Host: success

別SHAのrunは代用していない。

## 6. Required coverage matrix

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Existing finding identity/severity | checked | REV-001 High closed、REV-002 High partial/open。reclassificationなし |
| Requirement/design conformance | checked_finding | REV-001 now supported; REV-002 test evidence incomplete |
| Correctness / edge cases | checked_finding | workspace identity/restart supported; concurrency production boundary not exercised by regression |
| Scope discipline | checked_no_new_finding | fix rangeは2 findingsとreport/handoffに限定 |
| All changed files / direct deps | checked_finding | 10 changed filesとworkspace/state/history/command consumersを確認 |
| API/data/config/workflow compatibility | checked_no_new_finding | schema/public command変更なし。same-process queue scope、existing routingを維持 |
| Error handling / diagnostics | checked_no_new_finding | 2 RED artifactsを実展開しstdout/stderr/result/EH diagnosticを確認 |
| Security/privacy | checked_no_new_finding | token/source handling変更なし。新queueはprocess-local metadataのみ |
| Tests / validation adequacy | checked_finding | REV-002 regression bypasses real multi-instance queue |
| Exact current implementation HEAD CI | checked_no_new_finding | run `31948788255` success for `96ac0e3f...` |
| Report/tracking/docs accuracy | checked_finding / held | R2 reportのREV-002「completed」はclosure evidenceを過大評価。trackingは専用skill不在でheld |
| Regression / maintainability | checked_finding | real queue regressionがなくmodule-level lock regressionをCIが検出できない |

## 7. Held / unexplored / new findings

- Tracking (`tasks/tasks-status.md`, `tasks/phases-status.md`): repository指定のprogress-management Skillが利用できないためheld。reviewerは直接編集しない。
- T604 cross-window/cross-process locking、T605 remote/multi-root、T607 scaleは今回のfinding scope外。
- Mergeはuser-ownedのため実施しない。
- **New independent findings: なし。**
- **Unexplored in accepted fix-verification scope: なし。**

## 8. Verdict

**fail**。

- `T506-REV-001 / High`: **closed**
- `T506-REV-002 / High / introduced_by_fix`: **partial / open**

REV-002のproduction修正方針は確認できるが、TDD/回帰testがproductionで依存するmulti-instance shared state/history queueを通さないため、required closure evidenceが不足している。real multi-instance regression追加後、同じnormal reviewerがfinding identity/severityを保持して再度closure確認する。
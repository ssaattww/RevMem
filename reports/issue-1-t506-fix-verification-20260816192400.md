# T506 通常レビュー fix verification

## Identity

- Repository: `ssaattww/RevMem`
- Issue / Task: Issue #1 / T506
- Pull Request: #55 `T506: Global複数context統合・Extension Host試験`
- Review mode: `fix_verification`
- Reviewer continuity: 前回 `T506-REV-001` を出した同一通常reviewer / 同一chat
- Base: `146aec15783294da1795f268315c85d1a0dffa56`
- Previous review artifact HEAD: `8e830c51742e5cdbd6e110716cf0c5d30b0f1232`
- Reviewed implementation HEAD: `03ac8dedb7c92aa9000da03248b3985f57dcaaf2`
- Fix range: `8e830c51742e5cdbd6e110716cf0c5d30b0f1232..03ac8dedb7c92aa9000da03248b3985f57dcaaf2`
- Generated at: `2026-08-16T19:24:00+09:00`
- Verdict: **fail**

技術判定は `03ac8dedb7c92aa9000da03248b3985f57dcaaf2` に対するもの。reviewerはproduct、test、workflow、design、trackingの修正を行っていない。

## 1. Purpose / authoritative requirements

前回finding `T506-REV-001` のclosureを、finding identityとHigh severityを維持して検証した。同時にreview-workerのfix verification規則に従い、fix diff全体、直接影響、affected contract、同一defect classのsibling case、新規変更領域を再確認した。

T506のtaskは「複数contextの確認・解除・変更追従とGlobal集計を通す統合・Extension Host試験」を要求し、AC-18〜AC-20、GlobalのPR進捗非混入、restart後の同一理解率を終了条件とする。T501のGlobal contractはPR、branch、workspaceの確認をGlobalへ反映する。設計rev4はPR、branch、Gitなしworkspaceをreview contextとして扱い、編集時に変更部分だけを未確認化する。またREADMEは通常editorの編集イベントによる即時追従runtime配線をT506で解消すると明記している。

## 2. Fix diff / inspected files

`8e830c...03ac8ded` のfix rangeは8 commits、5 changed files。

| Path | Disposition |
| --- | --- |
| `src/document-review-edit-runtime.ts` | 新live-edit runtimeを全505行確認。`T506-REV-001` partial残存、`T506-REV-002`新規finding |
| `src/t305-extension.ts` | VS Code event wiring、refresh、deactivationを確認。両findingに関連 |
| `test/vscode/t506-suite/index.ts` | 実Git working treeでのedit/restart回帰を確認。Gitなしworkspaceとconcurrency regression欠落 |
| `reports/issue-1-t506-review-followup-20260816184900.md` | TDD/修正主張を確認。Git経路の証拠は成立するがclosure主張は過大 |
| `handoffs/issue-1-t506-review-followup-20260816184900.yaml` | fix identity / validation evidenceを確認。finding closureには追加修正が必要 |

直接依存・consumerとして次を確認した。

- `src/extension.ts`: base runtimeが別の`FileSystemReviewStateRepository` / `DebouncedReviewStateRepository` / `JsonlReviewHistoryStore`を所有
- `src/adapters/state-repository/coherent-file-system-review-state-repository.ts`: write serializationはrepository instance内の`writeTailByStorageRoot`
- `src/adapters/state-repository/validated-file-system-review-state-repository.ts`: outer write serializationもinstance-local
- `src/adapters/state-repository/jsonl-review-history-store.ts`: history append tailはstore instance-local
- `src/adapters/workspace-review-state/snapshot-tracking-workspace-review-state-session-provider.ts`: Gitなしworkspaceはsnapshotをopen/load時にmappingするが、今回追加されたlive-edit runtimeには接続されていない
- `src/t505-global-understanding-source.ts`: persisted Globalとopen document evidenceから理解率を再計算する
- `src/application/global-review-mapping/*` / `src/core/range-mapping/*`: actual mapping contract
- `tasks/tasks-status.md` / design rev4 / README
- PR #55 current body、review thread、follow-up report/handoff

## 3. TDD / diagnostic evidence

修正側が示したREDを独立確認した。

- RED HEAD: `02a3aba262f90a2d918998c3eb5a39c7bb1cd106`
- Workflow run: `31933264222`
- Conclusion: `failure`
- Failure artifact: `9259917030`
- Artifact head SHA: `02a3aba262f90a2d918998c3eb5a39c7bb1cd106`
- T506 command result: exit code 1
- Extension Host assertion: expected Global Understanding reviewed lines 2, actual 0 (`0 !== 2`)
- artifactにはstdout、stderr、combined log、result metadata、environment、Git status、generated file inventory、source/test/generated outputが含まれる

したがってGit working treeのproduction live-edit欠落を再現するREDは成立している。

## 4. Finding dispositions

### T506-REV-001 — High — **partial / open**

- Source severity: **High**（変更なし）
- Origin: `coverage_miss`
- Previous reviewed HEAD: `a6bd4d21477d4a32795acf3e762812971ca0216b`
- Current reviewed HEAD: `03ac8dedb7c92aa9000da03248b3985f57dcaaf2`
- Location: `src/document-review-edit-runtime.ts:120-124`, `src/t305-extension.ts:253-295`, non-Git workspace provider

#### Closed portion

Git working treeの通常editorについては、実`TextDocumentContentChangeEvent`を`DocumentReviewEditRuntime`へ渡し、Context / Globalをmappingしてpersistし、Global Understandingとdecorationをrefreshするproduction経路が追加された。Extension Host testは`TextEditor.edit()`で1行挿入し、Global Understanding 2/3、reviewed intervals `[0,1), [2,3)`、restart後の同一結果を検証している。この部分は前回findingを修正している。

#### Remaining defect

`DocumentReviewEditRuntime.persist()`はGit inspectionが`repository`でない場合、即座に`"unsupported-owner"`を返す。`t305-extension.ts`は`result !== "applied"`ならdecoration refreshを行わない。したがってGitなしworkspaceでは今回のlive-edit mapping/persistence経路が動かない。

これはT506のaccepted scopeに残る。同taskは「複数contextの変更追従とGlobal集計」を要求し、T501のGlobal contractにはworkspaceが含まれる。設計はGitなしworkspaceをreview contextとし、編集後に変更部分だけ未確認へ戻す。READMEも通常editorの即時編集追従runtime配線をT506で解消するとしており、Git-onlyとは限定していない。

既存`SnapshotTrackingWorkspaceReviewStateSessionProvider`はsnapshotを`open()` / `loadForDecoration()`時にmappingするが、今回のdocument-change eventからowner stateをpersistする経路ではない。Global Understandingはpersisted Globalのold content hashとnew open-document evidenceを比較するため、live edit直後に同じstale/0 defect classを残す。

#### Impact

Gitなしworkspaceでreview済みfileを編集中、変更行だけを外して未変更prefix/suffixを即時維持するT506 behaviorが成立せず、Global Understanding / decoration / restart証拠がGit contextに偏る。

#### Required action

1. Gitなしworkspaceをlive-edit ownerとしてroutingし、T601 snapshot authorityと整合する形でContext / workspace-local Globalをmapping/persistする。
2. 実Extension Hostで非Gitworkspace fileをreview → edit → unchanged range維持 / changed range解除 → Global Understanding → restartまで検証するRED/Green regressionを追加する。
3. `unsupported-owner`をT506 acceptance内のworkspaceへ返さない。

### T506-REV-002 — High — **open / introduced_by_fix**

- Origin: `introduced_by_fix`
- Location: `src/document-review-edit-runtime.ts:89-94`, `src/t305-extension.ts` activation; state/history adapters
- Severity: **High**

#### Description

新しい`DocumentReviewEditRuntime`はbase extensionと同じstorage URIを使用するが、独立した`FileSystemReviewStateRepository`と`JsonlReviewHistoryStore`を生成している。base extension側には既に別のatomic repositoryを`DebouncedReviewStateRepository`でwrapしたcommand/session persistenceと、別の`JsonlReviewHistoryStore`が存在する。

既存repositoryのCAS read/compare/write直列化は`writeTailByStorageRoot` / `outerWriteTailByStorageRoot`という**instance-local** mutexである。historyのread-validate-append-replaceも`JsonlReviewHistoryStore.tails`という**instance-local** tailである。したがって今回の2つのinstanceは同一Extension Host・同一storage ownerでも互いを直列化しない。

#### Concrete race

1. review済みGit fileをeditし、edit runtime Bがold complete snapshot `S`をloadする。
2. Bのmapping commitが完了する前に通常editor command/session runtime Aも`S`をloadする。
3. AとBは別instanceなのでそれぞれのCAS lock内で同じ`S`をcurrentと確認できる。
4. 両方が別のnext snapshotを書き、manifest-last replaceの最後のwriterが片方のContext/Global更新を隠せる。
5. historyも別storeが同じold JSONLをreadして別eventをappendし、最後のreplaceで片方のeventを失える。

これはT604が担当するcross-window / cross-process lockではない。今回のfixが**同一Extension Host内**に同じownerの独立persistence boundaryを増やしたことで、既存のsame-instance serialization contractを回避している。

#### Impact

edit直後にreview/unreview commandや他のstate transitionが重なるだけで、atomic Context/Global contractの片方のユーザー操作を失う可能性があり、履歴audit eventも消失しうる。確認済み状態の正確性とT501/T104/T206 contractを破る。

#### Required action

1. edit runtimeへbase extensionと同一のserialized repository / history boundaryを注入して共有する。あるいはstorage-owner単位のsame-process mutexをinstance間で共有する。
2. edit mappingとnormal-editor review commandを意図的に並行させ、両更新が直列化され、stale retry後もstateとhistoryの双方を失わない回帰testを追加する。
3. T604のcross-process responsibilityへ先送りせず、同一Extension Host内のinstance間競合をT506 fixで閉じる。

## 5. Exact current-HEAD validation

Reviewed implementation HEAD `03ac8dedb7c92aa9000da03248b3985f57dcaaf2` に一致するworkflow runだけを確認した。

- Workflow: `CI`
- Run: `31940480479`
- Job: `95148798221`
- Head SHA: `03ac8dedb7c92aa9000da03248b3985f57dcaaf2`
- Conclusion: `success`
- Build / typecheck / architecture / lint / unit / T602 / T403 / T404 / T304 / T502 / T503 / T504 / T505 / **T506** / Git / GitHub / standard Extension Host: all success

CI successは上記findingを否定しない。現T506 testはGit repository fixtureだけをlive-editし、別persistence instanceとの並行state transitionを作っていない。

## 6. Required coverage matrix

| review-worker criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirement and design conformance | `checked_finding` | `T506-REV-001` workspace sibling case残存 |
| Correctness and edge cases | `checked_finding` | non-Git owner未対応、same-process concurrent writer race |
| Scope discipline and unrelated changes | `checked_no_finding` | fix filesはfinding対応・test・report/handoffに限定 |
| Changed files and direct dependency impact | `checked_finding` | fix 5 paths全件とstate/history/workspace consumersを確認 |
| API/data/config/workflow/compatibility effects | `checked_finding` | `T506-REV-002`がatomic persistence contractへ影響 |
| Error handling and failure diagnostics | `checked_no_finding` | RED artifact `9259917030`を確認、必要diagnosticsあり |
| Security and secret handling | `checked_no_finding` | 新secret/token保存・source外部送信なし |
| Tests and validation adequacy | `checked_finding` | non-Git EH caseとconcurrent writer regressionがない |
| Current-HEAD CI evidence | `checked_no_finding` | exact HEAD run `31940480479` success |
| Report/tracking/documentation accuracy | `checked_finding` / `held` | follow-upの「REV-001 response complete」は過大。task trackingは専用manager不在 |
| Regression and maintainability risks | `checked_finding` | duplicate owner persistence instancesがsame-process raceを導入 |

## 7. Held / not applicable / unexplored

Held:

- `tasks/tasks-status.md` / `tasks/phases-status.md`同期: repository規則が`task-breakdown-planner` / `task-consistency-manager` / `progress-sync-manager`経由を要求するが、今回のuploaded worker setにはない。
- merge: user-owned。

Not applicable to this T506 fix verification:

- T604 cross-window/cross-process lockそのもの
- T605 multi-root / Remote SSH / Dev Containers / Codespaces full acceptance
- T607 scale benchmark

**Unexplored: なし。** Fix verificationで要求されるfinding identity、fix diff、affected contract、sibling case、新規変更領域を確認した。

## 8. Verdict / next action

**fail**。

- `T506-REV-001` High: Git pathは修正、Gitなしworkspace sibling caseが残るためpartial/open。
- `T506-REV-002` High: fixが同一Extension Host内に独立state/history repositoryを増やし、same-process CAS/history raceを導入。

implementation workerは両findingをTDDで修正し、同一normal reviewerが再度fix verificationする。修正後は新しいPR current HEADに一致するworkflow runだけをCI判定に使用する。mergeは利用者が行う。

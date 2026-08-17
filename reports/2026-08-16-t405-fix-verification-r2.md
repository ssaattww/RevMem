# T405 通常review finding fix verification R2

## Metadata / target identity

- report type: `verification_report`
- review mode: `fix_verification`
- repository: `ssaattww/RevMem`
- task: `T405`
- pull request: `#54 T405 Review Contexts ViewとPRコンテキスト操作を実装`
- branch: `feature/t405-review-contexts`
- base ref: `main`
- base SHA: `146aec15783294da1795f268315c85d1a0dffa56`
- previous verification administrative HEAD: `b0f3184a629945ed62d2a9d300f505b907e086f4`
- implementation R2 technical HEAD: `fcdae7d5121dc74459a20c148bdf9da0bfb1d6e2`
- fix-verification reviewed HEAD: `d68882e2fb5971247ac651ecc047b42420353d3e`
- verification range: `b0f3184a629945ed62d2a9d300f505b907e086f4..d68882e2fb5971247ac651ecc047b42420353d3e`
- source verification report: `reports/2026-08-16-t405-fix-verification.md`
- implementation follow-up report: `reports/2026-08-16-t405-review-followup-r2.md`
- reviewer identity: `ChatGPT normal reviewer / T405 review chat 2026-08-16`
- reviewer continuity: initial normal review、前回fix verificationと同じchatで再verificationを実施。実装・finding修正には関与していない。
- merge boundary: mergeは実施しない。利用者がmergeする。

## Purpose / scope

前回fix verificationで残った `R405-1 / R405-2 / R405-3 / R405-5 / R405-7 / R405-9` を、同じID・severity・required actionのままclosure確認する。前回closed済みの `R405-4 / R405-6 / R405-8` はregressionがないことだけ確認し、finding identityを再分類しない。

T406のGitHub障害/public unauth/HTTP failure/full multiple-candidate/closed-PR E2E matrix、T506 multi-context/Global integration、manager Skill所有のtask tracking、mergeは引き続きnon-goal/heldとする。ただしT405 source findingで明示したcomposition regressionはT406へ先送りしない。

## Delta inspected

前回administrative HEAD `b0f3184...` からreviewed HEAD `d68882e...` の14 commits / 11 changed filesを確認した。

- `src/application/review-contexts/current-pull-request-context.ts`
- `src/application/review-contexts/index.ts`
- `src/application/review-contexts/review-contexts-controller.ts`
- `src/t405-review-contexts-runtime.ts`
- `src/ui/review-contexts/index.ts`
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
- `test/unit/t405-github-lifecycle.test.ts`
- `test/unit/t405-pull-request-review-runtime.test.ts`
- `test/unit/t405-review-followup.test.ts`
- `reports/2026-08-16-t405-review-followup-r2.md`
- `handoffs/issue-1-t405-review-followup-r2-20260816215002.yaml`

直接依存として、前回required actionの基準となるT401 resolver、T302/T303 canonical diff command、T304 progress、T305 Current Context composition、T404 state service/revision mapper、通常editor selected-context ownership、および前回verification reportを再照合した。

## Finding closure matrix

Finding ID / severityは変更しない。severity reclassificationは0件。

| Finding | Severity | R2 verification | Result |
| --- | --- | --- | --- |
| R405-1 | Medium | `partial` | mapper/state-serviceのdurable B→C/layer/restart testは追加されたが、前回required actionの`registerT405ReviewContextsRuntime` redetect/synchronization compositionを通していない。 |
| R405-2 | Medium | `partial` | state-serviceのclosed/merged/restart/group/layer testは追加されたが、T405 `synchronizeRepository` lifecycle pathを通していない。 |
| R405-3 | Medium | `partial` | `PullRequestReviewRuntime` command serviceで両side mark/unmark persistenceは検証したが、Review Contexts command/openDiff composition起点を通していない。 |
| R405-4 | Medium | `addressed` | 前回closure維持。今回deltaにregressionなし。 |
| R405-5 | Medium | `addressed` | progress formatterをTree row descriptionとtooltipへproduction配線し、0/partial/100%表示contractを追加。 |
| R405-6 | Low | `addressed` | 前回closure維持。dead setting再導入なし。 |
| R405-7 | High | `partial` | preferred PR identityのproduction store/read/writeは追加されたが、testはhelper動作＋source文字列確認に留まり、前回required actionの`redetect→refresh→通常editor ownership` compositionを通していない。 |
| R405-8 | Medium | `addressed` | 前回closure維持。PR choiceはauthoritative create/update成功後にpersistされ、pre-persistence publicationは再導入されていない。 |
| R405-9 | Low | `addressed` | R405-5がuser-visibleになりREADMEの「進捗確認」記述とproduction挙動が一致。 |

## Remaining required findings

### R405-1 — Medium — partial

前回required actionは「同一PRのbase/head B→Cを**production runtimeで再検出**し、mapped durable state、layer operation成功、restart復元を一連で検証する回帰test」だった。

今回 `t405-github-lifecycle.test.ts` は `GitHubPullRequestContextStateService` とreal immutable mapperでB→C、layer、restartを検証しているため下位contractは強化された。しかしT405 production runtimeについては `src/t405-review-contexts-runtime.ts` に `redetectPullRequest ... contextStateService.update` が存在することを文字列assertするだけで、`registerT405ReviewContextsRuntime` のredetect/synchronization、real injected adapters、View/Current refreshとの接合を実行していない。

したがってproduct code上の旧欠陥は解消していると読めるが、前回findingが要求したcomposition regressionは未closure。

**Required action:** T405 runtime boundaryを実行可能なfixtureにし、redetectでB→Cを取得→T404 mapping→layer操作→同じstorageからruntime/service再生成後C復元までを一連で検証する。T406のfull E2E matrixまでは要求しない。

### R405-2 — Medium — partial

今回のtestはT404 state serviceに対してopen→closed/merged metadata updateを直接行い、restart、`saved-closed-pull-request` group、layer OFFを検証する。これはcore/state contractとして妥当。

しかし前回required actionはpersisted open PRをT405 runtimeのGitHub lifecycle synchronizationへ通し、`synchronizeRepository` 後のdurable state/View grouping/default layerを固定することだった。現在のtestは `FetchGitHubPullRequestLifecycleAdapter` とstate serviceを別々に検証し、T405のcomposition seamを通さない。

**Required action:** T405 source/runtime fixtureでlifecycle adapter応答をclosed/mergedへ変え、Review Contexts load/synchronization→durable state→saved group/layerを一連でassertする。

### R405-3 — Medium — partial

`PullRequestReviewRuntime`の追加testはcanonical URIを開いた後、`createCommandService()`でoriginal/modifiedのmark/unmarkを実行し、Context/Global persistenceまで確認している。この下位runtime contractは十分強化された。

ただし前回required actionは「**Review Contexts起点**でcanonical diffを開き、両side commandが実際にpersistするruntime/Extension Host regression」だった。今回も `ReviewContextsController.openDiff` / `registerT405ReviewContextsRuntime` / `reviewRange.openReviewContextDiff` からの経路は実行されていないため、初回不具合だったintegration seamを直接固定していない。

**Required action:** Review Contexts openDiff operationからPR diff registration/openを通し、そのURIに対してoriginal/modified mark/unmarkを実行しstate/progressへ反映されるcomposition test、またはT405-specific Extension Host scenarioを追加する。

### R405-7 — High — partial

production codeは改善されている。

- `VscodeCurrentPullRequestSelectionStore` が `workspaceState` にrepositoryId + immutable HEAD単位でcontextIdを保存する。
- redetectのauthoritative create/update成功後だけselectionをpersistする。
- Review Contexts projectionとCurrent Context candidate生成の双方でpreferred contextIdをreadする。
- `findCurrentPullRequestContext` は同一HEAD複数open PRのうちpreferred contextを選択し、preferenceなしではfail-closedを維持する。

一方、追加testはpure helperのpreferred selectionと、runtime source文字列に`select/read`があることをassertするだけである。前回required actionの「resolverで利用者が選択→redetect→refresh→Current Context→通常editor ownership」を一つのruntime flowとして通していない。既存 `t405-selected-pr-session` はsingle selected PRのnormal-editor ownershipのみで、multiple-candidate redetectとは接続していない。

**Required action:** same-HEAD PRを2件返すresolver/runtime fixtureでPR #Bを選択し、redetect完了後のCurrent Context refreshがPR #Bを選び、`runtimePort.setSelectedContext`相当の通常editor ownershipへ同じcontextIdが届くことを一連でassertする。必要なら再生成したworkspaceStateからpreference復元も追加する。T406ではその上にfull E2E matrixを追加する。

## Addressed in this round

### R405-5 — Medium — addressed

`formatReviewContextProgress()`をapplication APIとして追加し、`ReviewContextsTreeProvider.getTreeItem()`のdescriptionとtooltip双方で使用する。0%、75%、100% formatter testと、production UI source wiring testがRed→Greenで追加された。Design 16.4のuser-visible progress欠落は解消した。

### R405-9 — Low — addressed

READMEは既にReview Contextsで進捗確認可能と記載していたが、R405-5のproduction UIが追いついたため実装との不一致は解消した。dead settingも再導入されていない。

## Required coverage dispositions

| Required criterion | Disposition | Evidence / result |
| --- | --- | --- |
| requirement and design conformance | `checked_finding` | R405-1/2/3/7のrequired composition regressionsが未closure。R405-5/9はclosure。 |
| correctness and edge cases | `checked_no_finding` | 今回deltaのproduct code自体に新しいcorrectness defectは確認せず。same-HEAD preferred selection dataflowもcode inspection上整合。 |
| scope discipline and unrelated changes | `checked_no_finding` | 11 filesは残存findingのfix/test/report/handoffに限定。 |
| changed files and direct dependency impact | `checked_finding` | T401/T302/T303/T305/T404 seamsを再確認し、下位testのみでcomposition seam未固定。 |
| API, data, configuration, workflow, compatibility effects | `checked_no_finding` | formatter/export/selection store追加にbreaking changeなし。workspaceStateはpresentation/current-selection metadataのみ。 |
| error handling and failure diagnostics | `checked_no_finding` | selection persistはauthoritative create/update後。diagnostic workflow維持。 |
| security and secret handling where applicable | `checked_no_finding` | token/source leakageの新経路なし。selection storeはcontextIdのみ。 |
| tests and validation adequacy | `checked_finding` | R405-1/2/3/7で前回required integration/composition regression未達。 |
| current-HEAD CI evidence | `checked_no_finding` | reviewed HEAD `d68882e...` と完全一致するrun `31948207308`のみ採用、全step success。 |
| report, tracking, and documentation accuracy | `checked_finding` | implementation R2 report/handoffは6件全addressedとするが、4件はsource required action未達。READMEはR405-5 closureにより正確。trackingはheld。 |
| regression and maintainability risks | `checked_finding` | 初回に実際に壊れたcomposition seamsが下位単体testでしか固定されていない。 |

`unexplored`: 0件。

## TDD / CI evidence

### Red

- commit: `4fac6706d184e41865aade724d50c2fd3814f7ed`
- exact-head run: `31947458446`
- conclusion: `failure`
- diagnostic artifact: `9263698972`
- artifact `head_sha`: `4fac6706d184e41865aade724d50c2fd3814f7ed`
- build/typecheck/architecture/lint/unit/T602/T403/T404は成功し、T405 focused suiteで狙った2件のみ失敗:
  - R405-5 Tree progress wiring
  - R405-7 same-HEAD preferred PR helper behavior

TDD順序は成立している。

### Current reviewed-head CI

Reviewed HEAD:

`d68882e2fb5971247ac651ecc047b42420353d3e`

Matching run:

- run ID: `31948207308`
- status: `completed`
- conclusion: `success`
- Build / Contract typecheck / Architecture / Architecture negative / Lint / Unit / T602 / T403 / T404 / T405 / T304 / T502-T505 / Temporary Git / Mock GitHub / VS Code Extension Host: all success

別SHAのrunはcurrent-head CI判定へ代用していない。

## Held / non-goals

- T406 full GitHub public/auth/error/network/patch/multiple-candidate/closed-PR E2E matrix
- T506 multi-context change tracking / Global aggregation integration
- `tasks/tasks-status.md` / `tasks/phases-status.md` write: required manager Skill unavailable
- merge: user-owned

これらは`unexplored`ではない。

## Verdict

`fail`

- addressed: R405-4, R405-5, R405-6, R405-8, R405-9
- partial/open: R405-1, R405-2, R405-3, R405-7
- severity reclassification: none
- blocking unexplored: none
- current reviewed-head exact CI: success

次のimplementation follow-upではproduct codeを不用意に変更せず、まずR405-1/2/3/7で前回required actionどおりのT405 composition regressionを追加する。必要な場合のみ、そのtestが示すproduction defectを修正する。その後、このsame normal-review chatで再verificationする。

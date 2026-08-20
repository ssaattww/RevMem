# T606 normal finding closure R7 report

## タスク

T606 / Issue #76 / PR #77 の同一 normal reviewer による finding-limited closure R7。reviewer identity は `/root/t606_normal_review`。technical implementation HEAD `b3f2f9c43fa4f86c6cd51461f7afc6f48c21bc9e`、review target admin HEAD `d2bef25ab4a7b8965aed85322628638f5ae71bea`。既存openのT606-R002〜R005だけを照合し、T606-R001/R006/R007はclosedを維持した。

## sub-agentを使う理由

sub-agentは使用していない。同一reviewer continuityとfinding-limited closureの制約に従い、このreviewerがtechnical fix、admin sync、直接production command/storage経路、提供済みvalidation evidenceを一貫して照合した。

## 対象範囲

R6 closure `reports/issue-76-t606-normal-finding-closure-r6-20260821023000.md`、R7 follow-up report/handoff、technical range `0b23678f5b36e53f42589915511618f9c08900cb...b3f2f9c43fa4f86c6cd51461f7afc6f48c21bc9e`、admin range `b3f2f9c43fa4f86c6cd51461f7afc6f48c21bc9e...d2bef25ab4a7b8965aed85322628638f5ae71bea`を確認した。指定criteriaはR002 actual old-root reject/stale transition、R003 terminal failure後no refresh、R004 actual single write/non-retry、R005 production matrix wiringだけである。提供済み`test:t606` 195 pass / 2 Windows POSIX skip / 0 failとstatic validation passを評価した。

## 対象外

新規観点、新規finding、severity変更、sibling finding、full review、R001/R006/R007の再review、self-fix、test/build/lint/CIの再実行・起動・待機、GitHub/PR/Issue/branch/commit/push/mergeの変更は対象外。Markdown word checkはrepositoryに`tools/lint/`、必要設定、`lint:md` wiringがなくunsupportedとした。

## 実行コマンド

`git rev-parse`、`git status --short --branch`、`git log`、`git diff --name-status`、finding対象pathの`git diff`、`Get-Content`、`rg`、`Test-Path`によるread-only inspectionのみ。test/build/lint/CIは再実行していない。

## 対象ファイル

R7 changed filesの`src/ui/review-contexts/vscode-review-contexts-runtime.ts`、`test/unit/t606-r6-production-matrix.test.ts`、README、R7 report/handoff、tasks/phasesを確認した。直接dependency/consumerとしてoperation feedback boundary state、T405 `refreshPullRequestCache`、GitHub PR cache service、Node GitHub cache storage、storage-root lock diagnostic、post-mutation provider refresh、focused package/CI wiringを追跡した。

## 指摘事項

- **T606-R001 — High — closed maintained.** R6 closureのdispositionを維持し、再reviewしていない。
- **T606-R002 — High — closed.** Evidence: R7 matrixはold-root loadを実際に`reject`し、先行signalがabortedであること、old refreshがtyped cancellationでrejectすること、後続fresh-root nonempty itemだけがproviderに残ることをassertする。Impact:指定required actionのfailed old-root publicationとstale generation fenceは直接固定された。Required action: none。
- **T606-R003 — Medium — closed.** Evidence: `mutate`はoperationがthrowしたcatch内でもexplicit contextのterminal failure stateを取得する。R7 matrixはmutation controllerがstorage diagnosticを同じcontextへ報告してからthrowする経路を実行し、post-refreshのload回数が増えず、Output eventが`START, ERROR`一組だけであることをassertする。Impact:指定required actionのterminal failure後追加refresh/lifecycleは抑止された。Required action: none。
- **T606-R004 — Medium — open.** Evidence: R7 matrixのmutation stubはwrite前に`reportActiveStorageLockDiagnostic`を明示するためcatch時の`hasOperationFeedbackFailure`がtrueになる。しかしactual Node cache storageのENOSPC/EACCESはstorage-root lock取得失敗ではなくlock取得後のatomic write bodyで発生し、その経路はstorage-lock diagnosticを発行しない。したがってactual `refreshPullRequestCache`がnot-cachedとしてthrowしたcatchではterminal failure stateがfalseのままになり、post-mutation provider refreshが再度cache publish/writeを開始し得る。testの`writes += 1`はfake controller内であり、actual T405 source/Node cache storageを通らない。Impact:actual single write/non-retry required actionは未closureで、ENOSPC/EACCES時に同一commandから二回目のcache writeが起こり得る。Required action: mutationのthrow自体をpost-refresh抑止条件として返すか同等のboundary resultを設け、actual T405 source/Node cache storageへENOSPC/EACCESを注入して一commandのwrite一回、post-refreshなしをassertする。
- **T606-R005 — High — open.** Evidence:修正済みR7 scenariosは既存`test:t606` production matrixに含まれ、suite名のpackage/CI wiringも維持される。しかしR004 fixtureはactual cache compositionではなくdiagnostic付きfake controllerであり、diagnosticを伴わないactual atomic-write ENOSPC/EACCES後の再publishを検出しないまま195 passになる。Impact:production matrix wiringは存在するがactual single-write failure contractのregression detectionを満たさない。Required action:R004のactual T405/Node cache fixtureをproduction matrixへ追加し、同じfixtureを`test:t606`とCI contractで必須化する。
- **T606-R006 — Medium — closed maintained.** 前回closureのdispositionを維持し、再reviewしていない。
- **T606-R007 — Medium — closed maintained.** 前回closureのdispositionを維持し、再reviewしていない。

## 結果

**Verdict: FAIL.** T606-R001 closed maintained、R002 closed、R003 closed、R004 open、R005 open、R006 closed maintained、R007 closed maintained。提供済み195 pass / 2 Windows POSIX skip / 0 failとstatic validation passは受領したが、R004/R005のactual cache production scenarioを満たさない。Criterion dispositionはR002 failed old-root transition=`checked_no_finding`、R003 terminal failure後no refresh=`checked_no_finding`、R004 actual single write/non-retry=`checked_finding`、R005 production matrix adequacy/wiring=`checked_finding`。heldはMarkdown wording check unsupportedとexact-head CI merge gate。unexplored: none。次actionはimplementation ownerがR004/R005のrequired actionだけを修正・検証し、この同一normal reviewerへfinding-limited closureを依頼すること。

## リスク

Held: Markdown wording checkはrepository wiring不在のためunsupported。exact-head CIは未起動・未確認でmerge gateとしてheld。Windows POSIX 2 skipは提供済み証跡として明示し、passへ読み替えていない。technical verdictはimplementation HEAD `b3f2f9c43fa4f86c6cd51461f7afc6f48c21bc9e`へ適用し、admin HEAD `d2bef25ab4a7b8965aed85322628638f5ae71bea`はR7 evidence同期として区別する。report persistenceは通常review用repository fileでreport-attestationではなく、report以外の変更は行っていない。

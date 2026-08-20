# T606 normal finding closure R4 report

## タスク

T606 / Issue #76 / draft PR #77 の同一 normal reviewer による finding-limited closure R4。reviewer identity は `/root/t606_normal_review`。前回 reviewed HEAD `941f64b34d8f3f820145a9b262b9611df415a213` から fix HEAD `29ed22f70f714a6846ee58fff7b2eddf07cf4aa9` までを、open の T606-R001〜R005/R007 の required action に限って照合した。T606-R006 は closed を維持した。

## sub-agentを使う理由

sub-agent は使用していない。同一 reviewer continuity と finding-limited closure の制約に従い、この reviewer が対象 finding の production call graph と提供済み証跡を一貫して照合した。

## 対象範囲

R4 follow-up `reports/issue-76-t606-normal-review-followup-r4-20260821001157.md`、R4 fix diff、Review Contexts/Current Context/Global/PR Progress の cancellation、freshness、explicit feedback context、pure-read retry boundary、T402/T405 focused wiring、および README/handoff/tasks/phases を対象とした。提供済み `test:t606` 175 pass / 2 Windows POSIX skip / 0 fail と build、typecheck、lint、architecture positive/negative、diff-check の static evidence を評価した。R006 は再 review していない。

## 対象外

新規観点、新規 finding、severity 変更、sibling finding、full review、self-fix、GitHub/PR/Issue/branch/commit/push/merge の変更、test/build/lint/CI の再実行・起動・待機は対象外。Markdown word check は repository に `tools/lint/`、必要設定、`lint:md` wiring がなく unsupported とした。

## 実行コマンド

`git rev-parse HEAD`、`git status --short --branch`、`git log`、`git diff --name-status`、finding 対象 path の `git diff`、`Get-Content`、`rg`、`Test-Path` による read-only inspection のみ。test/build/lint/CI は再実行していない。

## 対象ファイル

R4 差分の Review Contexts、Current Context、Global、PR Progress、T305/T405/T505 production composition、`test/unit/t606-failure-policy-retry-diagnostics.test.ts`、`package.json`、`test/unit/ci-workflow-contract.test.ts`、README/handoff/tasks/phases/follow-up report を確認した。直接依存として operation feedback、GitHub PR cache service/storage、Current Context composition、T402 PR diff acquisition、T405 GitHub lifecycle、focused suite に列挙された adapter/UI tests を追跡した。

## 指摘事項

- **T606-R001 — High — open.** Evidence: Review Contexts と Global には AbortSignal が配線され、Review Contexts の superseded load test も改善した。一方、actual Current Context composition の `src/t305-extension.ts` は optional signal を受ける runtime port に対して `recompute: () => currentContextComposition.recompute()` と `selectContext: () => currentContextComposition.selectContext()` のまま signal を下流へ渡さず、refresh と select も別々の AbortController なので相互 supersede を中断しない。追加 direct test は Review Contexts に限定され、Global/Current Context/PR Progress の production seam で auth/validation/stale/permanent/cancellation と attempt/final-cause を固定していない。Impact: Current Context の古い acquisition が root/context change 後も継続し、各 production consumer の cancellable max-3/non-retry contract が回帰検出可能でない。Required action: Current Context の shared generation cancellation を actual composition まで伝播し、Global/Review Contexts/Current Context/PR Progress の concrete production seam で cancellation と auth/validation/stale/permanent の non-retry、attempt/final cause を検証する。
- **T606-R002 — High — open.** Evidence: old `stale` と new `fresh` を区別する provider test は stale publication fence と abort を直接証明するよう改善した。しかし前回 required action の failure と root-switch seam は追加されず、test は二つの成功 load の supersede だけを扱う。Impact: load failure または root switch 時に旧treeをfreshとして残さず stale/unknownへ遷移する contract が concrete host で未証明である。Required action: distinct items を用いた failure と root-switch の provider/runtime testを追加し、最終tree、freshness/unknown、通知、旧generation非publicationを検証する。
- **T606-R003 — Medium — open.** Evidence: feedback context は Review Contexts registration から T405 PR progress/cache diagnostic へ配線された。一方 `src/extension.ts` でreview-state/history/snapshot等へ渡す storage notifier は context なしのactivation-scoped callbackのままで、追加testもfake sourceが直接 `reportActiveOperationFailure` を呼ぶためactual T405 fallback/cache-lock compositionを通らない。Impact: actual persistence/storage diagnostic はouter operationへjoinせずstandalone terminalとなり、outer OKとの混在、duplicate terminal、activity単位の因果不整合が残り得る。Required action: explicit context をactual persistence/storage callbackを含むproduction call graphへ伝播し、T405 fallback、cache/storage lock、concurrent/nested operationをconcrete hostで実行してSTART一回とOK/ERROR一回、dedup、cross-talkなしを検証する。
- **T606-R004 — Medium — open.** Evidence: Review State の lifecycle projection と永続 mutation は分離されたが、Review Contexts の retry対象 `source.load()` は `GitHubPullRequestCacheService.acquire()` を含み、live取得時にcache `storage.write()`を行う。またR4はCurrent ContextのQuick Pick相当 `selectContext()`自体を `runWithBoundedRetry(... maxAttempts: 3)` で囲み、元findingが一回実行を要求したside-effect commandをretryableにした。追加registration testはside effectのないfake sourceである。Impact: cache publication後の後続failureでload全体とcache writeが再実行され、Quick Pick/selectionもretryable failure時に再実行され得る。Required action: retryを永続/cache mutation前のpure acquisitionだけへ分離し、Quick Pick/select、cache write、persistence、decoration/config mutationを一回だけ実行するproduction-composed partial-success testを追加する。
- **T606-R005 — High — open.** Evidence: focused commandへactual T402 PR diff acquisitionとT405 lifecycle suitesが追加され、404/incomplete content fallback、rate-limit/network、immutable identity/state transitionの直接証跡は改善した。しかしfocused listはR4で変更したGlobal UI/sourceとactual T405 Review Contexts/PR Progress composition testsを含まず、T405 lifecycle suiteのproduction runtime確認の一部もsource正規表現に留まる。したがってR001〜R004の全consumer failure/activity/freshness matrixを同じproduction factory chainで実行していない。Impact: 175 pass / 2 skipは追加adapter contractsを示すが、actual UI/runtime compositionのcancellation、retry、exactly-once terminal、freshness regressionを検出できない。Required action:変更したGlobal/Current/Review Contexts/PR ProgressとT405 source/cache/storageのactual compositionをfocused suiteへ追加し、要求されたGitHub/freshness/activity/retry matrixとfixture群を`test:t606`およびCI contractに固定する。
- **T606-R006 — Medium — closed maintained.** 前回 closure の disposition を維持し、再 review していない。
- **T606-R007 — Medium — open.** Evidence: README/handoff/tasks/phasesはR4 implementation commit `2353eb2d1be4199d1dfbbb152b1ace112701a660`、175 pass / 2 skip、closure pending、CI未実施を正しく記録したが、reviewed HEADは後続sync commit `29ed22f70f714a6846ee58fff7b2eddf07cf4aa9`であり、R001〜R005とexact-head CI gateは未closureである。Impact: authoritative evidenceはまだclosureまたはmerge-readyを主張できず、PR evidenceを含むexact reviewed-head completion identityにならない。Required action: R001〜R005 closure後のexact reviewed HEADへimplementation/handoff/tracking/report/PR validation evidenceを同期し、未実施/unsupported/heldをsuccessへ変換せずmerge gateを完了する。

## 結果

**Verdict: FAIL.** T606-R001 open、R002 open、R003 open、R004 open、R005 open、R006 closed maintained、R007 open。提供済み175 pass / 2 Windows POSIX skip / 0 failとstatic validation successは受領したが、open findingのrequired production-composed evidenceを満たさない。Criterion dispositionはR001 retry/cancellation/typed non-retry boundary = `checked_finding`、R002 failure/root-switch freshness = `checked_finding`、R003 operation identity/exactly-once composition = `checked_finding`、R004 pure-read/side-effect retry boundary = `checked_finding`、R005 full focused production matrix/CI wiring = `checked_finding`、R006 redaction = `checked_no_finding` carried、R007 reports/tracking/exact-head evidence = `checked_finding`。unexplored: none。次actionはimplementation ownerがopen findingのrequired actionだけを修正・検証し、この同一normal reviewerへfinding-limited closureを依頼すること。

## リスク

Held: Markdown wording checkはrepository wiring不在のためunsupported。exact-head CIは未起動・未確認でmerge gateとしてheld。Windows POSIX 2 skipは提供済み証跡として明示し、passへ読み替えていない。technical verdictはreviewed HEAD `29ed22f70f714a6846ee58fff7b2eddf07cf4aa9`に適用し、report persistenceは通常review用repository fileでreport-attestationではない。report以外の変更は行っていない。

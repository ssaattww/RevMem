# T606 normal finding closure R5 report

## タスク

T606 / Issue #76 / PR #77 の同一 normal reviewer による finding-limited closure R5。reviewer identity は `/root/t606_normal_review`。base `fb7df6ab79bb23ae16b43b61aa66ab743460be69`、前回 reviewed HEAD `29ed22f70f714a6846ee58fff7b2eddf07cf4aa9`、R5 reviewed fix HEAD `ec8315c8540badad5417702f667a406260795466`。既存 T606-R001〜R005/R007 の required action だけを照合し、T606-R006 は closed を維持した。

## sub-agentを使う理由

sub-agent は使用していない。同一 reviewer continuity と finding-limited closure の制約に従い、この reviewer が対象 finding の fix diff、直接 production dependency/consumer、提供済み validation evidence を一貫して照合した。

## 対象範囲

R4 closure `reports/issue-76-t606-normal-finding-closure-r4-20260821002540.md`、R5 follow-up `reports/issue-76-t606-normal-review-followup-r5-20260821010000.md`、range `29ed22f70f714a6846ee58fff7b2eddf07cf4aa9...ec8315c8540badad5417702f667a406260795466`、Current Context shared cancellation/Quick Pick non-retry、Review Contexts cache read/publish boundary、T405 operation feedback composition、focused package/CI wiring、README/handoff/tasks/phases を対象とした。提供済み `npm run test:t606` 191 pass / 2 Windows POSIX skip / 0 fail と build、typecheck、lint、architecture positive/negative、diff-check pass を評価した。R006 は再 review していない。

## 対象外

新規観点、新規 finding、severity 変更、sibling finding、full review、self-fix、test/build/lint/CI の再実行・起動・待機、GitHub/PR/Issue/branch/commit/push/merge の変更は対象外。Markdown word check は repository に `tools/lint/`、必要設定、`lint:md` wiring がなく unsupported とした。

## 実行コマンド

`git rev-parse`、`git merge-base`、`git status --short --branch`、`git log`、`git diff --name-status`、finding 対象 path の `git diff`、`Get-Content`、`rg`、`Test-Path` による read-only inspection のみ。test/build/lint/CI は再実行していない。

## 対象ファイル

R5 changed files の Current Context runtime/composition/controller、`src/t305-extension.ts`、GitHub PR cache service、T405 Review Contexts runtime、VS Code Review Contexts provider、Current Context/T405 composition tests、`package.json`、CI contract、README/handoff/tasks/phases/follow-up report を確認した。直接 dependency/consumer として operation feedback、T405 PR Progress/fallback/storage callback、T606 retry diagnostics、Review Contexts wiring/UI、Global UI/T505 source、T402/T403/T604/T605 focused suitesを追跡した。

## 指摘事項

- **T606-R001 — High — open.** Evidence: R5 は Current Context の refresh/select に shared AbortController を導入し、composition port と Quick Pick まで optional signal を伝播した。しかし追加された Current Context test は Quick Pick の non-retry だけであり、shared owner の cross-supersede、actual T305 composition の signal 伝播、Global/Review Contexts/Current Context/PR Progress の production seam における cancellation と auth/validation/stale/permanent non-retry、attempt/final cause を直接検証しない。focused に追加された T405 composition も `getPullRequestReviewProgress: (contextId) => pullRequestReviewRuntime.getProgress(contextId)` と optional feedback context/signal を捨てる test composition である。Impact: code path は改善したが、全 production consumer の cancellable max-3 と typed non-retry contract を regression test が保証しない。Required action: actual production signaturesを保持した concrete compositionでcross-supersede/root changeを起こし、各consumerのsignal到達、最大attempt数、auth/validation/stale/permanent non-retry、safe final causeをassertする。
- **T606-R002 — High — open.** Evidence: R5 は既存 generation fence を維持したが、前回 required action の failure と root-switch provider/runtime test を追加していない。現存 direct test は二つの成功 load によるold `stale`/new `fresh` supersedeだけで、failure時clear/unknownはsource正規表現、root switchは未実行である。Impact: load failureまたはroot切替時に旧treeをfreshとして残さず、通知とfreshnessをcurrent generationだけへ限定するcontractがconcrete hostで未証明である。Required action: distinct itemsを用いたfailureとroot-switchのprovider/runtime testを追加し、final tree、stale/unknown disposition、通知、旧generation非publicationを検証する。
- **T606-R003 — Medium — open.** Evidence: R5 はdeferred cache publishに既存feedback contextを保持するが、Review Contexts `mutate` は `operation: () => Promise<void>` のままfeedback contextをcontrollerへ渡さず、actual `redetectPullRequest` fallbackは `reportActiveOperationFailure` をcontextなしで呼ぶ。focusedへ追加されたT405 compositionも同一command後にfailed diagnosticとsucceeded eventの共存を許容しており、actual fallback/cache-lock/storageのSTART一回・terminal一回をassertしない。activation-scoped persistence/storage notifierもcontextなしのままである。Impact:一つのobservable commandでstandalone ERRORとouter OKが混在し、activity単位のexactly-once terminal、dedup、因果関係が保証されない。Required action: explicit feedback contextをmutation controllerとactual persistence/storage callbacksまで伝播し、redetect fallback、PR Progress、cache/storage lock、concurrent/nested operationをproduction-composed hostで実行してSTART一回とOK/ERROR一回、ERROR後OKなし、cross-talkなしをassertする。
- **T606-R004 — Medium — open.** Evidence: `GitHubPullRequestCacheService.acquireRead()`と`publish()`への分離、`publishLoaded()`をretryable read後に一回呼ぶ構造、Quick Pick non-retryはcode上で改善した。しかし`acquireRead`/`publish`/`publishLoaded`を参照するtestはなく、production cache write回数やread retry後のsingle publication、publish failure後のnon-retryを直接固定していない。既存registration testはside effectのないfake source、追加Quick Pick testはcontroller単体である。Impact: required actionのproduction-composed partial-success guaranteeが証跡化されず、将来retry boundary内へcache/persistence mutationが戻ってもfocused suiteが検出できない。Required action: actual T405 source/cache storageを用いてretryable read failure後のsingle cache write、publish failureのzero retry、Quick Pick/persistence/decoration/config mutationのsingle invocationをassertする。
- **T606-R005 — High — open.** Evidence: `test:t606`へGlobal UI/T505 source/T405 compositionを追加し、focused wiringは改善した。しかしR001のproduction cancellation/typed non-retry、R002のfailure/root-switch、R003のexactly-once feedback、R004のcache single-publicationをdirectに実行するfixtureはなお欠ける。T405 compositionは実際にoptional feedback context/signalを捨て、terminal exclusivityもassertしないため、R001〜R004のrequired matrixを同じproduction factory chainで固定していない。Impact:提供済み191 pass / 2 skip / 0 failは追加suiteの成功を示すが、open failure contractsのregression detectionを成立させない。Required action: R001〜R004の残るactual consumer/composition fixturesをfocused commandへ追加し、必要fixture名とproduction seamsを`test:t606`およびCI contractに固定する。
- **T606-R006 — Medium — closed maintained.** 前回 closure のdispositionを維持し、再 review していない。
- **T606-R007 — Medium — open.** Evidence: README/tasks/phasesはR5 local implementation、191 pass / 2 skip、closure/CI pendingを記録するが、R5 handoffの `implementation_head` はR5開始HEAD `c317c56f3102c535b33a4958b444786d69596507`であり、reviewed fix HEAD `ec8315c8540badad5417702f667a406260795466`と一致しない。R001〜R005とexact-head CIも未closureである。Impact: authoritative handoff/trackingはexact reviewed-head completion identityにならず、closureまたはmerge-readyを主張できない。Required action: R001〜R005 closure後のexact reviewed HEADへimplementation/follow-up/handoff/tracking/report/PR validation evidenceを同期し、未実施/unsupported/heldをsuccessへ変換せずmerge gateを完了する。

## 結果

**Verdict: FAIL.** T606-R001 open、R002 open、R003 open、R004 open、R005 open、R006 closed maintained、R007 open。提供済み191 pass / 2 Windows POSIX skip / 0 failとstatic validation passは受領したが、open findingのrequired production-composed evidenceを満たさない。Criterion dispositionはR001 retry/cancellation/typed non-retry boundary = `checked_finding`、R002 failure/root-switch freshness = `checked_finding`、R003 operation identity/exactly-once composition = `checked_finding`、R004 pure-read/single-publication boundary = `checked_finding`、R005 full focused production matrix/CI wiring = `checked_finding`、R006 redaction = `checked_no_finding` carried、R007 reports/tracking/exact-head evidence = `checked_finding`。heldはMarkdown wording check unsupportedとexact-head CI merge gate。unexplored: none。次actionはimplementation ownerがopen findingのrequired actionだけを修正・検証し、この同一normal reviewerへfinding-limited closureを依頼すること。

## リスク

Held: Markdown wording checkはrepository wiring不在のためunsupported。exact-head CIは未起動・未確認でmerge gateとしてheld。Windows POSIX 2 skipは提供済み証跡として明示し、passへ読み替えていない。technical verdictはreviewed fix HEAD `ec8315c8540badad5417702f667a406260795466`に適用し、report persistenceは通常review用repository fileでreport-attestationではない。report以外の変更は行っていない。

# T607 independent finding closure R3 report

## タスク

Issue #79 / PR #80 の既存open findings `T607-IFR001`、`T607-IFR002`、`T607-IFR004`、`T607-IFR006`だけを、初回と同じindependent reviewerがfinding-limited closure R3として再確認した。reviewed fix HEADはdetached `68de40686cb5573fcbe71cd72bab1dcb027185f0`、technical deltaは`dca4447f44ffdc810216dcd929d7ed14993245ff..68de40686cb5573fcbe71cd72bab1dcb027185f0`である。開始時のworktreeはcleanだった。

## sub-agentを使う理由

reviewer identityは`/root/t607_independent_review`である。finding identity、severity、reviewer continuityを維持するため追加sub-agentは使用せず、implementation ownerまたは通常reviewerの代行も行っていない。

## 対象範囲

Authoritative evidenceは`reports/issue-79-t607-independent-finding-closure-r2-20260821133000.md`に残った4件のrequired action、`reports/issue-79-t607-independent-finding-followup-r3-20260821150000.md`、および指定deltaの直接対応code、actual production/composition regressions、README、handoff、tasks/phasesだけである。4件を同時にdispositionし、severity reclassification、erratum、新規findingはない。finding scope内のunexplored areaはnoneである。

## 対象外

既にclosedの`T607-IFR003`と`T607-IFR005`、初回review観点の再探索、sibling scope、base全範囲、無関係なconsumer、GitHub metadataは対象外である。test、build、compile、typecheck、lint、architecture validation、benchmark、`git diff --check`、CIの開始・確認・待機・pollは行っていない。implementation、既存report、tracking、branch、commit、push、PR、Issue、mergeは変更していない。本report以外のrepository writeはない。

## 実行コマンド

Read-only evidence collectionとして`git status --short`、`git rev-parse`、`git log`、`git diff --stat/--name-status/--unified`、`rg -n`、`Get-Content`、`Test-Path`を使用した。provided evidenceはproduction fixture seam/behaviorのvalid Red、`npm run test:t607` 79 pass / 0 fail、build、contracts、lint、architecture positive/negative、diffcheckのpassとして受領し、再実行していない。このevidenceは未充足のproduction required actionまたはexact-head CIを代替しない。Markdown wording focused/fullはrepository tooling不在の`unsupported` heldであり、起動していない。

## 対象ファイル

`src/t405-pull-request-review-runtime.ts`、`src/t505-global-understanding-source.ts`、`src/application/global-understanding/global-understanding-background-recalculator.ts`、`src/ui/review-contexts/vscode-review-contexts-runtime.ts`、`src/extension.ts`、`src/adapters/crypto/node-sha256-stable-hash.ts`、`test/unit/t607-performance-incremental-ui.test.ts`、`README.md`、`handoffs/issue-79-t607-implementation-20260821094238.yaml`、`tasks/tasks-status.md`、`tasks/phases-status.md`、R2 closure report、R3 follow-up reportを確認した。

## 指摘事項

- **T607-IFR001 — High — closed — `src/t405-pull-request-review-runtime.ts:461-510,620-733`; `test/unit/t607-performance-incremental-ui.test.ts:525-600`.** Production runtimeはpersisted identityを全量`Object.entries`せずincrementalに列挙し、同じ最大128 item schedulerをcontext projectionと257-file reviewability preparationへ渡す。fixtureは10,000 changed lines、10,000 unrelated persisted files、257 changed files、reverse supersession、single current Tree swap、current diffだけのmemory ownership、各checkpoint `<=128`をactual `PullRequestReviewRuntime.activateProgress`で固定する。既存required actionを満たす。
- **T607-IFR002 — High — open — `src/t505-global-understanding-source.ts:105-207,270-419`; `src/application/global-understanding/global-understanding-background-recalculator.ts:185-246,288-390`; `src/t405-review-contexts-runtime.ts:301-384,391-448`; `test/unit/t607-performance-incremental-ui.test.ts:602-678`.** Incremental aggregate counters、transactional PR evidence publication、bounded Global state projection、actual T405 registration/cache supersession fixtureは追加された。一方、recalculatorは`globalFilesByPath`と`orderedIncludedFiles`でGlobal state/included/open pathsを最初のscheduler yield前に同期全量map/orderする。opened evidenceも各fileの`nonEmptyLines`をspreadで同期全量copyし、Review Contexts sourceは最終`projectReviewContexts`とcandidate spread/sortを同期実行する。actual fixtureは256 contextsの最終件数とcache ownershipを確認するが、これらの各operation `<=128` accountingを固定しない。Required actionは残るsource snapshot、evidence copy、Review Contexts projection/sortを共通`<=128` budgetへ接続し、actual runtime fixtureでbounded work、abort/dispose、stale nonpublication、terminal feedbackを固定すること。
- **T607-IFR004 — High — open — `src/extension.ts:92-117,267-436`; `test/unit/t607-performance-incremental-ui.test.ts:711-852`.** Production activation factory、128-line document extraction、Unicode hash、actual document state provider、2,048 intervals、options、bookkeeping、split-editor host applyは追加された。しかしactual factory fixtureはworkspace contextであり、`createNormalEditorDecorationLoadHandler`もsessionから`currentPullRequestDiff`をmodelへ渡さないため、required actionのcurrent-PR 10,000-line change evidenceはproduction activation経路で未接続・未実行である。別PR progress fixtureはnormal-editor decoration compositionの代替にならない。Required actionはcurrent PR diffをproduction decoration session/modelへgeneration-awareに接続し、同じactual activation fixtureで10,000 changed lines、supersession、current editorごとの一回だけのapply、stale I/O/apply 0件を固定すること。
- **T607-IFR006 — Low — open — `README.md:26`; `handoffs/issue-79-t607-implementation-20260821094238.yaml:7-8,13,30-34`; `tasks/tasks-status.md:12,17-18,368,391`; `tasks/phases-status.md:34,40-41,187`.** R3 evidenceと79/79は記録されたが、README/tasks/phases/handoffは`dca4447`上の未コミットdelta、technical commit freeze前、closure pendingと記し、handoff headは`c4a99db`のままである。現在はtechnical HEAD `68de406`へcommit済みであり、T607 rowとnext-start記録もR2の78/78状態を残す。Required actionはopen technical findingsの修正後、全current recordsを実際のnew pre-freeze head、validation、CI held、next actionへ同期し、全non-final writeをcommit/pushして再freezeすること。

## 結果

**Verdict: FAIL.** `T607-IFR001`はclosed、`T607-IFR002`、`T607-IFR004`、`T607-IFR006`はopenである。High 2件、Low 1件のrequired actionが残り、severity変更、新規finding、後出し観点はない。`T607-IFR003`と`T607-IFR005`は以前のclosed statusを維持し、本R3 scope外である。Heldはexact-head`pull_request` CIとMarkdown wording tooling`unsupported`。Unexploredはfinding scope内でnoneである。

`report_attestation_allowed: false`。passing verdictではないため、final administrative freeze後であっても本reportをterminal report-attestation commitとして扱えない。Next actionはimplementation ownerがopen 3件を同一batchで修正し、project validation、current tracking/handoff同期、通常finding-limited verificationを完了してnew technical headをfreezeした後、同じindependent reviewerがこの3件だけを再確認することである。mergeは認可しない。

## リスク

Provided local validationは受領済みだが、残る同期全量work、未接続のcurrent-PR decoration evidence、current-head provenanceを閉じない。exact-head`pull_request` CIはmerge gateまでheldであり、local evidenceまたはreport persistenceを成功へ読み替えない。worktree persistence modeはfail verdictを記録する単一report-only changeであり、reviewed HEAD `68de40686cb5573fcbe71cd72bab1dcb027185f0`自体は変更しない。

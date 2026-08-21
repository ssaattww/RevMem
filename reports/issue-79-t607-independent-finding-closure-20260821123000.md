# T607 independent finding closure report

## タスク

Issue #79 / PR #80 の既存 independent final review findings `T607-IFR001`〜`T607-IFR006`だけを同一 reviewer が finding-limited で再確認した。reviewed fix HEAD は `0f7ef9d81648cb4b41bf7956a8b7785f15fdf58b`、technical delta は `c4a99db2bf24286cd39e98efdceeaa9c1cd7a6c3..bff35cc`、`bff35cc..0f7ef9d81648cb4b41bf7956a8b7785f15fdf58b` は既存 independent final report の末尾空行だけを除く administrative delta である。開始時の worktree は clean、HEAD は detached だった。

## sub-agentを使う理由

reviewer identity は初回 independent final review と同じ `/root/t607_independent_review` である。finding identity、severity、独立性を維持するため追加 sub-agent は使用せず、implementation owner または通常 reviewer の代行も行っていない。

## 対象範囲

Authoritative evidence は `reports/issue-79-t607-independent-final-review-20260821110000.md` の6件の required action、`reports/issue-79-t607-independent-followup-20260821120000.md`、および指定された technical delta のうち各 finding に直接対応する production code、composition、test、README、handoff、tasks/phasesだけである。status は6件を一括で dispositionし、severity reclassification、erratum、新規 finding はない。finding scope 内の unexplored area は none である。

## 対象外

初回 review の観点を再探索せず、sibling scope、新しい requirement、base 全範囲、無関係な consumer、GitHub metadataを調査していない。test、build、compile、typecheck、lint、architecture validation、benchmark、`git diff --check`、CIの開始・確認・待機・pollは行っていない。implementation、既存 report、tracking、branch、commit、push、PR、Issue、mergeは変更していない。本 report 以外の repository write はない。

## 実行コマンド

Read-only evidence collection として `git status --short`、`git rev-parse HEAD`、`git log`、`git diff --stat/--name-status/--unified`、`rg -n`、`Get-Content`、`Test-Path` を使用した。provided evidence は `npm run test:t607` 74 pass / 0 fail、build、contracts、lint、architecture positive/negative、diffcheck の pass として受領し、再実行していない。この evidence は未充足の production required actionまたは exact-head CIを代替しない。Markdown wording focused/full は repository tooling不在の `unsupported` held であり、実行禁止にも従い起動していない。

## 対象ファイル

`src/core/pr-progress/pr-diff-progress.ts`、`src/t405-pull-request-review-runtime.ts`、`src/t505-global-understanding-source.ts`、`src/application/global-understanding/global-understanding-background-recalculator.ts`、`src/t405-review-contexts-runtime.ts`、`src/extension.ts`、`src/ui/normal-editor/normal-editor-decoration-controller.ts`、`src/application/editor-decoration/normal-editor-decoration-model.ts`、`src/adapters/crypto/node-sha256-stable-hash.ts`、`test/unit/t607-performance-incremental-ui.test.ts`、`README.md`、`handoffs/issue-79-t607-implementation-20260821094238.yaml`、`tasks/tasks-status.md`、`tasks/phases-status.md`、および上記2件の independent reportを確認した。

## 指摘事項

- **T607-IFR001 — High — open — `src/t405-pull-request-review-runtime.ts:607-675`; `test/unit/t607-performance-incremental-ui.test.ts:309-327`.** Cooperative calculatorと実 `setImmediate` は追加されたが、production runtime は calculatorへ入る前に persisted context全体を同期 cloneし、各 diff fileごとに全 persisted filesを同期 filterする。actual `PullRequestReviewRuntime.activateProgress` の10,000-line supersession、single current swap、context projection、memory ownership regressionもなく、required actionの全段階 `<=128` accountingは未充足である。Required action は context identity projectionとreviewability preparationを同じ generation-aware schedulerへ移し、actual runtime composition regressionを追加すること。
- **T607-IFR002 — High — open — `src/t505-global-understanding-source.ts:105-187,270-369`; `src/application/global-understanding/global-understanding-background-recalculator.ts:185-246,330-407`; `src/t405-review-contexts-runtime.ts:301-384,391-448`.** 外側 AbortSignalと複数の128-item checkpointは追加されたが、PR HEAD contentの split・line scan・hash、opened evidenceとGlobal intervalのcopy、recalculator初期 map/order、25-file emitごとの calculated prefix全量 aggregate、Review Contextsの最終同期 `projectReviewContexts` とsortが残る。actual large source/runtimeおよび多数 saved contexts のstale nonpublication、abort/dispose、cache ownership、terminal feedback regressionもない。Required action はこれらのproduction段階を共通budgetへ接続し、prefix再集計を除去して指定regressionを追加すること。
- **T607-IFR003 — High — open — `src/extension.ts:447-500,593-615`; `src/ui/normal-editor/normal-editor-decoration-controller.ts:107-200`.** Decoration descriptorはdocument versionを束縛し、document changeでvisible editor requestを更新するようになった。一方、command pathはdescriptor hash完了後にversion fenceを保持せず、state/session I/Oからcommitまでの同一 content generationを再確認しない。同一line count編集を各yield境界へ挿入し、stale load/apply/commitが0件であることを示すproduction composition regressionもない。Required action はcommand commitを含む全境界へversion/content generation fenceを伝播し、指定regressionを追加すること。
- **T607-IFR004 — High — open — `src/extension.ts:474-485,553-568`; `src/application/editor-decoration/normal-editor-decoration-model.ts:500-578`; `test/unit/t607-performance-incremental-ui.test.ts:387-450`.** Cooperative current-PR calculationと多くのinterval操作は追加されたが、other-context unionのspread、final decoration wrapperの`map`、return時の`map`はwork counter外であり、document fragment generatorも128 itemごとのline extraction fenceではない。fixtureはdescriptor hashとhost option/applyを注入したfake seamのままで、actual activationのlarge Unicode document、current PR 10,000 lines、document extraction、VS Code option/bookkeeping/applyを通らない。Required action は残るcopy/extraction/applyを一つの `<=128` generation-aware budgetへ移し、指定production composition regressionを追加すること。
- **T607-IFR005 — Medium — closed — `src/adapters/crypto/node-sha256-stable-hash.ts:16-47`; `test/unit/t607-performance-incremental-ui.test.ts:464-471`.** Cooperative SHA-256 はstage境界のhigh/low surrogate pairを分断せず、65,535、65,536、65,537境界でcanonical `digest` と同一になるregressionが追加された。既存 required actionを満たす。
- **T607-IFR006 — Low — open — `README.md:26`; `handoffs/issue-79-t607-implementation-20260821094238.yaml:7-9,30-33`; `tasks/tasks-status.md:12,18,368,391`; `tasks/phases-status.md:40-41,187`.** Historical reportを保持してc4 failureへ同期した点は確認したが、current recordsはfollow-up実装中・通常 finding-limited verification待ちのままで、actual technical head `bff35cc`、administrative head `0f7ef9d`、74/74 validation、現在の independent closure disposition、next actionを表していない。Required action は残るtechnical findingsの修正後、全current recordsを実際のpre-freeze head、validation、CI held、next actionへ同期し、全 non-final writeをcommit/pushして再freezeすること。

## 結果

**Verdict: FAIL.** `T607-IFR005` は closed、`T607-IFR001`、`T607-IFR002`、`T607-IFR003`、`T607-IFR004`、`T607-IFR006` は open である。High 4件、Low 1件のrequired actionが残り、severity変更、新規 finding、後出し観点はない。Held は exact-head `pull_request` CIとMarkdown wording tooling `unsupported` である。Unexplored は finding scope 内で none である。

`report_attestation_allowed: false`。passing verdictではないため、final administrative freeze後であっても本 reportを terminal report-attestation commitとして扱えない。Next action はimplementation ownerがopen 5件を同一batchで修正し、project validation、current tracking/handoff同期、通常 finding-limited verificationを完了して新しいtechnical headをfreezeした後、同じ independent reviewerがこの5件だけを再確認することである。mergeは認可しない。

## リスク

Provided local validationは受領済みだが、productionの未bounded同期work、stale command generation、未同期provenanceを閉じない。exact-head `pull_request` CIはmerge gateまでheldであり、local evidenceまたはreport persistenceを成功へ読み替えない。worktree persistence modeはfail verdictを記録する単一report-only changeであり、reviewed HEAD `0f7ef9d81648cb4b41bf7956a8b7785f15fdf58b` 自体は変更しない。



# T607 independent finding closure R2 report

## タスク

Issue #79 / PR #80 の既存 open findings `T607-IFR001`、`T607-IFR002`、`T607-IFR003`、`T607-IFR004`、`T607-IFR006`だけを、初回と同じ independent reviewer が finding-limited closure R2として再確認した。reviewed fix HEAD は detached `dca4447f44ffdc810216dcd929d7ed14993245ff`、technical delta は `0f7ef9d81648cb4b41bf7956a8b7785f15fdf58b..0356a46`、`0356a46..dca4447f44ffdc810216dcd929d7ed14993245ff` は既存R1 closure reportの末尾空行2行だけを除く administrative deltaである。

## sub-agentを使う理由

reviewer identity は `/root/t607_independent_review` である。finding identity、severity、reviewer continuityを維持するため追加 sub-agent は使用せず、implementation ownerまたは通常 reviewerの代行も行っていない。

## 対象範囲

Authoritative evidence は `reports/issue-79-t607-independent-finding-closure-20260821123000.md` に残った5件のrequired action、`reports/issue-79-t607-independent-followup-r2-20260821130000.md`、および指定technical deltaの直接対応code、production composition regression、README、handoff、tasks/phasesだけである。5件を同時にdispositionし、severity reclassification、erratum、新規findingはない。

## 対象外

既にclosedの`T607-IFR005`、初回review観点の再探索、sibling scope、base全範囲、無関係なconsumer、GitHub metadataは対象外である。test、build、compile、typecheck、lint、architecture validation、benchmark、`git diff --check`、CIの開始・確認・待機・pollは行っていない。

## 実行コマンド

Read-only evidence collectionとして`git status --short`、`git rev-parse`、`git log`、`git diff --stat/--unified`、`rg -n`、`Get-Content`、`Test-Path`を使用した。provided evidenceは新規fixture境界・PR status matrixのvalid Red、`npm run test:t607` 78 pass / 0 fail、build、contracts、lint、architecture positive/negative、diffcheckのpassとして受領し、再実行していない。Markdown wording focused/fullはrepository tooling不在の`unsupported` heldである。

## 対象ファイル

`src/t405-pull-request-review-runtime.ts`、`src/t505-global-understanding-source.ts`、`src/application/global-understanding/global-understanding-background-recalculator.ts`、`src/t405-review-contexts-runtime.ts`、`src/application/review-commands/normal-editor-review-command-service.ts`、`src/application/editor-decoration/normal-editor-decoration-model.ts`、`src/extension.ts`、`test/unit/t607-performance-incremental-ui.test.ts`、`README.md`、`handoffs/issue-79-t607-implementation-20260821094238.yaml`、`tasks/tasks-status.md`、`tasks/phases-status.md`、R1 closure report、R2 follow-up reportを確認した。

## 指摘事項

- **T607-IFR001 — High — open.** `Object.entries(persisted.contextState.files)`がscheduler checkpoint前に全persisted filesを同期配列化し、reviewability preparationにも128 filesごとの実scheduler accountingがない。fixtureは100 filesである。required actionはincremental identity enumerationとreviewability preparationを同じ`<=128` generation-aware schedulerへ接続し、128超filesのsupersession、single current swap、memory ownershipを固定すること。
- **T607-IFR002 — High — open.** opened evidence/Global interval copy、recalculator初期map/order、25-file emitごとのcalculated prefix全量aggregate、Review Contexts同期projection/spread/sortが残る。R2 fixtureはfabricated `load`結果をTree providerへ渡し、actual T405 sourceのsaved-context progress/projectionを通らない。abortもPR HEAD evidence/cache mutation中ではない。required actionは残るproduction段階を`<=128` budgetへ接続し、prefix再集計を除去してactual source/runtimeのabort/dispose、stale nonpublication、cache ownership、terminal feedbackを固定すること。
- **T607-IFR003 — High — closed.** document identity/version generationはdescriptor取得前、descriptor後、session I/O後、transaction commit直前へ伝播し、same-line-count edit regressionがstale commit 0を固定している。
- **T607-IFR004 — High — open.** document descriptorは10,000回の`document.lineAt`を65,536-character hash stageでしか区切らない。R2 fixtureはfake descriptor/host applyでありactual Unicode document extraction/hash、current-PR 10,000-line diff、VS Code option/bookkeeping/applyを通らない。required actionはdocument extractionを共有`<=128` item generation fenceへ移し、production composition全経路でsplit editors、supersession、一回だけのcurrent host apply、stale I/O/apply 0件を固定すること。
- **T607-IFR005 — Medium — closed/out of scope.** 既存closed statusを維持する。
- **T607-IFR006 — Low — open.** handoffとtasksがactual technical head `0356a46`、administrative head `dca4447`、R2 dispositionを一貫して示さない。required actionはopen technical findings修正後にcurrent recordsをnew pre-freeze head、validation、CI held、next actionへ同期すること。

## 結果

**Verdict: FAIL.** `T607-IFR003`はclosed、`T607-IFR001`、`T607-IFR002`、`T607-IFR004`、`T607-IFR006`はopenである。High 3件、Low 1件のrequired actionが残る。`T607-IFR005`はclosed statusを維持し本R2 scope外である。Next actionはimplementation ownerがopen 4件を同一batchで修正し、project validation、current tracking/handoff同期、new technical head freeze後に同じindependent reviewerが4件だけを再確認することである。mergeは認可しない。

## リスク

残る同期全量work、未通過のproduction composition、current-head provenanceを閉じない。exact-head`pull_request` CIはmerge gateまでheldであり、local evidenceをCI成功へ読み替えない。

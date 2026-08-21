# Issue #79 / PR #80 T607 independent finding closure R4

## タスク

Issue #79 / PR #80 の既存 open findings `T607-IFR002`、`T607-IFR004`、`T607-IFR006` だけを、初回と同じ independent reviewer が finding-limited closure R4 として再確認した。reviewed fix HEAD は detached `6bc0304af5b6d096c3d5dd040ce771b716aeef1d`、technical delta は `68de40686cb5573fcbe71cd72bab1dcb027185f0..6bc0304af5b6d096c3d5dd040ce771b716aeef1d` である。開始時の worktree は clean だった。

## sub-agentを使う理由

独立 reviewer の continuity と finding scope を保持する必要があるため、本 closure は同じ reviewer が直接実施し、追加の sub-agent は使用していない。新規観点の探索や sibling review への分割も行っていない。

## 対象範囲

Authoritative evidence は R3 closure `reports/issue-79-t607-independent-finding-closure-r3-20260821153000.md` に残った 3 件の required action、R4 follow-up `reports/issue-79-t607-independent-finding-followup-r4-20260821160000.md`、および指定 delta の直接対応 production code、composition regressions、README、handoff、tasks、phases だけである。`T607-IFR002`、`T607-IFR004`、`T607-IFR006` を一括で disposition し、severity reclassification、erratum、新規 finding はない。finding scope 内の unexplored area は none である。

## 対象外

既に closed の `T607-IFR001`、`T607-IFR003`、`T607-IFR005`、初回 review 観点の再探索、sibling scope、base 全範囲、無関係な dependency や consumer、GitHub metadata は対象外である。test、build、compile、typecheck、lint、architecture validation、benchmark、`git diff --check`、Markdown wording、CI の開始・確認・待機・poll は行っていない。implementation、既存 report、tracking、branch、commit、push、PR、Issue、merge は変更していない。本 report 以外の repository write はない。

## 実行コマンド

Read-only evidence collection として `git status --short`、`git rev-parse HEAD`、`git log`、`git diff --stat/--name-status/--unified`、`rg -n`、`Get-Content`、`Test-Path` を使用した。provided evidence は R3 closure FAIL を source Red contract、`npm run test:t607` 79 pass / 0 fail、build、contracts、lint、architecture positive/negative、diffcheck の pass として受領し、再実行していない。この evidence は未充足の production required action、追跡整合、exact-head CI を代替しない。Markdown wording tooling は repository wiring 不在の `unsupported` held であり、起動していない。

## 対象ファイル

- `reports/issue-79-t607-independent-finding-closure-r3-20260821153000.md`
- `reports/issue-79-t607-independent-finding-followup-r4-20260821160000.md`
- `src/application/review-contexts/review-contexts-controller.ts`
- `src/t405-review-contexts-runtime.ts`
- `src/t505-global-understanding-source.ts`
- `src/application/global-understanding/global-understanding-background-recalculator.ts`
- `src/extension.ts`
- `src/t305-extension.ts`
- `src/t405-pull-request-review-runtime.ts`
- `src/application/editor-decoration/normal-editor-decoration-model.ts`
- `test/unit/t607-performance-incremental-ui.test.ts`
- `README.md`
- `handoffs/issue-79-t607-implementation-20260821094238.yaml`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`

## 指摘事項

- **T607-IFR002 — High — open — `src/application/review-contexts/review-contexts-controller.ts:223-229`.** R4 は Global initial map/order、opened evidence copy、T405 acquisition と candidate projection、merge-sort comparison、abort/dispose、stale nonpublication、terminal feedback を shared scheduler へ広げた。しかし cooperative projector は deduplication の後、`let sorted = [...unique.values()]` で候補全件を同期コピーしてから最初の sort checkpoint に入る。この candidate spread は R3 required action が明示した projection/sort の `<=128` accounting 外であり、instrumented fixture の batch assertion では未計上の同期全量処理を検出できない。Required action はこの candidate materialization 自体を shared `<=128` budget で段階化し、actual runtime fixture でその batch accounting と既存の cancellation、stale nonpublication、terminal lifecycle を固定すること。
- **T607-IFR004 — High — closed — `src/extension.ts:669-682,828-829`; `src/t305-extension.ts:102-105,513`; `test/unit/t607-performance-incremental-ui.test.ts:791-919`.** Current PR diff は production runtime port から normal-editor activation session/model へ接続された。actual activation factory fixture は 10,000 Unicode lines、10,000 changed-line PR diff、actual document state provider、2,048 intervals、split editors、reverse supersession、option projection、bookkeeping を通し、各 current editor の一回だけの host apply、superseded generation の state I/O と stale apply 0 件、各 instrumented batch `<=128` を固定する。既存 required action を満たす。
- **T607-IFR006 — Low — open — `README.md:26`; `handoffs/issue-79-t607-implementation-20260821094238.yaml:7-9,33-34`; `tasks/tasks-status.md:12,17-18,368,391`; `tasks/phases-status.md:40-41,187`.** Validation は 79/79 と static gates Green へ更新されたが、current records は committed base `68de406` 上の「未コミット R4 delta」、new technical SHA 未作成、commit freeze と R4 closure 待ちを記録する。実際の frozen HEAD は `6bc0304af5b6d096c3d5dd040ce771b716aeef1d` であり、handoff の `implementation_head` と `report_normalized_head` も `68de406` のままである。Required action は全 current records を実際の new pre-freeze head、R4 disposition、validation、CI と Markdown held、正しい next action へ同期し、全 non-final write を commit/push して再 freeze すること。

## 結果

**Verdict: FAIL.** `T607-IFR004` は closed、`T607-IFR002` と `T607-IFR006` は open である。High 1 件、Low 1 件の required action が残り、severity 変更、新規 finding、後出し観点はない。`T607-IFR001`、`T607-IFR003`、`T607-IFR005` は以前の closed status を維持し、本 R4 scope 外である。Held は exact-head `pull_request` CI と Markdown wording tooling `unsupported`。Unexplored は finding scope 内で none である。

## リスク

`report_attestation_allowed: false`。passing verdict ではないため、final administrative freeze 後であっても本 report を terminal report-attestation commit として扱えない。Next action は implementation owner が open 2 件を同一 batch で修正し、provided project validation、current tracking/handoff 同期、全 non-final write の commit/push を完了して new technical head を strict freeze した後、同じ independent reviewer が `T607-IFR002` と `T607-IFR006` だけを再確認することである。exact-head `pull_request` CI と Markdown wording tooling は held のままであり、merge は認可しない。

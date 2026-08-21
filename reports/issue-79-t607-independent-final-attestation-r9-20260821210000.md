# Issue #79 / PR #80 T607 independent final attestation R9

## タスク

Issue #79 / PR #80 の invalid attestation `532620dc5cc91b3117fcb993ead5fd68e4e38b01` に対する exact `pull_request` CI run `32445673275` / job `96664691395` の2 T504 immutable-snapshot failuresだけを、初回と同じ independent reviewer が third CI-delta-limited verification として再確認した。reviewed clean detached HEAD は `76935627eec77e05de327ba59f94e4d0ee4e6da3`、delta は `532620dc5cc91b3117fcb993ead5fd68e4e38b01..76935627eec77e05de327ba59f94e4d0ee4e6da3` である。開始時の worktree は clean だった。

## sub-agentを使う理由

独立 reviewer の continuity と限定された CI failure scope を保持する必要があるため、本 verification は同じ reviewer が直接実施し、追加の sub-agent は使用していない。新規観点の探索や sibling review への分割も行っていない。

## 対象範囲

Authoritative evidence は observed T504 immutable-snapshot failures、CI follow-up R3 `reports/issue-79-t607-ci-followup-r3-20260821131334.md`、指定 delta の `GlobalUnderstandingBackgroundRecalculator` operation-start capture、および README、tasks、phases、handoff provenance だけである。最初の await 前の revision/file metadata/included/open-path capture、readonly interval ownership、既存 `<=128` cooperative validation/order/calculation、旧 attestation 無効化、provided focused/T607/static evidence、new exact-head gate を確認した。all technical findings `T607-IFR001`〜`T607-IFR006` の prior closed status を維持する。severity reclassification、erratum、新規 finding はない。finding scope 内の unexplored area は none である。

## 対象外

指定 T504 contract 以外の production implementation 再 review、既に closed の technical finding 観点、sibling scope、base 全範囲、無関係な dependency や consumer、GitHub metadata は対象外である。test、build、compile、typecheck、lint、architecture validation、benchmark、`git diff --check`、Markdown wording、CI の開始・確認・待機・poll は行っていない。implementation、既存 report、tracking、branch、commit、push、PR、Issue、merge は変更していない。本 report 以外の repository write はない。

## 実行コマンド

Read-only evidence collection として `git status --short`、`git rev-parse HEAD/HEAD^`、`git log`、`git show -s`、`git diff --stat/--name-status/--unified`、`rg -n`、`Get-Content`、`Test-Path` を使用した。provided evidence は exact failing file Red 2 pass / 2 fail、exact T504 three-file suite Green 15 pass / 0 fail、`npm run test:t607` 79 pass / 0 fail、contracts、lint、architecture positive/negative、diffcheck の pass として受領し、再実行していない。この evidence は new exact-head `pull_request` CI を代替しない。Markdown wording tooling は repository wiring 不在の `unsupported` held であり、起動していない。

## 対象ファイル

- `src/application/global-understanding/global-understanding-background-recalculator.ts`
- `reports/issue-79-t607-ci-followup-r3-20260821131334.md`
- `README.md`
- `handoffs/issue-79-t607-implementation-20260821094238.yaml`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`

## 指摘事項

- **T504 immutable-snapshot CI failures — accepted — `src/application/global-understanding/global-understanding-background-recalculator.ts:191-260,326-369`.** `recalculate` now calls synchronous `captureCalculationInput` before its first cooperative await. That capture owns repository/revision scalars, one shallow-frozen Global file record per operation-start member, included path/non-empty counts, and open-path membership. Later caller replacement of Global file metadata, included descriptors, counts, or open paths therefore cannot create a mixed-revision calculation. Each file retains its public readonly reviewed-interval vector reference, avoiding an unbounded repository-sized deep clone while isolating later replacement of the vector property.
- **Bounded continuation — accepted — `src/application/global-understanding/global-understanding-background-recalculator.ts:236-297,353-369`; `reports/issue-79-t607-ci-followup-r3-20260821131334.md:13,17,21-25,37-47`.** The synchronous phase only establishes the coherent operation-start snapshot required by the observed contract. Global validation, included mapping and priority ordering still account work through the existing scheduler, and downstream source validation/calculation retains the configured maximum `<=128`. Provided exact T504 15/15 and T607 79/79 evidence covers the two failed immutable-snapshot contracts and bounded workload behavior.
- **Provenance — accepted — `README.md:26`; `handoffs/issue-79-t607-implementation-20260821094238.yaml:7-9,28,36-37`; `tasks/tasks-status.md:12,17-18,368,391`; `tasks/phases-status.md:34,40-41,187`; `reports/issue-79-t607-ci-followup-r3-20260821131334.md:5-47`.** Records identify PR #80, exact failed attestation `532620dc5cc91b3117fcb993ead5fd68e4e38b01`, run/job identity, earlier passing stages and both T504 failures; preserve exact 15/15、T607 79/79、static pass evidence; and state that a new attestation and exact-head CI remain pending/held. The old `532620d` attestation is invalid and non-reusable for CI or merge authority.

## 結果

**Verdict: PASS_WITH_HELD.** The third CI-only delta is accepted. `T607-IFR001`〜`T607-IFR006` retain their closed statuses. Severity changes, new findings, and late viewpoints are none. The `532620dc5cc91b3117fcb993ead5fd68e4e38b01` attestation remains invalid and non-reusable. Held items are new exact-head `pull_request` CI and Markdown wording tooling `unsupported`. Unexplored is none within finding scope. This verdict does not authorize merge.

## リスク

`report_attestation_allowed: true` only under all of these strict conditions: create exactly one immediate commit whose first parent is `76935627eec77e05de327ba59f94e4d0ee4e6da3`; that commit changes only `reports/issue-79-t607-independent-final-attestation-r9-20260821210000.md`; and make no later repository writes before exact-head PR CI and merge. The resulting R9 report-attestation commit becomes the sole valid exact-head `pull_request` CI target; `532620dc5cc91b3117fcb993ead5fd68e4e38b01` cannot be reused. Merge remains unauthorized until the new exact-head PR CI is Green and all held dispositions remain accurately recorded; any extra write invalidates this attestation and requires a new freeze/review decision.

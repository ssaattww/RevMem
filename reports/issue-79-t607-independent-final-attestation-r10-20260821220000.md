# Issue #79 / PR #80 T607 independent final attestation R10

## タスク

Issue #79 / PR #80 の invalid attestation `2389e4a95970112b5a14abc32cb710f82320512f` に対する exact `pull_request` CI run `32446427744` / job `96666773624` の Linux IFR004 exported activation factory failureだけを、初回と同じ independent reviewer が fourth CI-delta-limited verification として再確認した。reviewed clean detached HEAD は `80d169fd284ff665562a30fd3829af325265c7ad`、delta は `2389e4a95970112b5a14abc32cb710f82320512f..80d169fd284ff665562a30fd3829af325265c7ad` である。開始時の worktree は clean だった。

## sub-agentを使う理由

独立 reviewer の continuity と限定された CI failure scope を保持する必要があるため、本 verification は同じ reviewer が直接実施し、追加の sub-agent は使用していない。新規観点の探索や sibling review への分割も行っていない。

## 対象範囲

Authoritative evidence は observed Linux IFR004 activation-fixture failure、CI follow-up R4 `reports/issue-79-t607-ci-followup-r4-20260821132429.md`、指定 delta の host-platform path/state-publication fixture、および README、tasks、phases、handoff provenance だけである。repository root、workspace URI、document `fsPath`、descriptor semantics、Unicode relative path、async repository publication、および既存 actual activation/2,048 interval/split/supersession coverage を確認した。all technical findings `T607-IFR001`〜`T607-IFR006` の prior closed status を維持する。severity reclassification、erratum、新規 finding はない。finding scope 内の unexplored area は none である。

## 対象外

Production implementation と activation/state-provider contract の再 review、既に closed の technical finding 観点、sibling scope、base 全範囲、無関係な dependency や consumer、GitHub metadata は対象外である。test、build、compile、typecheck、lint、architecture validation、benchmark、`git diff --check`、Markdown wording、CI の開始・確認・待機・poll は行っていない。implementation、既存 report、tracking、branch、commit、push、PR、Issue、merge は変更していない。本 report 以外の repository write はない。

## 実行コマンド

Read-only evidence collection として `git status --short`、`git rev-parse HEAD/HEAD^`、`git log`、`git show -s`、`git diff --stat/--name-status/--unified`、`rg -n`、`Get-Content`、`Test-Path` を使用した。provided evidence は exact T607 file 20 pass / 0 fail、`npm run test:t607` 79 pass / 0 fail、contracts、lint、architecture positive/negative、diffcheck の pass として受領し、再実行していない。この evidence は new Linux exact-head `pull_request` CI を代替しない。Markdown wording tooling は repository wiring 不在の `unsupported` held であり、起動していない。

## 対象ファイル

- `test/unit/t607-performance-incremental-ui.test.ts`
- `reports/issue-79-t607-ci-followup-r4-20260821132429.md`
- `README.md`
- `handoffs/issue-79-t607-implementation-20260821094238.yaml`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`

## 指摘事項

- **IFR004 Linux activation-fixture failure — accepted — `test/unit/t607-performance-incremental-ui.test.ts:791-927`.** The fixture derives Windows or POSIX semantics from the host, then applies one consistent repository root, workspace URI path, document URI path, and document `fsPath`. It asserts the production descriptor reports that host semantics and resolves the exact Unicode repository-relative owner `src/😀.ts`, eliminating the prior mixed `C:\\repo` / POSIX identity that correctly failed closed on Linux.
- **State publication and coverage — accepted — `test/unit/t607-performance-incremental-ui.test.ts:873-927`; `reports/issue-79-t607-ci-followup-r4-20260821132429.md:13,17,21-25,38-48`.** Workspace and PR state are published through awaited asynchronous `repository.save` calls before the actual `DocumentReviewStateSessionProvider` read. No timing sleep is added. The fixture retains actual exported activation, 10,000-line Unicode descriptor/diff, 2,048 interval owner, split-editor host applies, reverse supersession, zero stale I/O/apply, option/bookkeeping ownership, and all accounted batches `<=128`. Production is unchanged.
- **Provenance — accepted — `README.md:26`; `handoffs/issue-79-t607-implementation-20260821094238.yaml:7-9,28,37-38`; `tasks/tasks-status.md:12,17-18,368,391`; `tasks/phases-status.md:34,40-41,187`; `reports/issue-79-t607-ci-followup-r4-20260821132429.md:5-48`.** Records identify PR #80, exact failed attestation `2389e4a95970112b5a14abc32cb710f82320512f`, run/job identity, all stages through T606 passing and the sole IFR004 Linux failure; preserve exact 20/20、T607 79/79、static pass evidence; and state that a new attestation and exact-head CI remain pending/held. The old `2389e4a` attestation is invalid and non-reusable for CI or merge authority.

## 結果

**Verdict: PASS_WITH_HELD.** The fourth CI-only delta is accepted. `T607-IFR001`〜`T607-IFR006` retain their closed statuses. Severity changes, new findings, and late viewpoints are none. The `2389e4a95970112b5a14abc32cb710f82320512f` attestation remains invalid and non-reusable. Held items are new exact-head `pull_request` CI and Markdown wording tooling `unsupported`. Unexplored is none within finding scope. This verdict does not authorize merge.

## リスク

`report_attestation_allowed: true` only under all of these strict conditions: create exactly one immediate commit whose first parent is `80d169fd284ff665562a30fd3829af325265c7ad`; that commit changes only `reports/issue-79-t607-independent-final-attestation-r10-20260821220000.md`; and make no later repository writes before exact-head PR CI and merge. The resulting R10 report-attestation commit becomes the sole valid exact-head `pull_request` CI target; `2389e4a95970112b5a14abc32cb710f82320512f` cannot be reused. Merge remains unauthorized until the new exact-head PR CI is Green and all held dispositions remain accurately recorded; any extra write invalidates this attestation and requires a new freeze/review decision.

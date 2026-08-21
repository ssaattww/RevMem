# Issue #79 / PR #80 T607 independent final attestation R8

## タスク

Issue #79 / PR #80 の invalid attestation `63061974b2aead2c71a968c6b882bd3a9bab3106` に対する exact `pull_request` CI run `32445047413` / job `96662976057` の T405 composition regression failure だけを、初回と同じ independent reviewer が second CI-delta-limited verification として再確認した。reviewed clean detached HEAD は `b9423b8b416b8e0d105a4dd062d54ff79a9b1d30`、delta は `63061974b2aead2c71a968c6b882bd3a9bab3106..b9423b8b416b8e0d105a4dd062d54ff79a9b1d30` である。開始時の worktree は clean だった。

## sub-agentを使う理由

独立 reviewer の continuity と限定された CI failure scope を保持する必要があるため、本 verification は同じ reviewer が直接実施し、追加の sub-agent は使用していない。新規観点の探索や sibling review への分割も行っていない。

## 対象範囲

Authoritative evidence は observed T405 focused composition regression、CI follow-up R2 `reports/issue-79-t607-ci-followup-r2-20260821130055.md`、指定 delta の test-only startup-publication synchronization、および README、tasks、phases、handoff provenance だけである。5回の runtime registration、actual startup Tree publication、command 境界、旧 attestation 無効化、provided focused/static evidence、unrelated Windows POSIX fixture held、new exact-head gate を確認した。all technical findings `T607-IFR001`〜`T607-IFR006` の prior closed status を維持する。severity reclassification、erratum、新規 finding はない。finding scope 内の unexplored area は none である。

## 対象外

Production implementation と command-generation の再 review、既に closed の technical finding 観点、sibling scope、base 全範囲、unrelated `t405-selected-pr-session` POSIX fixture、無関係な dependency や consumer、GitHub metadata は対象外である。test、build、compile、typecheck、lint、architecture validation、benchmark、`git diff --check`、Markdown wording、CI の開始・確認・待機・poll は行っていない。implementation、既存 report、tracking、branch、commit、push、PR、Issue、merge は変更していない。本 report 以外の repository write はない。

## 実行コマンド

Read-only evidence collection として `git status --short`、`git rev-parse HEAD/HEAD^`、`git log`、`git show -s`、`git diff --stat/--name-status/--unified`、`rg -n`、`Get-Content`、`Test-Path` を使用した。provided evidence は exact composition file Red 2 pass / 1 fail、Green 3 pass / 0 fail、target composition pass、Windows `test:t405` 49 pass / 1 unrelated known POSIX fixture fail、contracts、lint、architecture positive/negative、diffcheck の pass として受領し、再実行していない。T607 production は unchanged で `test:t607` は再実行されていない。この evidence は new exact-head `pull_request` CI を代替しない。Markdown wording tooling は repository wiring 不在の `unsupported` held であり、起動していない。

## 対象ファイル

- `test/unit/t405-composition-regression.test.ts`
- `reports/issue-79-t607-ci-followup-r2-20260821130055.md`
- `README.md`
- `handoffs/issue-79-t607-implementation-20260821094238.yaml`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`

## 指摘事項

- **T405 composition CI failure — accepted — `test/unit/t405-composition-regression.test.ts:460-487,622-661,707-719,998,1050,1092`.** Fake Tree creation captures the provider's first `onDidChangeTreeData` publication as a promise before registration can start its fire-and-forget refresh. `registerRuntime` awaits that actual startup publication and asserts no leaked startup error before returning. All 5 runtime registrations are awaited before commands, so a normally superseded startup generation cannot defer a stale error into the later `openReviewContextDiff` assertion. The fixture uses the production registration seam and event completion rather than a timer or fixed sleep; production remains unchanged.
- **Held Windows fixture — accepted as unrelated — `reports/issue-79-t607-ci-followup-r2-20260821130055.md:17,21-25,39-40,44-48`.** The changed exact composition file is Green 3/3. The provided 49/50 `test:t405` result leaves only the pre-existing `t405-selected-pr-session` Windows/POSIX path-semantics fixture, outside this file and observed CI failure. It remains explicitly held and does not substitute for new exact-head CI.
- **Provenance — accepted — `README.md:26`; `handoffs/issue-79-t607-implementation-20260821094238.yaml:7-9,28,35-36`; `tasks/tasks-status.md:12,17-18,368,391`; `tasks/phases-status.md:34,40-41,187`; `reports/issue-79-t607-ci-followup-r2-20260821130055.md:5-48`.** Records identify PR #80, exact failed attestation `63061974b2aead2c71a968c6b882bd3a9bab3106`, run/job identity and startup-refresh fixture failure; preserve exact-file Green and static evidence; isolate the known POSIX fixture; and state that a new attestation and exact-head CI remain pending/held. The old `6306197` attestation is invalid and non-reusable for CI or merge authority.

## 結果

**Verdict: PASS_WITH_HELD.** The second CI-only delta is accepted. `T607-IFR001`〜`T607-IFR006` retain their closed statuses. Severity changes, new findings, and late viewpoints are none. The `63061974b2aead2c71a968c6b882bd3a9bab3106` attestation remains invalid and non-reusable. Held items are the unrelated known Windows/POSIX fixture, new exact-head `pull_request` CI, and Markdown wording tooling `unsupported`. Unexplored is none within finding scope. This verdict does not authorize merge.

## リスク

`report_attestation_allowed: true` only under all of these strict conditions: create exactly one immediate commit whose first parent is `b9423b8b416b8e0d105a4dd062d54ff79a9b1d30`; that commit changes only `reports/issue-79-t607-independent-final-attestation-r8-20260821200000.md`; and make no later repository writes before exact-head PR CI and merge. The resulting R8 report-attestation commit becomes the sole valid exact-head `pull_request` CI target; `63061974b2aead2c71a968c6b882bd3a9bab3106` cannot be reused. Merge remains unauthorized until the new exact-head PR CI is Green and all held dispositions remain accurately recorded; any extra write invalidates this attestation and requires a new freeze/review decision.

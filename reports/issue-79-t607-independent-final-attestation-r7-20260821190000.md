# Issue #79 / PR #80 T607 independent final attestation R7

## タスク

Issue #79 / PR #80 の invalid attestation `6770d2d8cbf66a11bf6747cc3e6e1f052ad86e0a` に対する exact `pull_request` CI run `32444576455` / unit job `96661656810` の2 observed failuresだけを、初回と同じ independent reviewer が CI-delta-limited verification として再確認した。reviewed clean detached HEAD は `1c14836973cd370b09895c55622d591f8ed7207d`、delta は `6770d2d8cbf66a11bf6747cc3e6e1f052ad86e0a..1c14836973cd370b09895c55622d591f8ed7207d` である。開始時の worktree は clean だった。

## sub-agentを使う理由

独立 reviewer の continuity と限定された CI failure scope を保持する必要があるため、本 verification は同じ reviewer が直接実施し、追加の sub-agent は使用していない。新規観点の探索や sibling review への分割も行っていない。

## 対象範囲

Authoritative evidence は observed PR68-R003 immediate rejection handling failure、T505-R005 fail-closed clear expectation failure、CI follow-up `reports/issue-79-t607-ci-followup-20260821125018.md`、指定 delta の2 test contracts、および README、tasks、phases、handoff provenance だけである。typed `OperationCancelledError`、stale PR A の PR B 非上書き、exact single fail-closed clear、stale republish 不在、旧 attestation 無効化、held gates を確認した。all technical findings `T607-IFR001`〜`T607-IFR006` の prior closed status を維持する。severity reclassification、erratum、新規 finding はない。finding scope 内の unexplored area は none である。

## 対象外

Production implementation の再 review、既に closed の technical finding 観点、sibling scope、base 全範囲、無関係な dependency や consumer、GitHub metadata は対象外である。test、build、compile、typecheck、lint、architecture validation、benchmark、`git diff --check`、Markdown wording、CI の開始・確認・待機・poll は行っていない。implementation、既存 report、tracking、branch、commit、push、PR、Issue、merge は変更していない。本 report 以外の repository write はない。

## 実行コマンド

Read-only evidence collection として `git status --short`、`git rev-parse HEAD/HEAD^`、`git log`、`git show -s`、`git diff --stat/--name-status/--unified`、`rg -n`、`Get-Content`、`Test-Path` を使用した。provided evidence は focused exact-two-file run 13 pass / 0 fail、`npm run test:t607` 79 pass / 0 fail、contracts、lint、architecture positive/negative、diffcheck の pass として受領し、再実行していない。この evidence は new exact-head `pull_request` CI を代替しない。Markdown wording tooling は repository wiring 不在の `unsupported` held であり、起動していない。

## 対象ファイル

- `test/unit/issue-66-pr68-review-findings.test.ts`
- `test/unit/t505-refresh-invalidation.test.ts`
- `reports/issue-79-t607-ci-followup-20260821125018.md`
- `README.md`
- `handoffs/issue-79-t607-implementation-20260821094238.yaml`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`

## 指摘事項

- **CI failure 1 — accepted — `test/unit/issue-66-pr68-review-findings.test.ts:566-583`.** PR A activation の promise 作成直後に outcome handler を接続するため、superseding PR B の完了後に PR A が reject しても unhandled-rejection timing を発生させない。assertion は outcome が rejected、error が typed `OperationCancelledError`、effective progress が PR B の file ID のままであることを固定し、stale A が B を上書きしない既存 production contract と一致する。
- **CI failure 2 — accepted — `test/unit/t505-refresh-invalidation.test.ts:27-55`.** Debounced refresh request は in-flight generation を直ちに invalidate し、fail-closed host state を exactly one `clear` で消去する。stale recalculation rejection 後の complete event sequence を `["clear"]` と比較するため、二重 clear と stale `show` republish の両方を拒否し、既存 production contract と一致する。
- **Provenance — accepted — `README.md:26`; `handoffs/issue-79-t607-implementation-20260821094238.yaml:7-9,27-35`; `tasks/tasks-status.md:12,17-18,368,391`; `tasks/phases-status.md:34,40-41,187`; `reports/issue-79-t607-ci-followup-20260821125018.md:5,13,21-25,39-50`.** Records identify PR #80, exact failed attestation `6770d2d8cbf66a11bf6747cc3e6e1f052ad86e0a`, run/job identity and both failures; preserve focused 13/13、`test:t607` 79/79、static pass evidence; and state that a new attestation and exact-head CI remain pending/held. The old `6770d2d` attestation is invalid and non-reusable for CI or merge authority.

## 結果

**Verdict: PASS_WITH_HELD.** The CI-only delta is accepted. `T607-IFR001`〜`T607-IFR006` retain their closed statuses. Severity changes, new findings, and late viewpoints are none. The `6770d2d8cbf66a11bf6747cc3e6e1f052ad86e0a` attestation remains invalid and non-reusable. Held items are new exact-head `pull_request` CI and Markdown wording tooling `unsupported`. Unexplored is none within finding scope. This verdict does not authorize merge.

## リスク

`report_attestation_allowed: true` only under all of these strict conditions: create exactly one immediate commit whose first parent is `1c14836973cd370b09895c55622d591f8ed7207d`; that commit changes only `reports/issue-79-t607-independent-final-attestation-r7-20260821190000.md`; and make no later repository writes before exact-head PR CI and merge. The resulting R7 report-attestation commit becomes the sole valid exact-head `pull_request` CI target; `6770d2d8cbf66a11bf6747cc3e6e1f052ad86e0a` cannot be reused. Merge remains unauthorized until the new exact-head PR CI is Green and the held Markdown tooling disposition remains accurately recorded; any extra write invalidates this attestation and requires a new freeze/review decision.

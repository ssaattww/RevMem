# Issue #79 / PR #80 T607 independent final attestation R11

## タスク

Issue #79 / PR #80 の invalid attestation `6b5cad916eda37eec7e241b34751c93667c66bc2` に対する exact `pull_request` CI run `32447060823` / job `96668498820` の final VS Code Host lifecycle restore failureだけを、初回と同じ independent reviewer が fifth CI-delta-limited verification として再確認した。reviewed clean detached HEAD は `595d8cfc21ff61777901571e49e315443cc68112`、delta は `6b5cad916eda37eec7e241b34751c93667c66bc2..595d8cfc21ff61777901571e49e315443cc68112` である。開始時の worktree は clean だった。

## sub-agentを使う理由

独立 reviewer の continuity と限定された CI failure scope を保持する必要があるため、本 verification は同じ reviewer が直接実施し、追加の sub-agent は使用していない。新規観点の探索や sibling review への分割も行っていない。

## 対象範囲

Authoritative evidence は observed `lifecycle-restore-confirmed-and-unmark` decoration failure、CI follow-up R5 `reports/issue-79-t607-ci-followup-r5-20260821133836.md`、指定 delta の active decoration drain、Test-mode API、unit regression、lifecycle assertions、focused runner flag、および README、tasks、phases、handoff provenance だけである。scheduler turn、active-generation idle、confirm/restart/unmark preservation、focused prerequisite timeout held、旧 attestation 無効化、provided local evidence、new exact-head gate を確認した。all technical findings `T607-IFR001`〜`T607-IFR006` の prior closed status を維持する。severity reclassification、erratum、新規 finding はない。finding scope 内の unexplored area は none である。

## 対象外

Persistence schema、review command、decoration model、production event-ordering の再 review、既に closed の technical finding 観点、sibling scope、base 全範囲、focused VS Host prerequisite timeout の修正、無関係な dependency や consumer、GitHub metadata は対象外である。test、build、compile、typecheck、lint、architecture validation、benchmark、`git diff --check`、Markdown wording、CI の開始・確認・待機・poll は行っていない。implementation、既存 report、tracking、branch、commit、push、PR、Issue、merge は変更していない。本 report 以外の repository write はない。

## 実行コマンド

Read-only evidence collection として `git status --short`、`git rev-parse HEAD/HEAD^`、`git log`、`git show -s`、`git diff --stat/--name-status/--unified`、`rg -n`、`Get-Content`、`Test-Path` を使用した。provided evidence は build / compile Green、`npm run test:t607` 80 pass / 0 fail、新 unit drain regression、contracts、lint、architecture positive/negative、diffcheck の pass として受領し、再実行していない。Focused VS Host は prerequisite confirm mark command の timeout により restore phase 未到達であり、Green evidence として扱わず held とする。この evidence は new Linux exact-head `pull_request` CI を代替しない。Markdown wording tooling は repository wiring 不在の `unsupported` held であり、起動していない。

## 対象ファイル

- `src/ui/normal-editor/normal-editor-decoration-controller.ts`
- `src/extension.ts`
- `test/unit/normal-editor-decoration-controller.test.ts`
- `test/vscode/suite/index.ts`
- `test/vscode/run-extension-host.ts`
- `reports/issue-79-t607-ci-followup-r5-20260821133836.md`
- `README.md`
- `handoffs/issue-79-t607-implementation-20260821094238.yaml`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`

## 指摘事項

- **VS Host lifecycle restore failure — accepted — `src/ui/normal-editor/normal-editor-decoration-controller.ts:90-151,209-221,288-298`.** Explicit and listener-triggered visible/editor refreshes are tracked in one active Promise set. `drain()` yields one configured scheduler turn so queued VS Code listeners can enter, snapshots and awaits every active generation, then repeats until the set is empty. A superseded explicit refresh therefore cannot make the Test observation proceed before the current bounded event generation publishes. Generation fencing and production refresh ordering remain unchanged; no fixed sleep is added.
- **Test-mode lifecycle seam — accepted — `src/extension.ts:163-173,1013-1023`; `test/unit/normal-editor-decoration-controller.test.ts:200-219`; `test/vscode/suite/index.ts:41-55,315-350`; `test/vscode/run-extension-host.ts:27-38,51-60,141-148`.** `drainVisibleEditorDecorations` is exposed only from Extension Test mode. The unit regression proves drain remains pending until an active bounded refresh applies. Confirm, restored-confirmed, and unmark assertions each retain their persistence/state expectations and now await refresh plus drain before observation. The focused runner selects confirm plus restore without modifying the full lifecycle sequence.
- **Evidence and provenance — accepted with held prerequisite — `README.md:26`; `handoffs/issue-79-t607-implementation-20260821094238.yaml:7-9,28,38-39`; `tasks/tasks-status.md:12,17-18,368,391`; `tasks/phases-status.md:34,40-41,187`; `reports/issue-79-t607-ci-followup-r5-20260821133836.md:5-52`.** Records identify PR #80, exact failed attestation `6b5cad916eda37eec7e241b34751c93667c66bc2`, run/job identity, all Node/focused/Git/Mock stages through T607 passing and the sole final restore failure; preserve T607 80/80 and static evidence; explicitly state the focused VS Host timed out before restore and is not Green; and hold new attestation/exact-head CI. The old `6b5cad9` attestation is invalid and non-reusable for CI or merge authority.

## 結果

**Verdict: PASS_WITH_HELD.** The fifth CI-only delta is accepted. `T607-IFR001`〜`T607-IFR006` retain their closed statuses. Severity changes, new findings, and late viewpoints are none. The `6b5cad916eda37eec7e241b34751c93667c66bc2` attestation remains invalid and non-reusable. Held items are the focused VS Host prerequisite timeout / unexecuted restore phase, new exact-head `pull_request` CI, and Markdown wording tooling `unsupported`. Unexplored is none within finding scope. This verdict does not authorize merge.

## リスク

`report_attestation_allowed: true` only under all of these strict conditions: create exactly one immediate commit whose first parent is `595d8cfc21ff61777901571e49e315443cc68112`; that commit changes only `reports/issue-79-t607-independent-final-attestation-r11-20260821230000.md`; and make no later repository writes before exact-head PR CI and merge. The resulting R11 report-attestation commit becomes the sole valid exact-head `pull_request` CI target; `6b5cad916eda37eec7e241b34751c93667c66bc2` cannot be reused. Merge remains unauthorized until the new exact-head PR CI, including Linux lifecycle restoration, is Green and all held dispositions remain accurately recorded; any extra write invalidates this attestation and requires a new freeze/review decision.

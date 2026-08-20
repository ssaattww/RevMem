# T606 independent review follow-up

## タスク

T606 / Issue #76 / PR #77 の一度限りの independent final review に対する finding 限定 follow-up である。branch は `task/t606-failure-policy-retry-diagnostics`、base および開始時 HEAD は `51e64d537002991782b985698f834b69895fd0ff`。対象は `reports/issue-76-t606-independent-final-review-20260821063000.md` の T606-IFR001〜IFR005 だけであり、新しい full review ではない。technical commit SHA は未commit 指示により pending である。

## sub-agentを使う理由

この実装 follow-up は parent の task owner から、既存の未commit implementation 差分を保持して IFR001〜005 を同一 batch で閉じる実装 owner として委譲された。independent reviewer の freshness を損なわないため、同 reviewer による finding 限定 closure は未実施のまま parent へ返す。追加の reviewer、CI、PR、commit、push、merge は実行していない。

## 対象範囲

既存設計 `doc/design/vscode-review-range-tracker-design.md` §2.1、§17、§20.4 の fail-closed UI、一時的 pure read だけの bounded retry、redacted operation lifecycle を production へ回復した。IFR001 は current-generation failure と cache mutation failure で Review Contexts tree を clear して old fresh projection を残さず、deferred cache publish の実結果を表示 status へ反映する。IFR002 は `git-timeout` を transient、`git-failure` を permanent として分離し、result-union unavailable を pure-read retry boundary へ伝播し、Current Context→T405 AbortSignal と PR Progress cancellation を接続する。IFR003 は Global toggle/open を shared operation feedback の一回の redacted terminal lifecycle に接続し、dedicated PR Progress の owner/retry を維持する。IFR004 は classifier、stale-tree、retry wiring、cancellation、Global lifecycle、focused CI wiring の regression を追加・更新する。IFR005 は README、task/phase tracking、当 report、handoff を同期する。

この変更は既存契約の回復であり、public API、persisted data、file format、configuration、breaking behavior を追加・変更しない。`Design/BreakingChanges.md` は変更不要と判断した。

## 対象外

新しい independent full review、実 Remote/network E2E、CI dispatch/rerun/wait、PR/Issue 操作、commit、push、merge、無関係 cleanup は対象外である。`npm run test:t606` は1回だけ実行済みで、follow-up 後に full rerun していない。historical normal reports の結論と severity は書き換えていない。

## 実行コマンド

Focused Red は `npm run compile:test` と `node --test test-dist/test/unit/t606-failure-policy-retry-diagnostics.test.js` で実行し、11 pass / 1 fail だった。failure は `PR_PROGRESS_UNAVAILABLE` の final `git-failure` が `retryable` ではなく `permanent` であるべきことを示した。同一 focused batch の Green は 12 pass / 0 fail だった。

`npm run test:t606` は1回のみ実行し、194 pass / 2 fail / 2 Windows POSIX skip だった。2 failure は old fresh-cache と result-union の旧 expectation だった。full rerun はしない代わりに、正確な失敗 selection を `node --test --test-name-pattern='Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics|T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation' test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/t405-composition-regression.test.js` で1回実行し、2 pass / 0 fail を確認した。

`npm run build`、`npm run typecheck:contracts`、`npm run validate:architecture`、`npm run validate:architecture:negative` は pass で、negative architecture は期待どおり11 violation を報告した。最初の `npm run lint` は機械的3件、最終 full lint は未使用 parameter 1件を報告した。同一原因の修正後に `npx eslint src/t405-review-contexts-runtime.ts --max-warnings=0` は pass だった。`git diff --check` は pass だった。

## 対象ファイル

Production は `src/adapters/local-git/local-git-pull-request-diff-adapter.ts`、`src/application/github-pr-diff/contracts.ts`、`src/application/github-pr-diff/pull-request-diff-acquisition-service.ts`、`src/application/operation-feedback/operation-feedback.ts`、`src/t305-extension.ts`、`src/t405-pull-request-review-runtime.ts`、`src/t405-review-contexts-runtime.ts`、`src/ui/global-understanding/global-understanding-ui-model.ts`、`src/ui/global-understanding/vscode-global-understanding-runtime.ts`、`src/ui/review-contexts/vscode-review-contexts-runtime.ts` である。

Regression は `test/unit/t606-failure-policy-retry-diagnostics.test.ts`、`test/unit/t606-r6-production-matrix.test.ts`、`test/unit/t405-composition-regression.test.ts`、`test/unit/review-contexts-runtime-wiring.test.ts` を更新した。Documentation/tracking は `README.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`、当 report、`handoffs/issue-76-t606-independent-review-followup-20260821070602.yaml` を更新した。

## 指摘事項

- **T606-IFR001 — High — addressed.** Current-generation handled failure と explicit cache mutation failure が old fresh Review Contexts projection を残さず clear/unknown へ移る。cache status は deferred publish の実結果から同じ snapshot へ反映される。
- **T606-IFR002 — High — addressed.** `git-timeout` と permanent Git failure を lossless に区別し、result-union unavailable を pure-read retry に接続した。Current Context と PR Progress の cancellation propagation を固定した。
- **T606-IFR003 — Medium — addressed.** Global toggle/open は START と terminal を一度だけ持つ shared lifecycle に入り、failure は generic/redacted UI projection になる。PR Progress も explicit cancellation owner を持つ。
- **T606-IFR004 — High — addressed.** IFR001〜003 を検出する production matrix、actual command lifecycle、focused `test:t606`/CI contract regression を更新した。
- **T606-IFR005 — Medium — addressed.** README、tracking、report、handoff は IFR001〜005 addressed、same reviewer closure pending、technical SHA pending、CI held、PR body external sync pending を記録する。

Source severity は全件保存し、reclassification はない。

## 結果

IFR001〜IFR005 は implementation scope で addressed である。same independent reviewer による finding 限定 closure は pending、technical SHA は commit 前のため pending、exact-head PR CI は held、PR #77 body の外部同期も pending である。Markdown wording は `tools/lint/`、`cspell.config.jsonc`、`lint:md` が存在しないため `unsupported` / held。CI は dispatch、rerun、wait をしていない。

## リスク

full `test:t606` の再実行は禁止されたため、Green evidence は exact failed selection 2/2 と既存 focused Green 12/12 に限定される。lint は final full run で判明した同一未使用 parameter を修正後、対象 file の focused ESLint で確認したが、追加の full lint は実行していない。次 action は同一 independent reviewer が IFR001〜005 限定で closure を行い、その後 parent が accepted batch を commit、technical SHA を記録、PR body を外部同期、exact-head CI を取得することである。当 report は merge authorization を与えない。

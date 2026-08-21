# T606 independent finding closure R4 report

## タスク

Issue #76 / PR #77 の T606 independent final review で確定した finding のうち、R3 で open だった `T606-IFR002` から `T606-IFR005` までの required action に対する、同一 independent reviewer による finding-limited closure R4 である。`T606-IFR001` は closed を維持し、再レビューしていない。新しい full-scope review、新規観点・finding、severity 変更、sibling 探索は行っていない。

## sub-agentを使う理由

sub-agent は使用していない。同一 reviewer の continuity と、既存 finding だけに限定した判定境界を保つため、対象証拠を一括して直接確認した。

## 対象範囲

- admin review target: `ecd53128770ddda06ea87ded9225a31bd1c66582`
- technical R4 HEAD: `c19bddd54827143520ca6070c28db37c66de218c`
- prior closure target: `2421e1657ae13f37ebda72b6a593c5618891f84f`
- original independent review target: `e73e87bef409c92a9508e90bd86da10c9fcdffac`
- base / merge-base: `fb7df6ab79bb23ae16b43b61aa66ab743460be69`
- 判定対象: `T606-IFR002` の lifecycle/auth/GitHub/local Git/blob/Node cache の signal・context、abort fence、retry composition、`T606-IFR003` の local content signal、typed supersede terminal、Global actual command、`T606-IFR004` の production regression 配線と full Green、`T606-IFR005` の README・tasks・phases・R4 evidence・PR body 同期
- provided validation evidence: `test:t606` 202 pass / 0 fail / 2 skip、build、`typecheck:contracts`、lint、architecture positive / negative、diff-check は pass。指示に従い再実行していない。
- current PR #77 body は admin target、technical R4 HEAD、202 / 0 / 2、finding 状態、exact-head CI held を同期済みであることを read-only で確認した。

## 対象外

- `T606-IFR001` の再レビュー、既に確定した severity の変更、新規 finding・観点、full independent review、sibling 探索
- 実装、test / CI の実行または待機、commit、push、PR 操作
- exact-head CI の完了確認。これは merge gate として held のままである。
- repository Markdown tooling による wording check。`tools/lint`、Markdown 対象・設定・whitelist、`prh`、`cspell`、`lint:md` が見つからないため unsupported / held とした。

## 実行コマンド

read-only で `git status --short --branch`、`git rev-parse HEAD`、`git merge-base`、`git log`、`git diff --name-status`、`git diff`、`rg`、`Get-Content`、`gh pr view 77` を使用し、identity、R3 closure、R4 follow-up report / handoff、対象実装・production regression・配線、README / tracking、current PR body を確認した。validation command と CI は実行していない。レポート更新には `apply_patch` だけを使用した。

## 対象ファイル

- `reports/issue-76-t606-independent-finding-closure-r3-20260821083000.md`
- `reports/issue-76-t606-review-followup-r4-20260821090000.md`
- `reports/issue-76-t606-review-followup-r4-handoff-20260821090000.md`
- `src/extension/auth/vscodeGitHubAuthenticationProvider.ts`
- `src/extension/cache/nodeFilePullRequestCacheStorage.ts`
- `src/extension/cache/pullRequestCacheService.ts`
- `src/extension/github/fetchGitHubPullRequestLifecycleAdapter.ts`
- `src/extension/github/readSynchronizedRepository.ts`
- `src/extension/git/nodeGitBlobReader.ts`
- `src/extension/git/nodeGitCommandExecutor.ts`
- `src/extension/git/vscodeLocalGitAdapter.ts`
- `src/extension/prReview/pullRequestReviewRuntime.ts`
- `src/tests/t405-composition-regression.ts`
- `src/tests/t606-r6-production-matrix.ts`
- `src/tests/t606-test-manifest.ts`
- `package.json`、`.github/workflows/ci.yml`
- `README.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`
- current PR #77 body

## 指摘事項

- `T606-IFR001` — **Closed maintained / not re-reviewed (High)**。R3 の closed disposition を維持する。本 R4 の対象外であり、required action を再判定していない。
- `T606-IFR002` — **Open (High)**。production code では lifecycle/auth/GitHub/local Git/blob/Node cache まで context と `AbortSignal` が伝播し、pending Node cache I/O の abort fence も追加されている。一方、network / timeout のみ最大3回、auth / validation / stale / storage / permanent は1回という typed retry classification を、実際の T305→T405 production composition と同じ owner / signal で通す regression は依然存在しない。現在の retry test は `CurrentContextUiController` と mock cache service の直接構成であり、既存 required action の「actual composition で固定」を満たさない。**Required action:** 実際の lifecycle/auth/GitHub/local Git/blob/cache composition を通る production regression で、同一 context / signal、pending abort、transient retry と permanent no-retry を一体で固定する。
- `T606-IFR003` — **Open (Medium)**。local review content I/O への signal 伝播と、supersede を `OperationCancelledError` の terminal failure/cancellation とする修正は確認でき、PR Progress の production runtime regression も更新されている。一方、Global Understanding の production **open command** を実際に invoke して lifecycle/redaction/retry/cancel を検証する regression はない。既存の actual command regression は toggle command であり、open は controller 直接呼び出しに留まる。**Required action:** 登録済み Global open command を実際に invoke する production regression を追加し、単一 lifecycle UI、redaction、retry/cancel、terminal outcome を固定する。
- `T606-IFR004` — **Open (High)**。`test:t606` と CI contract の配線、および provided full Green 202 pass / 0 fail / 2 skip は確認した。しかし `T606-IFR002` の actual retry composition と `T606-IFR003` の Global open actual command が production regression として未配線であるため、既存 required action の production seam coverage は完了していない。**Required action:** `T606-IFR002` と `T606-IFR003` の上記 production regressions を `test:t606` / CI contract に配線し、full Green evidence を更新する。
- `T606-IFR005` — **Closed (Medium)**。README、tasks、phases の current status から旧 R1 / R2 / R3 の current 表示が除去され、R4 technical HEAD と 202 / 0 / 2 evidence に同期されている。R4 report / handoff と current PR #77 body も、admin target `ecd5312...`、technical HEAD `c19bddd...`、validation count、closure-pending 状態を矛盾なく表している。

## 結果

**Technical verdict: FAIL.** `T606-IFR002`、`T606-IFR003`、`T606-IFR004` は open、`T606-IFR005` は closed、`T606-IFR001` は closed maintained / not re-reviewed である。required criteria は finding-limited scope 内ですべて reviewed または held に分類し、unexplored は none、unknown は none である。held は exact-head CI merge gate と unsupported の Markdown wording tooling である。

`report_attestation_allowed: false`。open finding が残るため、この report を independent-final-review attestation として commit してはならない。次回は同一 reviewer が `T606-IFR002` から `T606-IFR004` の上記 required action だけを closure 判定し、新しい full independent review は行わない。すべて closed になった後に限り、その時点で frozen された admin target を first parent とし、予約された closure report だけを含み、後続 commit がない report-only attestation commit を許可できる。

## リスク

- open findings により merge readiness は未達である。
- exact-head CI は本 closure では待機しておらず、merge gate として held である。
- repository Markdown tooling が不在のため、Markdown wording check は unsupported / held である。placeholder、見出し、末尾空白、HEAD、status の機械確認だけを行う。
- finding-limited closure なので、対象外の機能領域に関する保証や新規 finding の不存在を意味しない。ただし指定された closure criterion に unexplored はない。

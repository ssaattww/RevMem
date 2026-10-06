# Issues #136/#137 通常レビュー修正レポート

## 対象

- Branch: `issue-136-137-refresh-and-safe-diagnostics`
- Fix base: `479e27a9265f01be33ed1a1e6182edd56cdb6e44`
- Base range: `a479bf5cf2b35f342a8dab90dc886a19d8233520..479e27a9265f01be33ed1a1e6182edd56cdb6e44`
- Initial normal review report: `reports/issue-136-137-normal-review-20261006.md` (原本を変更せず保持)
- Result: NR-001..006の修正を実装。fix verification は同じnormal reviewerへ依頼前。
- Scope limits: 外部投稿、PR/Issue作成、push、merge、deploy、依存・認証・権限・環境の変更は実施しない。Extension Hostは今回再試行せず、実機UIは未検証のまま保持。

## 修正とfinding別証跡

| Finding | 修正 | 対応するテスト/証拠 | 状態 |
| --- | --- | --- | --- |
| I136137-NR-001 (P1) | generation/signalが古くなったbranch-list失敗からPR Progressをclearしない | `issue-136-refresh-coordinator.test.mjs`: Review Contexts旧failure、遅延old success、cancelled old refreshの各ケースで、後続explicit PR選択のtreeを保つ | 実装済み・fix verification待ち |
| I136137-NR-002 (P1) | Issue #90詳細診断でtarget値を保存・表示せず、PR reason/phaseもallowlist化。queued PR file detailもredact。refresh payloadはproduction formatterで安全に描画 | `issue-90-diagnostics-and-cancellation.test.ts` と `t405-pull-request-review-runtime.test.ts`: production T405 activation/queue/detail/export経由でpathを確認。repo/branch/URL/SHA/source/diff/exceptionもproduction feedback pathへ注入。OFF/ONで値の非出力を確認 | 実装済み・fix verification待ち |
| I136137-NR-003 (P2) | T405 augmentationが失敗しても、verified local branch候補があればその候補を維持。依存refresh失敗時は旧PR progressをclearし、branch failureとして終了 | `issue-136-refresh-coordinator.test.mjs`: T405 early augmentation failure→branch維持→dependent list failure→PR state clear | 実装済み・fix verification待ち |
| I136137-NR-004 (P2) | start/progress/success/failure/cancelledにowner operation IDを付与。詳細adapterは明示IDを優先し、production refresh payloadをbase formatterへ渡す | `issue-90-diagnostics-and-cancellation.test.ts`: production formatterのOFF/ON、同名並行operation 2件のstart/refresh/terminal相関 | 実装済み・fix verification待ち |
| I136137-NR-005 (P2) | shared PR projection失敗をowner feedbackへ報告し、tree publication failedとして再throw。PR計算失敗で成功terminalを出さない | `issue-136-refresh-coordinator.test.mjs`: projection failureでfailed publicationとfailed terminalを1件、succeeded terminalを0件確認 | 実装済み・fix verification待ち |
| I136137-NR-006 (P2) | current PR resolverが explicit/unique/ambiguous/no-match/no-selectionを返す。匿名ordinal/count、stage timing、repository/list/registration/selection/progress/publication結果をrefresh diagnosticへ接続 | `t405-review-followup.test.ts`: 4種の選択決定。coordinator tooling test: selection provenanceが生成済みsnapshotから実際のrefresh recordへ渡る。extension compositionが段階記録・件数を出力 | 実装済み・fix verification待ち |

## 検証

最終fix候補で次を実行。各コマンドはexit 0。

- `npm run lint`
- `npm run build`
- `npm run compile:test`
- `npm run test:t305`: 71/71
- `npm run test:t405`: 87/87
- `npm run test:t406`: 29/29
- `npm run test:t606`: 235/235
- `npm run test:t609`: 92/92
- Focused coordinator/privacy/Issue #90 suites: 19/19 pass. Production T405 detail privacy path is also included in test:t405.
- `git diff --check`: pass.

T406-specific result: dedicated `test:t406` and the T405 production composition test both passed. The previously observed globalState assertion failure is no longer present in these results.

## 未完了

- Same-reviewer fix verification pending; no closure verdict is claimed here.
- Extension Host route was not rerun in this fix pass. Existing report records the prior runner stopping during VS Code version resolution before host startup; device UI remains held.
- No PR/Issue, external post, push, merge, or deployment was performed.

## Fix-verification completeness matrix

| Finding | Required action | Production path changed | Actual fixture | Focused evidence |
| --- | --- | --- | --- | --- |
| I136137-NR-001 | Prevent old failure, success, and cancellation from clearing or publishing over a newer explicit PR selection across the shared Current Context/Review Contexts entry | `CurrentContextRuntimeCoordinator.refresh` / `selectContext`; branch cleanup runs only while its generation and signal remain current | Coordinator fixture starts a Review Contexts branch refresh, completes a newer explicit PR selection, then finishes the old branch operation as failure, success, or cancellation | Three isolated deferred-race tests in `issue-136-refresh-coordinator.test.mjs`; no stale clear and newer PR tree remains |
| I136137-NR-002 | Remove repository/branch/URL/SHA/path/source/diff/exception values from detailed PR logs, including queued and parent-owned details, with diagnostics OFF and ON | T405 `activateProgress` queues file details and reports per-file read details; Issue #90 exported feedback adapter validates and formats them | Production `PullRequestReviewRuntime.activateProgress` runs inside a parent feedback operation; a second fixture injects hostile values into queued and child detail fields and a thrown exception | T405 runtime privacy test plus `issue-90-diagnostics-and-cancellation.test.ts`; raw values absent in both detail modes |
| I136137-NR-003 | Preserve a verified local branch during early T405 list/lifecycle/snapshot enrichment failure, clear old PR progress, and retain fail-closed behavior when branch identity is not proven | `extension.ts` candidate enumeration calls `augmentCurrentContextCandidatesWithBranchFallback`; coordinator accepts branch before its dependent list failure clears PR state | Actual shared coordinator uses the production fallback helper with a verified branch candidate; injected augmentation and dependent-list failures | `early T405 augmentation failure keeps the verified branch...` in `issue-136-refresh-coordinator.test.mjs`; branch accepted and old PR progress cleared |
| I136137-NR-004 | Correlate default start/progress/terminal IDs and preserve refresh fields through the exported formatter for success/failure/cancel/supersession | Base `OperationFeedback` owns operation IDs; detailed adapter honors explicit owner IDs and routes `refresh` records through base safe formatter | Two concurrent same-label operations plus production exported formatter in both diagnostics modes; T405 runtime details include parent ownership | Issue #90 lifecycle/privacy tests and coordinator terminal test; matching IDs and safe stage payload asserted |
| I136137-NR-005 | Fail the owning shared refresh when PR recalculation fails; record failed publication and no successful terminal while preserving unrelated dependent isolation | `extension.ts` reports handled shared projection error to parent feedback, marks publication failed, and rethrows after helper completes other dependents | Production projection helper is composed with coordinator and parent feedback boundary; PR projection throws while decorations/Global resolve | `failed shared PR projection...` coordinator test asserts one failed terminal, no success terminal, and failed tree publication |
| I136137-NR-006 | Emit actual explicit/unique/ambiguous/no-match provenance and correlate selection, registration, snapshot, and tree through anonymous operation-local counts and durations | Review-context resolver -> T405 augmentation snapshot metadata -> coordinator provenance -> extension refresh stage records | Resolver decision fixtures cover multi-candidate explicit, unique, ambiguous, and absent match; coordinator consumes the resulting snapshot metadata and emits `pr-selection` | `t405-review-followup.test.ts` resolver tests plus `resolved selection provenance flows...` record test; extension reports repository/list/registration/selection/progress/publication stages |

Repository changes remain local. Before H2 is created: `commit_pending`, technical head `479e27a9265f01be33ed1a1e6182edd56cdb6e44`; parent/base commit is `a479bf5cf2b35f342a8dab90dc886a19d8233520`.

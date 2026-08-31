# Sub-agent実行レポート

## タスク

- 目的: `PR94-CI-003B4`としてcontent-free target-file evidence portを追加し、安全なmixed snapshot planを成立させる。
- タスク種別: TDD implementation / snapshot slice 2d

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/highで、T405 acquisitionからPR mapperまでのevidence境界を0.5h以内に閉じるため。

## 対象範囲

- 対象: T405 acquisition/adapterのcontent-free evidence port、PR mapper/store contract、direct focused tests。

## 対象外

- 対象外: mutation write-through、local Git、design/workflow/package/tracking、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- 実行コマンド:
  - Read-only: implementation/TDD/coding standards skills、slice-2b/2c reports、design 4.3/4.4、T405 runtime/Node adapter/store/mapper callers and direct T404 tests。
  - `rg -n -C 5 "createNodeGitHubPullRequestContextStateService|createImmutablePullRequestRevisionMapper" src` and evidence call-site search.
  - `git diff --check -- reports/2026-08-31-pr94-snapshot-slice-2d.md` — report更新後に実行する。

## 対象ファイル

- 変更または確認したファイル:
  - 変更: `reports/2026-08-31-pr94-snapshot-slice-2d.md` のみ。
  - 確認: `src/t405-review-contexts-runtime.ts`、`src/adapters/github/node-github-pull-request-context-layer-store.ts`、layer-store/mapper、`test/unit/t404-review-followup-r3.test.ts`。

## 指摘事項

- 指摘要約または「指摘なし」:
  - Blocked before Red: `GitHubPullRequestContextStateService.update()` creates `PullRequestRevisionMappingEvidence` internally from only PR SHA descriptors. The Node adapter supplies only the content/revision mapping loader. Canonical path/hash/line-count currently exists only after that loader's content acquisition.
  - Adding independent, content-free target evidence before exact-hit selection requires coordinated changes to public `UpdatePullRequestContextInput`, layer-store construction, Node adapter overload/port, and T405 acquisition/caller (with direct T404 factory tests). This is a protocol redesign, not the requested minimal one-caller wiring.
  - Loader bypass plus independent validation cannot be met by calling the existing loader or by self-derived snapshot values; both violate the stated contract.

## 結果

- 結果:
  - No product/test source changed; no Red/Green run. The >minimal protocol boundary was discovered before implementation, so work stops under the task's explicit safety condition.

## リスク

- 未解決のリスクまたは後続対応:
  - Proposed planning task: define a prevalidated `PullRequestImmutableTargetEvidence` acquisition port owned by T405, decide lifecycle/cache invalidation and update-input compatibility, then implement it across the four identified production contracts plus tests. The port must carry no content/token and be unavailable/stale on cache mismatch.
  - Until that decision, full-hit snapshot restoration remains self-evidence-based from slice 2 and must not be relied on for design-4.4 compliance; mixed-layer restore remains disabled.

# Sub-agent実行レポート

## タスク

- 目的: `PR94-CI-003B3`としてcanonical target evidence付きlayer別snapshot hit/missを実装する。
- タスク種別: TDD implementation / snapshot slice 2c

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/highで、循環検証を避けたmapping evidence境界を0.5h以内に閉じるため。

## 対象範囲

- 対象: PR mapper、layer-store mapping evidence contract、直接caller、snapshot/store focused tests。

## 対象外

- 対象外: T405 mutation write-through、local Git、design/workflow/package/tracking、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- 実行コマンド:
  - Read-only: implementation/TDD/coding standards skills、slice-2/2b reports、design 4.3/4.4、mapper/store and production caller search。
  - `rg -n -C 5 "createNodeGitHubPullRequestContextStateService|createImmutablePullRequestRevisionMapper" src` identified `src/adapters/github/node-github-pull-request-context-layer-store.ts` and `src/t405-review-contexts-runtime.ts:739`.
  - `git diff --check -- reports/2026-08-31-pr94-snapshot-slice-2c.md` — report更新後に実行する。

## 対象ファイル

- 変更または確認したファイル:
  - 変更: `reports/2026-08-31-pr94-snapshot-slice-2c.md` のみ。
  - 確認: mapper/store、`src/adapters/github/node-github-pull-request-context-layer-store.ts`、`src/t405-review-contexts-runtime.ts`、`test/unit/t404-review-followup-r3.test.ts`。

## 指摘事項

- 指摘要約または「指摘なし」:
  - Blocked before Red: the only production evidence acquisition is the `t405-review-contexts-runtime.ts` loader passed through the Node GitHub context-store adapter. Its returned diff/new-file evidence is where canonical target path/content hash/line count becomes available.
  - Calling that loader on an exact hit violates the required loader-bypass contract. Not calling it leaves mapper/store with SHA-only `PullRequestRevisionMappingEvidence`; they cannot independently revalidate target descriptor/content. A snapshot-derived value is circular and unsafe.
  - The minimal safe change therefore needs a new prevalidated immutable target descriptor/evidence port from T405 acquisition into the layer-store mapper input, plus caller wiring and tests. This is an acquisition/T405 contract change, explicitly prohibited by the current slice.

## 結果

- 結果:
  - No product/test source was changed and no Red/Green command was run. There is no safe mapper/store-only mixed matrix implementation that meets both 4.4 revalidation and exact-hit loader bypass.

## リスク

- 未解決のリスクまたは後続対応:
  - Proposed next bounded slice: authorize `src/t405-review-contexts-runtime.ts` and `src/adapters/github/node-github-pull-request-context-layer-store.ts` with the mapper/store, define a content-free canonical target-file evidence port (file ID/path/line count/hash/revision), and add the mixed hit/miss Red. The existing diff content remains private inside acquisition and is not logged.
  - Write-through remains subsequent work after that contract closes.

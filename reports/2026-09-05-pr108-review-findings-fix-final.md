# PR #108 review findings fix final report

## Scope

PR #108 / Issue #106 の最新authoritative scope `reports/2026-09-05-pr108-product-impact-action-scope.md` にある PRODUCT-001〜005 を対象とした。旧scopeのhistory途中失敗等は今回の必須対象ではない。mergeは行わない。

## Result

- PRODUCT-001: delayed PR が後からowner revisionになった場合に、PR固有のsource snapshotとowner-current Global mappingを分離して追随可能にした。B/B/B -> C/B/C -> C/D/D、Global先行状態をactual T405 compositionで固定した。
- PRODUCT-002: owner lifecycleが1件でも未完了ならexisting/new PR selection・Context作成・Global advance・history公開へ進まない。interactive private authentication後はowner全体を再同期してから継続する。
- PRODUCT-003: read-only lifecycle projectionのtitle/stateはremoteを反映しつつ、base/headはpersisted revisionへpinする。tree/cache/progress/diff registrationが同一revisionを参照し、異HEAD PRを除外せずrefresh/restart/open diff可能にした。
- PRODUCT-004: generic Review Stateの安全checkを削除せず、PR HEADのexact Global revision snapshotを一時投影して既存検証・mutationを実行し、結果をowner-current Globalを維持したままrevision snapshotへ再統合する。modified/original mark/unmark、sibling isolation、history、restartをactual compositionで固定した。
- PRODUCT-005: ユーザー向け文言 `対象PR` / `cacheへ保存` を修正し回帰テストを追加済み。

## TDD and publication

主要な修正はRedを先にpushし、その後の実装を小さい論理単位でpushした。

- PRODUCT-001 implementation: `c3517f0dbb4346d1182c6bdeb16c0efffc42dd53`
- PRODUCT-002 implementation: `f7bfc45ce0d5237b72bff74bc251357083595f7d`
- PRODUCT-003 Red: `3a71ffd7e1214b34a2f436183469c6f2f26a45d9`
- PRODUCT-003 fix: `7f102a122d3be464153f2e9827ca735b1ae03aa7`
- PRODUCT-004 Red: `bbfda2c53c93e25a1727835ada3a3b1cc397ce85`
- PRODUCT-004 adapters: `8d6e66af332f9ceb561ecf48bd4d907237cf2bbc`, `99184dae06cde51da39639cc1ca43ba382632a84`
- PRODUCT-004 activation: `64bff5e559ef53178790e47cfdb12aa268da47d9`
- PRODUCT-005 fix: `70cca0195c6f47ae12cc3cc72bdc2dfb2e3c402c`

## Verification

Local reconstructed-source verification used Node 22.16.0 / TypeScript 5.8.3 transpile-only.

- PRODUCT-001〜004 actual product regression: 12/12 pass.
- Review State / PR runtime / Issue #106 related regression: direct implementation 47/47 pass; final adapter implementation focused set 39/39 pass.
- PRODUCT-003 dedicated regression: 2/2 pass after fix.
- PRODUCT-004 dedicated regression: 2/2 pass after fix; both were Red before implementation.
- `git diff --check`: pass.

The reconstructed local tree lacks installed `@types/node`, `@types/vscode`, and the eslint binary, therefore local build/typecheck/lint equivalence is not claimed. Required CI remains the authoritative verification for those gates.

## Diagnostics and CI policy

`.github/workflows/ci.yml` already wraps commands with `tools/run-ci-command.mjs` and uploads failure diagnostics containing test results, stdout, stderr, combined logs, environment information, generated outputs and source/test files. No additional diagnostic workflow was required.

CI is used only for verification/diagnostics and was not used to update code. Completion requires checking only a workflow run whose `head_sha` exactly equals the PR current HEAD after this report commit. A run for another SHA is never substituted. The exact-head result is reported in the PR conversation after this report is published.

## Files and evidence

Detailed per-finding evidence is stored in:

- `reports/2026-09-05-pr108-product-001-fix.md`
- `reports/2026-09-05-pr108-product-002-fix.md`
- `reports/2026-09-05-pr108-product-003-fix.md`
- `reports/2026-09-05-pr108-product-004-fix.md`
- existing PRODUCT-005 commit/test evidence

No merge was performed.

# PR #108 review findings fix final report

## Scope

PR #108 / Issue #106 の最新authoritative scope `reports/2026-09-05-pr108-product-impact-action-scope.md` にある PRODUCT-001〜005 を対象とした。旧scopeのhistory途中失敗等は今回の必須対象ではない。mergeは行わない。

## Result

- PRODUCT-001: delayed PR が後からowner revisionになった場合に、PR固有のsource snapshotとowner-current Global mappingを分離して追随可能にした。B/B/B -> C/B/C -> C/D/D、Global先行状態をactual T405 compositionで固定した。
- PRODUCT-002: owner lifecycleが1件でも未完了ならexisting/new PR selection・Context作成・Global advance・history公開へ進まない。interactive private authentication後はowner全体を再同期してから継続する。
- PRODUCT-003: read-only lifecycle projectionのtitle/stateはremoteを反映しつつ、base/headはpersisted revisionへpinする。tree/cache/progress/diff registrationが同一revisionを参照し、異HEAD PRを除外せずrefresh/restart/open diff可能にした。
- PRODUCT-004: generic Review Stateの安全checkを削除せず、PR HEADのexact Global revision snapshotを一時投影して既存検証・mutationを実行し、結果をowner-current Globalを維持したままrevision snapshotへ再統合する。target snapshotが未作成の場合は空のtarget revision viewから開始して新規snapshotを作成する。file identity解決はowner-current Globalではなく対象PR revisionのGlobal snapshotへscopeし、modified/original mark/unmark、sibling isolation、history、restartをactual compositionで固定した。
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
- PRODUCT-004 CI type fixes: `48f0a06b0c7b9ac661b85448a22d0c08cd6a7046`, `86a8893c32973fe1639597a60a239db5498d3608`, `6a142efb05b1c4bf85b2c22e7f9113bc94b2dbbf`
- latest-main lifecycle fixture compatibility: `c1822bb5b86b6a6f767fcabff0d4de796e0962fd`
- PRODUCT-004 missing target snapshot fix: `402412dddc4750ddfe5e5d7d510531671fba0fa9`
- PRODUCT-004 target-revision file identity fix: `3b69cdba70d466d123861a26b0e0c0e3e0c08d3c`
- PRODUCT-005 fix: `70cca0195c6f47ae12cc3cc72bdc2dfb2e3c402c`

## Verification

Local reconstructed-source verification used Node 22.16.0 / TypeScript 5.8.3 transpile-only for the earlier focused work. The exact PR merge source from the diagnostic artifact was used only to reproduce failures and verify local corrections; CI artifacts were never used to update repository code.

- PRODUCT-001〜004 actual product regression before latest-main merge interaction: 12/12 pass.
- Review State / PR runtime / Issue #106 related regression: direct implementation 47/47 pass; final adapter implementation focused set 39/39 pass; after CI type corrections the focused PRODUCT-004/Review State/PR runtime set passed 29/29.
- PRODUCT-003 dedicated regression: 2/2 pass after fix.
- PRODUCT-004 dedicated regression: 2/2 pass after fix; both were Red before implementation.
- latest-main merged-source `test-pr108-products`: initial reproduction 1/20 pass, lifecycle merge-base fixture compatibility後 17/20 pass, PRODUCT-004の2実装不備修正後 20/20 pass.
- `git diff --check`: pass during focused local verification.

The reconstructed local tree used for the earlier work lacked installed `@types/node`, `@types/vscode`, and the eslint binary, therefore local build/typecheck/lint equivalence was not claimed. Required CI is the authoritative verification for those gates.

## Exact-head CI diagnostics and resolution

The first final-candidate exact-head run was CI run `33967575617` for PR HEAD `31eea70e2e05a8b56bae55005cf482a13f64daa5`. It failed at Build with TypeScript-only errors in the two new PRODUCT-004 adapter files: readonly Global snapshot types were assigned to mutable persisted contracts, and the snapshot adapter used the repository `ReviewStateCommit` type even though `captureImmutableRevisionSnapshots` returns only Context/Global state. The failure artifact was `ci-failure-diagnostics-33967575617-1` (artifact ID `9969918842`).

After the first type corrections, exact-head CI run `33967703901` for HEAD `f30f74a49bc4b08a2472ea5f0feba3692b414806` still failed at Build because the cloned `revisionSnapshots` map itself retained its deep-readonly type. Its failure artifact was `ci-failure-diagnostics-33967703901-1` (artifact ID `9969954469`). The map was explicitly materialized to the mutable persistence contract in `6a142efb05b1c4bf85b2c22e7f9113bc94b2dbbf`.

Exact-head CI run `33967799835` for HEAD `d772a9950d420215e0bec16fc9b8cf24110483b3` passed Build, contract typecheck, architecture, lint, unit, T403, T404, T405 and T406, then failed only at the Issue #106 / PR108 product gate. The failure artifact was `ci-failure-diagnostics-33967799835-1` (artifact ID `9970000910`). Diagnosis showed that latest `main` had added merge-base acquisition to open-PR lifecycle metadata, while the PR108 production fixture still modeled only `/pulls` and `/pulls/{number}`. That caused lifecycle acquisition to fail and masked two remaining PRODUCT-004 defects: missing target-revision snapshots did not start from an empty target view, and non-owner PR file identity resolution incorrectly consulted owner-current Global state.

The fixture was updated in `c1822bb5b86b6a6f767fcabff0d4de796e0962fd`; the missing-target snapshot behavior was fixed in `402412dddc4750ddfe5e5d7d510531671fba0fa9`; target-revision file identity and path lookup were fixed in `3b69cdba70d466d123861a26b0e0c0e3e0c08d3c`.

Exact-head CI run `33968882456` for code HEAD `3b69cdba70d466d123861a26b0e0c0e3e0c08d3c` completed successfully. It passed Build, contract typecheck, architecture validation, architecture negative contract, lint, unit tests, T602, T603, T403, T404, T405, T406, Issue #106 / PR108 product tests, T304, T502, T503, T504, T505, T506, T604, T605, T606, T609, T610, temporary Git integration, mock GitHub integration, VS Code Extension Host tests, and success-artifact publication.

No CI mechanism was used to update code. CI runs and artifacts were used only for verification and diagnosis; all repository writes were performed through the GitHub connector.

This report update is a documentation-only HEAD change. Per project policy, final completion still requires a workflow run whose `head_sha` exactly equals the PR current HEAD after this report commit. The PR conversation records that final exact-head result without causing another source commit.

## Diagnostics and CI policy

`.github/workflows/ci.yml` already wraps commands with `tools/run-ci-command.mjs` and uploads failure diagnostics containing test results, stdout, stderr, combined logs, environment information, generated outputs and source/test files. No additional diagnostic workflow was required.

CI is used only for verification/diagnostics and was not used to update code.

## Files and evidence

Detailed per-finding evidence is stored in:

- `reports/2026-09-05-pr108-product-001-fix.md`
- `reports/2026-09-05-pr108-product-002-fix.md`
- `reports/2026-09-05-pr108-product-003-fix.md`
- `reports/2026-09-05-pr108-product-004-fix.md`
- existing PRODUCT-005 commit/test evidence

No merge was performed.

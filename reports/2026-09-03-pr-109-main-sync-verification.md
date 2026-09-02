# PR #109 main同期・再検証レポート

Date: 2026-09-03
Repository: `ssaattww/RevMem`
Pull request: #109 `Fix PR Progress comparison base for #107`
Branch: `issue-107-pr-progress-branch-point`

## 1. 目的

利用者の指示に基づき、PR #109へ最新 `main` を取り込み、Issue #107の変更と最新mainの変更を同一HEAD上で再検証した。

## 2. 同期前の状態

- PR HEAD: `b5f7fc4bb725fc38b9610521303f04b9305d9a22`
- PR base SHA: `d2ebe6d3cdb878dfbf46a4b9e46bd86de7162299`
- 最新main: `669805326849a9d749b2ddb8bc85cba717e4e629`
- mainはPRの旧baseから1 commit進んでいた。
- main commit: `Issue #110: T609 Extension Hostのencoding切替待ちを解消する (#111)`

## 3. 失敗診断artifact契約の再確認

更新後branchの `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を再確認した。

各CI commandは `test-output/ci` へ stdout、stderr、combined log、result JSONを保存する。failure時には `test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、`tools/`、設定およびworkflowを `ci-failure-diagnostics-*` artifactへuploadする。

したがって今回も診断workflowの追加変更は不要だった。

## 4. main取り込み

mainとの差分は次の4 pathだった。

- `reports/2026-09-02-issue-110-t609-extension-host-speed-report.md`
- `test/unit/t404-review-followup-r3.test.ts`
- `test/unit/t609-gate-wiring.test.ts`
- `test/vscode/t609-suite/index.ts`

このうち `test/unit/t404-review-followup-r3.test.ts` はPR #109側でも変更されていた。

両側の変更を旧base `d2ebe6d3...` と比較したところ、どちらも「月跨ぎ時にhistory eventを単一の `events-YYYY-MM.jsonl` 固定読みにせず、複数月のhistory filesを列挙・sortして連結する」同じ回帰修正だった。PR #109側の実装は同じ要件を満たしているため、その内容を保持して競合を解消した。

main側のT609高速化2ファイルとIssue #110レポートはmainのblobをそのまま取り込んだ。

作成した2-parent merge commit:

- merge HEAD: `4ac1a19a24f5f8cfbeb36ed34cc23ecd7442a34a`
- first parent: `b5f7fc4bb725fc38b9610521303f04b9305d9a22` (PR #109)
- second parent: `669805326849a9d749b2ddb8bc85cba717e4e629` (main)

同期後のcompare結果は `main -> 4ac1a19...` が `ahead`、`behind_by=0`、merge baseも `669805326...` となり、最新mainを完全に包含していることを確認した。PRは `mergeable=true` へ戻った。

## 5. 更新後HEADでの再検証

対象は必ず更新後PR HEADとworkflow runの `head_sha` が完全一致するrunだけとした。

- technical HEAD: `4ac1a19a24f5f8cfbeb36ed34cc23ecd7442a34a`
- matching pull_request CI run: `33685365734`
- run number: `4111`
- status: `completed`
- conclusion: `success`
- run `head_sha`: `4ac1a19a24f5f8cfbeb36ed34cc23ecd7442a34a`

成功した主なgate:

- Build
- Contract typecheck
- Architecture validation / negative contract
- Lint
- Unit tests
- T602 / T603
- T403 / T404 / T405 / T406
- T304 PR progress tree tests
- T502 / T503 / T504 / T505 / T506
- T604 / T605 / T606
- T609 repository and encoding tests
- T610 folder Global Understanding tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests
- user validation package / artifact upload

特に、競合解消対象のT404、Issue #107の主要経路であるT405/T406/T304、およびmainから取り込んだT609はすべて同一runでsuccessだった。

## 6. User validation artifact

run `33685365734` のartifact:

- artifact ID: `9868058326`
- name: `review-range-user-validation-d9ab11d675be2d76c5549e5bc6e1dca0c37e31ac`
- digest: `sha256:fc6606bf94467845f938f583fab015f69b15f4b7f079eb1059ce65da8c70be69`
- artifact workflow `head_sha`: `4ac1a19a24f5f8cfbeb36ed34cc23ecd7442a34a`
- expired: false

artifact名のSHAはpull_request workflowの `GITHUB_SHA`（GitHubが生成するPR merge ref）に由来するが、workflow runおよびartifact metadataの `head_sha` はPR branch HEAD `4ac1a19...` と一致している。

## 7. TDD / 変更境界

今回の追加作業は新規機能実装ではなく、既にGreenであるPR #109へ最新mainを統合する作業であるため、新しいproduction変更に対するRedテストは追加していない。Issue #107本体のRed/Green証跡は既存report `reports/2026-09-01-issue-107-pr-progress-branch-point.md` に保持されている。

今回追加された機能差分はmain由来のみで、#107のproduction semanticsは変更していない。

## 8. 完了境界

本reportは上記technical HEAD `4ac1a19...` とそのmatching CIを記録するadministrative reportである。本report保存commitによりPR HEADが再度変わるため、完了判定は本report保存後のcurrent PR HEADと完全一致するpull_request CI runを再確認し、そのrun ID / conclusionをrepository内容を変更しないPRコメントへ記録する。

mergeは利用者が行うため実施しない。

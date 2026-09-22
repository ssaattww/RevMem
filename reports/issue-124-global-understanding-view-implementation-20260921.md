# Global Understanding View 改善 実装レポート

## メタデータ

- report type: implementation report
- generated at: 2026-09-21T17:15:50+09:00
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- implementation technical HEAD: `c3931612700d683cdea1c05ab30fc6e79008592a`
- execution environment: FA780 / Windows / PowerShell / RDC
- working directory: `C:\Users\donabe\Project\RevMem-issue124`

## 目的と範囲

Issue #124 の3要求を対象とした。
1. `running` folder rowをspinner表示する。
2. folder actionを現在状態ではなく、クリック後に行う`開始`/`停止`/`再開`として表示する。
3. path列挙済みだがcontent evidence未収集のfileも一覧へ残し、分母を推測せず未収集・未計算として表示する。

repository-wide file本文scanの復活、folder scope semanticsの変更、mergeは非対象とした。
## 実装

- `global-understanding-source.ts`
  - 既存path enumerationの`availablePaths`を`discoveredFilePaths`としてsnapshotへ公開した。
  - line progressは従来どおりcontent evidenceがあるfileだけで計算する。
  - 表示対象pathのopen targetを生成し、pathはcode-unit順で安定化した。
- `global-understanding-ui-model.ts`
  - `discoveredFilePaths`を追加し、line progressとは別契約にした。
  - content evidenceがないpathを`uncollected` file nodeへ投影し、descriptionを`未収集`とした。
  - incremental treeもdiscovered path数を基準にbounded stageを構築する。
- `vscode-global-understanding-runtime.ts`
  - 未収集file tooltipを`状態: 未収集` / `理解率: 未計算`とした。
  - `running`は`loading~spin`、`stopped`はpause、failed/partialはwarningとして描画する。
  - folder command titleをactionごとの`開始`/`停止`/`再開`へ変更した。
- `package.json`
  - 3 folder commandへaction名とinline iconを付与した。
- 設計書16.5へ、path-only fileを本文追加読込なしで未収集/未計算表示する契約を追記した。

## TDD証拠

実装前に対象テストを追加・拡張し、57件中4件のRedを確認した。
- discovered fileがUI modelから消える。
- source snapshotにpath-only一覧がない。
- running folderがwarning iconになる。
- command contributionが長い状態説明でiconを持たない。
実装後は同じfocused実行で57/57 Greenとなった。

追加・更新した主なテスト:
- `test/unit/global-understanding-ui.test.ts`
- `test/unit/t505-global-understanding-source.test.ts`
- `test/unit/t610-folder-understanding.test.ts`

## ローカル検証

成功:
- `npm run build`
- `npm run lint`
- `npm run typecheck:contracts`
- `npm run validate:architecture`
- `npm run validate:architecture:negative`（expected 11 findings一致）
- focused 57/57
- `npm run test:t610`: 75/75
- `npm test`: exit code 0。unit、Git、GitHub、T502、VS Code Extension Hostの全required phaseを完走した。

`npm run test:t607`は84/87だった。失敗3件は次の既存test:
- production VS Code Global runtime fences partial publication on invalidate and dispose
- production Global runtime supersedes old/new refreshes and gives each feedback operation one terminal
- IFR002 actual Global source/recalculator and Review Contexts provider

同じ3件だけをclean `origin/main` worktree、HEAD `eb8dc52f1c329a5768c263a8773289c9865f5dd4`で再実行し、3/3同一失敗を確認した。#124変更起因の成功扱いには変換せず、baseline failureとして記録する。

## CI診断契約

作業開始時に`.github/workflows/ci.yml`を確認した。既存workflowはcommand stdout/stderr/combined/result metadataを`test-output/`へ保存し、失敗時にsource/test/tools/環境情報とともにartifact uploadする。したがって追加workflow変更は不要と判断した。

## 変更していない領域

- folder scope controllerの状態遷移規則
- repository-wide本文scan禁止契約
- PR Progress
- review state persistence schema
- workflow
- breaking-change document

## 残存事項とリスク

- `test:t607`の既存Windows baseline failure 3件は本PRでは修正しない。
- remote CIはこのreport/tracking/handoffを含む最終commit push後に、PR #125 current HEADとrun head SHAの完全一致を確認して判定する。
- 別SHAのworkflow runは代用しない。

## 次の操作

1. report/tracking/handoff commitを作成し、そのexact HEADでfull local gateを再実行してからpushする。
2. PR #125のcurrent HEADをGitHub connectorで再取得する。
3. 同じHEAD SHAのrequired pull_request CIだけを確認する。
4. 結果を簡易reportとしてPRコメントへ投稿する。
5. mergeは利用者が行う。

# Sub-agent実行レポート

## タスク

T609 独立レビュー IFR005 の Extension Host fixture を、仮想 URI 境界の二つの公開コマンドだけ局所 10 秒タイムアウトから外し、single-root フェーズ所有の 300 秒起動期限で評価する。対象 HEAD は `ac1b01a659351941eda0be39ad2f1aba4e9b2f33`。

## sub-agentを使う理由

実装者（terra high）が、親のレビュー・コミット・GitHub 操作と分離して、最小の fixture/test 回帰とローカル Host 証拠を収集するため。

## 対象範囲

`assertActualUriBoundaries` 内の `reviewRange.refreshContext` と `reviewRange.refreshReviewContexts` の await、ならびにその fixture 契約テストのみ。実際の VS Code Uri（file/query/fragment/untitled/remote）判定、公開コマンド、仮想ドキュメントの open/close は保持した。

## 対象外

本番コード、設計書、timeout/sleep 値、Review Context 実装、レビュー、コミット、push、CI、GitHub、進捗追跡、履歴ファイルは変更・実行していない。

## 実行コマンド

Red: `npm run compile:test; if ($LASTEXITCODE -eq 0) { node --test test-dist/test/unit/t609-gate-wiring.test.js }` は新契約に対して 21/22 pass、既存の局所 `within` により 1 fail。

Green: 同コマンドは 22/22 pass。`npm run test:t609` は 72/72 pass。`npm run build`、`npm run compile`、`npm run lint`、`git diff --check` は各一回 pass（diff check は CRLF 変換警告のみ）。

最終一回: `npm run test:t609:extension-host` は 247.4 秒で fail。`t609-single-root` は `close shift-jis.txt` の局所 10 秒 timeout で中断し、fixture cleanup は succeeded。診断は `test-output/vscode-launch-diagnostics/t609-single-root-1787374264365.json`。

Markdown: `tools/lint/` と Markdown 用 npm script は存在せず、report の repo-local Markdown wording lint は unsupported と記録する。

## 対象ファイル

`test/vscode/t609-suite/index.ts`: 仮想 URI の公開 Current Context/Review Contexts コマンドを直接 await 化。

`test/unit/t609-gate-wiring.test.ts`: 二コマンドが局所 wrapper を使わず、runner の 300 秒期限に委譲される契約を追加し、既存期待を直接 await へ更新。

`reports/issue-81-t609-independent-review-followup-r22-host-20260822133518.md`: 本レポート。

## 指摘事項

R22 の fixture-only 要件は focused と T609 unit gate で Green。Red→Green 証拠もある。

ただし最終 Host は single-root の実行中、`assertLiveEncodingTransition` における `close shift-jis.txt` が 10 秒で timeout した。仮想 URI 境界の実コマンド、live encoding の Context/Global changed-only/unaffected 全断言、restart の persisted Context/Global、prepare multi-root の既存全フェーズには未到達であり、完了扱いにできない。Host 再試行はしていない。

## 提案内容

次の限定 follow-up では、`closeDocument` が Shift-JIS encoding transition で close event を待てない原因を診断し、実際の公開/Host 経路を維持した決定的な fixture 完了条件を作る。その後、未到達の Host セルを一回の最終実行で再評価する。

## 未解汾事項

Host failure の根本原因は未解決。R22 technical workspace は未コミットで、HEAD は開始時の `ac1b01a659351941eda0be39ad2f1aba4e9b2f33` のまま。PR、CI、tracking、review verdict は親が扱う。

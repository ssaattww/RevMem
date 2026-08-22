# Sub-agent実行レポート

## タスク

- 目的: IFR005のrestart-reopenで、未再openのShift-JIS state identityがrevision遷移時に欠落する原因を修正する。
- タスク種別: 独立レビューfinding follow-up実装（R28）

## sub-agentを使う理由

- 理由: ユーザー指定の実装担当terra/highへ、再起動時revision mappingの欠落だけを限定委譲するため。

## 対象範囲

- 対象: restart load、revision遷移、encoding hint非再利用、immutable text取得不能時のContext/Global identity、最小回帰、local gate、actual Extension Host単回検証。

## 対象外

- 対象外: 設計変更、tracking/PR body、レビュー、commit、push、CI待機、merge、IFR001〜004/006の再探索、削除ファイルの誤保持、timeout延長やsleep追加。

## 実行コマンド

- 実行コマンド: Red: `npm run compile:test; node --test test-dist/test/unit/t609-revision-mapping-encoding.test.js`（追加回帰が `undefined !== []` で失敗）。Green: 同コマンド（6/6 pass）。`npm run test:t609`（77/77 pass）、`npm run build`、`npm run lint`、`git diff --check`（すべて pass）。最後に `npm run test:t609:extension-host` を timeout 900000ms で一回だけ実行（606.1秒、pass）。

## 対象ファイル

- 変更または確認したファイル: `src/application/review-context/git-context-revision-mapper.ts`、`test/unit/t609-revision-mapping-encoding.test.ts`、この予約レポート。Host diagnostics: `test-output/vscode-launch-diagnostics/t609-single-root-1787381959763.json`、`test-output/vscode-launch-diagnostics/t609-prepare-1787382171633.json`、`test-output/vscode-launch-diagnostics/t609-restart-reopen-1787382206398.json`、`test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787382207202.json`。

## 指摘事項

- 指摘要約または「指摘なし」: revision進行時のmapperは、diffで未変更のShift-JIS fileについてhintなしの`invalid-encoding`（blobの存在は証明済み）を`missing-file`と同様にdropしていた。Context/Globalとも、未変更かつimmutable text unavailableのときだけstable identityを新revisionへ残しreviewed intervalを空にして、privacy-safeな`immutable-text-unavailable`を記録する。直接変更されたunsupported file、`missing-file`の削除、binary、rename/new、whitespace/EOLの既存fail-closed/mapping契約は保持する。

## 結果

- 結果: focused Red→Green、T609 local、build、lint、diff check、actual Extension HostがGreen。Host phaseは`t609-single-root`、`t609-prepare`、`t609-restart-reopen`、`vscode-fixture-cleanup`の全てsucceeded。restart-reopenはBOMのみを再openしShift-JIS hintを再利用せず、persisted Context/GlobalのShift-JIS identityをempty reviewed intervalで保持した。IFR005はready。commit、push、CI、review verdict、mergeは未実施。

## リスク

- 未解決のリスクまたは後続対応: Markdown lintは`tools/lint/`および`lint:md` scriptがなくunsupported。これはpassではない。変更は未commitで、pushとcurrent-HEAD CIは未実施。自己reviewは実施していない。

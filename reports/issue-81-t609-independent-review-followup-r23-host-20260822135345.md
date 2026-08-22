# Sub-agent実行レポート

## タスク

T609 IFR005 の Extension Host fixture に限り、Shift-JIS 文書を閉じる際に無関係な UTF-8 BOM 文書まで閉じないようにする R23 を実施した。対象は `40ba28e8f920e55977c0314dabf46e341b101215` 上の未コミット変更である。

## sub-agentを使う理由

親エージェントの指示により、production には触れず、fixture の最小修正とローカル検証だけを分離して行うため。

## 対象範囲

`test/vscode/t609-suite/index.ts` の `closeDocument` と、それを守る `test/unit/t609-gate-wiring.test.ts` の静的契約。対象 URI と一致する `TabInputText` だけを閉じ、実際の `onDidCloseTextDocument` を待機する。

## 対象外

production 実装、設計書、timeout/sleep、CI、GitHub、追跡ファイル、コミット、push、review は変更しない。既存の全エディタを閉じる helper は他フェーズ用として変更しない。

## 実行コマンド

- Red: `npm run compile:test`、`node --test test-dist/test/unit/t609-gate-wiring.test.js`。新規契約が旧 `closeAllEditors` 実装を検出し 22 pass / 1 fail。
- Green: `npm run compile:test`、`node --test test-dist/test/unit/t609-gate-wiring.test.js`。23/23 pass。
- Focused: `npm run test:t609`。73/73 pass。
- `npm run build`、`npm run lint`、`git diff --check` は pass。後者は既存の LF/CRLF 警告のみ。
- Extension Host: `npm run test:t609:extension-host` を一回だけ実行。373.5 秒で fail。再試行なし。
- Markdown: `tools/lint/` と `lint:md` script は存在せず、`npm run lint` は TypeScript の ESLint のみ。Markdown 専用 lint は unsupported と記録する。

## 対象ファイル

- `test/vscode/t609-suite/index.ts`: `closeDocument` が `vscode.window.tabGroups.all` から `TabInputText` かつ URI 完全一致の tab を一件取得し、`vscode.window.tabGroups.close(targetTab)` を一回だけ実行する。close event listener は成功時と例外時の双方で dispose する。ローカル 10 秒 wrapper と `closeAllEditors` は使わない。
- `test/unit/t609-gate-wiring.test.ts`: 対象タブ一致、単一 close、実 close event 待機、無関係 BOM 文書を保つライブ遷移、広域 close 禁止を静的に検査する R23 契約を追加する。
- 本レポート。

## 指摘事項

Host 実行の single-root phase は `assertLiveEncodingTransition` まで到達した。`closeDocument(shifted)` は timeout せず、以前の対象であった close timeout は再現しなかった。一方、encoding を `utf8` に変更して再オープンした後、`shift-jis.txt` の reviewed interval は期待した `[]` ではなく `[{ startLine: 0, endLineExclusive: 1 }]` のままだった。診断は `test-output/vscode-launch-diagnostics/t609-single-root-1787375498491.json`。fixture cleanup は succeeded。これは R23 の対象外であり、IFR005 は ready/incomplete のままである。

## 提案内容

対象タブを厳密に閉じる修正は維持する。次の bounded follow-up は、実際の encoding configuration change と再オープン後に interval clear が走らない理由を診断し、対象の production/fixture 境界を親エージェントが決めること。Host はこの R23 では再実行しない。

## 未解汾事項

Markdown 専用 lint が未構成のため unsupported。R23 は commit/push/CI/GitHub/tracking を行っていない。唯一実行した Host は失敗であり、IFR005 の全 semantic matrix と closure review は未完了。

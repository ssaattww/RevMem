# Sub-agent実行レポート

## タスク

T609 IFR005 R15: Windows の Git EOL 正規化により Host fixture が EOL-only Git 差分を失う問題を、実 Git blob で再現・固定し、最終 Extension Host 検証を一回実施する。

## sub-agentを使う理由

実装・テスト実行はユーザー指定の terra high サブエージェントが担当し、親はレビュー、コミット、push、CI、GitHub 操作を分離するため。

## 対象範囲

`test/vscode/run-extension-host.ts` の T609 fixture Git local config、同一 production composition の小さな実 Git EOL 回帰、ならびに focused/static/Host 検証。

## 対象外

プロダクション実装、設計書、タスク追跡、PR、レビュー、commit、push、CI 待機、既存履歴レポート。Host の再試行もしない。

## 実行コマンド

Red: local `core.autocrlf` を設定しない実 Git fixture で `git show HEAD:eol.txt` が `LF` となり、期待した `CRLF` blob assertion が失敗した。

Green: `npm run compile:test; node --test test-dist/test/unit/t609-host-rename-decoration-composition.test.js` は 2/2 pass。新規 raw EOL fixture と既存の 1-file rename decoration composition が通過した。

Focused: `npm run test:t609` は 66/66 pass。

静的検証: 先行 batch は executor 外側 timeout で個別結果未判定となったため、盲目的な同一 batch 再試行ではなく、未完 cell を分離取得した。`npm run build` exit 0 (42.8s)、`npm run compile` exit 0 (40.4s)、`npm run lint` exit 0 (61.2s)、`git diff --check` exit 0。後者は Windows line-ending warning のみ。

最終一回: `npm run test:t609:extension-host` は exit 1 (304.3s)。`t609-single-root` は成功、`t609-prepare` は `seed multi-root Current Context` の 10 秒 timeout、後続 cleanup は 10 秒 timeout。再試行なし。

## 対象ファイル

`test/vscode/run-extension-host.ts`: fixture repository に local `core.autocrlf=false` と `core.eol=lf` を設定し、ユーザーの global Git config に依存せず CRLF blob を commit する。

`test/unit/t609-host-rename-decoration-composition.test.ts`: old LF blob、new CRLF blob、working text を actual Git command/readFile で検証する小規模回帰を追加。既存 rename decoration composition の lifecycle は変更しない。

診断: `test-output/vscode-launch-diagnostics/t609-prepare-1787365645309.json`、`test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787365656259.json`。

## 指摘事項

確定した原因は fixture の Git 正規化であり、production mapping option の欠落ではない。既存 `t609-revision-mapping-encoding` と T609 focused suite が whitespace/EOL mapping を、既存 1-file composition が production decoration lifecycle を担当する。R15 の追加回帰は raw committed transition の決定性だけに限定した。

## 提案内容

IFR005 は ready-incomplete。EOL fixture は解消したが、最終 Host の public `reviewRange.refreshContext` が multi-root prepare phase で settle しない。次の作業者は上記 diagnostic の `seed multi-root Current Context` を対象に、同一 command 実行の再試行ではなく、command composition の未解決 Promise の原因を最小診断で確定する必要がある。

## 未解汾事項

[sub-agent記入]

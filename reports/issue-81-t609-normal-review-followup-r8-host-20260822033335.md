# Sub-agent実行レポート

## タスク

- 目的: NR-006 の Extension Host fixture 構築を Host 外へ移し、exact `--t609` の single-root timeout を解消する。
- タスク種別: 限定 implementation follow-up。

## sub-agentを使う理由

- 理由: 親から委譲された実装・検証の証跡を、予約済み R8 report へ限定して記録する。

## 対象範囲

- 対象: T609 runner による primary/second-root の Git fixture と encoding 設定の起動前構築、Host suite の fixture 消費専用化、契約 gate、指定された focused validation。

## 対象外

- 対象外: production code、timeout 延長・固定 sleep、full suite、tracking/design/workflow、review、commit、push、CI、GitHub 操作。

## 実行コマンド

- Red: `node --experimental-strip-types --test test/unit/t609-gate-wiring.test.ts` を1回実行し、runner の `prepareT609Fixture` 不在で新規契約1件が fail（既存2件は pass）。
- Green: 同一 source gate を実装後に実行し3/3 pass。
- Static: `npm run compile:test`、`npm run build`、`npm run lint`、`git diff --check` を各1回実行し pass。diff-check は既存変更対象の CRLF 警告のみ。
- Exact Host: `node test-dist/test/vscode/run-extension-host.js --t609` を1回実行。`t609-single-root` は succeeded、`t609-prepare` は `mark Shift-JIS review` の10秒 timeoutで failed。再試行していない。
- Markdown lint: `tools/lint/` の repo-local wiring と `lint:md` script が存在しないため unsupported。

## 対象ファイル

- 変更: `test/vscode/run-extension-host.ts` は runner parent で primary fixture、second-root Git repository、`.vscode/settings.json` と `.code-workspace` の `files.encoding` を起動前に構築する。
- 変更: `test/vscode/t609-suite/index.ts` は Host 内の workspace configuration 更新、file write、Git init/config/add/commit を除去し、事前構築済み fixture を使用する。
- 変更: `test/unit/t609-gate-wiring.test.ts` は runner-prepares/Host-consumes-only contract を追加する。
- 生成確認: `dist/**` と `test-dist/**` は build/compile:test で current source に更新した。report 以外の既存 user changes は保持した。

## 指摘事項

- source finding NR-006 の原因候補であった single-root `prepare Git fixture` timeout は解消し、single-root phase が exact Host で succeeded した。
- 新たに `t609-prepare` phase の `mark Shift-JIS review` timeout が露出した。診断は `test-output/vscode-launch-diagnostics/t609-prepare-1787337685839.json`。本限定 scope では追加修正・追加 Host 実行を行わない。

## 結果

- 結果: Red/Green と static checks は pass。exact Host は fail（single-root pass、prepare fail）。NR-006 ready は incomplete。
- target: branch `task/issue-81-repository-encoding`、technical HEAD `1c925c9b66a98e1772918de31110ea2649bbc725`、commit/push/CI は未実施。

## リスク

- 残リスク: prepare phase の `mark Shift-JIS review` timeout は未解決であり、multi-root stale/cancel、restart-reopen、44/44 `test:t609`、full local equivalence、matching CI、review verdict は未証明。
- 次アクション: 本診断を別の限定 follow-up として調査し、必要な修正後に exact `--t609` を新たな許可の下で再実行する。

# Sub-agent実行レポート

## タスク

T609 IFR005 Host public command unresolved の限定実装。review/commit/push/CI/GitHub/tracking/design/historical reports は行わない。

## sub-agentを使う理由

親エージェントから、既知の UTF-8 BOM public command 未完了を Test Host 限定で調査・実装・検証するよう委譲されたため。

## 対象範囲

`ExtensionMode.Test` の public normal-editor command は state commit 後に automatic decoration refresh を待たず resolve し、既存 T609 fixture が production decoration controller の explicit refresh、drain、interval assertion を担当する。production default は applied 後に refresh を一回 await する。

## 対象外

IFR001-004/006、production command/service/session/state-event の意味、fixture の direct mark、timeout/sleep、review/commit/push/CI/GitHub/tracking/design/historical reports は未変更。

## 実行コマンド

Red: `npm run compile:test` (exit 1; defer option 未実装)。Green: `npm run compile:test` と `node --test test-dist/test/unit/normal-editor-review-command-registration.test.js test-dist/test/unit/normal-editor-decoration-controller.test.js` (19/19 pass)。Static: `npm run build`、`npm run lint`、`git diff --check` (all pass)。Host exact one-shot: `npm run test:t609:extension-host` (exit 1; retryなし)。Markdown focused lint は `tools/lint/` と `lint:md` wiring が存在しないため unsupported。

## 対象ファイル

`src/extension.ts`、`src/ui/normal-editor/review-command-registration.ts`、`src/ui/normal-editor/index.ts`、`test/unit/normal-editor-review-command-registration.test.ts`、`test/unit/normal-editor-decoration-controller.test.ts`、本レポート。

## 指摘事項

Test-mode-only option `deferAppliedDecorationRefresh` を added。production default applied は refresh 一回を await する。Test mode の public registration は applied state path と error capture contract を維持しつつ refresh 0 で resolve する。unit regression は production await、Test public handler の refresh 0、explicit refresh 後の split-editor interval を確認する。

## 結果

IFR005: incomplete。exact Host は `t609-single-root` で Shift-JIS/UTF-8 BOM を通過後、`mark mapping seed whitespace.txt public command` が 10秒 timeout。`vscode-fixture-cleanup` も10秒 timeout。diagnostics: `test-output/vscode-launch-diagnostics/t609-single-root-1787352810277.json`、`test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787352821222.json`。IFR001-004/006 は unchanged。

## リスク

Host failure は whitespace mapping-seed public command に残る。automatic refresh との重複完了境界は UTF-8 BOM を含む先行 fixture で解消されたが、後続 mapping-seed の未完了と cleanup timeout は別途原因特定が必要。Markdown lint wiring 未提供のため focused Markdown lint は unsupported。

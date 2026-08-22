# Sub-agent実行レポート

## タスク

Issue #81 / T609 IFR005 の単一 Extension Host failure を、公開 `reviewRange.markSelectionReviewed` 経路のまま診断可能にする限定調査・実装。

## sub-agentを使う理由

親が予約した worktree と report を保持し、実装・focused validation・単回 Host 実行の証跡をこの sub-agent が担当するため。

## 対象範囲

`NormalEditorCommandHost` の ExtensionMode.Test 限定 failure capture、`src/extension.ts` の read-only diagnostic API、公開 command を呼ぶ T609 fixture、対応 unit test。IFR005 の Host failure cell のみ。

## 対象外

IFR001–004 の code、IFR006 の parent PR body、tracking/design/historical reports、review、commit、push、CI、timeout 延長、fixed sleep、Test-only direct seam への置換。

## 実行コマンド

Red 試行: source TypeScript を Node で直接実行する経路は extensionless ESM import 解決で起動前に失敗し、targeted transpile は 64 秒で timeout。Green: `node node_modules\\typescript\\bin\\tsc -p tsconfig.test.json; node --test test-dist\\test\\unit\\normal-editor-review-command-registration.test.js test-dist\\test\\unit\\t609-gate-wiring.test.js`（15/15 pass）。`npm run build` pass。`npm run lint` pass。`git diff --check` pass。単回 `npm run test:t609:extension-host` は fail、retry なし。Markdown 専用 lint wiring は未検出。

## 対象ファイル

変更: `src/ui/normal-editor/review-command-registration.ts`、`src/extension.ts`、`test/unit/normal-editor-review-command-registration.test.ts`、`test/vscode/t609-suite/index.ts`。診断: `test-output/vscode-launch-diagnostics/t609-single-root-1787352051846.json`。本予約 report。

## 指摘事項

Test mode では wrapper が operation と actual error を同期 capture し、`showErrorMessage` を await せず original error を throw する unit contract は Green。production UI は既存のまま。Host では capture が未発火で、single-root の Shift-JIS mark は通過後、UTF-8 BOM の public mark Promise が未解決のまま 10 秒 timeout。failure cell は public command 内の session open / commit / snapshot / decoration refresh の未分離区間で、raw error はない。fixture cleanup は succeeded。

## 結果

IFR005 は incomplete。Test-mode error UI wait は今回の failure cause ではないと確定したが、actual composition の未解決 stage は未特定。Host は指定どおり 1 回だけで再実行禁止のため、最小次候補は public command 内の session-open、commit、snapshot、decoration-refresh completion を production composition 上で個別に read-only signal 化して次の許可済み run で識別すること。IFR001–004 code unchanged。IFR006 parent PR body already updated。

## リスク

Host failureは未解決であり、IFR005を ready と扱えない。追加した Test-only capture は public command が reject した場合だけの診断で、今回の未解決 Promise の stage signal にはならない。technical HEAD は未commit の `677e4b54aa4c3186475355dfe265547e24595967` を親として維持し、push/CI evidence はない。

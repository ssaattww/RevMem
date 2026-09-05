# Sub-agent実行レポート

## タスク

- 目的: PR #113のblocking scopeを実測Redと更新済みレビュー報告に沿って最小修正する
- タスク種別: review follow-up implementation

## sub-agentを使う理由

- 理由: 複数module境界のreview follow-upをユーザー指定terra/highの実装担当へ継続委譲するため

## 対象範囲

- 対象: PR113-NR-002〜005のproduction修正と、必要な場合に限る既存最小テストの整合

## 対象外

- 対象外: 複数window調査、二重refresh最適化、汎用Abort/generation基盤、全特殊文字matrix、設計刷新、後続finding、commit、push、merge

## 実行コマンド

- 実行コマンド: テストは実行していない。非テスト診断として`git diff --check`を実行し、空白エラーがないことを確認した。

## 対象ファイル

- 変更または確認したファイル: `src/t405-pr-review-projection-sync.ts`、`src/t405-pull-request-review-runtime.ts`、`src/ui/pr-progress/vscode-pull-request-progress-tree.ts`、`src/t305-extension.ts`、`src/extension.ts`、既存追加testの`test/unit/issue-112-pr-review-projection-sync.test.ts`および`test/vscode/t302-suite/index.ts`、required unit gateへ2 suiteを登録した`package.json`、本レポート。

## 指摘事項

- 指摘要約または「指摘なし」: Redで確認済みのNR-003/004を最小修正した。NR-002はsource切替後の非同期装飾publishを抑止し、fire-and-forgetの失敗を既存`reportError`境界へ接続した。NR-005はreview diffのrouting、command、pair、side、session、provider境界をcanonicalな`Uri.toString()`へ統一した。

## 結果

- 結果: durable mutation成功後のderived projectionは各々を試行し、失敗を個別報告しても`applied`を維持する。working-tree openはactive snapshot内のnodeだけを受理する。特殊pathのURIはdisplay形式でなくcanonical形式で各PR review境界を通過する。`test:unit`の明示リストへ2つのblocking regression suiteを追加し、required unit gateの実行対象にした。

## リスク

- 未解決のリスクまたは後続対応: focused Green、lint、更新後required unit gate、全test matrix、actual Extension Host、Linux CIは未実行である。`toString(true)`を保持した通常documentのcache/forget/test lookupはreview diff identityではないため対象外とした。PR113-NR-001、006、008〜010も対象外のままである。

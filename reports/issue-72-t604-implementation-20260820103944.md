# T604 implementation report

## タスク

T604 / Issue #72 — cross-window storage lock and bounded cleanup。branch は `task/t604-storage-lock-cleanup`、base/current HEAD は `96057f9edc95a8f38bfc01da39eae350c29e9c39`。実装は完了し、通常review待ちです。

## sub-agentを使う理由

使用しない。依頼でsub-agent禁止であり、対象は既存state/history/snapshot/cache adapterを横断する一つのcoherent実装である。

## 対象範囲

同一storage rootのleased filesystem lock、expired lock recovery、state full-snapshot CASのcross-window直列化、JSONL append直列化、cache generationとsnapshotのbounded cleanup、privacy-safe lock diagnostic、root外とlink/junction/reparse traversalの拒否。`test:t604`を追加した。

## 対象外

T605/T606以降のremote/multi-root、一般容量policy、history UI/export/expiry、CI実行、commit、push、PR、merge、自己review。

## 実行コマンド

Red: `npm run test:t604` は新API未exportでcompile失敗。Green: `npm run test:t604`（6/6 pass）。追加検証: `npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check`。すべて成功。Markdown word checkは`tools/lint/`と`lint:md`が存在しないためunsupportedとして記録する。CIは方針により未実行。

## 対象ファイル

`src/adapters/state-repository/storage-root-lock.ts`、state repository contracts/index/validated/history adapter、GitHub cache adapter、non-Git snapshot adapter、`test/unit/t604-storage-lock-cleanup.test.ts`、`package.json`、design、README、task/phase tracking、handoff、本report。

## 指摘事項

設計書15章を更新した。lockはopaque tokenとleaseだけをroot内に保存し、live lockを奪わずexpired lockだけを回復する。公開diagnosticにはoperationのkindだけを出し、path、repository ID、source、tokenは出さない。互換性を壊す公開contract変更はないため`Design/BreakingChanges.md`は未変更。

## 結果

local TDD Red→実装→Greenと指定の静的検証が完了。T604は実装完了・通常review待ち。commit/push/PR/merge/CIは未実行。

## リスク

実際の別OS processをspawnする検証、reparse pointを作成するWindows固有fixture、full CI/Extension Hostは本taskのローカル検証範囲外。leaseを超えて停止したownerは意図どおりstaleとして回復対象になる。

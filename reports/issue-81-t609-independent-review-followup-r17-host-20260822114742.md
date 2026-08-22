# Sub-agent実行レポート

## タスク

T609 / IFR005 の R17 Host フィクスチャ修正。R16 で確認した、Git 遷移の装飾検証が最後に開いた `eol.txt` を active editor のまま Current Context の複数 root 選択へ進ませていた状態を解消する。

## sub-agentを使う理由

実装と検証を分離し、指定されたフィクスチャ限定の TDD と一回限りの Extension Host 実行結果を親へ渡すため。

## 対象範囲

`test/vscode/t609-suite/index.ts` と `test/unit/t609-gate-wiring.test.ts` のみ。Git 遷移装飾の確認直後、`setCurrentContextSelectionForTest("first")` の直前に既存の `closeAllEditors` を呼び、active editor がない複数 Git root 状態で public Current Context command を実行する。

## 対象外

製品コード、設計書、timeout/sleep、CI、GitHub、タスク追跡、過去レポート、commit、push、レビューは変更していない。

## 実行コマンド

- Red: `npm run compile:test; node --test test-dist/test/unit/t609-gate-wiring.test.js` — 18 件中 17 pass / 新規 1 fail。新しい順序 assertion が未修正 fixture で失敗した。
- Green: 同コマンド — 18/18 pass。
- `npm run test:t609` — 68/68 pass。
- `npm run build` — pass。
- `npm run compile` — pass。
- `npm run lint` — pass。
- `git diff --check` — exit 0。Windows の LF/CRLF 警告のみ。
- `npm run test:t609:extension-host` — 一回のみ実行し fail。`t609-single-root` の `mark UTF-8 BOM public command` が 10 秒で timeout。retry はしていない。cleanup phase は succeeded。multi-root と restart-reopen は未実行。

## 対象ファイル

- `test/vscode/t609-suite/index.ts`: マッピング検証後に既存の bounded `closeAllEditors` を呼ぶ。
- `test/unit/t609-gate-wiring.test.ts`: 上記の順序を固定する TDD regression assertion。
- 本レポート。

## 指摘事項

R16 の selection request count 0 は resolver の不具合ではなく、EOL mapping fixture が active editor を残したためだった。本変更は active editor を閉じ、既存の workspace-root readiness を保ったまま multi-root Quick Pick cancel / stale / post-pick 検証を到達可能にする。

ただし一回限りの Host 実行は single-root の UTF-8 BOM public mark timeout で停止した。R17 の multi-root selection 修正の成否を Host 全体では確認できていない。

## 提案内容

IFR005 は `ready-incomplete`。親はこの R17 の fixture-only diff を checkpoint commit/push した後、single-root public mark の未解決 timeout を別の最小 follow-up として診断する。Host は今回の実行を再試行しない。

## 未解汾事項

single-root で `mark UTF-8 BOM public command` が未完了になる原因。診断は `test-output/vscode-launch-diagnostics/t609-single-root-1787367700968.json` に残る。R17 では production path と timeout/sleep を変更しない制約のため未解決のまま保持する。

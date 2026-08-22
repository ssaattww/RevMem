# Sub-agent実行レポート

## タスク

- 目的: IFR005のactual Host前段で、public markが保存した実Current ContextをTest観測APIが正しく参照できるようにする。
- タスク種別: 独立レビューfinding follow-up実装（R25）

## sub-agentを使う理由

- 理由: ユーザー指定の実装担当terra/highへ、原因と検証境界を限定して委譲するため。

## 対象範囲

- 対象: T609 Test-mode read-only Git state snapshot、実際の選択contextとの整合、最小回帰、focused/local static gate、actual Extension Host単回検証。

## 対象外

- 対象外: productionの通常動作変更、設計変更、tracking/PR body、レビュー、commit、push、CI待機、merge、IFR001〜004/006の再探索。

## 実行コマンド

- 実行コマンド: Red: `npm run compile:test` と `node --test test-dist/test/unit/t609-gate-wiring.test.js` は既存23件pass、追加snapshot-owner gate 1件だけfail（`selectedContext?.kind === "pull-request"` 不在）。Green: 同じ command は24/24 pass。`npm run test:t609`: 75/75 passed（内部 `compile:test` passed）。`npm run lint`: passed。`git diff --check`: passed（LF/CRLF warningのみ）。Markdown lintは `tools/lint/` と `lint:md` が存在せずunsupported。最終 `npm run test:t609:extension-host` は1回だけ実行し、内部 `build`/`compile:test` はpassed、single-root はfailed、cleanup succeeded（357.1秒）。

## 対象ファイル

- 変更または確認したファイル: `src/t305-extension.ts`: Test modeのread-only snapshotがCurrent Contextのrepository/root/revision所有を検証し、selected pull-requestならそのrepository/contextIdをload targetに使い、branch/detachedは検証済みGit context、workspaceはfail-closedにした。通常production modeの挙動は変更していない。`test/unit/t609-gate-wiring.test.ts`: selected ownerをread-only loadし、mutation APIを使わないgateを追加。`test/vscode/t609-suite/index.ts`、`test/vscode/run-extension-host.ts`、R24 report、state provider、repository routing、Current Context composition、Debounced repositoryを確認。本レポート。

## 指摘事項

- 指摘要約または「指摘なし」: 既存snapshot APIはdocument inspectionから常にGit branch targetを再構築していたため、Current Contextがpull-requestならpublic markと別owner/contextIdを読む余地があった。R25はこのTest-only観測経路をCurrent Context ownerへ揃え、workspace/branch/detached/pull-requestの扱いを明示し、loadのみとした。しかしactual single-root Hostは変更後も同じ `persisted state must contain shift-jis.txt` で停止した。Host出力には選択identityが含まれないため、この仮説を直接確定または否定するための実owner観測は後続scopeに残る。

## 結果

- 結果: focused Red→Green、T609 local suite、lint、diff checkはGreen。exact Hostは単回で `t609-single-root` の `assertLiveEncodingTransition` 初期snapshot（`shift-jis.txt`欠落）に失敗し、`vscode-fixture-cleanup`はsucceeded、prepare/restart-reopen phaseは未到達。IFR005 ready/incomplete判定はincomplete。

## リスク

- 未解決のリスクまたは後続対応: single-root public markの実際の永続contextをbranch snapshotが読めない根本原因は未解決であり、Current Context owner mismatch以外（command/sessionのcontext生成またはstate visibility）を別の許可済みfollow-upで観測・最小Red化する必要がある。Hostは本R25では再試行していない。commit、push、CI/GitHub操作、merge、design/tracking更新は未実施。Markdown lintはrepository wiring不在のためunsupported。

# Sub-agent実行レポート

## タスク

- 目的: activation を重い startup Global Understanding 計算の完了待ちにせず、Test mode では同じ startup work を明示 drain できるようにし、T610 Host の停止位置を再検証する。
- タスク種別: bounded normal-review follow-up implementation (R13 Host startup drain)

## sub-agentを使う理由

- 理由: R12 が `context-ready` より前の activation/startup boundary timeout を示したため、R9 startup helper の non-blocking registration と Test-only drain を最小範囲で検証する。

## 対象範囲

- 対象: `src/t305-extension.ts` の startup Global work registration/rejection containment/Test drain、`test/vscode/t610-suite/index.ts` の activation 後 drain、T610 static/behavior regression、本 report。

## 対象外

- 対象外: design/tracking/history、review、commit/push/CI、timeout/sleep 増加、Host retry、R13 範囲外の production/Test、全体 gate。

## 実行コマンド

- Red: `npm run compile:test; node --test test-dist/test/unit/t610-folder-understanding.test.js` は compile process が実行 wrapper の 64.3 秒上限で中断された後、生成済み focused artifact で 30/31 pass・1 failure だった。failure は `drainStartupGlobalUnderstandingForTest` 未実装のみである。
- Green: `npm run compile:test`、`npm run test:t610`（56/56 pass）、`npm run test:t305`（60/60 pass）、`npm run build`、`npm run lint`、`git diff --check` は pass。diff check は LF-to-CRLF conversion warning のみで whitespace error はない。
- Exact Host: `REVIEW_RANGE_VSCODE_LAUNCH_TIMEOUT_MS=900000 node test-dist/test/vscode/run-extension-host.js --t610` を一回だけ実行した。`t610-initial` は 900000ms で timeout、`t610-restart` は未到達、`vscode-fixture-cleanup` は succeeded。retry は 0 回。

## 対象ファイル

- 変更または確認したファイル: `src/t305-extension.ts` は startup helper promise を activation から await せずに登録し、rejection を active Output diagnostic へ report して Test mode の fulfilled drain promise を保持する。`test/vscode/t610-suite/index.ts` は `extension.activate()` 後かつ最初の marker/assert 前にその drain を await する。`test/unit/t610-folder-understanding.test.ts` は immediate registration/one eventual refresh、non-await、Test drain、Host ordering を固定する。本 report を更新した。R2 closure、R8/R9/R12 reports、T305 helper/current-context queue、Host patterns を read-only で確認した。

## 指摘事項

- 指摘要約または「指摘なし」: production activation は startup `observe`/refresh completion を await しない。startup promise は rejection を unhandled にせず `reportActiveOperationFailure("Global Understanding startup", error)` へ渡す。Test mode だけがその contained promise を API に公開し、Host suite が current-context refresh、最初の `context-ready` marker、fixture document open より前に drain する。R13 static+behavior contract は Green だが、exact Host は persisted subphase が unavailable のまま activation/startup boundary で timeout したため、根因を startup helper completion に限定または解消できていない。

## 結果

- 結果: **incomplete**。technical HEAD は `419ca288db122764345139904a135e840f1472b0` の uncommitted worktree。exact diagnostic は `test-output/vscode-launch-diagnostics/t610-initial-1787419121090.json`（owned worker PID 24360、Extension Host PID 22400、termination requested、persisted subphase unavailable）と `test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787419121937.json`（succeeded）。initial failure/restart not reached/cleanup succeeded を一回の Host run で記録した。commit/push/CI は未実施。

## リスク

- 未解決のリスクまたは後続対応: R13 は activation completion から startup calculation を外し、Test drain を導入したが、initial Host は依然 first suite marker 前に 900 秒で停止する。次回は retry ではなく、新たに許可された activation-entry instrumentation または activation 前の VS Code boundary 診断で startup helper より外側の停止箇所を区別する必要がある。Markdown wording lint は `tools/lint/` と `lint:md` wiring がないため unsupported であり pass ではない。full local equivalence、exact-head CI、normal-review closure、independent review/attestation、merge は未実施。

# Sub-agent実行レポート

## タスク

- 目的: T609専用Extension Hostのmulti-root cancellation timeoutを決定的同期へ修正しNR-006をclosure-readyにする
- タスク種別: bounded fixture diagnosis・test fix・exact verification

## sub-agentを使う理由

- 理由: freshなterra highが保存診断とT609 fixtureだけを読み、再実行連鎖を避けて単一blockerを閉じるため

## 対象範囲

- 対象: `t609-prepare` multi-root cancellation boundary、関連runner/test-only synchronization、exact `--t609` evidence

## 対象外

- 対象外: production core、他unit/gate、tracking/design/README、full suite、remote CI、commit、push、review verdict、merge

## 実行コマンド

- 実行コマンド: 保存済みdiagnostic・T609 fixture・runner・VS Code 1.130 API type definitionをread-only確認後、`npm run compile:test`を1回実行（pass）。続けてcache済みrunnerで`node test-dist/test/vscode/run-extension-host.js --t609`をcurrent contentに対して1回だけ実行（fail）。full suite、`test:t609`、static suite、download、remote CI、commit/push/PR/review/merge、再実行は実施していない。

## 対象ファイル

- 変更または確認したファイル: `test/vscode/t609-suite/index.ts`（二根初期workspaceを前提とする第三root追加、`added` URI一致eventとfolder列の明示同期）、`test/vscode/run-extension-host.ts`（T609専用の二根`.code-workspace` launch target）、本report。production core、NR-001〜005/007差分、package/CI gate、tracking/design/他reportsは未変更。

## 指摘事項

- 指摘要約または「指摘なし」: 保存diagnosticのtimeoutは`within("multi-root cancellation boundary", ...)`内の`workspaceChanged`待機で発生した。listenerは`updateWorkspaceFolders`より前に登録されているが、専用Hostは単一folderで起動しており、二根目追加はsingle-folderからmulti-rootへの遷移となる。この遷移ではVS Code APIが実行中Extension Hostを再起動し、`onDidChangeWorkspaceFolders`を発火しないため、listenerは解決されず10秒でtimeoutした。Quick Pick/cancellation assertionには到達していない。初期起動を二根workspaceにし、listener登録後に三根目を追加してeventの`added` URI一致を待機し、workspace folder列にも追加済みであることを確認してからcancel/stale triggerを実行する。

## 結果

- 結果: `npm run compile:test`はpass。exact Host `node test-dist/test/vscode/run-extension-host.js --t609`はfail。保存済みfailureのmulti-root cancellation boundary timeoutは解消対象として同期を置換したが、二根で開始したcurrent contentではその直前の`no-active-editor Current Context`がambiguous-root Quick Pickを表示して解決せず10秒timeoutした。`t609-prepare`はmulti-root cancellation assertionへ未到達であり、`restart-reopen` phaseも未到達。NR-006はincomplete。

## リスク

- 未解決のリスクまたは後続対応: 新しいexact diagnosticは`test-output/vscode-launch-diagnostics/t609-prepare-1787336330966.json`。二根初期化によりCurrent Context commandのno-active-editor pathが実Quick Pickを待機することが未解決blockerである。指示により追加修正・追加Host実行・diff-checkは行っていない。NR-006のready evidence、restart/reopen Host evidence、full local equivalence、remote CI、commit/push/review verdict/mergeは未実施。

# Sub-agent実行レポート

## タスク

- 目的: T610 の actual Extension Host lifecycle で、R5 で残った fixture cleanup timeout を、production behavior を変えずに解消する。
- タスク種別: bounded normal-review follow-up implementation (R6 cleanup)

## sub-agentを使う理由

- 理由: parent 指定の狭い Host cleanup worker として、保存済み diagnostic と所有済み runner/suite だけから原因を確定し、許可された一回の Host evidence を記録するため。

## 対象範囲

- 対象: T610 runner/suite、owned Extension Host launch diagnostic、owned cleanup helper の unit wiring、本 report。

## 対象外

- 対象外: production runtime behavior、T305/T505 source、design/tracking/history、review、commit、push、CI、Host retry、timeout 値または sleep の変更。

## 実行コマンド

- 実行コマンド: Red は `npm run compile:test` 後の `node --test test-dist/test/unit/t610-folder-understanding.test.js` で、新規 T610 teardown contract が未実装のため 1 failure（既存 16 pass）。Green は `npm run test:t610` が 41/41 pass。`npm run build`、`npm run lint`、`git diff --check` は pass。`npm run test:vscode-runner` は既存 `success-without-close` の 250ms worker-start race が `failed` 期待に対し `timed-out` となり 6/7 pass・exit 1（この path は本変更で未変更）。exact Host は outer timeout 960s で `node test-dist/test/vscode/run-extension-host.js --t610` を一回だけ実行し、258.4s・exit 0。再実行なし。

## 対象ファイル

- 変更または確認したファイル: `test/vscode/t610-suite/index.ts` は T610 が開いた `src/a.ts` の tab を finally で閉じ、private `onDidCloseTextDocument` listener を event/finally の双方で dispose する。`test/vscode/owned-extension-host-launch.ts` は phase ごとの `ownedWorkerPid` と worker stdout の `ownedExtensionHostPids` を diagnostic へ記録し、termination helper が task-owned worker PID の tree のみを対象とすることを明記する。`test/unit/t610-folder-understanding.test.ts` と `test/unit/owned-extension-host-launch.test.ts` は teardown/PID contract を固定する。本 report を更新した。

## 指摘事項

- 指摘要約または「指摘なし」: R5 保存 diagnostic は initial worker PID 24308/Host PID 25148 と restart worker PID 22448/Host PID 23436 がいずれも exit 0 である一方、cleanup worker PID 21676 は stdout/stderr 空のまま 10s timeout だった。live process query では残存 process はなかった。T610 suite は shown document を明示的に閉じず、T609 の既存成功 pattern と異なっていた。R6 はその suite-owned document/listener を確実に解放し、各 phase の ownership を diagnostic で識別可能にした。one-shot result は initial worker 24016/Host 9936、restart worker 13688/Host 23752、cleanup worker 7948（Host PID なし）の全て succeeded、termination `not-needed`、cleanup 10s 内 exit 0。

## 結果

- 結果: `ready`。technical HEAD は `08ebed8e50cf8800509a55c7e3f40e3b3350a274`（未commit）。T610 teardown/PID contract は Red→Green、focused T610、build、lint、diff check は pass。指定された exact Host は一回だけ実行され、`t610-initial`、`t610-restart`、`vscode-fixture-cleanup` の全 phase が succeeded した。diagnostic は `test-output/vscode-launch-diagnostics/t610-initial-1787405596062.json`、`test-output/vscode-launch-diagnostics/t610-restart-1787405631028.json`、`test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787405631785.json`。

## リスク

- 未解決のリスクまたは後続対応: `npm run test:vscode-runner` の `success-without-close` は、本 scope と無関係な 250ms deadline race により今回も failed/timed-out classification が不一致である。timeout/sleep を変更しない制約のため修正せず、actual T610 cleanup success を否定する evidence ではない。Markdown wording check は `tools/lint/` と `lint:md` wiring が存在せず `unsupported`。commit/push/CI/review/merge は未実施。

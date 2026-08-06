# Sub-agent実行レポート

## タスク

- 目的: T306 default Extension Host runnerの終了問題を、既存suiteの実行回数を増やさずに診断・最小修正する。
- タスク種別: 実装フォローアップ

## sub-agentを使う理由

- 理由: 親agentからrunner限定の原因調査、修正、有限timeout検証、予約レポート記入を委譲されたため。

## 対象範囲

- 対象: `test/vscode/run-extension-host.ts`だけ。T306、T302、既存3-phase lifecycle suiteのworkspace、user-data、extensions directoryを隔離し、lifecycle 3 phase内だけ永続状態を共有する。

## 対象外

- 対象外: T306受入試験内容、`src/extension.ts`、`package.json`、tracking、CI workflow、product code、unit/Git/static suite、commit、push、PR、merge。

## 実行コマンド

- 実行コマンド:
  - `npm run test:t306`（修正直後）: compile error。`launchArgs`が必要とするmutable配列にreadonly配列を渡していたためTS4104。runnerだけを最小修正した。
  - `npm run test:t306`（残留VS Code process存在時）: 64秒timeout。前回cancelled runが残した`.vscode-test`配下のVS Code root processを診断した。
  - `npm run test:t306`（残留test process終了後）: pass、10.9秒。T306専用workspace/profile/extensionsでExtension Hostがcode 0終了した。
  - `npm run test:vscode`: failed/Held。有限120秒でtimeout。T306/T302の後、lifecycle `confirm` のExtension Host root processが終了せず、run 31066886820 / job 92506355723と同じ終了不能状態を再現した。成功扱いにしていない。
  - `git diff --check`: pass。

## 対象ファイル

- 変更または確認したファイル:
  - `test/vscode/run-extension-host.ts`: suite群別のworkspace/profile/extensions隔離を追加。各suiteはdefaultで一度だけ、`--t306`ではT306だけを実行する既存契約を維持した。
  - `reports/issue-1-t306-extension-host-runner-followup-20260806115832.md`: 本レポート。

## 指摘事項

- 指摘要約または「指摘なし」: 共有workspaceではT306がlocal Git fixtureを作成し、後続lifecycle suiteがGit化済みworkspaceを開いていた。旧runner logではT306/T302のExtension Hostはterminateした一方、lifecycle confirmはactivate後にterminate messageへ到達しなかった。隔離はこの汚染を除去したが、lifecycle confirmの終了不能自体は残った。

## 結果

- 結果: focused `test:t306`は成功した。default `test:vscode`は120秒timeoutのfailed/Heldで、runner終了問題は未解決である。timeout後の残留test VS Code root processを対象path確認後に終了し、以後のworktree検証を妨げない状態へ戻した。commit/push/PR/mergeは未実施。

## リスク

- 未解決のリスクまたは後続対応: default lifecycle confirmがVS Code root processを終了できない原因はrunner隔離だけでは解消していない。次の対応では、lifecycle suite内の停止地点を追加診断で特定し、有限timeout時にchild process treeを確実に終了できるrunner制御を検討する必要がある。本フォローアップではscopeとコスト制約により追加の全suite再実行を行わない。

# Sub-agent実行レポート

## タスク

T609 / IFR005 の R14。multi-root Extension Host fixture が single-root fixture と同じ Git mapping settings を渡すことを、fixture-only で検証・補正する。

## sub-agentを使う理由

親は進行管理を担当し、実装・TDD・ローカル検証は独立した implementation sub-agent が担当する運用である。

## 対象範囲

`test/vscode/run-extension-host.ts` の T609 multi-root `.code-workspace` fixture と、それを固定する `test/unit/t609-gate-wiring.test.ts` のみ。workspace settings に `files.encoding`、`reviewRange.ignoreWhitespaceChanges`、`reviewRange.ignoreEolChanges` が各1回ずつ存在することを検査する。

## 対象外

production code、設計書、timeout/sleep/command path、CI、GitHub、task tracking、commit/push、review、および過去 report は変更しない。Host の再試行もしない。

## 実行コマンド

- Red: `npm run test:t609` は 65件中64 pass、追加 test が `reviewRange.ignoreWhitespaceChanges` 不在で fail。
- Green: 同コマンドは 65/65 pass。
- Static: `npm run build`、`npm run compile`、`npm run lint`、`git diff --check` は各1回 pass。`git diff --check` は CRLF 変換予告 warning のみ。
- Exact Host one-shot: `npm run test:t609:extension-host` は exit 1。`t609-single-root` は success、`t609-prepare` は EOL-only mapping assertion failure、後続 `vscode-fixture-cleanup` は timeout。再試行なし。

## 対象ファイル

- `test/vscode/run-extension-host.ts`: multi-root workspace file settings に二つの mapping option を追加。
- `test/unit/t609-gate-wiring.test.ts`: workspace settings の3キーが各1回であることを検査する Red/Green regression。
- 本 report: 実行証跡のみ。

## 指摘事項

R14 の前提どおり workspace file に設定がなかったことは Red で確認でき、追加後の source-level fixture gate は Green になった。しかし実 Host では `t609-prepare` の `assertMappedGitTransitions` が EOL-only Git transition を未保持として fail した。diagnostic は `test-output/vscode-launch-diagnostics/t609-prepare-1787363988263.json`。この一回の実行だけでは VS Code multi-root composition が workspace file settings を production mapping option まで反映しない原因は確定できず、IFR005 の actual Host semantic matrix は未完了である。

## 提案内容

この最小 fixture change は checkpoint 候補である。次の bounded follow-up は、Host configuration の実効値と workspace/folder setting precedence を診断して、原因を一つに確定してから行う。R14 では retry、production/design 変更、command path 変更をしない。

## 未解汾事項

IFR005 は ready-incomplete。single-root mixed encoding は今回の one-shot で通過したが、multi-root prepare の rename/new/whitespace/EOL transition matrix と cancellation/restart の後続 phase は未到達、cleanup も timeout である。Markdown wording check は repository に `tools/lint/`、`lint:md`、cspell/prh wiring がないため focused/full とも unsupported（held）。最終 technical HEAD は開始時の `de7db74aadede798a012b0bba226a1e07140f31c` のまま、作業treeには上記2 test 変更と本 report が未commitである。

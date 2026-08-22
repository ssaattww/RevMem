# Sub-agent実行レポート

## タスク

- 目的: T609 Test-mode selection APIをactual extension exportへ接続し専用Host phaseを完了する
- タスク種別: bounded test API wiring・exact verification

## sub-agentを使う理由

- 理由: 同じterra highが一意なmissing exportだけを修正し、追加調査や再実行連鎖を避けるため

## 対象範囲

- 対象: Test-mode API export wiring、compile、exact `--t609`

## 対象外

- 対象外: production behavior、core findings、fixture再設計、full suite、CI、commit、push、review、merge

## 実行コマンド

- 実行コマンド: R5 failure、`package.json` entry、`tsconfig.test.json`、`tsconfig.json`、`src/t305-extension.ts`、`src/extension.ts`、`dist/t305-extension.js`、`test-dist/src/t305-extension.js`をread-only確認した。compile/test/runnerは実施していない。`compile:test`はR5で1回実施済みだが、R6の有効なcurrent candidateを生成できないため同じHost実行を消費していない。

## 対象ファイル

- 変更または確認したファイル: 本reportのみ。`src/t305-extension.ts`にはR5でTest-mode `setReviewContextsRepositorySelection`が追加済みであり、`test-dist/src/t305-extension.js`にも出力済みである。一方、package entryの`dist/t305-extension.js`は旧出力でmethodを含まない。`src/extension.ts`は現在のpackage entry activation chain外であるため未変更。fixture/runner/core/package/CI/tracking/design/他reportは未変更。

## 指摘事項

- 指摘要約または「指摘なし」: actual chainは`package.json`の`main: "./dist/t305-extension.js"`からTest-mode return APIへ至る。R5の`npm run compile:test`は`tsconfig.test.json`により`test-dist`だけを更新し、VS Code development extensionが読む`dist/t305-extension.js`を更新しない。従ってsource/Test-output側にはmethodがあってもHost API exportには現れず、R5 TypeErrorと一致する。`src/extension.ts`はこのpackage entry chainに接続されていないため、そこへのtype/composition追加だけではmissing exportを解決しない。

## 結果

- 結果: incomplete。R6で許可された`compile:test`だけではactual entrypointへTest-mode APIを出力できず、修正を有効化するには禁止されたsource compile (`dist`更新)、runner/package routing変更、またはgenerated `dist`直接編集のいずれかが必要となる。矛盾を黙って解決せず、追加修正・runner再実行・diff-checkは実施していない。NR-006はincomplete。

## リスク

- 未解決のリスクまたは後続対応: 既存exact failure diagnosticは`test-output/vscode-launch-diagnostics/t609-prepare-1787336719892.json`。R6のnext actionには、actual Host entrypointを更新するための明示的なauthority（source compileまたはtest-only entry routing、generated artifact更新の可否）が必要である。NR-006 ready evidence、restart/reopen evidence、full local equivalence、remote CI、commit/push/review verdict/mergeは未実施。

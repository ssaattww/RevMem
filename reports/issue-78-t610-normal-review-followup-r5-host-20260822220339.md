# Sub-agent実行レポート

## タスク

- 目的: R4 で確定した T305 repository-root-to-workspace-URI identity の Windows canonicalization 不備を最小修正し、T610 の initial → restart → cleanup Host lifecycle を一度だけ検証する。
- タスク種別: bounded normal-review follow-up implementation (R5 Host)

## sub-agentを使う理由

- 理由: parent 指定の狭い Host worker として、R4 diagnostic の controller 前 source-root 解決を T305/source identity に限定して修正し、許可済み one-shot Host evidence を固定するため。

## 対象範囲

- 対象: T305 `resolveRepositoryRootUri` の workspace-side Windows path identity、remote authority を保持する source identity helper、その regression test、既存 T610 Host fixture、固定 report。

## 対象外

- 対象外: SelectedContext contract の拡張、T505/controller/enumerator/runtime仕様、design/tracking/history、review、commit、push、CI/GitHub、Host retry、cleanup実装の変更。

## 実行コマンド

- 実行コマンド: TDD Red は `npm run compile:test` が helper 未解決の `TS2307` で fail。Green は `npm run compile:test` と `node --test test-dist/test/unit/t305-repository-root-uri.test.js` が 2/2 pass。`npm run test:t610` は 41/41 pass、`npm run test:t305` は 60/60 pass、`npm run build`、`npm run lint`、report 編集前の `git diff --check` は pass。Host は `node test-dist/test/vscode/run-extension-host.js --t610` を outer timeout 960秒で一度だけ実行し、`t610-initial` と `t610-restart` は succeeded、`vscode-fixture-cleanup` は runner 内10秒timeoutで fail。Markdown word check は `tools/lint/` と `lint:md` が存在しないため `unsupported`。

## 対象ファイル

- 変更または確認したファイル: `src/t305-extension.ts` は raw `path.resolve` equality を T305 helper に置換し、T609 `workspaceUriToFilesystemPath` を通過した workspace folder のみを渡す。`src/t305-repository-root-uri.ts` は Windows/Posix の workspace-side path containment、workspace URI eligibility、unique match、元 URI identity の返却を実装する。`test/unit/t305-repository-root-uri.test.ts` は Windows case/separator、remote authority 保持、ambiguous multi-root fail-closed を固定する。`test/vscode/t610-suite/index.ts` と runner fixture は確認のみで変更していない。本 report を更新した。

## 指摘事項

- 指摘要約または「指摘なし」: R4 の source refresh `undefined` は、T305 が `path.resolve(folder.uri.fsPath) === path.resolve(repositoryRoot)` で raw filesystem string を厳密比較したため、Windows の drive/path case または separator の差で workspace URI を見つけられず、T505 `scopeRoot()` が controller 前に return したことによる。R5 は workspace-side `path.win32`/`path.posix` の relative containment で repository root を含む workspace を選び、T609 の既存 URI→filesystem boundary と T605 workspace URI eligibility を再利用した。複数候補は fail-closed で `undefined` とし、唯一候補では scheme/authority/path を変更せず返す。Host initial/restart は successful で、R4まで未到達だった snapshot publish、stop/resume、watcher、final stop、runner mutation、stopped-only restartを通過した。最終 cleanup のみ runner 内10秒で timeout し、stdout/stderr は空だった。

## 結果

- 結果: `incomplete`。T305 root identity の Red→Green、focused T610/T305、build、lint は Green。one-shot Host の functional phases `t610-initial` と `t610-restart` は Green だが、同一一回の command は `vscode-fixture-cleanup` timeout により exit 1 である。Host retry は実施していない。診断は `test-output/vscode-launch-diagnostics/t610-initial-1787404485167.json`、`test-output/vscode-launch-diagnostics/t610-restart-1787404520052.json`、`test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787404531507.json`。

## リスク

- 未解決のリスクまたは後続対応: next exact stopping point は、別の明示許可scopeで `vscode-fixture-cleanup` の10秒timeout（exit 1、stdout/stderr empty）を read-only に分離し、必要なら runner cleanup を最小修正して新たな one-shot Host authority で再検証すること。本R5 scopeではretryもcleanup修正も行わない。Markdown terminology gate は repo-local `tools/lint/`/`lint:md` wiring 不在で `unsupported` のまま。commit/push/CI/review/merge は未実施。

# Sub-agent実行レポート

## タスク

- PDS-09: 実Extension HostでPR差分の設定と左右表示同期を検証する。
- 開始HEAD: `466ce7137706c1b4ea8ac44c86fb7fd1f9e02005`、PR #120、base main。

## sub-agentを使う理由

- 利用者指定のterra high担当が実装・検証を行う。

## 対象範囲

- test/vscodeと必要最小限の製品UI接続、既定検証経路への組込み。

## 対象外

- PDS-10全体gate、Issue #121、無関係な製品変更、コミット・push・merge。

## Dispatch profile

- selection inputs: implementation / bounded_technical / uncertainty medium / cross_module / criticality ordinary / sequential_dependencies / bounded_history。
- selection source: user_override。original requested gpt-5.6-terra / high / fork none。
- decomposition_policy forbidden。初回調査は既存 `/root/line_contract` を継続したが、実装未着手のまま2度終了したため、同じ要求profileのfresh workerへ引き継ぐ。調査結果は実装完了の証拠としない。
- default role unchangedの初回証拠を継承。planned_runtime_profile gpt-5.6-terra / high。
- applied null、final_profile_hidden。初回spawn_succeeded_profile_unverifiedを保持。
- application_status: spawn_succeeded_profile_unverified。新worker `/root/pds09_host`、requested: gpt-5.6-terra / high / fork none。ユーザー・repositoryのconfigにagents role overrideなし、公開spawn APIの明示model/effort引数を使用した。最終profileは非公開のためappliedはnullを維持。approval not_required、Astra not_applicable。
- report_persistence_mode normal_persistence。Dispatch profileは親所有。
- 100人全体で月1回以下の問題は頻度根拠と影響を記したIssueのみとする利用者方針を適用。

## 実行コマンド

- `node tools/run-ci-command.mjs pds09-compile C:/Windows/System32/cmd.exe /d /s /c "npm run compile:test"` — exit 0。開始HEAD `466ce7137706c1b4ea8ac44c86fb7fd1f9e02005` 上の最初のコンパイル証拠。
- `node tools/run-ci-command.mjs pds09-lint C:/Windows/System32/cmd.exe /d /s /c "npm run lint"` — exit 0。
- `node tools/run-ci-command.mjs pds09-host-boundary-final3 C:/Windows/System32/cmd.exe /d /s /c "npm run test:pr-diff-selection-mode:extension-host"` — exit 0。固定 VS Code 1.130.0 archiveを使う実Extension Hostの担当範囲と最終selection境界追加後の証拠。
- `node tools/run-ci-command.mjs pds09-host-default-final C:/Windows/System32/cmd.exe /d /s /c "npm run test:vscode"` — exit 0。既定Host経路に統合済みで、t306、t302、新規PR diff suite、lifecycle 3 phase が成功。
- `pds09-architecture`、`pds09-architecture-negative`、`pds09-vscode-runner` はすべてexit 0。architecture positive/negativeとHost runner discovery契約を確認した。
- 結果JSON・stdout・stderr・結合ログは `test-output/ci/pds09-{compile,lint,host-boundary-final3,host-default-final}.*`。成功Host診断は `test-output/vscode-launch-diagnostics/pr-diff-selection-mode-1789687191471.json` と `...-1789687216840.json`。
- 失敗証拠: `.../pr-diff-selection-mode-1789686620441.json` はfixtureのaddition hunk座標不整合、`...-1789686675300.json` は選択コンテキストを再読込するテスト用refreshによる表示確認失敗。後者は公開コマンド後の永続状態が正しいことを確認して、初期化済みPR runtimeを直接activateするテスト専用refreshへ置換した。`...-1789687079665.json` と `...-1789687110853.json` はcolumn 0境界で原側rendererが変更blockに加えて選択済みcontextを表示し得る既存mapping意味論を、永続rangeとの同一視で誤判定したテスト期待である。最終testは永続stateを厳密比較し、rendererには次変更行が未装飾であることを検証する。後続の同じ `pds09-host` wrapper result/logは再実行で上書きされたため、この4件は個別Host診断JSONを原証拠とする。
- 最終source fingerprint（SHA-256、final Host実行後に確認）: `package.json` `51982bcee335e231f7d989bfb0aa93f9d3a273697cfe41316db9453136f11c71`; `src/composition/extension.ts` `d3efc30e7e6acd045afc7bc6a282b1c96432c9757db5ecb85c20ec53eeadcd4c`; `src/extension.ts` `7a4b8c57496df737184bf962847ce31db303b697b20dd29b7ad2dd40de1d5288`; `src/ui/pr-progress/vscode-pull-request-progress-tree.ts` `84990831cb76211ff9ed0a2b9a07a10196cf06618d6a3ae9995287cfe5ffbb40`; `test/vscode/run-extension-host.ts` `3ec8ed53e8984eb7d2dba9c313d126cdc03c4a1c11f8e686fb127a90df63db56`; `test/vscode/pr-diff-selection-mode-suite/index.ts` `dff408e3668eb29bf3a5cc30caebedfd604d1eb36e1c6f49abe98cb246b0c6ac`。Windows PowerShell、Node `v24.20.0`、npm `11.19.0`、VS Code archive `1.130.0`。

## 対象ファイル

- `src/composition/extension.ts`: Test modeでのみ、immutable PR snapshot・対応する永続PR context・revision本文を登録し、構成済み `PullRequestReviewRuntime` のPR Progressをactivateする初期化/読取経路を追加した。
- `src/extension.ts` と `src/ui/pr-progress/vscode-pull-request-progress-tree.ts`: 実際のPR Progress Tree行と、rendererが左右のimmutable diff editorへ適用した装飾範囲をTest APIから読めるようにした。
- `test/vscode/pr-diff-selection-mode-suite/index.ts`: PR Progressから公開コマンドでdiffを開き、左右paneの公開mark/unmark、保存状態、Tree、装飾を検証するHost suiteを追加した。
- `test/vscode/run-extension-host.ts` と `package.json`: focused Host scriptを追加し、既定 `test:vscode` のdiscoveryへsuiteを組み込んだ。

## 指摘事項

- 新規の実Host能力テストを追加する前は、該当する構成済みPR runtimeのHost経路が存在しなかった。既存 `test:vscode --t506` は別の `LocalBaseHeadRuntime` であり、PDS09のPR evidenceではない。
- このため実装seamが新規testより先になった。既存動作が通る状況でRedを捏造していない。最初の実Host失敗はfixture座標、次はtest-only refreshのコンテキスト競合であり、いずれも製品欠陥ではない。

## 結果

- replacement、追加のみ、削除のみ、LF終端変更、Globalのみの状態不一致、context cursor境界、次変更行column 0終端の順方向/逆方向selectionを1つのimmutable PR snapshotで実行した。
- replacementは既定 `side` の元側1行確認、`block` の元側部分選択から左右全ブロック確認、先側公開解除を確認した。追加/削除は存在する側だけ、EOLは両側の実在content行、状態不一致はGlobalを公開markで修復した。
- 各mutation後に実永続Review State、実PR Progress Tree row、左右diff rendererの適用装飾を照合した。LocalBaseHeadRuntimeは使用していない。
- column 0境界では、永続originalは最初のblockだけ、modifiedは選択済みcontextを含む範囲になった。renderer側も両paneで次blockの変更行を装飾しないことを確認した。reverse selectionの公開unmarkは同じ対象を解除した。
- 実装・担当検証は完了。commit_pending / push_pending（親所有）。

## リスク

- 親のMarkdown検査: tools/lintとlint:md未構成のためfocused/fullはunsupported。今回も非blockingの記録とし、差分空白検査と通常レビューで本文を確認する。
- 初期化と状態読取は `ExtensionMode.Test` 以外では返却されず、initializer自体もTest modeを要求する。製品のPR取得・通常UI経路を置換しない。
- PDS-10の全体gate、独立レビュー、CI/公開判定は未実施で親の担当範囲である。

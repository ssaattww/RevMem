# Issue #131 / PR #132 実装報告

## 対象と目的
- Repository: ssaattww/RevMem
- Issue: #131
- PR: #132
- Branch: `chore/issue-131-publish-failure-diagnostics`
- 検証済み technical HEAD: `9d1eb76f282987d33f8393f04dfd89a368c98c06`
- Merge: 未実施

同一commitでCI/Publish結果が揺れないよう、短いwall-clock deadline・固定sleep・実時間timeout fixtureをrequired gateから分離し、T306等は状態/イベント/queue drainによる完了判定へ変更した。性能・timeout検証自体は削除しない。

## 作業開始時の診断artifact確認
先行commit `f6202ee` によりPublish failure diagnosticsは既に実装済みだった。release workflowは `tools/run-ci-command.mjs` でstdout/stderr/combined/result JSONを `test-output/ci` に保存し、failure時に環境情報、git status、生成物一覧、`test-output/vscode-launch-diagnostics/*.json` を含む `test-output/` をartifact uploadする。通常CIにも同種のfailure diagnosticsがあるため追加workflow変更は不要だった。

## 実装
- `test:timing-sensitive` を追加し、`owned-extension-host-launch`、`owned-temporary-directory-cleanup`、`node-git-blob-reader`、T606の25ms production timeout fixtureを開発時専用へ分離。
- required `test:unit` / `test:t302` / `test:t606` から上記fixtureを除外。
- T306、共通lifecycle、T506、T609、T506 concurrencyの短い `Promise.race` を除去。
- T506 workspace mappingはwall-clock pollingではなくdocument review edit / decoration queueのdrain後に状態確認。
- T604は50/60/1020ms固定sleepをchildのlock-acquired ready通知とstdin releaseへ置換。
- 異常停止用の大きいwatchdogは安全境界として維持。
- CI contractでtiming suite非配線、required suite混入禁止、deadline-free待機、CI/Publish共通base gateを固定。

## TDD
開始時に10ファイルのtask-owned未commit差分が存在していたため、その既存差分のRed-before-Green時系列は本セッションから独立証明できない。
監査中にrequired T606へ25ms実時間timeout fixtureが残る漏れを新規発見し、この部分は先にcontract testを追加した。Redは19件中18 pass / 1 fail。その後fixtureを `t606-production-timeout.timing.test.ts` へ分離し、Green 19/19を確認した。

## 検証
Focused:
- CI contract + T604: 39 pass / 0 fail
- `npm run test:timing-sensitive`: 8 pass / 0 fail / 2 skip
- `npm run test:t306`: Extension Host `status=succeeded`
- `npm run test:t506`: integration 3/3 pass、各Extension Host phase成功
- `npm run test:t609:extension-host`: exit 0
- `npm run test:t606`: 224 pass / 0 fail / 2 skip

technical HEAD `9d1eb76f282987d33f8393f04dfd89a368c98c06` でfinal local gateを再実行しexit 0。
- build: pass
- typecheck:contracts: pass
- architecture: pass
- architecture:negative: expected 11 violationsを検出してpass
- lint: pass
- `npm test`: pass（tooling 16/16、git 35 pass/3 skip、GitHub 48/48、T502 11/11、VS Code Extension Hostを含むdefault gate全体exit 0）

WindowsローカルでCI用 `run-ci-command.mjs` を連結実行した試行は即時exit 127・出力なしだったため、製品テスト失敗とは扱わず、同一項目を通常npmコマンドで再実行して上記Greenを確認した。

## Commit
- `f6202ee`: Publish failure diagnostics
- `c69a734`: main CI failure investigation report
- `a181325`: PR #132 normal review report
- `98d7bf8`: required CI gates deterministic化
- `9d1eb76`: obsolete 10秒timeout定数削除

remoteに `a181325` が追加済みだったためforce pushせず、その上へrebaseして通常pushした。

## CI
2026-09-29 19:28 JST時点でtechnical HEAD `9d1eb76f282987d33f8393f04dfd89a368c98c06` とhead SHAが一致するrunのみ確認。
- pull_request CI `36555381562`: in_progress
- push CI `36555375286`: in_progress

旧HEAD runは代用しない。report commit後は新しいPR current HEADに一致するrunを別途確認する。

## 外部確認と結論
Publish VSIX Packageはpull_requestでは起動しないため、PR上で実Publish failure artifact生成は未実施。workflow contractと定義で診断保存経路を検証した。

Issue #131の実装として、required CI/Publishから既知の時間依存fixtureを分離し、主要Extension Host経路を状態ベース待機へ変更した。開発時専用の性能/timeout検証と異常停止watchdogは維持。製品コードの挙動変更とmergeは行っていない。

# T404 実装レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T404
- Mode: initial implementation
- Branch: `feature/t404-pr-context-layers`
- Base: `main` / `112198c33823a5fc6681399a19e0c5361614143f`
- Pull Request: #48
- Reviewed implementation HEAD: `8b2de3b0657b5b1bd7094fa9efc0faaf88b02a34`
- Merge: 未実施

## 目的と範囲

GitHub host、owner、repository、PR番号を安定したcontext IDとし、base/head revision、open/closed/merged、PR別確認範囲を複数layerとしてExtensionの`globalStorageUri`配下へ保存する。

対象外はT405のReview Contexts View、layer切替、再検出、表示削除UI、closed PR diff表示である。

## 実装

- `src/application/github-pr-context/github-pull-request-context-layer-store.ts`
  - runtime非依存のPR context identity、lifecycle、revision、file interval contractを追加
  - `github-pr:<host>/<owner>/<repository>#<number>`形式の安定context IDを生成
  - full SHA-1/SHA-256、repository-relative path、interval、timestamp、schemaをfail closedで検証
  - closed/mergedでは装飾を既定で無効化
- `src/adapters/github/node-github-pull-request-context-layer-store.ts`
  - `globalStorageUri.fsPath`相当のabsolute pathを受けるNode adapterを追加
  - version 1 JSONで複数PR layerを保存
  - temporary file + renameによるatomic publication
  - 再起動後のlist/get復元とcontext単位removeを提供
- public indexを更新
- T404 unit testを追加
- CIへT404専用compile/testログを追加し、既存failure artifactへ保存

## TDD evidence

1. `58124757929214ed8a566b39d420b7b08355719a`
   - 実装前に`test/unit/github-pr-context-layer-store.test.ts`を追加
   - import先未実装のためRedとなる構成
2. `d987ec93500761e0b117ca4f44e233cc8bc300ba`以降
   - context layer implementationを追加
3. CI failure `31090559332`
   - application層の`node:fs/promises` importをarchitecture validatorが拒否
   - failure artifact `8963238742`を保存
4. application contractとNode adapterを分離
5. CI failure `31090721162`
   - test regexの不要escapeをlintが検出
   - failure artifact `8963309238`を保存
6. `8b2de3b0657b5b1bd7094fa9efc0faaf88b02a34`
   - lint修正後、exact-head CI `31090821677`がsuccess

## 検証結果

Exact implementation HEAD `8b2de3b0657b5b1bd7094fa9efc0faaf88b02a34`に対するCI run `31090821677`:

- Build: success
- Contract typecheck: success
- Architecture validation: success
- Architecture negative contract: success
- Lint: success
- Unit tests: success
- T403 tests: success
- T404 context layer tests: success
- T304/T502/T503/T504 tests: success
- Git integration: success
- Mock GitHub integration: success
- VS Code Extension Host tests: success

## 変更しなかった範囲

- `tasks/tasks-status.md` / `tasks/phases-status.md`: repository規則上、`task-breakdown-planner`、`task-consistency-manager`、`progress-sync-manager`経由のみ更新可能だが、今回のuploaded skill setに存在しないため未変更
- T405 UIとruntime composition: T404の非目標
- design document: rev4にT404要件が既に定義されており変更不要

## 残存リスク

- adapterは`globalStorageUri.fsPath`相当のabsolute pathを受けるが、Extension activationへのcompositionはT405または後続wiringで行う必要がある
- multi-process lock、generation cleanup、容量制限はT604の範囲
- detailed report追加後のfinal HEADについては、matching CIを別途確認する

## 次のアクション

通常reviewを別workerで実施する。利用者がmergeするまでmergeしない。

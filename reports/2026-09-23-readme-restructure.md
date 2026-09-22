# README 再構成 実装レポート

## メタデータ

- repository: `ssaattww/RevMem`
- branch: `docs/readme-restructure-20260923`
- base: `main`
- base HEAD: `df1501358be6ad0e6e03989ddc9e08f67a6e1996`
- README initial implementation commit: `a9c2be643b7c5d163090e91e4181b8f4a23f0fc6`
- README contract compatibility fix commit: `e4f10193e3799d975d8337be8ddd5e85f7d84cd5`
- PR: #127
- verification capability: `local_execution_available`
- execution environment: FA780 / PowerShell / Remote Desktop Commander
- worktree: `C:\Users\donabe\Project\RevMem-readme-restructure-20260923`

## 目的

READMEを利用者向けに読みやすく再構成し、主要機能、操作方法、各Viewの役割、確認状態の関係を短い導線で理解できるようにする。

図示が有効な箇所はMermaidを使用し、製品仕様・設定値は現在の実装と設計文書に合わせる。

## 対象範囲

- `README.md` の構成と文章の再編
- Context / Global / PR Progress / Global Understanding の関係の図示
- PR diff の `side` / `block` 選択モードの図示
- 現在の設定項目のREADMEへの反映
- 利用者向け制限事項と開発・CI情報の整理

## 対象外

- 製品コード、テスト、workflow、設定定義の変更
- 既存の製品仕様変更
- Issue / task status の変更
- Marketplace配布方法の変更
- merge

## 作業開始時のCI診断artifact確認

`.github/workflows/ci.yml` には失敗時の診断artifact保存が既に存在していたため、workflow変更は不要と判断した。

`tools/run-ci-command.mjs` は各CI commandについて次を `test-output/ci/` へ保存する。

- `<label>.stdout.log`
- `<label>.stderr.log`
- `<label>.log`
- `<label>.result.json`

CI失敗時には `Collect failure context` でenvironment、git status、生成ファイル一覧を追加し、`Upload failure diagnostics` が `test-output/`、生成物、source、test、tooling、設定ファイルをartifactとして保存する。

## 実施内容

### READMEの導線整理

旧READMEは「現状できること」に多数の機能、過去CIの状態、個別タスクの状況が連続しており、利用者が基本操作へ到達するまでに情報量が多かった。

新READMEでは次の順序へ再構成した。

1. 製品の目的
2. 現状できること
3. 全体像
4. インストール方法
5. 使い方
6. 4つのView
7. Context / Globalの仕組み
8. PRレビュー
9. Global Understanding
10. 保存と履歴
11. 設定
12. 制限
13. 開発・検証
14. 詳細仕様

### 図の追加

Mermaidを2点追加した。

1. 通常エディタ / PR diffの確認操作からContext、Global、PR Progress、Global Understandingへつながる全体像
2. `reviewRange.prDiffSelectionMode` の `side` / `block` の対象範囲

### 設定表の同期

`package.json` の現在のconfiguration定義と照合し、READMEの設定表へ次を含めた。

- `reviewRange.prDiffSelectionMode`
- `reviewRange.showGlobalReviewed`
- `reviewRange.ignoreWhitespaceChanges`
- `reviewRange.ignoreEolChanges`
- `reviewRange.showGutterIcon`
- `reviewRange.showOverviewRuler`
- `reviewRange.globalUnderstanding.autoStartDescendants`
- `reviewRange.diagnostics.detailed`
- `reviewRange.exclude`
- `reviewRange.maxSnapshotFileSizeBytes`

### 利用者向け情報と開発履歴の分離

旧README内にあった特定CI run、attestation HEAD、個別タスクIDの長い状態説明は基本導線から外した。

実装中タスクや既知課題は `tasks/tasks-status.md`、詳細な仕様は各design文書へ誘導する形に整理した。

## TDD / contract regression

当初のdocumentation-only再構成は製品挙動の実装変更ではないためTDD対象外とした。

最初のexact-head CIでREADME contract testの回帰が判明した後は、その失敗をRedとして扱った。`test/unit/release-vsix-contract.test.ts` を確認し、既存契約の見出し6件と `diff editor` / `GitHub PR` の明示記載を把握した上でREADMEだけを修正した。

修正後に `npm run compile:test` と `node --test test-dist/test/unit/release-vsix-contract.test.js` を実行し、8/8 passのGreenを確認した。

## 検証

### 構文・差分

- `git diff --check`: pass
- README変更以外の製品ファイル変更なし
- README内で追加・維持した相対リンクの存在確認: pass

確認したリンク:

- `doc/design/vscode-review-range-tracker-design.md`
- `Design/pr-diff-selection-mode.md`
- `doc/design/operation-diagnostics-and-refresh-scheduling.md`
- `doc/design/source-layout-and-ci-vsix-version.md`
- `tasks/tasks-status.md`

### README contract focused test

- Red: exact-head CI run `35784546717` / CI #4671、HEAD `cca8b2b3d745e22e49759d0c41b6b1ff96746b80`
- failure: `release-vsix-contract.test.js` が既存README見出し契約を検出
- diagnostic artifact: `ci-failure-diagnostics-35784546717-1` / artifact id `10719552894`
- Green: `npm run compile:test` + `node --test test-dist/test/unit/release-vsix-contract.test.js`
- result: 8 tests / 8 pass / 0 fail

失敗runは旧HEADに紐づくため、修正push後の最終CI判定には再利用しない。

### Markdown tooling

repositoryには次のMarkdown専用wiringが存在しない。

- `tools/lint/`
- `cspell.config.jsonc`
- `package.json` の `lint:md`

したがってMarkdown専用mechanical lintは `unsupported` と記録する。製品用の `npm run lint` は `src` / `test` を対象としており、README検証には使用していない。

### 文言セルフチェック

`document-wording-review` のauthor self-checkとして、旧READMEと新READMEを比較し、変更した人向け文章を全体確認した。

- Meaning: 製品仕様、設定値、主要制限の意味を維持
- Identification: UI名、設定キー、PR diff mode、VSIX artifact名を識別可能な形で維持
- Approved usage: repository固有の用語承認registryはREADME変更範囲では確認されていないためnot applicable
- Readability: 基本操作より前に過去CI詳細が入る構成を解消し、機能関係を表と図へ分離
- result: pass

## 意図的に変更していないもの

- `tasks/tasks-status.md`: 製品タスクの状態変更がないため未変更
- `package.json`: 設定定義自体は変更していない
- `.github/workflows/ci.yml`: 必要な失敗診断artifactが既に存在するため未変更
- source / test: documentation-onlyのため未変更

## 残る制約・リスク

- repositoryにMarkdown専用lint / rendererがないため、Mermaidの実レンダリングをローカル自動検証するgateはない
- CI結果は最終push後のcurrent HEADに一致するworkflow runのみを有効な証拠として扱う

## 次の操作

- 本reportをcommit / pushする
- PR #127のcurrent HEADと一致するpull_request CI runを確認する
- 変更内容と検証結果をPRコメントへ要約する
- mergeは利用者が行う

# T106 実装レポート

- Issue: #1
- Task: T106 通常エディタの確認済み装飾
- Branch: `task/t106-normal-editor-decoration`
- Pull Request: #10
- 作成日時: 2026-07-23 17:56:44 JST

## 実装範囲

visible editorだけを対象に、現在有効と確実に判断できる確認済み行を通常エディタへ描画した。

- テーマ対応の半透明グレー背景
- デフォルト有効のガターアイコン
- デフォルト無効で設定から有効化できるOverview Ruler
- Context、状態更新日時、Global状態を含むhover
- active editor、visible editor、装飾設定変更時の再描画
- 確認・解除コマンドのatomic commit成功直後の即時再描画
- diff editorの装飾解除
- 非表示editorの非読込
- 古い非同期読込結果の破棄
- 不確実なContextまたはGlobalレイヤーだけを個別に非表示化

## 構成

### 装飾モデル

`src/application/editor-decoration/normal-editor-decoration-model.ts`へ、VS Code APIに依存しない装飾モデルを追加した。

- 0始まり半開区間を維持する
- revision、path、line count、content hash、interval境界を検証する
- 現在ContextをGlobalより優先する
- ContextとGlobalが部分的に重なる場合はhover情報が正しくなるよう区間を分割する
- Global状態が不整合でも、確実なContext状態は維持する
- 判断できないレイヤーは確認済みとして表示しない

### visible editor制御

`src/ui/normal-editor/normal-editor-decoration-controller.ts`へ装飾制御を追加した。

- visible editorだけをrefreshする
- diff editorは空の装飾へ置換する
- per-editor generationでstaleな非同期結果を破棄する
- 設定変更時はDecoration Typeを作り直す
- 状態読込失敗時は装飾を消してエラー通知する
- コマンド成功後はデバウンスせず対象editorをrefreshする

### VS Code接続

`src/extension.ts`へ通常エディタ装飾を接続した。

- `reviewRange.reviewedBackground`を`ThemeColor`として使用する
- `reviewRange.reviewedOverviewRuler`を`ThemeColor`として使用する
- light、dark、high contrast、high contrast lightの既定色をmanifestへ定義する
- `reviewRange.showGlobalReviewed`を既定値`true`で追加する
- `reviewRange.showGutterIcon`を既定値`true`で追加する
- `reviewRange.showOverviewRuler`を既定値`false`で追加する
- hover文字列はMarkdown commandを信頼せず、HTMLも無効化する

## TDD記録

### 初期受け入れテスト

実装moduleの追加前に、装飾モデルとvisible editor制御のテストを追加した。

- Context優先とGlobal-only範囲
- Global表示設定
- revision・path・hash不整合時の安全な非表示化
- PR・branch・workspaceのhover label
- visible editor限定読込
- diff editor解除
- stale result破棄
- 設定変更と即時refresh
- 読込失敗時の装飾解除

### 部分重複の回帰

ContextとGlobalが一部だけ重なるfixtureを追加し、`Global: active`が誤ってContext区間全体へ適用されないよう区間分割を実装した。

修正後CI:

- Actions run: `29992192701`
- 結果: success

### テーマ色のRed/Green

テーマ色contributionを先行検証した。

Red:

- Commit: `6174047a8e3454355f34e5ba3afb9a52f7fc006b`
- Actions run: `29992211357`
- 失敗箇所: VS Code Extension Host tests
- 原因: `contributes.colors`未実装
- 診断artifact: `ci-failure-diagnostics-29992211357-1`
- Artifact ID: `8557508421`

Green:

- Commit: `7e2563431977bc205170f04910eb34be609a2c98`
- Actions run: `29992274740`
- 結果: success

### Global隔離のRed/Green

Global repository ID不整合時にContext装飾まで消える問題を回帰テストで再現した。

Red:

- Commit: `1a26398fee471a38abff3d71123339bb725080c0`
- Actions run: `29992884316`
- Unit tests: 84 success / 1 failure
- 失敗: `decoration model keeps certain context ranges when Global state is unrelated`
- 診断artifact: `ci-failure-diagnostics-29992884316-1`
- Artifact ID: `8557706583`

Green:

- Commit: `d3ad753b9d39a738e6842be9023c4a6284ad7f8b`
- Actions run: `29992936703`
- 結果: success

## 最終CI

Actions run `29992936703`で次を確認した。

- Install dependencies: success
- Build: success
- Lint: success
- Unit tests: success（85件）
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

## 変更ファイル

- `media/reviewed-gutter.svg`
- `package.json`
- `src/application/editor-decoration/index.ts`
- `src/application/editor-decoration/normal-editor-decoration-model.ts`
- `src/extension.ts`
- `src/ui/normal-editor/index.ts`
- `src/ui/normal-editor/normal-editor-decoration-controller.ts`
- `test/unit/normal-editor-decoration-controller.test.ts`
- `test/unit/normal-editor-decoration-global-isolation.test.ts`
- `test/unit/normal-editor-decoration-model.test.ts`
- `test/unit/normal-editor-decoration-overlap.test.ts`
- `test/vscode/suite/index.ts`

## Scope外

- activation/deactivation、保存デバウンス、再起動復元の一連試験: T107
- 編集イベントによる範囲追従: T201
- branch・detached HEAD context解決: T205
- JSON Lines履歴保存と範囲単位の操作日時: T206
- diff editor両側の装飾・操作: T303
- 現在PR変更行をGlobalだけではグレーにしない優先順位: T502

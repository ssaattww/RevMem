# PR差分選択モード結線 実装レポート

## 対象

- Repository: `ssaattww/RevMem`
- PR: `#120`
- branch: `investigation/issue-119-linked-diff-blocks`
- 対象タスク: `PDS-06`
- 実装開始時HEAD: `9fbee35335bf735564f1f1388367e3f7fe371079`
- 技術HEAD / 実装commit: `00d42300d838d510b2101d03d7969ba7ce0a4a31`
- base: `main` (`989317e00893e3b45a9e77ecb550e99274ac7e69` at intake)
- 永続化方式: `repository_file`
- 管理report commit: `commit_pending`
- 次タスク: `PDS-07`

## 目的と範囲

`reviewRange.prDiffSelectionMode` を公開し、RevMem管理下のPR差分に対する選択範囲の確認・解除へだけ適用した。既定値は従来互換の`side`、明示値`block`ではPDS-03〜05で実装済みの変更ブロック導出、更新対象組立て、原子的状態更新・履歴を実コマンド経路へ接続した。

通常エディタ、任意のVS Code diff、local base/head、ファイル全体操作の動作は変更対象外とした。`block`用の変更ブロック導出は`block`を選んだ選択操作でだけ実行し、`side`では従来経路をそのまま使う。

## 前提確認

PDS-05は同じレビュワー文脈の再レビューで`PDS05-NR1-001`がfixedとなり、`pass_with_held`を確認済み。したがってPDS-06の依存条件を満たしている。

作業開始時に`.github/workflows/ci.yml`を確認した。`tools/run-ci-command.mjs`が結果JSON、標準出力、標準エラー、結合ログを`test-output/ci/`へ保存し、失敗時workflow artifactに`test-output/`等を含める既存構成があるため、診断workflowの追加変更は不要だった。

## TDD Red

製品コードを変更する前に、設定境界とPR runtimeの実経路テストを追加した。

実行:

`node tools/run-ci-command.mjs pr-diff-selection-connection-red bash -lc 'npm run compile:test && node --test test-dist/test/unit/pr-diff-selection-configuration.test.js test-dist/test/unit/t405-pull-request-review-runtime.test.js'`

結果:

- 29件中24成功 / 5失敗。
- 設定契約3件が、設定キー・既定値・reader未実装で失敗した。
- block実経路2件が、従来の片側処理のままで左右連動せず失敗した。
- 空selectionでsessionを開かない既存境界はRed時点から成功した。
- 診断証拠: `test-output/ci/pr-diff-selection-connection-red.*`。

このRedを確認してから製品実装へ進んだ。

## 実装

### 設定境界

`src/application/configuration/review-range-configuration.ts`へ`PrDiffSelectionMode = "side" | "block"`と`readPrDiffSelectionMode`を追加した。設定未指定は`side`、`side`と`block`以外は`TypeError`で拒否し、不正値を暗黙fallbackしない。

`package.json`へ`reviewRange.prDiffSelectionMode`を追加し、VS Code設定の既定値を`side`とした。型fixtureも新しい設定契約へ追従した。

### PR runtime

PR runtimeは選択操作ごとに設定readerを1回呼び、その操作で使う値をsessionへ固定する。次の操作では再度readerを呼ぶため、設定変更は次の操作から反映される。

`side`では変更ブロックを導出しない。`block`のときだけ完全なimmutable hunkと両側の内容行数から変更ブロックを導出し、PDS-04の`createDiffSelectionTargetPlan`へ渡す。

### コマンド経路

`DiffEditorReviewCommandService`は選択配列を先に正規化し、空ならsession取得前に`no-op`を返す。`block` sessionでは左右の対象範囲を組み立て、PDS-05の`markDiffBlockReviewed` / `unmarkDiffBlockReviewed`を1 transactionとしてcommitする。

blockに必要なimmutable evidenceが不足した場合はfail closedとし、side処理へのfallbackはしない。既存sessionが許容する旧mapping表現はblock計画へ渡す直前にsession-oriented形式へ正規化した。

ファイル全体操作は`whole-file` scopeとしてsessionを開き、selection modeを読まず、既存のwhole-file transactionを継続使用する。

### 履歴

production compositionでblock mark/unmarkを`user-selection`として履歴へ渡すようにした。保存成功後の履歴生成・順序・no-op判定自体はPDS-05の実装を再利用する。

## 変更ファイル

- `package.json`
- `src/application/configuration/index.ts`
- `src/application/configuration/review-range-configuration.ts`
- `src/application/review-commands/diff-editor-review-command-service.ts`
- `src/composition/extension.ts`
- `src/composition/pull-request/pull-request-review-runtime-base.ts`
- `test/unit/pr-diff-selection-configuration.test.ts`
- `test/unit/t405-pull-request-review-runtime.test.ts`
- `type-fixtures/contracts/review-contracts.fixture.ts`

## Greenと回帰

| 検証 | 結果 | 診断ラベル |
| --- | --- | --- |
| Red | 24成功 / 5失敗 | `pr-diff-selection-connection-red` |
| 接続Green | 29成功 / 0失敗 | `pr-diff-selection-connection-green` |
| PDS-06焦点 | 59成功 / 0失敗 | `pr-diff-selection-focused` |
| build | 成功 | `pr-diff-selection-build` |
| 型契約 | 成功 | `pr-diff-selection-contracts` |
| architecture | 成功 | `pr-diff-selection-architecture` |
| architecture負例 | 期待11件と一致 | `pr-diff-selection-architecture-negative` |
| lint | 成功 | `pr-diff-selection-lint` |
| 既定unit | 790成功 / 0失敗 | `pr-diff-selection-unit` |
| tooling | 16成功 / 0失敗 | `pr-diff-selection-unit` |
| `git diff --check` | 成功 | whitespace errorなし |

既定unitには通常エディタ、PR Progress provenance、任意diff境界、whole-file操作など既存経路の回帰が含まれ、今回差分後も全件成功した。

## コミットとpush

実装と担当テストは1つの論理コミット`00d42300d838d510b2101d03d7969ba7ce0a4a31`（`feat: connect PR diff selection mode`）へまとめ、RDCのgitから`investigation/issue-119-linked-diff-blocks`へpushした。

push後のPR current HEADが同SHAであることをGitHub connectorで確認した。同SHAに紐づくpull_request CIはrun `35033585889`。本report作成時点では`in_progress`であり、成功とは記録しない。

本report、handoff、task/phase同期は別の管理コミットにする。その管理コミットでPR current HEADが変わるため、最終公開CIは新しいcurrent HEADとrunの`head_sha`一致を改めて確認し、別SHAのrunを代用しない。

## 未実施・残範囲

- PDS-07の設計表全行を通す結合受入試験は未実施。
- PDS-08の古い比較・競合・再読込回帰は未実施。
- PDS-09の実Extension Hostでの設定切替・左右表示同期は未実施。
- PDS-10の統合通常レビュー、独立レビュー、最終公開HEAD CI監査は未実施。
- 本タスクではmergeしない。mergeは利用者が行う。

## 次の操作

PDS-07を開始し、設計の正常系・選択境界・状態遷移表を本文→差分→PR session→実コマンド→保存→履歴→PR Progressまでの結合受入条件へ対応付ける。

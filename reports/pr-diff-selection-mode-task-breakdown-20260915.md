# PR差分の確認単位切替 — タスク分割報告

## 対象

- Repository / PR: `ssaattww/RevMem` / #120。Issue #119。
- branch: `investigation/issue-119-linked-diff-blocks`。base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`。
- 作業開始HEAD: `c7a5d2b1d9a34e60614ae48c619217b9568e1e8e`。
- タスク計画の公開commit: `454c9b7d1a11632f5f83f174e83ace8811e8cbd7`。
- 設計blob: `83a16fd656f9f66ebc6ef81d3b97c97f902710c9`。今回変更なし。

## 依頼と成果物

依頼は実装タスクの分割。実装上の不備はタスクへ織り込み、設計書へ書かない。製品実装は開始しない。
`task-breakdown-planner` と `task-consistency-manager` を通して、4フェーズ・10タスクを定義した。アップロード済みのwork-context-manager、report-writer、chat-handoff-managerも参照した。別workerは起動していない。

- `tasks/pr-diff-selection-mode/tasks-status.md`: 状態、規模、依存、変更範囲、終了条件、設計表の担当、共通検証、次の操作。
- `tasks/pr-diff-selection-mode/phases-status.md`: 入力境界、ブロック処理、接続と受入、検証とレビューの終了条件。
- 本報告と `handoffs/pr-diff-selection-mode-task-breakdown-20260915.yaml`: 経緯・検証・次の作業の保存。

本機能の追跡を上記の専用ディレクトリにまとめ、PR本文に入口を追加した。全体タスク・フェーズの他案件の記録は変更していない。
末尾改行に関するIR1 / P2は設計上closedだが、既存製品の再現4失敗はPDS-01／02へ引き継いだ。設計上の解消と実装修正を区別した。
状態更新・履歴の基本受入は置換108組、追加18組、削除6組とし、一部確認・Globalだけの更新を省略しない。各表行は担当タスクでRed→Greenを確認し、結合試験まで単体テストを延期しない。

## 今回の検証

| 検証 | 結果 |
| --- | --- |
| タスク・フェーズの機械照合 | 10タスク、4フェーズ、全件未着手、依存循環なし |
| Markdownの表・相対リンク・文字コード | 成功。表の列数一致、リンク先存在、置換文字なし |
| 既存追跡ファイルと設計の変更有無 | 変更なし。設計blobが開始時と一致 |
| テストソース再コンパイル | 終了コード0 |
| 設計構造・CI診断契約の既存テスト | 17成功、0失敗、0skip |
| 公開内容とRDC上の原稿 | Git tree `ee8427745c92ede40a14bad887a7e04faa31b5d9` が一致 |
| 公開済み計画の再検査 | 成功 |

実行環境はFA780 / Windows / Node v24.20.0。原稿編集と検証はRDC、リポジトリ公開とPR操作はGitHub connectorを使用した。原稿と公開内容をGit treeで照合している。
診断ラッパーの証拠は `test-output/ci/pr-diff-task-plan*` の結果JSON・標準出力・標準エラー・結合ログ。補助検査スクリプトは同じローカル出力ディレクトリにあり、製品テストへ追加したものではない。
今回の17件は既存契約の確認であり、新機能や末尾改行不備の修正成功を示さない。全体ローカル試験、末尾改行の再現試験、実Extension Hostは今回は再実行していない。

## CI・未変更範囲・次の操作

開始時に既存CIの失敗診断artifactを確認した。`test-output/`、stdout、stderr、結果JSON、環境・checkout SHA、関連ソースを保存するため、workflowは変更していない。成功時を含む新しいテストの診断整備はPDS-10へ明記した。
本報告公開後の最終HEADとhead SHAが一致するpull_request CIだけを最終証拠とし、結果・run・成果物をPRコメントに記録する。本報告生成時点ではそのSHAは未確定であり、開始時の成功CIを代用しない。
設計、製品、テスト、設定、workflow、既存全体追跡、過去のレビュー報告は変更していない。新しい独立レビュー判定や過去の合格証明の継承は行っていない。
計画自体の機械検査は完了。製品タスクは全件未着手であり、既知の実装不備は未修正。実装開始の指示後はPDS-01を実行する。マージ・Issue終了・draft解除はしていない。

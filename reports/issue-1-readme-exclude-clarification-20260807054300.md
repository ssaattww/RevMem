# README exclude説明明確化レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: `#51`
- Branch: `agent/readme-exclude-clarification`
- Base: `main`
- Merge: 実施しない

## 目的

`README.md`の`reviewRange.exclude`説明について、「通常エディタの確認操作と装飾へ影響しない」という抽象的な表現を、利用者が挙動を直接理解できる説明へ置き換える。

## 変更内容

- 除外対象ファイルでも通常エディタでは確認済みにできることを明記。
- 確認済み表示と状態保存も行われることを明記。
- 一方で、そのファイルはPR進捗とGlobal理解率の集計対象から除外されることを明記。

## 事前確認

既存`.github/workflows/ci.yml`には、失敗時に標準出力・標準エラー・テスト結果・環境情報・調査用ログ等をartifactへ保存する処理が存在するため、workflow変更は不要。

## 検証

- documentation-only変更のためTDDは非適用。
- 変更後READMEをGitHub connectorで再取得し、説明が「確認済みにできる／表示・保存される／PR進捗とGlobal理解率からは除外される」と明示されていることを確認。
- `main`との差分がREADME 1行と本レポートだけであることを確認。
- PR作成時HEAD `71af8cfcb4cff7e9749c59f5d34a090791f52220` に対して複数回workflow runを確認したが、一致するpull-request runは存在しなかった。別SHAのrunは代用していない。
- 本レポート更新後は新しいPR current HEADについて再度exact-head CIを確認する。

## 対象外

- `reviewRange.exclude`の実装変更。
- `tasks/tasks-status.md`の変更。
- merge。

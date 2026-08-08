# README「現在の制限」タスク対応明記 実装レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Pull Request: `#50`
- Branch: `agent/readme-limitations-task-mapping`
- Base: `main`
- 作業種別: documentation-only implementation
- README変更commit: `694525f61b8603326e020e2787e978bad29fe074`
- PR作成時HEAD: `020e4dabccfa6fc1420dc98df3277cde24aa0cb2`
- Merge: 実施しない

## 目的

READMEの「現在の制限」について、各制限がどのタスクの完了によって解消されるかを利用者が判断できるようにする。

## 権威ある参照先

- 利用者指示: READMEの現在の制限へ解消条件となるタスクを明記する。
- `README.md`: 現在公開している制限の説明。
- `tasks/tasks-status.md`: T404〜T406、T505〜T506、T603〜T605、T608の変更範囲・依存・終了条件。
- `doc/design/vscode-review-range-tracker-design.md` rev4: 初期版の対象、UI、履歴、UNCを含む設計上の境界。
- `.github/workflows/ci.yml`: CI失敗時の診断artifact保存方針。

## 事前確認

`.github/workflows/ci.yml`には失敗調査用のworkflowが既に存在する。各検証の標準出力・標準エラーを`tee`で`test-output/ci/*.log`へ保存し、失敗時に環境情報、Git状態、生成物一覧、test結果、source、test、設定、workflowを`actions/upload-artifact@v4`で保存するため、workflow変更は不要と判断した。

## 変更内容

`README.md`の「現在の制限」を次のように更新した。

- タスクIDの参照先として`tasks/tasks-status.md`を明記した。
- GitHub PR contextのproduction runtimeとReview Contexts Viewは、T404・T405の実装とT406の統合試験完了を解消条件とした。
- Global Understanding ViewはT505・T506の完了を解消条件とした。
- 通常エディタ編集中の即時追従runtime配線は、複数contextの変更追従runtime統合とExtension Host試験を扱うT506の完了を解消条件とした。
- multi-root、Remote SSH、Dev Containers、CodespacesはT605の完了を解消条件とし、初期版全体の最終受け入れをT608で確認すると明記した。
- `reviewRange.exclude`の対応UIはGitHub PR進捗側がT404〜T406、Global理解率側がT505〜T506で揃うことを明記した。
- untitled editor、履歴閲覧・検索・export UI、UNCセキュリティ制約は現行タスクで解消されないことを明記した。
- T603とT604は履歴のmigration・破損回復・競合・atomic appendを扱うが、履歴UIを追加するタスクではないことを明記した。
- `reviewRange.exclude`が通常エディタの確認操作と装飾へ影響しないこと、およびUNC制約を迂回しないことは仕様上維持される条件として区別した。

## 対象外

- `tasks/tasks-status.md`と`tasks/phases-status.md`の更新。これらはrepository規約上、指定されたprogress management skill経由でのみ更新するため変更していない。
- 実装コード、test、workflow、設計書、manifestの変更。
- untitled editor対応、履歴UI、VS CodeのUNCセキュリティ制約を迂回する実装。
- T404、T505、T602の既存PR内容や状態の変更。

## TDDと検証

本作業は既存タスク定義に基づくREADME文言のみの変更であり、実行可能な挙動を変更しないためTDDは適用していない。

実施した検証:

1. GitHub connectorで変更後branchの`README.md`を再取得し、「現在の制限」の反映内容を確認した。
2. README全体に対して次の静的検証を実施した。
   - Markdownコードフェンスが対応していること。
   - 必須タスクID `T404`、`T405`、`T406`、`T505`、`T506`、`T603`、`T604`、`T605`、`T608`が記載されていること。
   - `tasks/tasks-status.md`への相対リンクが存在すること。
   - 行末空白がないこと。
3. `tasks/tasks-status.md`および設計書の該当定義と、READMEへ記載した解消条件を照合した。

静的検証結果: PASS

## 既知事項・残存リスク

- T506のタスク定義は複数contextの変更追従runtime統合とExtension Host試験を含むため、通常エディタ編集中の即時追従制限の解消条件として記載した。実装時にタスク範囲が再分解された場合はREADMEも追従更新が必要になる。
- 履歴UIとuntitled editor対応は現行タスク一覧に存在しない。将来対応する場合は新規タスク定義とREADME更新が必要になる。
- READMEには変動しやすいPR番号や進行状態を記載せず、安定したタスクIDと完了条件だけを記載した。

## 次のアクション

- PR #50のcurrent HEAD SHAと一致するCI runだけを確認する。
- CI結果と変更要約をPRコメントへ投稿する。
- mergeは利用者が実施する。

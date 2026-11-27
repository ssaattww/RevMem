# Issue #154 / PR #151 独立指摘に対する通常修正確認

**通常の修正確認は合格、必須残数0件です。独立レビューによる解消確認は別に行います。**

- 初回独立レビューの凍結版：`53aac0142e553dd1b24b99e7eab22262bfd08ca9`。初回判定は必須3件のため不合格。
- 修正技術版：`2557e2e5b7a2a26cca872097f6a19547dd4bd80d`。対象は読み取りだけの第1段階、取り込みで閉じるのは子 Issue #154 のみ。親 #93 と書き込み段階は対象外です。
- 同じ通常担当による焦点43/43・型検査成功。親側で実行した焦点68/68、静的検査、型契約、構造の正負検査とは別です。
- 技術版の [PR 自動 CI](https://github.com/ssaattww/RevMem/actions/runs/46081171854)：成功（同一 SHA）。記録を追加した版とは区別します。

| 指摘 | 修正の条件 | 製品経路 | 実行した検証と限界 |
|---|---|---|---|
| I154-IFR-001 | PR 差分の保存が始まったとき Branch が選択されていても、途中から PR が選ばれた場合に取得を開始せず、履歴保存に失敗したときは以前のオーバーレイを出さない。 | `src/composition/extension.ts:641`、`src/composition/pull-request/pull-request-review-runtime.ts:149–171`。操作開始時に無条件でガードを取得し、PR 差分の4操作が完了または失敗するまで保持。 | `test/unit/issue-112-pr-progress-runtime.test.ts:764–821` の Branch→PR、取得抑止と履歴失敗。実アカウントを使わない。 |
| I154-IFR-002 | 正常に取り消した、または変更がなかった場合、保存失敗と区別して現在世代の取得だけを行う。古い応答は採用しない。 | `src/ui/normal-editor/review-command-registration.ts:103–115`、`src/document-review-edit-runtime.ts:188–194` と PR 差分の正常終了分岐。従来の applied 通知を維持。 | 単体・選択中 PR 編集の統合試験が正常取消・no-opの経路を検証。PR 差分の no-op の独立したテストケースはなく、取消と同じ正常終了分岐であることをコードで確認。 |
| I154-IFR-003 | 模擬認証・通信から本番の選択取得・表示を通し、失敗がローカル確認状態・履歴を更新する指令にならないことを示す。 | `src/composition/review-contexts/github-viewed-selection-reader.ts` の本番 reader と `publishGitHubViewedSelection` を、実行時と同じ接続で合成する。外部の実アカウントには接続しない。 | `test/unit/pull-request-progress-tree.test.ts:635–725` で正常、認証なし、HTTP 403、GraphQL エラー、通信失敗。GraphQL はクエリ、REST は GET。履歴の不変は製品の読取専用依存と模擬配列を検証しており、実ストレージの保存は通さない。 |

実アカウント、実画面、実際の GitHub への書き込みは実施していません。次は初回と同じ独立担当が3件とその直接影響、および CI 差分だけを確認します。新規の独立レビューを行いません。

# PR差分選択モード PDS-06 指摘修正検証レポート

## 対象

- Repository: `ssaattww/RevMem`
- PR: `#120`
- branch: `investigation/issue-119-linked-diff-blocks`
- 対象タスク: `PDS-06`
- 通常レビュー対象HEAD: `d256b2506247c302ad1edd5b2af247368fe2fdba`
- 通常レビュー記録HEAD: `cc0a34a16cb9535661fb97b054c99bdeec5b0a25`
- 修正技術HEAD: `444eb6e15a3574d7241ea78ac94181b83d4da428`
- 修正範囲: `PDS06-NR1-001`, `PDS06-NR1-002`
- source severity: 両方 `P2 / medium`。severity変更なし。
- 永続化方式: `repository_file`
- 本report管理commit: `commit_pending`
- 状態: 実装修正済み。同じ通常レビュワーによる再レビュー待ち。

## 根拠

通常レビュー `reports/pr120-pds06-normal-review-20260916.md` は、PDS-06実装HEADに対して2件のP2を指摘し、verdictを`fail`とした。本対応ではその2件だけを修正し、PDS-07以降には着手していない。

作業開始時に既存 `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` の診断経路が利用可能であることを確認済み。結果JSON、標準出力、標準エラー、結合ログ、および失敗時artifactを保存するためworkflow変更は行っていない。

## PDS06-NR1-001 / P2

### 指摘

PR HEADがrepository ownerのcurrent Global revisionと異なるとき、Contextのoriginal/modifiedが既に目的状態で、PR HEAD側の`globalState.revisionSnapshots[headSha]`だけが変更対象になるblock操作を、`DiffEditorReviewCommandService`が`no-op`と誤判定していた。

### TDD Red

製品コード変更前に実runtime経路へ4ケースを追加した。

- original側 mark
- original側 unmark
- modified側 mark
- modified側 unmark

各ケースは先に実コマンドでContextとsnapshotを準備し、その後owner current Globalを別revisionへ切り替え、PR HEAD snapshotだけを目的状態と逆にして同じ操作を再実行する。

診断ラベル: `pr-diff-selection-snapshot-only-red`

- 既存26件: 成功
- 追加4件: 4/4失敗
- 実結果: `no-op`
- 期待: `applied`

### 修正

commit `bc6c143` (`fix: persist PR snapshot-only review changes`)

`src/application/review-commands/diff-editor-review-command-service.ts` の独自`hasSemanticChange`を削除した。この独自判定はcurrent `contextState.files[fileId]`とcurrent `globalState.files[fileId]`だけを比較しており、revision snapshotだけの意味差を見落としていた。

`commitWhenChanged`はcoreの`hasReviewStateSemanticChange`を使用するよう変更し、Context・Globalの全persisted snapshotを含む共通semantic判定へ統一した。

### Green

診断ラベル: `pr-diff-selection-snapshot-only-green`

- 関連55/55成功
- PR HEAD snapshotのみの変更でも1 commit / 1 history requestになる
- owner current Global filesは不変
- mark/unmark、original/modifiedの4ケースをすべて確認

静的検証 `pr-diff-selection-snapshot-only-static`:

- build: 成功
- contract typecheck: 成功
- architecture: 成功
- architecture negative: 期待11件と一致
- lint: 成功
- `git diff --check`: 成功

## PDS06-NR1-002 / P2

### 指摘

production compositionがside selectionとblock selectionの両方を同じ`reason = user-selection`で`ReviewHistoryRecorder`へ渡していた。このため追加のみ等、保存範囲が同じケースではpersisted historyから操作単位を識別できなかった。

### TDD Red

`test/unit/pr-diff-selection-history.test.ts`を先に追加し、実`ReviewHistoryRecorder`を通すproduction履歴境界を要求した。テスト側の型修正後のRedは、新しいproduction境界`pull-request-review-history`が未実装であるcompile failureのみになった。

診断ラベル: `pr-diff-selection-history-red`

### 修正

commit `444eb6e` (`fix: distinguish block selection history`)

`src/composition/pull-request/pull-request-review-history.ts`を追加し、PR review transactionからpersisted history reasonを決定する境界を分離した。

- side range mark/unmark: `user-selection`
- block mark/unmark: `user-block-selection`
- その他の既存fallback: `user-file`

`src/composition/extension.ts`はこの境界を使用する。履歴イベント件数、event type、modified→original順序は変更していない。

### Green

診断ラベル: `pr-diff-selection-history-green`

- 履歴関連22/22成功
- 同じ追加のみmarkでもsideとblockのpersisted `reason`が異なる
- block mark/unmarkで変更イベントが1件だけのケースも`user-block-selection`を保持

## 統合ローカル検証

| 検証 | 結果 | 証拠 |
| --- | --- | --- |
| NR1-001 Red | 26成功 / 4失敗 | `test-output/ci/pr-diff-selection-snapshot-only-red.*` |
| NR1-001 Green関連 | 55/55 | `test-output/ci/pr-diff-selection-snapshot-only-green.*` |
| NR1-002 Red | production履歴境界未実装のcompile failure | `test-output/ci/pr-diff-selection-history-red.*` |
| NR1-002 Green関連 | 22/22 | `test-output/ci/pr-diff-selection-history-green.*` |
| PDS-06焦点 | 66/66 | `test-output/ci/pr-diff-selection-review-fixes-focused.*` |
| 既定unit | 797/797 | `test-output/ci/pr-diff-selection-review-fixes-unit.*` |
| tooling | 16/16 | 同上 |
| build / 型契約 / architecture正負 / lint | 成功 | `pr-diff-selection-snapshot-only-static`, `pr-diff-selection-history-static` |
| `git diff --check` | 成功 | whitespace errorなし |

## CI

修正技術HEAD `444eb6e15a3574d7241ea78ac94181b83d4da428` に一致するpull_request CI runは `35082458412`。本report作成時点では`in_progress`であり、successとは記録しない。

本report・handoff・trackingをcommitするとPR current HEADは変わる。その後のCI確認は新しいcurrent HEADとrun head SHAの一致を必須とし、`444eb6e...`や別SHAのrunを代用しない。

## 変更ファイル

NR1-001:

- `src/application/review-commands/diff-editor-review-command-service.ts`
- `test/unit/t405-pull-request-review-runtime.test.ts`

NR1-002:

- `src/composition/pull-request/pull-request-review-history.ts`
- `src/composition/extension.ts`
- `test/unit/pr-diff-selection-history.test.ts`
- `package.json`

## 未変更・境界

- 設計書は変更していない。
- `.github/workflows/ci.yml`は既存診断要件を満たすため変更していない。
- PDS-07以降の製品・受入実装には着手していない。
- source findingのseverityは変更していない。
- 通常レビューの`fail`を本実装担当が`pass`へ変更していない。finding closureは同じ通常レビュワーの再レビューで確定する。
- mergeは実施しない。利用者が行う。

## 次の操作

同じ通常レビュワー文脈で`PDS06-NR1-001`と`PDS06-NR1-002`のfix verificationを行い、両方がfixedになったことを確認する。確認完了までPDS-07へ進まない。

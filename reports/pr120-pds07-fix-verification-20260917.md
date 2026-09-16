# PR差分選択 PDS-07 指摘対応検証レポート

## 対象

- Repository: `ssaattww/RevMem`
- PR: `#120`
- branch: `investigation/issue-119-linked-diff-blocks`
- 対象タスク: `PDS-07`
- 通常レビュー対象HEAD: `3fe8233320b692a8a68f49b36017098a28514db0`
- 通常レビュー記録HEAD: `15808b6039f1a95930451648344878774aeb8d40`
- 指摘対応技術HEAD: `cebdf252af94fa5096d2ab9d4338d5385226ac7e`
- 状態: 2指摘とも修正・push済み、同じ通常レビュワーの再レビュー待ち

## 通常レビュー指摘

通常レビュー `reports/pr120-pds07-normal-review-20260917.md` は `fail`、P2を2件報告した。

1. `PDS07-NR1-001 / P2`: 正常系ケース表の一部行について `side` の実runtime受入が不足。
2. `PDS07-NR1-002 / P2`: 正常系・境界・末尾改行等で履歴の発生側だけを主に確認し、履歴payloadのbefore/after等を十分に固定していない。

製品コードの挙動不良ではなく、PDS-07が要求する受入証拠の網羅性不足が対象である。

## 作業開始時確認

`.github/workflows/ci.yml` は `tools/run-ci-command.mjs` により結果JSON・stdout・stderr・結合ログを `test-output/ci` に保持し、失敗時に `test-output` を診断artifactへアップロードする。既存workflowで必要な診断経路を満たすため変更していない。

## PDS07-NR1-001 / P2

### Red

先に `normal acceptance matrix preserves required side-mode scenarios` を追加し、正常系表で必要な9ケースの名前が常設受入に存在することを検査した。

- 診断ラベル: `pds07-fix-coverage-red`
- 結果: 51件中50成功・1失敗
- 失敗内容: 追加、削除、左右context-only、左右の変更+隣接context、複数block、同一block複数selection、別block複数selectionの `side` 9ケースが未対応として列挙された。

### 修正

以下の9ケースを `test/unit/pr-diff-selection-acceptance.test.ts` の実runtime受入へ追加した。

- 複数行追加の一部選択は `side` では選択1行だけをmodified Context / Globalへ保存する。
- 複数行削除の一部選択はoriginalの選択1行だけを保存する。
- original / modifiedのcontext-onlyを `side` で確認する。
- original / modifiedの変更行+隣接contextを `side` で確認する。
- 1選択が複数blockへ触れる場合も `side` では操作側の選択範囲を維持する。
- 同一blockの複数selection、別blockの複数selectionを `side` で確認する。

各ケースで実際の保存範囲、commit回数、実履歴、Global、PR Progress分子・分母を同一経路で確認する。

- Green: `pds07-fix-side-green` 60 / 60
- commit: `e6dd2d19206700f1e19355f869d9bbe9d0f659a9` (`test: cover side-mode acceptance scenarios`)

## PDS07-NR1-002 / P2

実 `ReviewHistoryRecorder` のevent内容を共通helperで検証するよう受入を強化した。

検証対象は次のとおり。

- Context `previousRanges` / `nextRanges`
- modified eventの `globalPreviousRanges` / `globalNextRanges`
- 操作種別を示す `reason`
- original eventの `diffId`
- event件数と `modified` → `original` の順序

正常系全ケース、選択境界10ケースのmark/unmark、末尾改行・存在13ケースのmark/unmark、追加状態積18ケース、削除状態積6ケースへ適用した。

最初の詳細化実行 `pds07-fix-history-green` は60件中54成功・6失敗だった。6件は製品不具合ではなく、`side` のoriginal側操作で既存互換の `user-file` reasonを使う契約を、テスト側で `user-selection` と誤認した期待値不備だった。`src/composition/pull-request/pull-request-review-history.ts` の既存契約に合わせ、block=`user-block-selection`、modified側のrange操作=`user-selection`、original側のlegacy fallback=`user-file` として期待値を明示した。

- 修正後直接受入: `pds07-fix-history-green-2` 60 / 60
- focused: `pds07-fix-focused-after-findings` 126 / 126
- commit: `cebdf252af94fa5096d2ab9d4338d5385226ac7e` (`test: verify persisted review history payloads`)

期待値不備による6失敗は製品Redとして扱わない。指摘自体は「履歴内容を十分にassertしていない」という受入網羅性不足であり、製品コード変更は不要だった。

## 最終ローカル検証

技術HEAD `cebdf252af94fa5096d2ab9d4338d5385226ac7e` に対して実行した。

| 検証 | 結果 | 診断ラベル |
| --- | --- | --- |
| PDS-07直接受入 | 60 / 60成功 | `pds07-fix-history-green-2` |
| focused | 126 / 126成功 | `pds07-fix-focused-after-findings` |
| 既定unit | 857件中855成功・0失敗・2skip | `pds07-fix-unit-final` |
| tooling | 16 / 16成功 | `pds07-fix-unit-final`内 |
| build | 成功 | `pds07-fix-build-final` |
| contract typecheck | 成功 | `pds07-fix-contracts-final` |
| architecture | 成功 | `pds07-fix-architecture-final` |
| architecture negative | 期待11件と一致 | `pds07-fix-architecture-negative-final` |
| lint | 成功 | `pds07-fix-lint-final` |
| `git diff --check` | 成功 | commit前に確認 |

2件のskipは既存WindowsのPOSIX signal fixtureで、今回の受入試験にskipはない。

## CI

技術HEAD `cebdf252af94fa5096d2ab9d4338d5385226ac7e` と一致するpull_request CIはrun `35160456646`。本report作成時点では `in_progress` であり、成功とは扱わない。

report・handoff・trackingを管理commitとしてpushするとPR current HEADが変わるため、その後は新しいHEADに一致するworkflow runだけを最終CIとして確認する。`35160456646` や以前のSHAのrunを代用しない。

## 変更範囲

- 変更: `test/unit/pr-diff-selection-acceptance.test.ts`
- 追跡同期: `tasks/pr-diff-selection-mode/tasks-status.md`、`tasks/pr-diff-selection-mode/phases-status.md`
- 詳細記録: 本reportとfix verification handoff
- 未変更: `src/` 製品コード、設計書、設定、workflow
- 未着手: PDS-08〜PDS-10

## 再レビュー依頼事項

同じ通常レビュワーで次を確認する。

1. `PDS07-NR1-001 / P2`: 正常系表の未対応side行が実runtime受入へ入り、保存・履歴・Progress・Globalまで同時に確認されていること。
2. `PDS07-NR1-002 / P2`: 正常系、境界、末尾改行・存在、追加、削除で履歴payloadのbefore/after、Global、reason、original diffIdが実recorderまで検証されること。
3. 新規指摘がなければPDS-07を収束させること。収束前にPDS-08へ進まない。

mergeは利用者が行うためworkerは実行しない。

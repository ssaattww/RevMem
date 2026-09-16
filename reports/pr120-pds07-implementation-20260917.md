# PR差分選択 受入試験実装レポート

## 対象

- Repository: `ssaattww/RevMem`
- PR: `#120`
- branch: `investigation/issue-119-linked-diff-blocks`
- 対象タスク: `PDS-07`
- 実装開始時HEAD: `a5ab79df980f15394ffb7d9547e25e739f565169`
- 受入試験commit / 技術HEAD: `2f1b3d516209182cfcf867149306a8a2152cda60`
- 技術HEAD tree: `775973aaeb1356a1509d4c69eb1c6af472e4b90b`
- base: `main` (`989317e00893e3b45a9e77ecb550e99274ac7e69` at intake)
- 管理report commit: `commit_pending`
- 状態: 実装・ローカル検証完了、通常レビュー待ち

## 目的と範囲

設計表の各条件を、本文取得から差分解析、PR session、実コマンド、状態保存、実履歴recorder、PR Progressまで接続した常設受入試験へ対応付けた。
製品コードは変更していない。既存のPDS-01〜06実装が設計の受入条件を満たすことを実経路で確認し、新しい受入試験をfocused suiteと既定unitへ組み込んだ。
PDS-08のstale比較・CAS競合・保存失敗・再読込、PDS-09の実Extension Host、PDS-10の最終レビュー／公開監査は対象外である。

## 作業開始時確認

PR current HEADはGitHub connectorで`a5ab79df980f15394ffb7d9547e25e739f565169`と確認した。PDS-06通常再レビューでは2件のP2がfixed、判定`pass_with_held`、新規指摘なしであり、PDS-07の依存条件を満たしていた。
`.github/workflows/ci.yml`には`tools/run-ci-command.mjs`の結果JSON、stdout、stderr、結合ログを`test-output/ci`へ保存し、失敗時に`test-output`等をartifactへアップロードする既存経路がある。このためworkflow変更は不要だった。
## 開発順序とRedの扱い

RevMemのTDD方針とタスク計画のRed→Green要件を確認した。本タスクは既存挙動を変更する実装ではなく、既に実装済みの設計表を結合受入試験へ上げる作業である。
新規受入試験の有効な最初の実行では、三成分132ケース、正常系、境界、末尾改行を含め既存製品挙動が成功したため、製品欠陥を示す正当なRedは得られなかった。Redを作るために製品を意図的に壊すことはしていない。
途中で複数ブロック用の手書きunified diff fixtureがparserに拒否された失敗があったが、fixture自体の不備であり製品欠陥ではないためRed証拠には数えていない。fixtureを実Gitのzero-context形式へ修正後、同じ受入条件は成功した。

## 変更

- `test/unit/pr-diff-selection-acceptance.test.ts`を追加した。
- `package.json`の`test:pr-diff-selection`と`test:unit`へ新規受入試験を追加した。
- 製品コード、設計書、workflowは変更していない。

受入fixtureは`buildSnapshotFromLocalGitDiff`、`PullRequestReviewRuntime`、`DiffEditorReviewCommandService`、実`ReviewHistoryRecorder`、`calculatePullRequestDiffProgress`へ至る製品経路を利用する。状態保存はruntimeのrepository commit境界を通す。

## 設計表との対応 — 正常系ケース表

| 設計行 | 実経路で固定した内容 | 常設試験 |
| --- | --- | --- |
| 元側変更行 | sideでは元側だけ、blockでは置換ブロック両側 | `original changed line keeps side mode...`、`equal-size replacement expands both block sides` |
| 先側変更行 | sideでは先側Context/Globalだけ、blockでは両側 | `modified changed line keeps side mode...`、`partial replacement selection expands...` |
| ブロック一部 | sideは選択範囲、blockは全ブロック | `partial replacement selection stays partial...` / `expands the complete block` |
| 同数行置換 | 行対応を推測せずblock全体 | `equal-size replacement expands both block sides` |
| 異数行置換 | sideは選択範囲、blockは両側全範囲 | `unequal replacement keeps...` / `expands complete...` |
| 追加のみ | modified Context/Globalだけ | `addition expands only the existing modified side`、addition state product |
| 削除のみ | originalだけ | `deletion expands only the existing original side`、deletion state product |
| 元側contextのみ | unchanged mappingだけを更新、blockへ拡張しない | `original context-only selection stays out of change blocks` |
| 先側contextのみ | modified Context/Globalだけ、blockへ拡張しない | `modified context-only selection stays out of change blocks` |
| 元側変更＋context | blockとmapped contextを一transactionへ統合 | `original changed and adjacent context selection...` |
| 先側変更＋context | blockとmodified contextを一transactionへ統合 | `modified changed and adjacent context selection...` |
| 1選択で複数block | 各blockを展開して1 transaction | `one selection touching multiple blocks...` |
| 複数selection・同一block | blockを重複対象化しない | `multiple selections touching one block...` |
| 複数selection・別block | 各blockを独立展開 | `multiple selections on different blocks...` |
| ファイル全体 | selection modeを読まず既存whole-file transaction | `whole-file review ignores the selection mode...` |

各ケースで保存後のoriginal、modified Context、Global、履歴event側、PR Progress分子・分母を同じ試験内で照合する。

## 設計表との対応 — 選択正規化と境界

| 設計条件 | 常設受入 |
| --- | --- |
| 元／先の変更行カーソル | `original/modified changed-line cursor touches its block` |
| 元／先のcontextカーソル | `original context cursor...` / `modified context cursor...` |
| 元／先の順方向選択 | `original/modified forward selection...` |
| 元／先の逆方向選択 | `original/modified reverse selection...` |
| 元／先の列0終端 | `original/modified column-zero endpoint excludes the next block` |
| 元／先の空selection配列 | `empty selections on both sides are no-ops...` |

確認済み化の後に同じselectionで解除も実行し、mark/unmarkで対象集合が同じこと、2回の保存・履歴・Progress復帰を確認する。空selectionはsession用設定値を読まず保存・履歴0件であることを確認する。

## 設計表との対応 — 三成分状態・commit・履歴

置換ではoriginal / modified Context / Globalの3状態直積3×3×3、確認／解除2種、操作元2側の108ケースを実runtimeで実行する。追加のみ18ケース、削除のみ6ケースと合わせて132基本ケースを常設化した。
各ケースで、目的状態への遷移、semantic change有無、repository commit回数、modified→originalの履歴順序、履歴before/after、保存後Global、PR Progressを同時に確認する。これにより設計の3行状態遷移表と8組のcommit／履歴表を全組合せから検証する。

Global edgeのうち、Context両側が既に全確認でGlobalだけ未確認の確認操作は専用試験`a Global-only block change commits history without changing the PR Progress numerator`でも固定した。保存1回とmodified履歴1件が発生する一方、PR Progressは操作前後とも4/4であり、Globalを分子へ二重加算しない。
全成分が目的状態のケースは132ケース内で`no-op`、commit 0、履歴0として確認する。

## 設計表との対応 — 行数・末尾改行

設計の13行をすべて本文から`deriveDocumentLineContract`へ通し、その値を同じPR runtime受入fixtureへ使用した。

| 条件 | エディタ/差分の期待 |
| --- | --- |
| 新規 `new` | 元0/0、先1/1 |
| 新規 `new\n` | 元0/0、先2/1 |
| 新規 `new\r\n` | 元0/0、先2/1 |
| 削除 `old` | 元1/1、先0/0 |
| 削除 `old\n` | 元2/1、先0/0 |
| 削除 `old\r\n` | 元2/1、先0/0 |
| 置換 `old\n`→`new\n` | 元2/1、先2/1 |
| 置換 `old`→`new\n` | 元1/1、先2/1 |
| 置換 `old\n`→`new` | 元2/1、先1/1 |
| 既存空→`new` | 元1/0、先1/1 |
| `old`→既存空 | 元1/1、先1/0 |
| 末尾改行追加 | 元1/1、先2/1 |
| 末尾改行削除 | 元2/1、先1/1 |

各行でmark/unmark後の存在する側だけの保存、履歴、PR Progressを確認した。末尾改行後の表示空行と既存空ファイルの表示行だけを選択する追加ケースでは、状態更新・commit・履歴が0件であることを確認した。
## 設定切替と進捗

`selection mode changes apply from the next operation...`で、最初のblock markは両側を確認済みにし、次の操作前にsideへ変更するとmodified側だけ解除され、original側だけが確認済みとして残ることを確認した。設定readerは操作ごとに1回、計2回呼ばれ、PR Progressは2/2→1/2へ一致する。

## 検証結果

| 検証 | 結果 | 診断ラベル |
| --- | --- | --- |
| 新規受入単独 | 50/50成功 | `pds07-acceptance-complete-green` |
| focused | 116/116成功 | `pds07-focused-green` |
| 既定unit | 847件中845成功・0失敗・2skip | `pds07-unit-green` |
| tooling | 16/16成功 | `pds07-unit-green`内 |
| build | 成功 | `pds07-build` |
| contract typecheck | 成功 | `pds07-contracts` |
| architecture | 成功 | `pds07-architecture` |
| architecture negative | 期待11件と一致 | `pds07-architecture-negative` |
| lint | 成功 | `pds07-lint` |
| `git diff --check` | 成功 | Git直接確認 |

2件のunit skipはPOSIX signal lifecycle fixtureで、Windows実行時の既存skipである。今回の受入試験にskipはない。
`npm ci`は成功した。npmは既存依存関係について1 moderate / 4 highの脆弱性を報告したが、`package-lock.json`は変更しておらず、本タスクでは依存関係更新を行っていない。

## CI

受入試験commit `2f1b3d516209182cfcf867149306a8a2152cda60` とhead SHAが一致するpull_request CIはrun `35150950188`。本report記述時点では`in_progress`であり、成功とは扱わない。
本report・handoff・trackingを別commitとしてpushするとPR current HEADが変わるため、公開後は新しいHEADに一致するrunだけを確認する。`35150950188`や過去SHAのrunを新HEADの代用にはしない。
## 変更ファイル

- `test/unit/pr-diff-selection-acceptance.test.ts`: 設計表全行の実経路受入。
- `package.json`: 新規受入試験をfocused suiteと既定unitへ追加。
- `reports/pr120-pds07-implementation-20260917.md`: 本詳細レポート。
- `handoffs/issue-119-pr120-pds07-implementation-20260917.yaml`: 次工程への引継ぎ。
- `tasks/pr-diff-selection-mode/tasks-status.md`: PDS-06再レビュー結果とPDS-07実装状態を同期。
- `tasks/pr-diff-selection-mode/phases-status.md`: 接続と受入フェーズの現在位置を同期。

## 意図的に変更していない範囲

- `src/`: 新規受入で製品欠陥を検出しなかったため変更なし。
- `Design/pr-diff-selection-mode.md`: 受入条件の変更はない。
- `.github/workflows/ci.yml`: 既存の失敗診断artifact経路が要件を満たす。
- PDS-08以降のテスト／実装: 別タスクのため未着手。

## 残範囲

PDS-07は実装・検証完了だが、通常レビューは未実施である。PDS-08の古い比較・競合・再読込、PDS-09の実Extension Host、PDS-10の統合通常レビュー・独立レビュー・最終公開監査は残る。
mergeは実施しない。mergeは利用者が行う。

## 次の操作

PDS-07の通常レビューを行い、この受入試験が設計表全行を実経路で正しく検証しているか、期待値が実装に追従して誤って固定されていないか、既存PDS-01〜06契約との重複・欠落がないかを確認する。レビュー収束後にPDS-08へ進む。
## 変更ファイル

- `test/unit/pr-diff-selection-acceptance.test.ts`: 設計表全行を実runtime・保存・履歴・PR Progressへ接続する受入試験。
- `package.json`: 新規受入試験を`test:pr-diff-selection`と`test:unit`へ常設組込み。
- `reports/pr120-pds07-implementation-20260917.md`: 本詳細レポート。
- `tasks/pr-diff-selection-mode/tasks-status.md`: PDS-06再レビュー結果とPDS-07実装状態を同期。
- `tasks/pr-diff-selection-mode/phases-status.md`: 接続と受入フェーズの現在位置を同期。
- `handoffs/issue-119-pr120-pds07-implementation-20260917.yaml`: 次レビュー向けの引継ぎ。

## 意図的に変更していない範囲

- 製品コード: 新規受入試験で設計上の不足を検出しなかったため変更なし。
- `Design/pr-diff-selection-mode.md`: 受入条件そのものの変更はない。
- `.github/workflows/ci.yml`: 既存の失敗診断artifact経路が要件を満たすため変更なし。
- PDS-08: stale比較、CAS競合、保存失敗、再読込は未着手。
- PDS-09: 実Extension Hostでの左右装飾・PR Progress同期は未着手。
- PDS-10: 統合通常レビュー、独立最終レビュー、最終公開監査は未着手。

## コミットと公開

受入試験とtest wiringは論理コミット`2f1b3d516209182cfcf867149306a8a2152cda60`（`test: cover PR diff selection acceptance`）としてRDCのgitからPRブランチへpush済み。GitHub connectorでPR current HEADが同SHAであることを確認した。
本report・tracking・handoffは別の管理コミットとし、そのpush後はPR current HEADが変わるため、新しいHEADに一致するpull_request CIだけを確認する。
## 未完了・残リスク

PDS-07の受入試験は実装・ローカル検証済みだが、通常レビューは未実施である。そのためPDS-07は通常レビュー待ちとして扱い、PR全体の合格やIssue完了とはしない。
既存製品挙動が新規受入条件を最初から満たしたため、製品欠陥を示す有効なRedは存在しない。fixture不備による一時失敗は製品Redとして扱わない。
実Extension Hostでの表示装飾同期、競合・再読込、最終独立レビューは後続タスクに残る。

## 次の操作

同じPRのPDS-07通常レビューを、受入試験commit `2f1b3d516209182cfcf867149306a8a2152cda60` と管理commitを含む公開HEADに対して行う。レビューで必須指摘が出た場合は同じfinding identityを保持して修正・再検証する。
通常レビュー収束前にPDS-08へ進めない。mergeは利用者が行うため実施しない。

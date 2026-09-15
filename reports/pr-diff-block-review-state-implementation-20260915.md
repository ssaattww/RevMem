# PR差分ブロック状態更新 実装レポート

## 対象

- Repository: `ssaattww/RevMem`
- PR: `#120`
- branch: `investigation/issue-119-linked-diff-blocks`
- 対象タスク: `PDS-05`
- 実装技術HEAD: `a56499ecb0d339c651b18372625acf6894960bf1`
- 実装開始時HEAD: `49e395731724f7f3e8defef4a6bc8b21875e8c7f`
- 永続化方式: `normal_persistence: repository_file`
- 管理report commit: `commit_pending`
- 次タスク: `PDS-06`。本作業では未着手。

## 実装範囲

変更ブロック操作専用の状態更新契約を追加した。既存のoriginal selection操作へ偽装せず、操作元は`invokedFrom`として保持する。

- `originalReviewedByDiff[diffId]`
- modified Contextの`modifiedReviewed`
- Globalの`reviewed`

上記3成分を1つのexpected/next transactionで扱い、mark/unmarkを同一原子更新単位にした。対象範囲が空の不存在成分は新規生成しない。

## 状態差分とPR Global

semantic changeはexpected/next全体を比較し、`updatedAt`だけを無視する。範囲が同じでもファイルの存在、path、revision、content hash等が変われば変更として扱う。
PRのowner Globalが対象HEADと異なる場合は、対象HEADのrevision snapshotへGlobal差分を反映する。Globalにsemanticな変更がないoriginal-only操作では、owner Globalも不存在snapshotも変更しない。

## 履歴

modified ContextまたはGlobalのどちらかが変化した場合はmodified履歴を1件生成し、ContextとGlobal双方のbefore/afterを保持する。originalが変化した場合だけoriginal履歴を生成する。両方が変化した場合の順序はmodified、originalとした。

保存失敗時は履歴記録処理へ進まない。Context fileが存在せずGlobalだけ変化する解除でも、Global側のファイル識別情報からfile pathとrevisionを得てmodified履歴を残す。

## TDD証拠

新規テストは`test/unit/diff-block-review-state.test.ts`へ実装より先に追加した。診断ラッパーのWindows起動経路は`cmd.exe /d /s /c`へ補正し、次のRedを実装編集前に保存した。

`node tools/run-ci-command.mjs diff-block-state-red cmd.exe /d /s /c "npm run test:diff-block-state"`

- 終了コード: 2。
- 未実装の`hasReviewStateSemanticChange`、`markDiffBlockReviewed`、`unmarkDiffBlockReviewed`、`DiffBlockReviewRangeMutationInput`が原因でcompile failureとなった。
- 証拠: `test-output/ci/diff-block-state-red.result.json`、`stdout.log`、`stderr.log`、`log`。
- 実装開始時HEADを使った後追い再現 `diff-block-state-start-head-red` でも、block専用APIがない状態のcompile failureを確認した。これは補助証拠であり、TDD Redの時系列根拠は上記`diff-block-state-red`である。

実装後の最終Green:

`node tools/run-ci-command.mjs diff-block-state-green-final cmd.exe /d /s /c "npm run test:diff-block-state"`

- 12成功 / 0失敗。
- 置換108組、追加18組、削除6組の132基本ケースをループで全て検証する。
- Global-only、original+Global、1行block、対象外範囲保持、繰返し/no-op、メタデータ差、保存失敗、PR Global snapshot、不存在成分を追加検証する。
## 最終検証

| 検証 | 結果 | 証拠 |
| --- | --- | --- |
| focused | 12成功 / 0失敗 | `diff-block-state-green-final` |
| 関連回帰 | 42成功 / 0失敗 | `diff-block-regression-final` |
| compile・型契約・構造・負例構造・lint | 成功 | `diff-block-static-final` |
| 負例構造 | 期待11件と一致 | `diff-block-static-final` |
| `git diff --check` | 成功 | whitespace errorなし |

関連回帰は`review-state-service`、`review-history-original-side`、`diff-review-state-service`、`t405-pull-request-review-runtime`を実行した。

既定unit全体は成功ではない。

- 変更後: 781テスト中755成功、24失敗。
- 実装開始時HEADのpristine worktree: 770テスト中744成功、24失敗。
- 正規化した失敗テスト名は双方23種類で完全一致し、変更後だけの失敗は0件、pristineだけの失敗も0件だった。
- 代表的な`issue-13-r6-review-followup`はpristine HEADでも8件中5件が`document path is outside the resolved Git working tree.`で失敗した。
- baseline証拠: `test-output/ci/baseline-unit.*`、`test-output/ci/baseline-issue13-r6.*`。

したがって24失敗はPDS-05による新規回帰ではないと比較実行で確認した。ただし既定unit自体は失敗であり、成功とは扱わない。

## 診断workflow

作業開始時に`.github/workflows/ci.yml`を確認した。主要検証は`tools/run-ci-command.mjs`を通り、失敗時に`test-output/`等をartifactへ保存する既存workflowがある。結果JSON、標準出力、標準エラー、調査ログを取得可能なためworkflow変更は行っていない。
## 対象ファイル

- `src/core/review-state/review-state-service.ts`
- `src/core/review-state/pull-request-review-state-service.ts`
- `src/core/review-state/index.ts`
- `src/application/review-history/review-history-recorder.ts`
- `src/application/repository-global-state/repository-global-state-repository.ts`
- `src/adapters/document-review-state/reconciled-document-review-state-session-provider.ts`
- `test/unit/diff-block-review-state.test.ts`
- `package.json`

Repository Global側は新しいoperation unionを受けられるように型を伝播し、reconciliation側は`ReviewStateTransaction` union拡張に合わせてblock transactionの`invokedFrom`と`diffId`を保持する。通常editorや設定経路へblock動作は接続していない。

## コミットと公開

実装・テストの論理コミットは`a56499ecb0d339c651b18372625acf6894960bf1`。RDCのgitから`origin/investigation/issue-119-linked-diff-blocks`へpush済みで、GitHub PR #120のHEAD一致を確認した。

本report、handoff、タスク/フェーズ同期は別の管理コミットにする。本report自身の将来SHAは記載しない。管理コミット後のPR current HEADに対するCIは外部記録で確認し、別SHAのrunを代用しない。

## 残範囲

- `reviewRange.prDiffSelectionMode` の設定公開とPR限定コマンド経路への接続は未実施。
- 設計表全行の結合受入、競合・再読込、実Extension Host検証は未実施。
- 最終通常レビュー、独立レビュー、最終exact-head CIは後続タスクの範囲である。
- PRはdraftのまま維持し、mergeは行わない。
- 次の実装対象はPDS-06。利用者の追加指示までは開始しない。

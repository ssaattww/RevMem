# PR差分ブロック状態更新 実装レポート

## 対象

- Repository: `ssaattww/RevMem`
- PR: `#120`
- branch: `investigation/issue-119-linked-diff-blocks`
- 対象タスク: `PDS-05`
- core実装commit: `a56499ecb0d339c651b18372625acf6894960bf1`
- 最終技術HEAD: `7e01bd4c6c9f97acc78f93e45161fbee7c71bec6`
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

新規テスト`test/unit/diff-block-review-state.test.ts`はcore実装編集より先に作成した。ただし最初の診断ラッパー実行はWindows上の`npm`起動方法が原因で製品Redを取得できず、有効な`diff-block-state-red`を保存した時点ではcore実装断片の編集が始まっていた。このため「失敗確認後に実装開始」という厳密な時系列は満たしていない。

実装開始時HEAD `49e395731724f7f3e8defef4a6bc8b21875e8c7f`へ最終担当テストを一時配置した`diff-block-state-start-head-red`では、block専用API未実装によるcompile failure（exit 2）を再現した。これは未実装状態でテストが失敗することの再現証拠であり、時系列を遡ってTDD完了とみなすものではない。

追加の検証修正では、各修正前に`pds05-windows-path-fixture-red`（33件中19失敗）と`pds05-hunk-body-fixture-red`（18件中3失敗）のRedを保存してからfixtureを修正した。Extension Hostの待機修正は既定unitで発生した`timed-out`誤分類をRed証拠とした。

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
| compile・型契約・構造・負例構造・lint | 成功 | `pds05-static-after-unit-fix` |
| 負例構造 | 期待11件と一致 | `pds05-static-after-unit-fix` |
| 既定unit | 780成功 / 0失敗 / 2skip | `pds05-unit-final` |
| POSIX fixture回帰 | 33成功 / 0失敗 | `pds05-windows-path-fixture-green2` |
| immutable本文fixture回帰 | 18成功 / 0失敗 | `pds05-hunk-body-fixture-green` |
| Extension Host安定性 | 3件×3回、9成功 / 0失敗 | `pds05-owned-extension-host-stability` |
| `git diff --check` | 成功 | whitespace errorなし |

関連回帰は`review-state-service`、`review-history-original-side`、`diff-review-state-service`、`t405-pull-request-review-runtime`を実行した。

既定unit全体は、利用者指示後の検証修正を含む最終技術HEADで成功した。

- `pds05-unit-final`: 782件中780成功 / 0失敗 / 2skip。toolingは別集計で16/16成功。
- 旧Windows失敗の主因は、POSIX意味論fixtureがhost依存の`path.resolve`を使いWindowsで`C:\repo`へ変換されていたこと。製品の境界検証は変更せず、fixtureを`path.posix.resolve`へ揃えた。focusedはRed 14/33成功・19失敗からGreen 33/33へ改善した。
- immutable diffの3失敗は、PDS-02で追加した本文/hunk照合に対して旧fixture本文がhunk内容と不一致だったことが原因。本文fixtureを正しいoriginal/modified内容へ揃え、focusedは15/18成功・3失敗から18/18成功へ改善した。
- Extension Hostの一過性1件は、success IPC受信前に250msのdeadlineへ達し`failed`ではなく`timed-out`へ誤分類された。success-without-close試験だけ待機上限を1,000msへ広げ、対象3件を3連続実行して9/9成功を確認した。
- `pds05-static-after-unit-fix`: build、型契約、architecture正負、lintすべて成功。負例architectureは期待11件と一致した。

失敗をskip化したり製品のfail-closed検証を緩めたりせず、fixtureの意味論と試験待機だけを修正した。

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
- `test/unit/document-review-state-session-provider.test.ts`
- `test/unit/issue-13-atomic-reconciliation-review.test.ts`
- `test/unit/issue-13-baseline-metadata-review.test.ts`
- `test/unit/issue-13-owner-reconciliation-review.test.ts`
- `test/unit/issue-13-r5-review-followup.test.ts`
- `test/unit/issue-13-r6-review-followup.test.ts`
- `test/unit/issue-112-pr-progress-runtime.test.ts`
- `test/unit/issue-66-pr68-review-findings.test.ts`
- `test/unit/owned-extension-host-launch.test.ts`

Repository Global側は新しいoperation unionを受けられるように型を伝播し、reconciliation側は`ReviewStateTransaction` union拡張に合わせてblock transactionの`invokedFrom`と`diffId`を保持する。通常editorや設定経路へblock動作は接続していない。

## コミットと公開

core実装・担当テストの論理コミットは`a56499ecb0d339c651b18372625acf6894960bf1`。検証修正は`9069379ced11cb86a140d10ce2fc0fa53ff4e1e2`（POSIX fixture）、`e9d4d6f92515df7f1824984ea9b42cdfcb18a717`（immutable本文fixture）、`7e01bd4c6c9f97acc78f93e45161fbee7c71bec6`（Extension Host待機）に分離してRDCのgitからpushした。

本report、handoff、タスク/フェーズ同期は別の管理コミットにする。本report自身の将来SHAは記載しない。管理コミット後のPR current HEADに対するCIは外部記録で確認し、別SHAのrunを代用しない。

## 残範囲

- `reviewRange.prDiffSelectionMode` の設定公開とPR限定コマンド経路への接続は未実施。
- 設計表全行の結合受入、競合・再読込、実Extension Host検証は未実施。
- 最終通常レビュー、独立レビュー、最終exact-head CIは後続タスクの範囲である。
- PRはdraftのまま維持し、mergeは行わない。
- 次の実装対象はPDS-06。利用者の追加指示までは開始しない。

# Sub-agent実行レポート

## タスク

- 目的: `PR94-CI-002B`としてDiffEditor command-serviceへoriginal mapping sessionと互換helperをTDDで接続する。
- タスク種別: TDD implementation / CI repair slice 3

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/highで、compile diagnostics 4件を単一境界として0.5h以内に閉じるため。

## 対象範囲

- 対象: review-commandsのplan/index/command-serviceと、その直接focused tests。

## 対象外

- 対象外: core review-state、T405 runtime、snapshot実装、design/workflow/package/tracking、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- 実行コマンド: 既存Redを再利用した（`npm run compile:test`の10 diagnostics: command-service境界4件、core review-state 3件、T405 runtime 3件）。Redは指示どおり再実行していない。
- 実行コマンド: `rg -n -C 2 "DiffEditorReviewStateSession|originalToModifiedLineMappings|deriveOriginalToModifiedLineMappings|projectOriginalIntervalsToModified" src test`でsession fixtureと直接focused testを照合した。
- 実行コマンド: `npm run compile:test`を1回実行。command-service境界4件は消滅し、core review-state 3件とT405 runtime 3件のみが残った。
- 実行コマンド: `node --test test-dist/test/unit/original-diff-selection-projection.test.js test-dist/test/unit/diff-editor-review-command-service.test.js`を1回実行。13件中10件成功、3件失敗。
- 実行コマンド: `npm run lint`を1回実行し成功（`eslint src test --max-warnings=0`）。
- 実行コマンド: `git diff --check`を1回実行し成功（既存working copyのLF/CRLF警告のみ）。

## 対象ファイル

- 変更または確認したファイル: `src/application/review-commands/original-selection-review-plan.ts`に、検証済みの`buildOriginalSideLineProjection`と`createOriginalSelectionReviewPlan`へ委譲する`deriveOriginalToModifiedLineMappings`/`projectOriginalIntervalsToModified`を追加した。
- 変更または確認したファイル: `src/application/review-commands/diff-editor-review-command-service.ts`の`DiffEditorReviewStateSession`に、未供給時を後続操作でfail-closedに扱えるoptionalな不変`originalToModifiedLineMappings`契約をJSDoc付きで追加した。
- 変更または確認したファイル: `src/application/review-commands/index.ts`は既存のplan module re-exportにより互換APIを公開済みであり、追加変更は不要だった。
- 変更または確認したファイル: `test/unit/diff-editor-review-command-service.test.ts`、`test/unit/original-diff-selection-projection.test.ts`、Issue #92のfocused tests/designをread-onlyで確認し、既存testが必要なAPI契約を直接カバーするためtest編集は不要だった。

## 指摘事項

- 指摘要約: compileの10 diagnosticsからcommand-service境界4件（session field不足2件、index export不足2件）は解消した。残る6件は対象外のcore review-state export不足3件とT405 `validateDiffDocumentPair`不足3件のみである。
- 指摘要: focused testの失敗3件は、original-sideのmapped modified rangeとoriginal-only deletion rangeを単一transactionに統合していない既存command-service実装に起因する。今回の互換helper/契約境界には失敗がなく、mapping導出・zero-count anchor・ambiguous gap拒否は成功した。

## 結果

- 結果: Green（slice境界）。`compile:test`でこのsliceの4 diagnosticsは0件となり、残存diagnosticsはすべて次境界である。公開APIにはJSDocを付け、mapping生成・投影は重複実装せず既存のimmutable/fail-closed plan primitivesへ委譲した。
- 結果: source/test/design/workflow/package/trackingには、このslice範囲外の新規変更を行っていない。既存の51 staged temporary-path deletionおよび親所有の変更は保持したまま、stage/revertしていない。

## リスク

- 未解決のリスクまたは後続対応: 次のbounded sliceで、command-serviceのoriginal-side mark/unmarkを`createOriginalSelectionReviewPlan`で計画し、mapped modified/Globalとoriginal-only rangeを単一transactionに統合する。これによりfocused testの残る3失敗を閉じる。
- 未解決のリスクまたは後続対応: その後は別sliceとしてcore review-stateの`markOriginalSelectionReviewed`/`unmarkOriginalSelectionReviewed` 3 diagnostics、さらに別境界でT405 `validateDiffDocumentPair` 3 diagnosticsを実装する。compile/build/full testは、これらのplaceholder境界が解消されるまでGreenにならない。

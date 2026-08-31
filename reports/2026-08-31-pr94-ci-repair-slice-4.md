# Sub-agent実行レポート

## タスク

- 目的: `PR94-CI-002C`としてcore composite operationとcommand-serviceのoriginal-side mark/unmarkを単一atomic transactionへ統合する。
- タスク種別: TDD implementation / CI repair slice 4

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/highで、focused Red 3件を単一command-service境界として閉じるため。

## 対象範囲

- 対象: core review-state composite operation、history contract、DiffEditor review command-serviceと直接focused tests。

## 対象外

- 対象外: T405 runtime、snapshot実装、design/workflow/package/tracking、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- 実行コマンド: 直前のfocused Redを再利用した。`node --test test-dist/test/unit/original-diff-selection-projection.test.js test-dist/test/unit/diff-editor-review-command-service.test.js`は13件中3件失敗で、original-sideのmapped rangeとoriginal-only deletion rangeが同一transactionではなかった。Redは指示どおり再実行していない。
- 実行コマンド: `npm run compile:test`を実行。既知T405 3 diagnosticsに加え、composite operation union追加により`repository-global-state-repository.ts`の網羅switch 1件が露出した。
- 実行コマンド: unionの直接影響を最小修正後、emit済みfocused testを正確に評価するため`npm run compile:test`を例外的に再実行した。残存は対象外のT405 `validateDiffDocumentPair` 3 diagnosticsのみ。
- 実行コマンド: `node --test test-dist/test/unit/original-diff-selection-projection.test.js test-dist/test/unit/diff-editor-review-command-service.test.js`を1回実行し、13件中13件成功。
- 実行コマンド: `npm run lint`を1回実行し成功（`eslint src test --max-warnings=0`）。
- 実行コマンド: `git diff --check`を1回実行し成功（既存working copyのLF/CRLF警告のみ）。

## 対象ファイル

- 変更または確認したファイル: `src/core/review-state/review-state-service.ts`に、型安全な`markOriginalSelectionReviewed`/`unmarkOriginalSelectionReviewed`とcomposite original-selection transaction unionを追加した。mapped modified Context/Globalと`${baseSha}..${headSha}`のoriginal-only stateを一つのexpected/next snapshotへ作成する。
- 変更または確認したファイル: `src/core/review-state/index.ts`でcomposite API/input typeを公開し、`src/application/repository-global-state/repository-global-state-repository.ts`ではこのoriginal-only operationを既存modified-only boundaryから明示除外した。
- 変更または確認したファイル: `src/application/review-history/review-history-recorder.ts`はcomposite transactionをmodified、originalの順に差分のあるeventだけへ展開する。既存original-only transactionの履歴契約は維持した。
- 変更または確認したファイル: `src/application/review-commands/diff-editor-review-command-service.ts`はoriginal selectionを`createOriginalSelectionReviewPlan`へ渡し、mapping未供給時はno-opでfail closedとし、composite core APIを一回だけcommit/historyへ渡す。
- 変更または確認したファイル: `test/unit/original-diff-selection-projection.test.ts`のhistory call countを、single composite transactionの一回のhistory委譲へ補正した。recorder単体testの既存契約どおり、そこでmodified→originalの2 eventを生成する。

## 指摘事項

- 指摘要: 当初のcommand-service-only scopeでは、focused testが要求する`mark/unmark-original-selection-reviewed` operationがcore unionに存在せず、unsafe assertionなしには型安全に実装できなかった。親承認でcore composite operation/history contractを同sliceへ統合した。
- 指摘要: design §5.1.1は、対応不明・矛盾・staleな入力を更新せず、original selectionのContext・Global・original stateを一回のatomic transactionでcommit後にmodified→original順で履歴化することを要求する。実装はplan validationとcore validationに委譲し、この順序を満たす。

## 結果

- 結果: Green。focused Red 3件は13件中13件成功へ転じ、新規focused failureはない。mark/unmarkの両方でcommitter callは一回、transaction operationは`mark-original-selection-reviewed`または`unmark-original-selection-reviewed`、`side`は`original`、`diffId`はcanonical `${baseSha}..${headSha}`である。
- 結果: `compile:test`ではslice前のcore review-state 3 diagnosticsも解消した。残るcompile diagnosticsはT405 `validateDiffDocumentPair` 3件だけで、このsliceではT405/snapshot/runtimeを変更していない。commit、push、CI wait、review、mergeは行っていない。

## リスク

- 未解決のリスクまたは後続対応: 次のbounded sliceはT405 runtimeの`validateDiffDocumentPair` 3 diagnosticsを、immutable snapshot/source contractを変更せず実装する。その後にcompile/testの残るplaceholder境界を再評価する。
- 未解決のリスクまたは後続対応: PR runtime/extension側のuser-selection history reason routingは、このsliceのT405 runtime非変更制約により未配線である。core recorderのevent順序は型安全に実装済みだが、runtime接続後にfocused runtime testで確認する。

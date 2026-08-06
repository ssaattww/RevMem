# Sub-agent実行レポート

## タスク

- 目的: PR #42 の未解決 `T305-IFR-001`・`T305-IFR-002` sibling caseをTDD修正する
- タスク種別: review follow-up implementation R2

## sub-agentを使う理由

- 理由: finding continuityを保ち、初回修正担当の `terra/high` が同じruntime contractの追加修正を行うため

## 対象範囲

- 対象: 開始HEAD `0fe4050`。branch切替、選択候補消滅、detached HEAD、複数repositoryでTree/Statusとruntime command/decoration identityを一致させる

## 対象外

- 対象外: IFR-003/004の追加変更、T505、PR #44、tracking、design、BreakingChanges、依存・workflow、commit、push、merge

## 実行コマンド

- 開始確認: `git rev-parse HEAD`で `0fe4050ddd410168f0f7b94695abe31f673e150c`、予約済み本レポートだけが未追跡であることを確認した。
- Red: `npm run compile:test && node --test --test-name-pattern "refresh replaces|selected detached" test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/document-review-state-session-provider.test.js`を実行した。候補消滅後のrefreshで`selection:workspace:workspace`がなく、旧branch identityがruntimeに残るassertion failureを確認した。detachedは既存contractにvariantがなくselection identityを構成できないことをsource/direct providerから確認した。
- Green: `npm run test:t305`は13 tests / 13 pass。`node --test --test-name-pattern "selected (workspace|branch)|selected detached" test-dist/test/unit/document-review-state-session-provider.test.js`は3 tests / 3 pass。
- Broader: `npm run build`、`npm run typecheck:contracts`、`npm run validate:architecture`、`npm run validate:architecture:negative`（expected 11 violations）、`npm run lint`はいずれもexit 0。`npm run test:vscode`はexit 0。`git diff --check`はexit 0。
- Unit: `npm run test:unit`は432 tests中411 pass、19 fail、2 skipped、exit 1。19 failuresは既知Issue #28のWindows POSIX fixture portabilityで、共通診断は`document path is outside the resolved Git working tree.`であり、本変更で成功へ変換していない。

## 対象ファイル

- 変更: `src/ui/current-context/current-context-candidate-selection.ts`、`src/ui/current-context/current-context-ui-controller.ts`、`src/ui/current-context/current-context-runtime-coordinator.ts`、`src/ui/current-context/index.ts`、`src/t305-extension.ts`、`src/application/review-context/selected-review-context.ts`、`src/adapters/document-review-state/git-context-document-review-state-session-provider.ts`、`test/unit/current-context-ui.test.ts`、`test/unit/document-review-state-session-provider.test.ts`、本レポート。
- 確認: source fix verification report、T305 current runtime contract、base runtime port、DocumentReviewStateSessionProvider、Extension Host suite、design 16.2/16.6/16.7/16.8。

## 指摘事項

- `T305-IFR-001`: `CurrentContextRuntimeCoordinator.refresh()`がcontrollerのaccepted authoritative snapshotをruntimeへ設定してからdependent refreshするよう修正した。stale refreshはruntime identityを消去しない。`CurrentContextCandidateSelection`はexplicit selectionが候補から消えた時点でkeyをclearし、active editor候補または先頭候補へfallbackするため、UIとruntime identityが同一snapshotへ揃う。
- `T305-IFR-001`: detached HEADを`repositoryId`、`repositoryRoot`、immutable `headRevision`を持つ`SelectedReviewContext` variantへ追加した。selection key、T305 composition、DocumentReviewStateSessionProvider routingまで同じidentityを使用し、別repositoryではautomatic routingへ戻らずcommandは拒否・decorationは空表示になる。
- `T305-IFR-002`: production codeで使用するcandidate selection componentを切り出し、成功Quick Pick、Tree/Status、runtime command/decoration refresh、branch replacement、候補消滅、detached identityを1つのbehavior testで確認した。provider routing testはWorkspace、Branch、detachedと別repository rejectionを確認する。
- IFR-003/004は変更していない。`npm run test:t305`と`npm run test:vscode`で既存wiring/error-boundary coverageの回帰なしを確認した。

## 結果

- 実測Redの後に最小修正を適用し、focused Green、required broader validation、Extension Hostを完了した。commit、push、merge、PR操作、tracking/design/BreakingChanges編集は実施していない。最終HEADはcommit未実施のため開始HEADと同じ `0fe4050ddd410168f0f7b94695abe31f673e150c`。

## リスク

- Windowsの`npm run test:unit`にはIssue #28既知のPOSIX fixture portability failureが19件残る。interactive Desktopでの実際の複数repository Quick Pick選択およびRemote/multi-rootの視覚確認は未実施であり、後続の独立reviewで確認対象とする。
- Detached HEADが新しいimmutable revisionへ移動した場合はcandidate key不一致としてexplicit selectionをclearしfallbackする。候補列挙とactive editor切替の極端な並行raceはgeneration guardでstale runtime更新を抑止するが、手動stress確認は未実施である。

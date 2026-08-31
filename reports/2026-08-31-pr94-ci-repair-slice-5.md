# Sub-agent実行レポート

## タスク

- 目的: `PR94-CI-002D`としてT405 runtimeのexact diff document pair検証をTDDで実体化する。
- タスク種別: TDD implementation / CI repair slice 5

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/highで、残るcompile diagnostics 3件をT405単一境界として閉じるため。

## 対象範囲

- 対象: `PullRequestReviewRuntime.validateDiffDocumentPair`と直接focused T405/Issue #92 tests。

## 対象外

- 対象外: snapshot実装、他runtime、design/workflow/package/tracking、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- 実行コマンド: 既存Redを再利用した。`npm run compile:test`のT405 `PullRequestReviewRuntime.validateDiffDocumentPair`未定義3 diagnosticsは指示どおり再実行していない。
- 実行コマンド: `npm run compile:test`を1回実行し成功。T405 compile diagnosticsは3→0となった。
- 実行コマンド: `node --test test-dist/test/unit/t405-pull-request-review-runtime.test.js test-dist/test/unit/issue-92-pr-progress-selection-review.test.js`を1回実行。14件中10件成功、4件失敗。scope外failureのためlintおよび`git diff --check`は指示どおり実行していない。

## 対象ファイル

- 変更または確認したファイル: `src/t405-pull-request-review-runtime-base.ts`にpublic JSDoc付き`validateDiffDocumentPair`を追加した。両URIを既存`ReviewDiffUriCodec`でcanonical decodeし、current registrationの各fileから生成したoriginal/modified URI pairと完全一致した場合だけrepository/context/file identityおよびimmutable descriptorsを返す。
- 変更または確認したファイル: Issue #92 design §5.1.1、§8.1および`test/unit/t405-pull-request-review-runtime.test.ts`をread-onlyで確認した。path文字列だけの比較は行わず、context、path semantics、side order、revision source、BASE/HEAD、exact pair provenanceを検証する。

## 指摘事項

- 指摘要: stale BASEおよびHEAD URI pairは現在registrationとの差異でrejectされ、既存T405 direct testは成功した。reversed side、異context、異path semantics、noncanonical URI、mixed file pair、binary/absent-side source不一致もcanonical pair再生成との不一致によりfail closedとなる。
- 指摘要: focused testの4 failureはこのpublic methodのcompile/runtime contractではなく既存未結線境界である。(1) Issue #92 static testが旧`commitTransactionSequence` helperを要求、(2) T405 `openSession`が`originalToModifiedLineMappings`をまだ供給しないためoriginal selectionがno-op、(3) 同じ未供給によりT405 PR Progress atomic selection testが失敗、(4) `src/t305-extension.ts`が`TabInputTextDiff`のactive pairを`validateDiffDocumentPair`へまだ配線していない。

## 結果

- 結果: compile Green（3→0）、ただしfocused testは10/14で停止。scope外failureがあるため、このslice全体をGreenとは扱わず、lint/diff-check/full/default/Host/performance/CIは未実行である。
- 結果: snapshot実装、他runtime、package/design/workflow/tasks、commit/push/review/mergeは変更していない。

## リスク

- 未解決のリスクまたは後続対応: 次のbounded sliceでT405 `openSession`へvalidated immutable hunk mappingを供給し、original-side selection focused failures 2件を閉じる。mappingはsnapshot/runtime provenanceから得て、未供給・stale・不正pairをfail closedに保つ。
- 未解決のリスクまたは後続対応: その後、別sliceでT305 extensionの`TabInputTextDiff` original/modified pairをmutation前に`validateDiffDocumentPair`へ配線する。Issue #92 static testの旧`commitTransactionSequence`期待は、型安全なcomposite core APIへ置換済みのため、test contractを更新するか互換helperが必要かを親が判断するまで変更しない。

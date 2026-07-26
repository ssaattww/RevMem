# Issue #13 Review Follow-up R3

## 対象

- Issue: #13 ワークスペース外のファイル対応
- Pull Request: #15
- Branch: `issue/13-document-context-routing`
- 指摘元: `reports/issue-13-review-r3-20260725095458.md`
- 対応対象: blocking finding 2件

## Finding 1: Issue #13回帰テストがCI入口へ明示登録されていない

### 問題

Issue #13で追加したtest fileはTypeScript compile対象には含まれていたが、`package.json`の`test:unit`および`test:git`へ明示列挙されていなかった。

別testからのimportに依存する構成では、import削除やtest runner入口変更によって回帰testが無言で未実行になる。最終CIの成功だけではIssue #13の回帰test実行を証明できない。

### 対応

`package.json`へIssue #13のtest fileを明示登録した。

Unit:

- `document-review-state-regressions.test.js`
- `document-review-state-session-provider.test.js`
- `external-file-state-repository.test.js`
- `issue-13-baseline-metadata-review.test.js`
- `issue-13-owner-reconciliation-review.test.js`

Git:

- `local-git-head-classification-review.test.js`
- `local-git-ownership-classification.test.js`

一時的に`core-contracts.test.ts`へ追加していたimport集約は削除し、各test fileをrunnerが直接実行する構成へ戻した。

`package.json`のT300設定、PR #22のrelease contract test、その他のmain由来test入口は変更していない。

## Finding 2: content hash変更時にbaseline metadataを更新しない

### 問題

`ownerReconciliation`の早期returnは確認済みintervalだけを比較していた。

そのため、旧baselineが`H1 / A`、現在sourceとtargetが`H2 / A`の場合、intervalが同じという理由でbaselineを`H2`へ更新しなかった。

後続でfallback ownerへ範囲Bを追加しても、次のGit復旧時にbaseline hash不一致としてlegacy分岐へ入り、Bを移行しないままbaselineだけを進める可能性があった。

### TDD

`test/unit/issue-13-baseline-metadata-review.test.ts`を先に追加した。

検証sequence:

1. workspace H1で範囲Aを確認
2. Git H1へ昇格し、baseline H1/Aを作成
3. Git H2で範囲Aを確認
4. fallback workspace H2でも範囲Aを確認
5. Git復旧時、intervalが同じでもbaselineをH2へ更新
6. fallbackへ範囲Bを追加
7. 次のGit復旧でA+Bになる

### Red

- head: `e22475dd30d67f2d33f5d71d58750f4cf8c1e570`
- workflow run: `30137797858`
- Build: success
- Lint: success
- Unit tests: failure
- failure: baseline content hashが`hash-h1`のまま残り、期待した`hash-h2`へ更新されない
- artifact: `ci-failure-diagnostics-30137797858-1`
- artifact ID: `8613418386`

### 実装修正

`OwnerSourceSnapshot`の同一判定を追加し、次の全metadataを比較するよう変更した。

- source owner
- source repository ID
- source context ID
- source file ID
- content hash
- line count
- source createdAt
- source updatedAt
- reviewed intervals

追加・解除deltaが0でもsnapshot metadataが変化している場合は、no-op range transactionを基礎にして`ownerReconciliation`だけをatomic commitする。

早期returnは完全なsource snapshot一致時だけ行う。

## Green

コード・test入口修正後:

- head: `497a9a802bbe8934d12018215c117182e38dfb6c`
- workflow run: `30138311845`
- Install dependencies: success
- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

同repositoryの別branchや他作業者のrunではなく、上記head SHAに紐づくrunだけを判定に使用した。

## Scope確認

- `main` `31218556a31afa8f7f2532a302a593c3df8fc62f`に対してbehind 0
- `tasks/tasks-status.md`は変更していない
- PR #22の4 reportと`release-vsix-contract.test.ts`は変更していない
- T300 runtime、設定、testは変更していない
- `package.json`変更はIssue #13 test fileの明示登録だけ
- マージは行わない

## 再レビュー

確認観点:

- Issue #13 test fileがrunnerから直接実行される
- aggregator importへ依存しない
- interval一致でもcontent hash変更時はbaselineが更新される
- metadata-only更新がatomic transactionで保存される
- baseline更新後のfallback追加が次回復旧で失われない
- T300およびPR #22のマージ済み変更を上書きしない

判定:

- blocking finding: なし
- non-blocking finding: なし

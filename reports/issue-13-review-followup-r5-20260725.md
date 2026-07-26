# Issue #13 R5レビュー指摘対応レポート

## 対象

- Pull Request: #15
- Branch: `issue/13-document-context-routing`
- 指摘元: `reports/issue-13-review-r5-20260725153209.md`
- 基準設計: `doc/design/document-context-routing.md`
- 対応対象: blocking 2件、non-blocking 2件
- held: revision mapping側の既存error分類1件

## 対応概要

R5で検出された次の問題へTDDで対応した。

1. 初回昇格範囲とbaselineが異なるlower-owner snapshotから計算される
2. workspaceとexternal-fileの相反deltaで低優先ownerが高優先ownerを反転する
3. `ownerReconciliation`が正式な永続化contractに含まれず、malformed metadataを検証しない
4. writable `open`がactive ownerを2回解決し、Git inspectionを重複実行する

## Blocking 1: Lower-owner snapshotの二重観測

### 問題

初回昇格時、base providerがlower ownerを読み込んでrangeをpromotion transactionへ入れた後、reconciliation層が同じlower ownerを再読込してbaselineを作成していた。

2回の読込間でsourceがAからBへ変化すると、targetにはA、baselineにはBが保存される。次回openではBが既にbaseline済みと判断され、Bをtargetへ反映できない。

### 修正

- writable `open`ごとに`CapturingRepository`を作成した
- repository targetごとの`load`結果をimmutable snapshotとしてcacheする
- workspace decoration sourceもdescriptorごとにcacheする
- promotion range、delta、baselineを同じsource observationから計算する
- 同じlower ownerを1回のopen中に再観測しない

## Blocking 2: 複数source競合時のowner優先順位

### 問題

workspaceを先に、external-fileを後に処理していても、後段sourceが直前のplanned snapshotへ自由にdeltaを適用できた。

そのため、低優先のexternal-fileが次を行えた。

- workspaceでreviewedと判断されたrangeをremoveする
- workspaceでremoveしたrangeをaddし直す

### 修正

source評価順をworkspace、external-fileとした上で、高優先sourceの判断を保護する。

- `protectedReviewed`: 高優先sourceが現在reviewedと確定したrange
- `protectedUnreviewed`: 高優先sourceがbaselineから明示的にremoveしたrange
- 低優先sourceのremovalから`protectedReviewed`を除外する
- 低優先sourceのadditionから`protectedUnreviewed`を除外する
- 競合しないdeltaと各sourceのbaselineは同じplanned snapshotへ反映する

## Non-blocking 1: 正式な永続化contractとvalidation

### 修正

core contractへ次を追加した。

- `OwnerReconciliationSourceOwner`
- `OwnerReconciliationSourceSnapshot`
- `ReconciledReviewContextState`

全context共通の`ReviewContextState`へ実装固有fieldを直接追加せず、reconciliation metadataを保持する専用subtypeとして定義した。これにより既存context contractとの互換性と、metadataの正式な型を両立する。

filesystem persistenceではoptional additive sectionとして扱う。

- metadataなしの既存schema version 1 stateは有効
- metadataがある場合はsource owner、identity、content hash、line count、interval、timestampを検証
- malformed metadataを無視または自動修復せずload/save/commitで拒否
- round-trip後もsnapshotを保持

## Non-blocking 2: Git inspectionの重複

### 問題

public persisted providerはreconciliation済みsessionを取得した後、`loadForDecoration`でactive ownerを再解決していたため、同じwritable openでGit inspectionが2回発生していた。

### 修正

- reconciliation providerが返すcomplete sessionをそのままpublic sessionとして返す
- 永続化確認目的の2回目のdecoration loadを廃止する
- writable openのactive-owner Git inspectionを1回に固定する
- read-only decoration経路は非変更処理として維持する

## TDD Red

### Lint境界

- head: `1093a3c3f6fd1ff12a03b710f63cf30951c326f7`
- workflow run: `30148716273`
- Build: success
- Lint: failure
- 原因: Red test内の未使用fixture
- artifact: `ci-failure-diagnostics-30148716273-1`
- artifact ID: `8616910517`

Lintだけを修正し、再現条件は変更していない。

### 挙動Red

- head: `2109aa28d4c22edb87db7b26c86a4ed8005c32aa`
- workflow run: `30148815364`
- Build: success
- Lint: success
- Unit tests: failure
- artifact: `ci-failure-diagnostics-30148815364-1`
- artifact ID: `8616941839`

再現した5件:

- promotion rangeはA、baselineはBとなる
- external removalがworkspace reviewed rangeを解除する
- external additionがworkspace removalを復活させる
- writable openのGit inspection回数が2回になる
- malformed reconciliation metadataをloadできてしまう

## 実装中の型境界

### DeepReadonly境界

- head: `d142633dbfc49b8f733eb53700437db63115d61a`
- workflow run: `30149370011`
- Build: failure
- artifact: `ci-failure-diagnostics-30149370011-1`
- artifact ID: `8617112593`

transactionのdeep readonly snapshotをmutable detached cloneへ戻す箇所と、validator引数の型を修正した。

### 既存test viewとのcontract衝突

- head: `7c214a8aeb934276bf8529abeb666f020998d53c`
- workflow run: `30149463090`
- Build、Lint: success
- Unit test compile: failure
- artifact: `ci-failure-diagnostics-30149463090-1`
- artifact ID: `8617142068`

`ownerReconciliation`を基本`ReviewContextState`へ直接追加したことで、既存testの限定viewと衝突していた。正式contractを`ReconciledReviewContextState`へ分離し、基本context contractを変更しない構成へ修正した。

## Green

### 製品・回帰test Green

- head: `935523c6ac5705456e2546e5087d0f91de5617b5`
- workflow run: `30149689346`
- Install dependencies: success
- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

同repositoryの別branchまたは他作業者のrunではなく、このhead SHAに紐づくrunだけを製品Green判定に使用した。

## 回帰test

`test/unit/issue-13-r5-review-followup.test.ts`を`package.json`の`test:unit`へ直接登録した。

固定した条件:

- promotion rangeとbaselineが同じlower-owner observationを使用する
- 次回openで観測後のsource deltaが失われない
- workspace reviewed rangeをexternal removalが反転しない
- workspace removalをexternal additionが反転しない
- writable openのactive-owner Git inspectionが1回
- reconciliation metadataをfilesystem persistenceでround-tripできる
- malformed line countなどのmetadataを拒否する

一時的なaggregator importは削除し、runnerからtest fileを直接実行する。

## 設計書同期

`doc/design/document-context-routing.md`へ次を規範化した。

- 1回のopenで各lower ownerを1回だけ観測する
- promotion、delta、baselineは同じimmutable source snapshotを使用する
- workspaceとexternal-fileの競合ではworkspace判断を優先する
- `ReconciledReviewContextState`を正式な永続化contractとする
- optional additive metadataのvalidation規則
- writable openのactive-owner Git inspectionを1回にする

設計書は機能単位の1ファイル構成を維持し、Issue番号やTask番号を追加していない。

## Held

revision mapping側の`objectExists`におけるexit code 128分類は、このPRで追加または変更したowner routing/reconciliationの範囲外である。

- 本対応では変更しない
- R5 review reportのheld findingとして維持する
- revision mapping機能の担当変更で修正・検証する

## Scope確認

変更していない範囲:

- `tasks/tasks-status.md`
- T300のpolicy、runtime、設定、test
- PR #22のreportと`test/unit/release-vsix-contract.test.ts`
- revision mapping実装
- その他のマージ済み`main`由来ファイル

途中でfilesystem wrapperの仮内容を誤って作成したcommitと、core contractの説明を簡略化したcommitがあったが、いずれも直後に完全な実装・元の詳細documentationへ置換した。最終差分に仮内容やdocumentation欠落は残していない。

本レポートと設計書同期後の最終headに紐づくCI結果は、PR本文とPRコメントへ記録する。マージは実施しない。

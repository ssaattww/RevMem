# Issue #13 レビュー指摘対応レポート

## 対象

- Issue: #13 ワークスペース外のファイル対応
- Pull Request: #15
- Branch: `issue/13-document-context-routing`
- 指摘元: `reports/issue-13-review-r2-20260725075248.md`
- 対応対象: blocking finding 2件

## 指摘1: Git復旧時にfallback側の変更を再調整しない

### 問題

既存Git contextに対象file stateがある場合、従来の`promoteFirstCertainSource`は早期returnしていた。

そのため、Git利用不能中にworkspaceまたはexternal-file ownerへfallbackして追加・解除した確認済み範囲が、Git復旧後の既存Git stateへ反映されなかった。

一方、fallback stateを毎回単純unionすると、Git側で明示的に解除済みの範囲を古いfallback stateから復活させる危険があった。

### TDD

`test/unit/issue-13-owner-reconciliation-review.test.ts`を先に追加した。

- Git stateに範囲Aがある状態でfallback側へ範囲Bを追加し、復旧後にA+Bとなること
- workspace stateのAをGitへ初期移行後、Git側でAを解除し、fallback側でBを追加しても、復旧後にAを復活させずBだけになること

### 修正

- active contextへ下位ownerごとの`ownerReconciliation` baseline snapshotを保持する
- baselineありでは次を計算する
  - 追加差分: `current source - previous source`
  - 解除差分: `previous source - current source`
- 解除差分と追加差分を1回の完全snapshot CAS transactionへまとめる
- baselineなしでは、content hash・line count・source作成時刻から確実に判断できる初期移行または追加だけを反映する
- legacyで曖昧な状態は範囲を推測変更せずbaselineだけを確立する
- reconciliation後にactive ownerをread-only再読込し、返却sessionと永続化済みsnapshotを一致させる
- decoration loadは従来どおり非変更処理のままとする

## 指摘2: 任意のHEAD exit 128をunbornとして扱う

### 問題

`git rev-parse --verify HEAD^{commit}`のexit code 128を一律にmissing HEADと判定していたため、破損HEAD、object database異常、権限問題などもunborn branchとして隠蔽する可能性があった。

### TDD

`test/unit/local-git-head-classification-review.test.ts`を先に追加した。

- exit 128かつC localeの既知診断`fatal: Needed a single revision`だけはunbornとして受理する
- exit 128かつ`fatal: bad object HEAD`は`GitCommandFailedError`として伝播する

### 修正

- object有無確認用のexit分類とHEAD確認用のexit分類を分離した
- HEAD確認はexit 128かつ既知unborn診断の完全一致だけを`undefined`として返す
- その他の非0終了は`GitCommandFailedError`として、invocation、exit code、stdout、stderrを保持して伝播する
- `NodeGitCommandExecutor`が設定する`LANG=C`、`LC_ALL=C`を診断分類の前提とする

## 最新main統合

並行開発で`main`へT203がマージされたため、次の2-parent merge commitで取り込んだ。

- merge commit: `0a1432febb9f6a77298356c6b7bef1abca3bc869`
- Issue #13 parent: `b07477d871a76a33935621a42260084bef02fb36`
- main/T203 parent: `7d11243634ae47258dad92b84a548185d64b6bbd`

`package.json`はIssue #13のreview再現testとT203 testの両方を正式suiteへ保持した。最終branchは`main`に対してbehind 0である。

## Red・診断artifact

### Red 1: 型境界

- head: `0a1432febb9f6a77298356c6b7bef1abca3bc869`
- run: `30133656117`
- failure: Build、source ownerの型絞り込み不足
- artifact: `ci-failure-diagnostics-30133656117-1`
- artifact ID: `8612008851`

### Red 2: 既存unit期待値

- head: `1544b93ada11d173a1219a1ea406daefaf0156df`
- run: `30133890499`
- result: Unit tests 164 / 165 success
- review再現test 2件: success
- failure: lower-owner read追加後の既存I/O順序fixture
- artifact: `ci-failure-diagnostics-30133890499-1`
- artifact ID: `8612093053`

### Red 3: fixture編集ミス

- head: `849d634bd73b822bbba2ed64987bac1f4f20c73d`
- run: `30134161535`
- failure: Lint、fixtureの閉じ括弧不足
- artifact: `ci-failure-diagnostics-30134161535-1`
- artifact ID: `8612181602`

### Red 4: preload済みundefinedの再読込

- head: `436b57d67db49f25ca48726a9cd3c0f19f46472d`
- run: `30134518563`
- result: Unit tests 164 / 165 success
- failure: 未保存externalの`undefined`をpreload未実施と区別できず、active owner後に再読込していた
- artifact: `ci-failure-diagnostics-30134518563-1`
- artifact ID: `8612303726`

Red 3は製品ロジックの失敗ではなくfixture更新ミスだった。fixtureを修正前blobへ戻し、製品側をactive owner再読込の独立providerへ整理した。

## 最終Green

- head: `e092425b9aec3e81d3be06e51f4d8a4de099d01f`
- workflow run: `30134731964`
- Install dependencies: success
- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

同repositoryの別branchや他作業者のrunではなく、上記head SHAに紐づくrunだけを最終判定に使用した。

## 独立再レビュー

確認観点:

- baselineありの追加・解除差分が正しいこと
- fallback sourceの単純unionでGit側の解除済み範囲を復活させないこと
- baselineなしの曖昧な解除を推測反映しないこと
- content hash・line count不一致時に再調整しないこと
- 追加・解除とbaseline更新を1回のatomic transactionで確定すること
- active owner再読込がlower ownerを再度開かないこと
- decoration readが状態を変更しないこと
- HEADの既知unborn診断と未知のexit 128が分離されること
- T203統合後もIssue #13と既存suiteがすべてGreenであること

判定:

- blocking finding: なし
- non-blocking finding: なし
- merge: 実施しない。ユーザーが行う。

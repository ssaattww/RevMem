# Issue #13 R6レビュー指摘対応レポート

## 対象

- Pull Request: #15
- Branch: `issue/13-document-context-routing`
- 指摘元: `reports/issue-13-review-r6-20260726111127.md`
- 対応対象: blocking finding 3件
- 基準設計: `doc/design/document-context-routing.md`

## 指摘1: 新context初期化でowner-wide Globalを空にする

### 問題

repository manifestは複数contextと1つのowner-wide Globalを保持する。一方、対象Context IDがmanifestに存在しない場合、従来のcontext loadは`undefined`を返し、document providerはowner全体が未作成であるかのように空context・空Globalを保存していた。

その結果、別branchまたはdetached contextで初めてdocumentを開いた時点で、既存contextから蓄積されたGlobal確認済み範囲を失う可能性があった。

### 修正

- contextの有無とは独立してowner-wide Globalを読み出す`loadPersistedOwnerGlobal`を追加した
- public filesystem repositoryへ`loadGlobal`境界を追加した
- 新contextの空Global初期化は同一storage rootのwrite queue内でcontextとGlobalを再読込する
- 既存Globalと新contextが同じrevisionならGlobalを継承する
- revisionが異なる場合はGlobalを変更せず、revision mapping要求として拒否する
- 新context作成と同時に非空Globalを明示したsaveは空初期化と区別し、既存contractを維持する
- reconciliationは保存後に実際に永続化されたcontext・Globalを再読込し、それをplanning開始snapshotと最終CASの`expected`に使用する

### 回帰条件

- branch AでGlobal rangeを保存後、同一revisionのbranch Bを初回openしてもGlobalを維持する
- branch Bの初回open後にbranch Aを再openしてもContext rangeとGlobal rangeを維持する
- 異なるrevisionのbranch B初期化を拒否し、branch AのGlobalを変更しない
- 既存repository testの明示的Global更新を維持する

## 指摘2: lower owner再作成を全解除として扱う

### 問題

baselineとの共通性判定はowner、Repository ID、Context ID、File ID、content hash、line countを比較していたが、source contextの`createdAt`を比較していなかった。

workspaceまたはexternal-file contextは決定的IDを再利用するため、保存状態を削除して再作成すると、同じIDでも別incarnationとなる。再作成された空contextを旧baselineと比較すると、旧range全体を明示的な解除と誤認する可能性があった。

### 修正

- common baseline判定へ`sourceCreatedAt`を追加した
- `sourceCreatedAt`が異なる場合は別incarnationとしてbaseline差分を適用しない
- incarnation変更時はbaselineなしの保守規則を使う
- targetの既存rangeは推測解除せず、現在sourceを次baselineとして確立する

### 回帰条件

- workspace rangeをGitへ反映してbaselineを確立する
- workspace stateを削除し、同じ決定的IDで空contextを再作成する
- Git復旧時に旧rangeを解除しない

## 指摘3: reconciliation intervalがlineCount外でも永続化できる

### 問題

`OwnerReconciliationSourceSnapshot.reviewed`はinterval形状だけを検証し、`endLineExclusive <= lineCount`を検証していなかった。

不正metadataを保存すると、将来のdelta計算へ実在しない行を混入させる可能性があった。

### 修正

- snapshotの`lineCount`を先に検証する
- 各intervalについて次を検証する
  - 非負safe integer
  - `startLine < endLineExclusive`
  - `endLineExclusive <= lineCount`
- save、load、commitの`expected`・`next`で同じvalidatorを適用する

### 回帰条件

- saveでlineCount外intervalを拒否する
- commitのnextでlineCount外intervalを拒否する
- disk上のcontext documentを不正化した場合、再起動loadで拒否する

## TDD Red

- head: `c958a3088add42ea7bf2418820717278e3cba9a4`
- workflow run: `30184574838`
- Build: success
- Lint: success
- Unit tests: failure
- failure artifact: `ci-failure-diagnostics-30184574838-1`
- artifact ID: `8626617246`

先行追加したR6 testで、Global消失、異revision初期化、source incarnation、metadata interval境界を固定した。

## 実装中の回帰確認

初回実装head `5500a2312c359b4bc9870ac5fee34c2e278c156b`ではR6 testは通過したが、既存repository test 2件が失敗した。

原因は、新contextへ非空Globalを明示して保存する既存contractまで一律に既存Globalへ置換したことだった。

修正後は、保護対象を「空Globalを伴う新context初期化」へ限定し、非空Globalを伴う明示的saveは従来どおり許可した。

## 製品Green

- head: `e0493ca39c23d10f8b387d4d9f57f7209561b7da`
- workflow run: `30184958358`
- Install dependencies: success
- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

同repositoryの別branchや他作業者のrunではなく、上記head SHAに紐づくrunだけを製品検証に使用した。

## テスト実行保証

- `test/unit/issue-13-r6-review-followup.test.ts`を追加した
- Red確認時の一時的な`core-contracts.test.ts` importは削除した
- `package.json`の`test:unit`へR6 test fileを直接登録した

## 設計書修正

`doc/design/document-context-routing.md`へ次を統合した。

- owner不存在、context不存在、context存在の区別
- repository manifestが複数contextと1つのowner-wide Globalを持つ契約
- 新context初期化時のGlobal再読込・継承・revision mapping拒否
- 空初期化と非空Globalを伴う明示的saveの区別
- same-storage-root write serialization
- source context `createdAt`をincarnation identityとして扱う規則
- incarnation変更時に旧baseline removalを適用しない規則
- reconciliation intervalの`lineCount`境界
- 初期化後の実snapshotをreconciliation CASの`expected`へ使用する規則

設計書は機能単位の1ファイルを維持し、Issue番号やTask番号を追加していない。

## Scope確認

変更対象はdocument ownership、owner-wide Global persistence、owner reconciliation、metadata validation、対応test、統合設計書、reportに限定した。

変更していない範囲:

- `tasks/tasks-status.md`
- T300のpolicy、runtime、設定、test
- PR #22のreportと`test/unit/release-vsix-contract.test.ts`
- revision mapping実装
- その他のマージ済み`main`由来ファイル

## Held

`LocalGitAdapter.objectExists`が任意のexit code 128をmissing objectとして扱う問題は、revision mapping側の既存dependencyであり、本PRのdocument owner routing正常経路では使用しない。mapping接続前に担当変更で分類を修正する。

## 判定

- R6 blocking finding 1: 対応済み
- R6 blocking finding 2: 対応済み
- R6 blocking finding 3: 対応済み
- merge: 実施しない。ユーザーが行う

# T301 実装レポート

## 対象

- Issue: #1
- Task: T301 PR進捗（差分ベース）
- Pull Request: #25
- Branch: `agent/t301-pr-diff-progress`
- Base: `main`

## CI失敗時診断

作業開始時に `.github/workflows/ci.yml` を確認した。既存workflowは各工程の標準出力・標準エラー、生成物、source、test、設定file、head SHAとrefを失敗時artifactへ保存するため、workflow変更は不要だった。

- R5 run `30147427410`: Lint failure。artifact `8616489254`から不要escapeを特定し、`ab861d7823b2090879eadf52e0bfcdc768378006`で修正した。
- R6 run `30148686753`: Unit failure。artifact `8616901186`から不正なpure-addition hunk anchorを特定し、`458128aba44687f121d6ef1fc751cbd673414c75`で修正した。
- R7 run `30183833409`: Unit failure。artifact `8626415660`の`test-unit.log`から、unknown-kind fixtureのaddition統計が0で完全diff検証が先に発火していたことを特定し、`35df3ff3cecbe182f4932d4e59a3d81cac725c8f`で修正した。

## TDD証跡

### 初回〜R6

- 初回 Red: `dafdb537145ab8c935c0d6c40a99182cb78fae7e` / run `30136402379` failure
- 初回 Green: `32628bb1c80b1ac899e057a6c7183fdd40b1b6a5` / run `30136493715` success
- R1 Test-first: `a6994a606c5f2b4d67b49f614ce34b478e21eb67` / Green run `30137524150`
- R2 Test-first: `940c33320b14d2914fd119641a4737cbbcbae064` / Green run `30138438036`
- R3 Test-first: `9f7d64dbd3a36d4ce56f3967d801eb606eed784e` / Green run `30144044817`
- R4 Test-first: `f65c3b7715fb4ece6ca57d05dc4c3a8d7d83ad15` / Green run `30144959022`
- R5 Test-first: `1ddfe5363672cc58ec98b4e9c5a0ef429ea61a4d` / Green run `30147550473`
- R6 Test-first: `f0d735a3bcd9bacf31c14728593c50a62e4c7c83` / Green run `30148802522`

### R7レビュー対応

- Test-first commit: `774bc3c5ac7161e746db2efc265a0087c194fb46`
- Implementation commit: `328816a427ad8bd8bc472174dc6bcd170637af04`
- Fixture diagnostic fix: `35df3ff3cecbe182f4932d4e59a3d81cac725c8f`
- Green run: `30183893735` / success

## 現在の実装内容

- identity-bound snapshotとPR context/revisionをcalculator境界で照合
- runtime line kind・file status、old/new repository-relative pathを検証
- added/deletedの非空diffはfile先頭から全内容を表す単一complete hunkのみ受理
- modified/renamed/copied/deletedを含むstatus/path/side invariantを検証
- binary以外は除外判定に依存せずhunk構造・座標・delta・統計を検証
- hunk validatorからmodified-side最大extentを返し、state `lineCount`と照合
- state map key、payload file ID、head revision、canonical `currentPath`を照合
- stale・誤routing・bounds不正stateは除外fileでも拒否し、集計だけをskip
- reviewed intervalを1行ずつ展開せず、正規化・mergeしたintervalへchanged座標を二分探索で照合
- file ID・canonical path重複、context-only/zero-zero hunk、統計不一致を拒否
- 除外fileは元統計・理由を保持しつつ集計分子・分母を0にする
- file単位・PR全体ともzero denominatorを100%と定義

## 累積テスト対象

- file単位とPR全体の部分進捗
- added/deleted complete diffとpartial patch拒否
- deletion-only hunkを含むmodified-side extentとlineCount
- state currentPath・revision・payload ID・interval bounds
- excluded fileでもdiff/state validationを継続
- safe integer級の巨大intervalを展開しない計算
- non-PR、stale snapshot/state、unknown runtime union
- context-only/zero-zero、座標、hunk order/gap/delta、統計不一致
- duplicate file ID・canonical path
- rename-only、binary/user glob、exclusion reason、zero denominator

## 対象外

- GitHub API paginationとPR file取得adapter
- GitHub patchを`PullRequestDiffSnapshot`へ構築するadapter
- Tree View、装飾、進捗UI
- PR context resolver

## 検証方針

CI判定はrepository全体の「最新run」ではなく、自分のbranch HEAD SHAに紐づくworkflow runだけを使用する。マージはユーザーが行うため、本対応ではマージしない。

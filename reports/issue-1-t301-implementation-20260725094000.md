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
- R6 run `30148686753`: Unit failure。artifact `8616901186`の`test-unit.log`から、line 100へのpure addition fixtureが不正なhunk anchorを使用していたことを特定し、`458128aba44687f121d6ef1fc751cbd673414c75`で修正した。

## TDD証跡

### 初回〜R5

- 初回 Red: `dafdb537145ab8c935c0d6c40a99182cb78fae7e` / run `30136402379` failure
- 初回 Green: `32628bb1c80b1ac899e057a6c7183fdd40b1b6a5` / run `30136493715` success
- R1 Test-first: `a6994a606c5f2b4d67b49f614ce34b478e21eb67` / Green run `30137524150`
- R2 Test-first: `940c33320b14d2914fd119641a4737cbbcbae064` / Green run `30138438036`
- R3 Test-first: `9f7d64dbd3a36d4ce56f3967d801eb606eed784e` / Green run `30144044817`
- R4 Test-first: `f65c3b7715fb4ece6ca57d05dc4c3a8d7d83ad15` / Green run `30144959022`
- R5 Test-first: `1ddfe5363672cc58ec98b4e9c5a0ef429ea61a4d` / Green run `30147550473`

### R6レビュー対応

- Test-first commit: `f0d735a3bcd9bacf31c14728593c50a62e4c7c83`
- Implementation commit: `a33371f44c97514bb822f5e370fe8f4135ca6ec7`
- Fixture diagnostic fix: `458128aba44687f121d6ef1fc751cbd673414c75`
- Green run: `30148750034` / success

## 現在の実装内容

- `PullRequestDiffSnapshot`でbase/head SHA、context ID、original diff ID、changed filesを一体化
- snapshotと`ReviewContextState`のPR context/revisionをcalculator境界で照合
- runtimeのline kind・file statusをexhaustiveに検証
- old/new両pathをrepository-relative pathとして正規化・検証
- modifiedは同一path、renamed/copiedは異なるpathを必須化
- addedはold-side contentなし、deletedはnew-side contentなしを必須化
- canonical display pathとfile IDの重複を拒否
- binary以外は除外判定前にhunk構造・座標・delta・統計を検証
- context-only・zero-zero hunk、opposite-side座標、header/body不一致を拒否
- stateがある場合、actual modified座標とreviewed intervalの双方を`lineCount`以内に制限
- reviewed intervalと実addition/deletion座標の積集合だけを分子へ算入
- 除外fileは元統計と理由を保持しつつ、集計分子・分母を0にする
- file単位・PR全体ともzero denominatorを100%と定義
- 公開DTOのsnapshot identity、raw/normalized path、除外count、zero denominator、file順序をJSDoc化

## 累積テスト対象

- file単位のreviewed/total/progressとPR部分進捗
- malformed excluded nonbinary file
- old/new secondary pathとstatus/hunk side matrix
- actual modified coordinateとstate lineCount不一致
- 除外fileのaggregate numerator/denominator/progress・excluded flag
- stale snapshot/context/state、unknown runtime union
- line coordinate、hunk order/gap/delta、duplicate actual coordinate
- source統計値、duplicate file ID・canonical path
- binary/user glob/rename-only/zero denominator

## 対象外

- GitHub API paginationとPR file取得adapter
- GitHub patchを`PullRequestDiffSnapshot`へ構築するadapter
- Tree View、装飾、進捗UI
- PR context resolver

## 検証方針

CI判定はrepository全体の「最新run」ではなく、自分のbranch HEAD SHAに紐づくworkflow runだけを使用する。マージはユーザーが行うため、本対応ではマージしない。

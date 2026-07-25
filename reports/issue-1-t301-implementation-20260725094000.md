# T301 実装レポート

## 対象

- Issue: #1
- Task: T301 PR進捗（差分ベース）
- Pull Request: #25
- Branch: `agent/t301-pr-diff-progress`
- Base: `main`

## CI失敗時診断

作業開始時に `.github/workflows/ci.yml` を確認した。既存workflowは各工程の標準出力・標準エラー、生成物、source、test、設定file、head SHAとrefを失敗時artifactへ保存するため、workflow変更は不要だった。

R5対応のHEAD `b85a396f8ced10265d99db2cab72f34f99923404` に紐づくrun `30147427410`ではLintが失敗した。保存されたfailure diagnostics artifact `8616489254` の`lint.log`から、test path literalの不要escape 2件を特定し、commit `ab861d7823b2090879eadf52e0bfcdc768378006`で修正した。同HEADのrun `30147490531`は全工程成功した。

## TDD証跡

### 初回〜R4

- 初回 Red: `dafdb537145ab8c935c0d6c40a99182cb78fae7e` / run `30136402379` failure
- 初回 Green: `32628bb1c80b1ac899e057a6c7183fdd40b1b6a5` / run `30136493715` success
- R1 Test-first: `a6994a606c5f2b4d67b49f614ce34b478e21eb67` / Green run `30137524150`
- R2 Test-first: `940c33320b14d2914fd119641a4737cbbcbae064` / Green run `30138438036`
- R3 Test-first: `9f7d64dbd3a36d4ce56f3967d801eb606eed784e` / Green run `30144044817`
- R4 Test-first: `f65c3b7715fb4ece6ca57d05dc4c3a8d7d83ad15` / Green run `30144959022`

### R5レビュー対応

- Test-first commit: `1ddfe5363672cc58ec98b4e9c5a0ef429ea61a4d`
- Implementation commit: `b85a396f8ced10265d99db2cab72f34f99923404`
- Lint diagnostic fix: `ab861d7823b2090879eadf52e0bfcdc768378006`
- Green run: `30147490531` / success

## 現在の実装内容

- `PullRequestDiffSnapshot`でbase/head SHA、context ID、original diff ID、changed filesを一体化
- snapshotと`ReviewContextState`のPR context/revisionをcalculator境界で照合
- runtimeの`DiffLine.kind`と`PullRequestFileChange.status`をexhaustiveに検証し、未知値を拒否
- statusごとのold/new path・addition/deletion matrixを検証
- exclusion policyで正規化したcanonical pathの重複を拒否
- hunkごとにaddition/deletionが1件以上あることを必須化し、context-only・zero-zero hunkを拒否
- unified diffのone-based座標、opposite-side absence、cursor進行、header/body countを検証
- zero-count anchor正規化、first hunkからのcumulative delta、後続hunk order/gapを検証
- unique addition/deletion座標数とsource統計値をside別に厳密照合
- review stateのmap key、payload file ID、head revisionを照合
- `lineCount`を非負safe integerとして検証し、modified reviewed intervalの上限超過を拒否
- PR contextのzero-based half-open intervalと実変更座標の積集合だけを分子へ算入
- binary/default glob/user glob除外理由と元のaddition/deletion統計を保持
- 除外fileは集計対象外、zero denominatorは100%として扱う

## 累積テスト対象

- 正常なaddition-only、deletion-only、replacement
- zero-count addition/deletion後のvalid hunkとfirst-hunk delta
- stale snapshot、context ID、base/head、original diff ID、non-PR context
- stale file revision、state payload ID、lineCount・modified interval上限
- unknown line kind/status、status/path/count matrix
- line coordinate、opposite-side、context coordinate、header/body
- multiple hunk order/gap、context-only、zero-zero、duplicate actual coordinate
- source統計値の過不足、duplicate file ID、canonical path重複
- rename-only、zero denominator、user glob、binary、exclusion reason

## 対象外

- GitHub API paginationとPR file取得adapter
- GitHub patchを`PullRequestDiffSnapshot`へ構築するadapter
- Tree View、装飾、進捗UI
- PR context resolver

## 検証方針

CI判定はrepository全体の「最新run」ではなく、自分のbranch HEAD SHAに紐づくworkflow runだけを使用する。マージはユーザーが行うため、本対応ではマージしない。
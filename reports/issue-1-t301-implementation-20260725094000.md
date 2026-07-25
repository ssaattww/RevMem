# T301 実装レポート

## 対象

- Issue: #1
- Task: T301 PR進捗（差分ベース）
- Pull Request: #25
- Branch: `agent/t301-pr-diff-progress`
- Base: `main`

## CI失敗時診断

作業開始時に `.github/workflows/ci.yml` を確認した。既存workflowは各工程の標準出力・標準エラー、生成物、source、test、設定file、head SHAとrefを失敗時artifactへ保存するため、workflow変更は不要だった。

レビュー対応中のrun `30138361324` ではUnit testsが失敗した。保存されたfailure diagnostics artifactとjob logを確認し、assertionが期待するerror messageの大文字・小文字差を修正した。原因確認後のHEAD `5551e070215997294f1f6cf9eebe9bb6f1763504` に紐づくrun `30138438036`は成功した。

## TDD証跡

### 初回実装

- Red commit: `dafdb537145ab8c935c0d6c40a99182cb78fae7e`
- Red run: `30136402379` / failure
- Green commit: `32628bb1c80b1ac899e057a6c7183fdd40b1b6a5`
- Green run: `30136493715` / success

### R1レビュー対応

- Test-first commit: `a6994a606c5f2b4d67b49f614ce34b478e21eb67`
- Contract/implementation commits: `787e70bf0f4cfc0c31157a1e1b16b48d4f338ca9`, `a5ec9465fa5a9dcce2c1ade7081bc9dfc5cb46b0`
- Green run: `30137524150` / success

### R2レビュー対応

- Test-first commit: `940c33320b14d2914fd119641a4737cbbcbae064`
- Implementation commits: `f490e8143c8c9becc13974d6b1893e079e2cf6d0`, `adce5578fc6bbc4609719b67aa035cf9ae8f5c0d`
- Diagnostic fix commit: `5551e070215997294f1f6cf9eebe9bb6f1763504`
- Green run: `30138438036` / success

### R3再レビュー対応

- Test-first commit: `9f7d64dbd3a36d4ce56f3967d801eb606eed784e`
- Implementation commit: `274898af39267ffdf96adc0501a11f50aab84992`
- Public export commit: `5592913df162cabfecbda3cb751976fd03925105`
- Validation run: `30143993668` / success
- 最終report更新後のHEADとrunはPRコメントおよびPR本文に追記する。

## 現在の実装内容

- `PullRequestDiffSnapshot`でbase SHA、head SHA、context ID、original diff ID、changed filesを一体化
- snapshot identityと`ReviewContextState`のpull-request context/revisionをcalculator境界で照合
- `originalDiffId`を`${baseSha}..${headSha}`のcanonical keyとして検証
- 既存`PullRequestFileChange`、`DiffHunk`、`DiffLine` contractを再利用
- unified diffの各lineについてone-based old/new coordinate、反対side座標のabsence、source-order cursor進行を検証
- hunk header/body count、hunk間order、未変更gap、重複actual coordinateを検証
- hunkから得たunique addition/deletion座標数とGitHub統計値をside別に厳密照合
- PR contextのzero-based half-open intervalをone-based座標へ変換し、実変更座標との積集合だけを分子へ算入
- Global、branch、workspace、stale revision由来のstateを進捗計算へ混入させない
- T300 `ReviewFileExclusionPolicy`を再利用し、binary/default glob/user globの理由を保持
- 除外fileは集計分子・分母を0にする一方、元の`additions`・`deletions`と分類を結果へ保持
- file単位・PR全体とも分母0を100%として扱う
- 公開DTOとcalculatorに座標規約、除外時count、zero denominator、identity、validation failureを記載
- `test:t301` focused testと通常unit suiteへ配線

## テスト対象

- 正常なaddition-only、deletion-only、replacement
- current PR contextのmodified/original interval
- stale diff snapshot、context ID mismatch、base/head mismatch、original diff ID mismatch
- line coordinate mismatch、opposite-side coordinate、context coordinate mismatch
- multiple hunk、hunk order、hunk gap、重複actual coordinate
- GitHub統計値とunique座標数の過不足
- rename-onlyとzero denominator
- user glob、binary、exclusion reason、除外時source count保持

## 対象外

- GitHub API paginationとPR file取得adapter
- GitHub patchを`PullRequestDiffSnapshot`へ構築するadapter
- Tree View、装飾、進捗UI
- PR context resolver

## 検証方針

CI判定はrepository全体の「最新run」ではなく、自分のbranch HEAD SHAに紐づくworkflow runだけを使用する。マージはユーザーが行うため、本対応ではマージしない。

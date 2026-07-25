# T301 実装レポート

## 対象

- Issue: #1
- Task: T301 PR進捗（差分ベース）
- Pull Request: #25
- Branch: `agent/t301-pr-diff-progress`
- Base: `main`

## CI失敗時診断

作業開始時に `.github/workflows/ci.yml` を確認した。既存workflowは各工程の標準出力・標準エラー、生成物、source、test、設定file、head SHAとrefを失敗時artifactへ保存するため、workflow変更は不要だった。

## TDD

### Red

- Commit: `dafdb537145ab8c935c0d6c40a99182cb78fae7e`
- Run: `30136402379`
- Result: failure
- 実装moduleより先に `test/unit/pr-diff-progress.test.ts` を追加した。

### Green

- Commit: `32628bb1c80b1ac899e057a6c7183fdd40b1b6a5`
- Run: `30136493715`
- Result: success
- Build、Lint、Unit、Temporary Git integration、Mock GitHub integration、VS Code Extension Hostが成功した。

## 実装内容

- PR changed-fileの `additions + deletions` だけを分母にする純粋関数
- RIGHT/head側の追加行とLEFT/base側の削除行を別々に集計
- reviewed座標の重複除去とGitHub側行数への上限制約
- T300 `ReviewFileExclusionPolicy` の直接再利用
- binary、default glob、user globの除外理由保持
- 除外fileを集計分母・分子から除外
- file単位・PR全体とも分母0を100%として扱う
- 不正count、座標、重複file inputを推測せず拒否
- `test:t301` focused testと通常unit suiteへの配線

## 対象外

- GitHub API paginationとPR file取得adapter
- patchから追加・削除行座標を抽出する処理
- Tree View、装飾、進捗UI
- PR context resolver

## 検証方針

CI判定は自分のbranch HEAD SHAに紐づくworkflow runだけを使用し、repository全体の最新runは使用しない。

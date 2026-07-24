# T300 実装レポート

## 対象

- Issue: #1
- Task: T300 共通除外policy
- Pull Request: #17
- Branch: `task/t300-exclusion-policy`
- 初回base: T109統合済み`main`
- 最終base: T104-2統合済み`main` `938904da6e63c7111dc8add56cb3a53acd9e9904`

## 目的

GitHub PR変更fileとlocal Git変更fileに共通適用できる、理由付きの除外policyを提供する。

- binary
- 設計書既定glob
- ユーザーglob
- 除外理由
- 設定変更通知
- T301のPR進捗とT503のGlobal集計が共有する評価境界

PR進捗計算本体はT301、repository列挙・gitignore・空行判定はT503の責務とする。

## CI失敗時診断

作業開始時に`.github/workflows/ci.yml`を確認した。既存workflowは各工程の標準出力・標準エラー、生成物、`src`、`test`、設定file、実行環境、head SHAとrefを失敗時artifactへ保存するため、workflow変更は不要だった。

## 初回TDD

### Red

- Commit: `6901e8c1f50ef2031209ea858ae29d3eedacbe4b`
- Run: `30091509541`
- Failure: Unit tests
- Artifact: `ci-failure-diagnostics-30091509541-1`
- Artifact ID: `8595860377`

実装moduleの追加前に、既定glob、ユーザーglob、binary、除外理由、設定変更通知、PR/Globalの共有decisionをテストで定義した。

### Green

- Commit: `55ca7b1980dc3e4de3ebf6dc8fab2c22dd8981c9`
- Run: `30091641437`
- 結果: install、build、lint、unit、Git、GitHub、Extension Host成功

## 初回実装

### Core

`ReviewFileExclusionPolicy`をVS Code、GitHub、Node filesystemに依存しないpure coreとして実装した。

- binary、既定glob、ユーザーglobの順で評価
- 最初に一致したpatternを理由として保持
- repository-relative pathを検証
- globをpolicy作成時にcompile
- `*`、`**`、`?`、character class、brace alternatives
- blankとduplicateの除去
- negated globの拒否

### Application

`ReviewFileExclusionPolicyService`がcurrent policy snapshotを所有し、effectiveなuser glob変更だけを通知する。

### Manifest

`reviewRange.exclude`へ次のdefaultを追加した。

- `**/.git/**`
- `**/node_modules/**`
- `**/bin/**`
- `**/obj/**`
- `**/dist/**`
- `**/build/**`

## 後続レビュー

初回専用レビュー後、R2でruntime設定接続、POSIX Git path、glob compile上限、最新main統合後CIに指摘が入った。これらは`reports/issue-1-t300-review-r2-20260724212500.md`とreview follow-up reportで追跡する。

# T204 R5レビュー対応レポート

## 対象

- Pull Request: #24
- レビュー: `reports/issue-1-t204-review-r5-20260725153000.md`
- ブランチ: `task/t204-file-state-transitions`

## 対応内容

### rename metadata完全性

- `rename from`と`rename to`をexactly once要求する。
- 片側欠落、duplicate from、duplicate toをtransition適用前に`SyntaxError`でatomic拒否する。
- malformed renameをsilent `continue`へ到達させない。

### add/delete header side整合性

- `new file mode`はold headerがcanonical `/dev/null`、new headerが実pathであることを要求する。
- `deleted file mode`はold headerが実path、new headerがcanonical `/dev/null`であることを要求する。
- quoted `/dev/null`とTAB timestamp付きheaderをdecode後のcanonical valueで判定する。
- new/delete modeの同時指定も拒否する。

### parser二重化の縮小

wrapper内のsection分割後、各sectionを一度だけcanonical parseし、その`ValidatedSection`をmetadata完全性、header side整合性、destination一意性の検証で共有する構造へ変更した。

## TDD

- Red: `28caf70ebf1a341468dcad5b34f8f96f91f63fa1`
- Green: `937395aa0e3df98eacdb0d5f7ea2173c0f106628`

追加した回帰ケース:

- rename fromのみ
- rename toのみ
- duplicate rename from/to
- new fileのnew sideがquoted `/dev/null`
- new fileのnew sideが`/dev/null<TAB>timestamp`
- new fileのold sideが実path
- delete fileのold sideが`/dev/null`
- delete fileのnew sideが実path

## CI

Green commit `937395aa0e3df98eacdb0d5f7ea2173c0f106628`に紐づくworkflow run `30147293084`で以下がsuccess。

- Build
- Lint
- Unit tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

最終判定は本レポート追加後のHEAD SHAに紐づくCIで行う。

## 未実施

- 最終再レビュー
- 最終再レビュー通過後のtask/phase完了同期
- マージ

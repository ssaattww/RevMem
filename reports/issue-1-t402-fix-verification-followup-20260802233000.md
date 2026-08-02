# T402 Fix Verification残存指摘対応レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: `#40`
- Task: `T402`
- Mode: review follow-up
- Branch: `task/t402-pr-diff-acquisition`
- Base: `main` / `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Fix verification成果物追加後の開始HEAD: `e935770013ea63ea7db489b28254f060b0e742f7`
- 実装HEAD（本レポート前）: `59e1862eb81f2372e3f08565b94c22d6ec436cf4`
- Merge: 未実施

## 対象

同一初回レビュワーによるfix verificationでpartialと判定された次の残存境界だけを修正した。

- `T402-R003` / medium: ordinary Git diff passに明示的なnon-zero rename/copy候補上限がなく、repository/userの`diff.renameLimit=0`等へ依存していた。
- `T402-R004` / high: Pull Request metadataの`changed_files`を取得しておらず、files APIの`Link`欠落時にpartial file listを完全結果として返し得た。

`T402-R001`と`T402-R002`は前回fix verificationでaddressed済みのため、実装変更対象外とした。T403 cache、T404永続PR layer、T405 UIも対象外である。

## 診断artifact workflow

作業開始時に`.github/workflows/ci.yml`を再確認した。既存workflowは各commandの標準出力・標準エラーを`test-output/ci/*.log`へ保存し、失敗時にtest/build出力、生成物、source、tests、tools、設定、environment、Git statusをartifactへ保存する。追加変更は不要だった。

## TDD

### Red

先に次の回帰testを追加した。

1. ordinary local Git diff invocationにも`-l1000`が含まれること。
2. Pull Request metadataが`changed_files=2`を示す一方、files APIが1 fileだけ返し`Link`を欠落させた場合に`unavailable / api`となること。

Red HEAD:

- `697205545d90ad7dcd8c0f77b2dcbf35cd98a38c`
- Workflow run: `30751880349`
- Job: `91507237834`
- Conclusion: failure
- Artifact: `8834702941` / `ci-failure-diagnostics-30751880349-1`

Mock GitHub integrationは36件中34件成功、次の2件だけが失敗した。

- ordinary Git invocationのactualに`-l1000`がない。
- `changed_files=2`に対して1 fileだけのpartial listが`available`となる。

build、contract typecheck、architecture positive/negative、lint、unit、T503、temporary Git integrationはRed HEADでも成功した。

### Green実装

#### T402-R003

`LocalGitPullRequestDiffAdapter.executeDiff()`で、ordinary passと`--find-copies-harder` passの両方にCLI引数`-l1000`を追加した。

これによりrename/copyのexhaustive fallback上限はrepository/userの`diff.renameLimit`ではなく、T402 adapterの明示値で固定される。pure copy integration testではrepository設定を`diff.renameLimit=0`へ変更した状態でも、CLI上限付きでunchanged sourceからのcopyを`copied`、0 additions/deletions、0 hunksとして取得する。

Gitが候補超過によりrename/copy検出をskipしたdiagnosticは、従来どおり`diff-too-large`としてfail closedにする。

#### T402-R004

GitHub Pull Request metadata parserで`changed_files`をnon-negative safe integerとして必須取得するようにした。

- `changed_files >= 3000`: GitHub files endpoint上限と一致させ、`diff-too-large`で拒否する。
- 取得中に`files.length > changed_files`: `api`で拒否する。
- pagination終端時に`files.length !== changed_files`: `api`で拒否する。

これにより`Link` headerが欠落しても、metadataが示す変更file総数と一致しないpartial listはsnapshotへ進まない。

## 変更file

- `src/adapters/local-git/local-git-pull-request-diff-adapter.ts`
  - ordinary/harder両passへ`-l1000`を固定。
- `src/adapters/github/fetch-github-pull-request-diff-adapter.ts`
  - `changed_files`のparse、3000件境界、過不足件数照合を追加。
- `test/integration/t402-pr-diff-boundary.test.ts`
  - ordinary pass上限とmissing-Link partial listのRed/Green回帰。
- `test/integration/t402-pr-diff-acquisition.test.ts`
  - adapter metadata fixtureへ`changed_files`を追加し、Git invocation契約を同期。
- `test/integration/t402-review-followup.test.ts`
  - metadata fixtureへ`changed_files`を追加し、`diff.renameLimit=0`下のpure-copy回帰を固定。

## 検証

実装HEAD `59e1862eb81f2372e3f08565b94c22d6ec436cf4`と一致するworkflow runだけを確認した。

- Workflow run: `30752113658`
- Job: `91507861795`
- Conclusion: success

成功gate:

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T503 repository enumeration tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのrunは代用していない。

## intentionally untouched

- `.github/workflows/ci.yml`: 必須failure diagnosticsを既に満たす。
- `tasks/tasks-status.md`: 専用task/progress Skillの更新対象。
- `T402-R001` / `T402-R002`: 前回verificationでaddressed済み。
- T403、T404、T405、merge。

## 結論

`T402-R003`の残存性能上限と`T402-R004`のpartial files list受理経路を、test-firstで修正した。実装HEADに一致するCIは全gate successである。

次は同じ初回レビュワーによる`T402-R003`と`T402-R004`の再fix verificationを行う。mergeは利用者が実施する。

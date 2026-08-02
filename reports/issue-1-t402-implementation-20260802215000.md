# T402 実装レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Task: `T402`
- Pull Request: `#40`
- Branch: `task/t402-pr-diff-acquisition`
- Base: `main` / `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Implementation HEAD before this report: `8a9313da5295b6c8f099dc32db25e29adfce5bc1`
- Mode: initial implementation
- Merge: 未実施

## 目的と範囲

T402の受け入れ範囲として、PR metadataと変更file一覧を取得し、同一のimmutableなbase/head比較に対して次の順序で完全な`PullRequestDiffSnapshot`を取得するapplication serviceとadapterを実装した。

1. local Gitによるbase/head commit間diff
2. GitHub Pull Request Files APIのpatch
3. GitHubから取得したbase/headのfile内容によるローカル差分再構築

各routeはidentity、path、status、統計、hunk座標、patch完全性を検証する。部分的または不整合な証拠からsnapshotを推測せず、全route失敗時は`kind: unavailable`のみを返す。

T403のcache、T404の永続PR layer、T405のReview Contexts View、runtime composition、mergeは変更していない。

## authoritative requirements

- `tasks/tasks-status.md` T402: PR metadata/file取得、local Git diff、PR files API patch、base/head内容差分の3段fallbackを実装する。
- local、patch、patch欠落、不完全patch、全経路失敗をmockで再現し、全経路失敗時に確認済みを推測しない。
- T203のdiff parser、T301の`PullRequestDiffSnapshot`、T401のGitHub repository/PR identityを利用する。
- RevMem実装はTDDを基本とする。
- current PR HEAD SHAとworkflow runのhead SHAが一致するrunだけをCI証拠とする。
- 変更は小さな論理単位でcommit/pushし、詳細reportをrepositoryへ保存し、簡易reportをPR commentへ投稿する。
- mergeは利用者が行う。

## 診断artifact workflow

作業開始時に`.github/workflows/ci.yml`を確認した。既存workflowは各commandの標準出力・標準エラー相当logを`test-output/ci/*.log`へ保存し、failure時にtest/build結果、environment、Git状態、生成物、source、tests、tools、configurationを`actions/upload-artifact@v4`で保存するため、workflow変更は不要だった。

TDD Redの両runで診断artifactが正常に生成された。

- Initial Red run `30747002998`
  - HEAD: `a61929cfec47200d79fa1ff1892cd598c1dc71ab`
  - Artifact: `ci-failure-diagnostics-30747002998-1`
  - Artifact ID: `8833199337`
  - SHA-256 digest: `2915f5a14bc974569fa9047da05cccc7cf78fd63470f2fea3300726c7645adc5`
- Boundary Red run `30748311594`
  - HEAD: `49dbc8301a993e290d233efcdab55d6b17d4b547`
  - Artifact: `ci-failure-diagnostics-30748311594-1`
  - Artifact ID: `8833602975`
  - SHA-256 digest: `4653f8562a39c5635667464d014b4b2aea074cfb19c9372a2b921f704dc232f2`

## TDD記録

### Initial Red

commit `a61929cfec47200d79fa1ff1892cd598c1dc71ab`で、未実装moduleを参照するT402 testを先に追加した。

定義した主要契約:

- local Git成功時はremote APIを呼ばない。
- local Git unavailable後は完全なGitHub patchを使用する。
- patch欠落時はexact base/head file内容へfallbackする。
- patchのadditions/deletionsとbodyが不一致なら不完全patchとしてcontent fallbackする。
- metadataのPR番号・base SHA・head SHAが一致しない場合はcontentを読まない。
- 全route失敗時はsnapshotを返さない。
- raw content APIはexact immutable refを指定する。
- 不正pathや不正revisionは外部command/API呼出し前に拒否する。

exact-head CI run `30747002998`は、application/adapter moduleが未実装であることにより`compile:test`で失敗した。Redとして意図したfailureであり、artifact `8833199337`に診断情報が保存された。

### Green implementation

次を実装した。

- immutable request、remote metadata/file、local/remote port、result/attempt contract。
- local Git、GitHub patch、GitHub contentの順序を固定したacquisition service。
- exact PR number/base/head identity validation。
- T203 zero-context parserをT301 snapshotへ変換するlocal Git builder。
- GitHub patchのheader/body、line count、changed-line統計、hunk順序、gap/delta、added/deleted全体性を検証するparser。
- base/head textから決定的にdiffを再構築し、GitHub file統計と照合するcontent builder。
- metadataとPull Request Files APIのpagination、same-origin/same-path Link validation、raw content exact-ref取得、rate-limit/network/API分類。
- 公開contract fixtureと`test:t402`/`test:github` gate。

implementation HEAD `069de0726f82bdc014b200b114397d28835d86b3`に一致するCI run `30748015228`は全段階successだった。

### Boundary Redと修正

Green後の自己点検で、完全snapshot保証に関する次の2点を検出した。

1. full SHAの構文検証だけでは、local objectがcommitであることを保証していなかった。
2. GitHub Pull Request Files APIは最大3000 fileでresponseを制限するため、3000件到達時に完全一覧と断定できなかった。

commit `49dbc8301a993e290d233efcdab55d6b17d4b547`で先に3 testを追加した。

- base/headを`git rev-parse --verify --quiet <sha>^{commit}`で検証してからdiffする。
- commit object欠落時はdiffを実行しない。
- 3000件到達時は不完全な可能性をfail-closedで`diff-too-large`にする。

exact-head CI run `30748311594`ではこの3件のみが失敗し、既存gateはそれ以前までsuccessだった。artifact `8833602975`を確認後、commit object検証と3000件上限拒否を実装した。

## 実装構成

### Application contract/service

- `src/application/github-pr-diff/contracts.ts`
  - exact PR comparison request、remote metadata/file、local/remote port、source、attempt、fail-closed result。
- `src/application/github-pr-diff/request-validation.ts`
  - context、repository identity、positive PR number、lowercase full SHA-1/SHA-256 object IDの検証。
- `src/application/github-pr-diff/pull-request-diff-acquisition-service.ts`
  - local Git、GitHub patch、GitHub contentの順序制御とidentity mismatch/exceptionのfail-closed処理。
- `src/application/github-pr-diff/index.ts`
  - T402 public application API。

### Snapshot builders

- `snapshot-builder-shared.ts`
  - canonical repository-relative path、status/path/statistics matrix、重複file identity、snapshot identity。
- `local-git-diff-builder.ts`
  - T203 parser出力からT301 file/hunk/line contractへの変換。
- `github-patch-diff-builder.ts`
  - unified patch完全性、coordinate、context、changed count、added/deleted全体性の検証。
- `content-diff-builder.ts`
  - exact EOLを保持した決定的LCS diff、API統計照合、最大matrix sizeによるfail-closed。
- `pull-request-diff-builders.ts`
  - builder export。

### Adapters

- `src/adapters/local-git/local-git-pull-request-diff-adapter.ts`
  - base/headをcommit objectとして個別検証し、argument arrayでzero-context diffを実行する。
- `src/adapters/github/fetch-github-pull-request-diff-adapter.ts`
  - PR metadata、paginated file records、raw immutable content取得。
  - Linkのorigin/protocol/path/credential/hashを検証する。
  - API上限3000件に到達した一覧を完全snapshotへ使用しない。
- `src/adapters/github/index.ts`、`src/adapters/local-git/index.ts`
  - public adapter export。

### Tests and validation wiring

- `test/integration/t402-pr-diff-acquisition.test.ts`
  - 12件: 3段route、patch欠落/不完全、metadata mismatch、context line、raw content、invalid path/revision、全失敗。
- `test/integration/t402-pr-diff-boundary.test.ts`
  - 3件: commit object検証2件、3000件API cap。
- `type-fixtures/contracts/t402-pr-diff-acquisition.fixture.ts`
  - public contract positive/negative type fixture。
- `type-fixtures/contracts/tsconfig.json`
  - fixture登録。
- `package.json`
  - `test:t402`追加、`test:github`へT402 15 testを接続。

## 検証

### Local focused validation

ローカルartifact workspaceで次を実行した。

- T402 application/adapter strict typecheck: passed
- T402 public contract fixture typecheck: passed
- `t402-pr-diff-acquisition.test.ts`: 12/12 passed
- `t402-pr-diff-boundary.test.ts`: 3/3 passed
- architecture validation: passed

`npm ci`は実行環境の内部registryに`yocto-queue`が存在せず依存解決できなかったため、ローカルfull suiteは実行できなかった。この制約をsuccessへ読み替えていない。repositoryのlockfileと正式依存を使用するGitHub Actionsでfull gateを検証した。

### Exact-head CI

implementation HEAD `8a9313da5295b6c8f099dc32db25e29adfce5bc1`に完全一致するCI run `30748555293`、job `91498337175`はsuccessだった。

成功したgate:

- Install dependencies
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

failure context collectionとartifact uploadはsuccess runのためskipされた。

このreport/handoffを保存すると新しいHEADが作られるため、最終HEADのCIはそのHEADに一致するrunだけをPR commentへ記録する。別SHAのrunは代用しない。

## Fail-closedと安全境界

- local Git commandへ渡すrevisionはlowercase full object IDに限定し、base/headをcommit objectとして検証する。
- shell文字列連結を使用せずargument arrayを使用する。
- remote metadataのPR番号・base SHA・head SHAがrequestと一致しない場合はpatch/contentを使用しない。
- repository-relative pathはcanonical path contractで検証し、親directory escapeを拒否する。
- pagination Linkは同一origin、protocol、collection pathのみ許可する。
- file record、status/path matrix、statistics、patch、content diffの一部でも不整合なら完全snapshotを返さない。
- GitHub APIの3000 file上限へ到達した一覧は完全性を証明できないため拒否する。
- content diffのLCS matrixが1,000,000 cellを超える場合は`diff-too-large`として拒否する。
- 全route失敗時はattempt理由だけを返し、確認済み範囲を推測しない。

## intentionally untouched

- `.github/workflows/ci.yml`: 必須failure diagnosticsを既に満たすため変更していない。
- `tasks/tasks-status.md`: repository ruleにより専用task/progress Skillのみ更新可能なため、本implementation workerでは変更していない。
- `src/extension.ts`とruntime composition: T404/T405側の永続context/UI統合範囲。
- T403 cache、T404永続PR layer、T405 Review Contexts View。
- mergeとrelease。

## remaining risks

- Pull Request Files APIが3000件へ到達したPRは、完全性を優先してremote routeを利用不能とする。local repositoryにexact base/head commitが存在する場合のみ先行local routeで取得できる。
- content fallbackは決定的なLCSを使用し、計算量上限を超える大fileでは`diff-too-large`となる。部分diffは返さない。
- binary fileはline進捗対象外としてhunkなしで保持する。binary contentの意味的差分はT402 scope外である。
- runtimeでこのserviceをPR context persistence/UIへ接続する作業はT404/T405に残る。

## 次のaction

- PR #40を通常reviewへ渡す。
- reviewerは最終current HEADを固定し、そのSHAに一致するCI runのみ使用する。
- mergeは利用者が行う。

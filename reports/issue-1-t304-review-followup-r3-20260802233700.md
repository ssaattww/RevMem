# T304 Fix Verification R2 指摘対応 R3 レポート

## 1. Metadata

- repository: `ssaattww/RevMem`
- Pull Request: `#38`
- task: `T304`
- mode: review follow-up R3
- branch: `task/t304-pr-progress-tree`
- base ref: `main`
- base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- source verification report: `reports/issue-1-t304-fix-verification-r2-20260802225900.md`
- source verification implementation HEAD: `47cbc813e828c4cb26c9fcba417298c89d83ceb2`
- source verification evidence HEAD: `52ed5ca2753326b9c1d80bb810717215a61c5898`
- technical implementation HEAD: `5beba08823b741b03c22e2b47a5343c219ca9e82`
- design synchronization HEAD: `62a361c1036dd187adad4bc5bf10464a8d26af15`
- report path: `reports/issue-1-t304-review-followup-r3-20260802233700.md`
- merge: 実施しない

## 2. 作業開始時の診断workflow確認

`.github/workflows/ci.yml`には作業開始時点で次のfailure diagnosticsが存在した。

- 各commandの標準出力・標準エラーを`2>&1 | tee test-output/ci/*.log`へ保存
- environment、Git status、生成物一覧を収集
- `test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、`tools/`、`type-fixtures/`、package/configuration/workflowをartifactへ保存

R3 Redと中間失敗の双方でartifactが生成されたため、workflow追加は不要だった。

## 3. 対応対象

### T304-R3-P1 / medium

行単位レビュー対象外nodeが通常text diffを無条件に開き、binary・invalid encoding・unsupported encodingでcontent provider failureになる問題。

### T304-R3-P2 / medium

line-reviewability適用後のeffective progressをraw T301 `PullRequestDiffProgress`として公開していたため、raw変更統計・effective分母・対象外理由の意味を型から復元できない問題。

### T304-R3-P3 / medium

`revisionSource: "empty"`を追加した一方で、external content portとLocal Git adapterが広いdescriptor unionを受理し、同じdescriptorがapplication provider経由では空文字列、adapter直接呼出ではGit readになる問題。

## 4. TDD Red

### Red HEAD

- HEAD: `dbe208cd65afae27ef29a78c323464ea3cded5ce`
- workflow run: `30751935700`
- job: `91507385687`
- conclusion: `failure`
- failed step: `Contract typecheck`
- diagnostic artifact: `8834715318`
- artifact name: `ci-failure-diagnostics-30751935700-1`

### Red内容

先に次を追加した。

- `test/unit/t304-review-followup-r3.test.ts`
  - binary・invalid encoding・unsupported encoding選択時にtyped unavailable resultを返し、diff hostを呼ばない
  - raw T301とは異なる`PullRequestEffectiveProgress`を要求する
  - effective fileがraw record、reviewability、effective reasonを保持する
  - `empty` descriptorをexternal content portへ渡さない
  - Local Git sourceがruntimeでも`empty`をresolver/Gitアクセス前に拒否する
- `type-fixtures/contracts/t304-pr-progress-tree.fixture.ts`
  - effective/raw型の非互換
  - typed selection result
- `type-fixtures/contracts/t302-diff-document.fixture.ts`
  - `GitCommitReviewDiffDocumentDescriptor`
  - `EmptyReviewDiffDocumentDescriptor`
  - external portとLocal Git sourceへの`empty`入力をcompile-timeで拒否
- `test/unit/ci-workflow-contract.test.ts`
  - R3回帰testを`test:unit`と`test:t304`から外せないcontract

Red runでは新規public typeとnarrowed portが未実装のため、想定どおりcontract typecheckが失敗した。

## 5. 実装

### 5.1 行単位レビュー対象外selection

`PullRequestProgressTreeFileNode`へ`reviewability`を保持した。

`PullRequestProgressTreeDataProvider.select()`は次のtyped unionを返す。

- reviewable node:
  - hostへidentity-bound targetを渡す
  - `{ kind: "opened-diff", target }`
- unsupported node:
  - hostを呼ばない
  - `{ kind: "line-review-unavailable", file, reason }`

binary、不正UTF-8、未対応encodingの3caseを同じcontractで検証した。stale node拒否はselection分岐より先に維持する。

### 5.2 Raw T301とeffective progressの型分離

次の専用public contractを追加した。

- `PullRequestEffectiveFileProgress`
  - `raw: PullRequestDiffFileProgress`
  - `reviewability`
  - category
  - effective reason
  - effective reviewed/total/progress
- `PullRequestEffectiveProgress`
  - effective aggregate
  - effective file list

`snapshot.progress`はraw validated T301 resultのまま保持・検証する。unsupported fileのraw additions/deletions、status、path、identityは`raw`へ保持し、effective分子・分母だけを0へprojectionする。

`getEffectiveProgress()`はraw T301型を返さず、detachedなeffective projectionを返す。consumer type fixtureでraw `PullRequestDiffProgress`への代入を禁止した。

既存consumerとのruntime deep-equalityを不要に壊さないため、effective fileのdirect enumerable fieldは従来のprojected count shapeを維持し、raw/reviewability/category/effectiveReasonを明示contractとして付加した。

### 5.3 Diff descriptorとcontent portの整合

application contractを次のdiscriminated unionへ変更した。

- `GitCommitReviewDiffDocumentDescriptor`
  - `revisionSource: "git-commit"`
- `EmptyReviewDiffDocumentDescriptor`
  - `revisionSource: "empty"`
- `ReviewDiffDocumentDescriptor`
  - 上記union

`RevisionTextContentSource.readTextContent()`は`GitCommitReviewDiffDocumentDescriptor`だけを受理する。

`RevisionTextContentProvider`はcodec decode後、`empty`を空文字列へshort-circuitし、`git-commit`だけをexternal sourceへ委譲する。

`LocalGitRevisionTextContentSource`は型入力をGit descriptorへ限定し、runtime cast経由で`empty`が到達してもrepository resolverやGit adapterを呼ぶ前に`TypeError`で拒否する。

codecはencode/decode後もrevision source discriminantを維持し、sourceごとのcanonical descriptorを返す。

### 5.4 Public contractとtest discovery

- application diff-document barrelへdescriptor base・subtypeをexport
- PR progress barrelへeffective/selection contractをexport
- T302/T304 consumer fixtureを更新
- R3回帰testを`test:unit`と`test:t304`へ登録
- CI contract testで登録を固定

### 5.5 恒久設計同期

`doc/design/vscode-review-range-tracker-design.md`の機能別sectionを更新した。

- 8.2: `git-commit` / `empty` descriptor unionとexternal port narrowing
- 8.3: `empty` revisionはcomparison identityであり外部blob read元ではないこと
- 8.4: canonical URIが2 sourceだけを許可すること
- 8.5: application providerのsource dispatch
- 11.2: raw T301 resultとeffective UI projectionの型・意味分離
- 16.3: unsupported selectionはtext diffを開かずtyped resultを返すこと
- 20: unit/integration/Extension Host検証観点
- 21: revision sourceを含むURI復元条件

設計書へtask IDやissue番号は追加していない。

## 6. 中間失敗

### Implementation boundary HEAD

- HEAD: `9a1140055eeab0149402301fb79edf1f742d006e`
- workflow run: `30752133930`
- job: `91507916999`
- conclusion: `failure`
- diagnostic artifact: `8834777254`
- artifact name: `ci-failure-diagnostics-30752133930-1`

build、contract typecheck、architecture positive/negative、lintは成功した。Unit testsの`compile:test`で新規testの`readonly Array<T>`というTypeScript構文誤りを検出した。

production codeのfailureではなく、test declarationを`ReadonlyArray<T>`へ修正した。

## 7. Green検証

### 技術実装HEAD

- HEAD: `5beba08823b741b03c22e2b47a5343c219ca9e82`
- workflow run: `30752209455`
- job: `91508120696`
- conclusion: `success`
- exact-head verified: `true`
- substituted run: `false`

### 設計同期HEAD

- HEAD: `62a361c1036dd187adad4bc5bf10464a8d26af15`
- workflow run: `30752452916`
- job: `91508787329`
- conclusion: `success`
- exact-head verified: `true`
- substituted run: `false`

両runで次が成功した。

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T304 PR progress tree tests
- T503 repository enumeration tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのrunは代用していない。

## 8. 変更ファイル

### Source

- `src/application/diff-document/contracts.ts`
- `src/application/diff-document/index.ts`
- `src/application/diff-document/review-diff-uri-codec.ts`
- `src/adapters/diff-document/local-git-revision-text-content-source.ts`
- `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`
- `src/ui/pr-progress/index.ts`

### Tests and fixtures

- `test/unit/t304-review-followup-r3.test.ts`
- `test/unit/ci-workflow-contract.test.ts`
- `type-fixtures/contracts/t302-diff-document.fixture.ts`
- `type-fixtures/contracts/t304-pr-progress-tree.fixture.ts`
- `package.json`

### Design and evidence

- `doc/design/vscode-review-range-tracker-design.md`
- 本report
- R3 handoff

## 9. Finding disposition

| Finding | 対応 | Implementation worker disposition |
|---|---|---|
| `T304-R3-P1` | unsupported selectionをtyped unavailable resultへ分岐し、host非呼出しを3理由で検証 | addressed。通常reviewer closure待ち |
| `T304-R3-P2` | raw T301とeffective projectionを別public typeへ分離し、raw/reviewability/reasonを保持 | addressed。通常reviewer closure待ち |
| `T304-R3-P3` | descriptor union、external port narrowing、Local Git runtime拒否、設計同期 | addressed。通常reviewer closure待ち |

## 10. 対象外・held

- VS Code TreeItem、Activity Bar、Current Context、Status Barの具体的表示・event wiringは後続UI scope
- PR metadata/diff取得、encoding判定source、cache、refresh sourceは後続GitHub integration scope
- 独立最終reviewは通常finding closure後
- mergeはユーザーが実施するため禁止
- `tasks/tasks-status.md`は指定progress management skillが利用できず、直接編集していない

## 11. 次のaction

同じ通常reviewerが、現在PR HEADで`T304-R3-P1`、`T304-R3-P2`、`T304-R3-P3`のclosureと新規回帰を確認する。通常reviewがpassした場合だけ独立最終reviewへ進む。mergeは行わない。

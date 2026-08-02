# T304 初回レビュー指摘対応 Fix Verification レポート

## 1. Metadata

- repository: `ssaattww/RevMem`
- Pull Request: `#38`
- task: `T304`
- review mode: `fix verification`
- reviewer: ChatGPT review worker（初回通常reviewと同一チャット）
- reviewer continuity: 継続あり。T304の実装およびreview fixには参加していない
- branch: `task/t304-pr-progress-tree`
- base ref: `main`
- base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- initial reviewed implementation HEAD: `1fdecc956d6c3a42d7d65b203ff7b75decd7afd8`
- previous review evidence HEAD: `73db236bb5a3baee153fe95d53bc0c7fee87443c`
- reviewed implementation HEAD: `580671ab642cfa43216d06118af7b3b0fb6061c8`
- full reviewed range: `76b49e99453ebcf7ebecb2c141ed24d750736abc..580671ab642cfa43216d06118af7b3b0fb6061c8`
- fix range: `73db236bb5a3baee153fe95d53bc0c7fee87443c..580671ab642cfa43216d06118af7b3b0fb6061c8`
- exact-head CI: run `30749340434`、job `91500453521`、`success`
- previous review report: `reports/issue-1-t304-review-20260802213932.md`
- implementation follow-up report: `reports/issue-1-t304-review-followup-20260802220800.md`
- report path: `reports/issue-1-t304-fix-verification-20260802221700.md`
- merge: 実施しない

Technical verdictは上記reviewed implementation HEADにだけ適用する。

## 2. Purpose and review mode

初回通常review finding `T304-R1-P1`、`T304-R1-P2`、`T304-R1-P3`について、finding identityとseverityを維持してclosureを確認した。fix差分、変更された公開contract、T301/T302/T303への直接影響、追加されたtest、workflow、package scripts、follow-up report/handoff、current-HEAD CIを確認した。

Fix verificationとして既存findingの対象箇所だけでなく、修正で新たに追加・変更されたAPI境界と同じ欠陥classのsibling caseも確認した。

## 3. Authoritative requirements

- `tasks/tasks-status.md` T304
  - 5分類、未確認数降順・path昇順
  - fileごとの確認数、全変更数、率、追加、削除
  - ユーザー除外の理由表示
  - file選択でdiffを開く
- `doc/design/vscode-review-range-tracker-design.md` 11.2、12、13.2、16.3
  - binary/encoding対象外を「行単位レビュー対象外」へ理由付きで表示
  - identity-bound snapshotとold/new path・immutable revisionをdiff表示へ再利用
  - valid UTF-8としてdecodeできないtext blobは集計対象外
  - 公開barrelはconsumer type fixtureで固定する
- project instruction
  - current HEADとworkflow run head SHAが一致するCIだけを利用する
  - failure diagnostics artifactを保持する
  - detailed reportとPR簡易reportを残す
  - mergeしない

## 4. Inspected fix change set

Fix rangeは9 commits、変更対象は次の8 filesである。

- `.github/workflows/ci.yml`
- `package.json`
- `src/ui/pr-progress/index.ts`
- `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`
- `test/unit/ci-workflow-contract.test.ts`
- `test/unit/pull-request-progress-tree.test.ts`
- `reports/issue-1-t304-review-followup-20260802220800.md`
- `handoffs/issue-1-t304-review-followup-20260802221000.yaml`

Direct dependenciesとして次を確認した。

- `src/core/pr-progress/pr-diff-progress.ts`
- `src/core/file-exclusion/review-file-exclusion-policy.ts`
- `src/ui/diff-editor/review-diff-editor-controller.ts`
- `src/application/diff-document/revision-text-content-provider.ts`
- `src/adapters/diff-document/local-git-revision-text-content-source.ts`
- `src/adapters/local-git/local-git-adapter.ts`
- `type-fixtures/contracts/review-contracts.fixture.ts`
- `doc/design/vscode-review-range-tracker-design.md`
- `tasks/tasks-status.md`

## 5. Previous finding dispositions

### T304-R1-P1 — high — partial / open

#### Addressed portion

- `PullRequestProgressTreeSnapshot`へ`snapshotId`、`contextId`、base/head SHA、`originalDiffId`、filesystem semanticsを追加した。
- nodeへ`PullRequestProgressTreeDiffTarget`を保持し、renameではold/new pathとbase/head revisionを固定した。
- providerが現在snapshotで生成したnode objectだけを保持し、revision/context refresh前のstale nodeを拒否するtestを追加した。

この部分は初回findingのcontext/revision混線を解消している。

#### Remaining defect

- location:
  - `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts` の `createOpenTarget`
  - `test/unit/pull-request-progress-tree.test.ts` の `selection supports added and deleted paths without losing immutable sides`
  - `src/ui/diff-editor/review-diff-editor-controller.ts`
  - `src/application/diff-document/revision-text-content-provider.ts`
  - `src/adapters/local-git/local-git-adapter.ts`
- description: `createOpenTarget`はoriginal pathを`oldPath ?? newPath ?? path`、modified pathを`newPath ?? oldPath ?? path`で構築する。このためadded fileではbase revisionに存在しないnew pathをoriginal sideとして、deleted fileではhead revisionに存在しないold pathをmodified sideとして「exact immutable side」に格納する。追加testも両sideへ同じpathを入れることを正として固定している。
- impact: T302/T303のcontent pathは指定commitに存在するexact blobを読む。不存在側は`missing-file`となるため、added/deleted fileを選択してもこのtargetをそのままT303 controllerへ渡してdiffを開けない。hostがstatusを見てtargetのside contractを無視し、別のempty-document処理を推測しなければならない。これは「選択でそのcontextのexact diffを開く」契約と、初回finding required actionのadd/delete coverageを満たさない。
- evidence:
  - `ReviewDiffEditorController`はoriginal/modified双方のpathとrevisionをそのままimmutable URIへencodeする。
  - `LocalGitAdapter.readTextFileAtRevision`は指定commitにpathがなければ`missing-file`を返す。
  - `RevisionTextContentProvider`は`missing-file`をerrorとして送出し、空documentへ変換しない。
  - current testはtarget生成だけを確認し、controller/content provider経由でdiffを開けることを確認していない。
- required action: diff sideを`present`/`absent`のdiscriminated contractにするか、added/deletedの不存在側を表すimmutable empty-document revision sourceを定義する。存在しないpathを実在するsideとして格納しない。Tree selectionからT303/T302境界までを通し、added fileのempty original sideとdeleted fileのempty modified sideでdiffが開けるintegration regressionを追加する。

Source severity `high`を維持する。reclassificationはない。

### T304-R1-P2 — high — partial / open

#### Addressed portion

- `PullRequestLineReviewability`とbinary、invalid encoding、unsupported encodingの理由unionを追加した。
- reason表示、完全なfile ID map、未知reason、空encoding、binaryとの不一致を保守的にrejectする。
- line-review unsupported categoryを除外・metadata-onlyより先に分類する。

表示modelとしての分類と理由保持は追加された。

#### Remaining defect

- location:
  - `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts` の `PullRequestProgressTreeSnapshot.progress` と `validateReviewability`
  - `src/core/pr-progress/pr-diff-progress.ts` の `PullRequestDiffFileProgress` と calculator
  - `test/unit/pull-request-progress-tree.test.ts` のencoding test
- description: snapshotは`progress`を「Validated T301 progress result」と定義する一方、encoding unsupportedでは`reviewedLineCount=0`、`totalLineCount=0`、`progress=1`を必須にする。T301 calculatorは非binary・非excluded fileについて常に`totalLineCount = additions + deletions`とし、zero countにするのは共通除外policyが`excluded`を返した場合だけである。encoding unsupportedはT301のstatus・`ReviewFileExclusionReason`・policy decisionに存在しない。
- impact: 変更行を持つinvalid/unsupported encoding fileについて、T301の実出力をそのままT304 snapshotへ渡すとproviderがrejectする。逆にcallerがline countをzeroへ書き換えると「validated T301 result」ではなくなり、authoritative calculatorを迂回した集計を作ることになる。したがって、T402が実際のencoding判定を行っても、現在の公開境界だけでは設計上の集計対象外fileを一貫してTreeへ供給できない。
- evidence:
  - T301 result contractはexcluded fileだけがzero line countsを返す。
  - calculatorのincluded pathは`totalLineCount = file.additions + file.deletions`である。
  - exclusion reason unionはbinary/default-glob/user-globだけである。
  - current encoding testは`additions=0`、`deletions=0`のsynthetic fileだけを用い、実際に変更統計を持つencoding対象外fileやT301 producerとの接続を検証しない。
- required action: encoding reviewabilityをT301 progress contract/calculatorへ統合するか、T301 diff resultとline-review availabilityからraw additions/deletionsを保持したeffective progressを構築するauthoritative projection serviceを定義する。そのserviceからTreeまで、非zero additions/deletionsを持つinvalid/unsupported encoding fileがPR分母から除外され、理由付きで表示されるregression testを追加する。JSDocとproducer ownershipを一致させる。

Source severity `high`を維持する。reclassificationはない。

### T304-R1-P3 — medium — addressed / closed

- `test:unit`に`pull-request-progress-tree.test.js`が登録された。
- `test:t304`がCI contract testとT304 behavior testを実行する。
- `npm test`は`test:unit`を含む。
- CIはraw node commandではなく`npm run test:t304`を実行し、`test-output/ci/test-t304.log`を保存する。
- `ci-workflow-contract.test.ts`が上記接続を検証する。
- current exact-head CIでUnit testsとT304 focused stepが成功した。

Source severity `medium`を維持したままclosedとする。

## 6. New finding

### T304-R2-P1 — medium — open

- origin: coverage_miss / introduced_by_change
- location:
  - `src/ui/pr-progress/index.ts`
  - `type-fixtures/contracts/review-contracts.fixture.ts`
  - `doc/design/vscode-review-range-tracker-design.md` 13.2
- description: T304はsnapshot identity、line reviewability、diff target、host、node、providerをpublic barrelからexportしたが、consumer type fixtureはこれらをimport・constructしていない。fixtureはT303 public barrelsまでしか固定していない。
- impact: `typecheck:contracts`がsuccessでもT304 public APIのexport欠落、discriminant崩れ、required fieldのoptional化、invalid shapeの受理を検出できない。今回追加されたP1/P2の境界は公開contractであるため、内部unit compileだけでは後続T305/T402 consumerとの互換性証拠にならない。
- evidence:
  - 設計13.2は「公開barrelはconsumer type fixtureで固定し、内部compileだけで公開contractを検証済みとしない」と明記する。
  - `src/ui/pr-progress/index.ts`は新規public typesをexportする。
  - current `review-contracts.fixture.ts`に`src/ui/pr-progress` importまたはT304 type usageがない。
- required action: consumer fixtureへT304 public barrelを追加し、正常なsnapshot/reviewability/diff target/host shapeをconstructする。少なくともmissing snapshot identity、invalid reviewability discriminant、unsupported reason欠落、diff side contractの不正shapeがcompile-timeで拒否されることを`@ts-expect-error`等で固定する。

## 7. TDD and failure diagnostics assessment

### Red evidence

- `T304-R1-P3`
  - HEAD: `851c55a66206ac64a82236fce6efa5f64655f3a5`
  - run: `30748859263`
  - conclusion: failure
  - artifact: `8833773687` / `ci-failure-diagnostics-30748859263-1`
- `T304-R1-P1` / `T304-R1-P2`
  - HEAD: `c17b97f03af516f0c484356042c91d2ba8bb9c78`
  - run: `30748932987`
  - conclusion: failure
  - artifact: `8833796187` / `ci-failure-diagnostics-30748932987-1`
- intermediate boundary correction
  - HEAD: `72a16a48070df9d67e79a82c8160a2d4153a9ec3`
  - run: `30749149862`
  - conclusion: failure
  - artifact: `8833863915` / `ci-failure-diagnostics-30749149862-1`

Red runsとartifactのhead SHA一致を確認した。diagnostic workflowは標準出力・標準エラー統合log、test result、environment、Git status、生成物、source/test/configurationを保存する。

### Current-HEAD Green evidence

reviewed HEAD `580671ab642cfa43216d06118af7b3b0fb6061c8`に一致するrunだけを使用した。

- run: `30749340434`
- job: `91500453521`
- conclusion: `success`
- successful steps:
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

別SHAのrunは代用していない。CI successは実行されたtestが通る証拠であり、P1/P2と新規P1の欠落scenarioを否定する証拠ではない。

## 8. Required coverage dispositions

- requirement and design conformance: `checked_finding` — T304-R1-P1、T304-R1-P2、T304-R2-P1
- correctness and edge cases: `checked_finding` — added/deleted absent side、encoding対象外のnonzero change stats
- scope discipline and unrelated changes: `checked_no_finding` — package manifestは全体format変更を含むが、意味上の追加はT304 test wiringに限定され、別機能変更は確認されない
- changed files and direct dependency impact: `checked_finding` — T301/T302/T303、public consumer fixtureとの境界
- API, data, configuration, workflow, compatibility effects: `checked_finding` — P1/P2 public contractとT304-R2-P1。P3 workflow/script接続はclosed
- error handling and failure diagnostics: `checked_no_finding`
- security and secret handling: `not_applicable`
- tests and validation adequacy: `checked_finding` — added/deleted end-to-end、T301 encoding producer、public type fixtureが欠落
- current-HEAD CI evidence: `checked_no_finding` — exact-head successを確認
- report, tracking, documentation accuracy: `checked_finding` — follow-up report/handoffのP1/P2 `addressed`主張はclosure evidenceと一致しない。T304 tracking未更新はheld
- regression and maintainability risks: `checked_finding` — nonexistent sideをexact targetとして表現するAPIと、calculator外でのsynthetic progress生成が後続実装へ負債を移す

## 9. Held and not applicable

### Held: task tracking sync

- `tasks/tasks-status.md`のT304は`未着手`のままである。
- repository ruleにより指定progress-management skill経由の更新が必要だが、今回のuploaded skill setには該当managerが含まれない。
- 通常fix verificationのtechnical verdictは実装findingでfailしているため、現時点でtrackingを完了へ進める条件も満たさない。

### Accepted deferred scope

- T305: VS Code TreeItem/event、Activity Bar、Current Context、Status Bar
- T402: PR metadata/diff取得、encoding判定source、cache、refresh source
- T306: Extension Host end-to-end UI試験

ただし、後続taskへ実装を延期することは、T304が公開する境界を内部矛盾のない形で定義する責任を免除しない。

### Not applicable

- security/secret handling: T304 fix差分はcredential、network、secretを扱わない
- merge: user reserved action
- Markdown lint: repository-local entry pointなし。TypeScript lintを代用しない

## 10. Verdict

`fail`

- `T304-R1-P1 / high`: partial、open
- `T304-R1-P2 / high`: partial、open
- `T304-R1-P3 / medium`: addressed、closed
- `T304-R2-P1 / medium`: new、open

通常review findingが残るため、独立最終reviewへ進めない。

## 11. Next action

実装chatへ戻し、次をTDDで修正する。

1. added/deletedの不存在sideを正確に表せるdiff targetとempty document経路を定義する。
2. encoding対象外をT301 producerまたはauthoritative projectionと整合させ、非zero変更統計を持つscenarioを通す。
3. T304 public barrelをconsumer type fixtureで固定する。
4. review follow-up report/handoffのP1/P2 dispositionを今回のfix verification結果と整合させる。
5. 新HEADに一致するCI success後、同じ通常reviewerが既存finding closureと新規findingを再確認する。

mergeは行わない。

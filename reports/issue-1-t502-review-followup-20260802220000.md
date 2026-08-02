# T502 レビュー指摘対応レポート

## 対象

- Repository: `ssaattww/RevMem`
- Pull Request: #37
- Task: T502
- Branch: `task/t502-global-mapping-display-priority`
- 通常レビュー対象実装HEAD: `ff2a138a4c21b864aec0da2a8bb96d5a7a960e37`
- 通常レビューreport commit: `6d1b9705a6969092dfcb2c34128ef37a8ea8a36b`
- 対応実装HEAD: `baa116755f28b2f22dc84fd6fdc30dd57635f975`

## 対応finding

### T502-REV-001 high

通常modified fileがT204 file transitionだけを通り、T203 interval mappingを通らない問題へ対応した。

- same-path modified sectionを`parseZeroContextGitDiff`で識別する。
- pre-transition Global rangeを`mapReviewedIntervalsAcrossDiff`へ渡す。
- 変更旧行だけを無効化し、未変更rangeを新revision座標へ追従する。
- new file metadataがある場合は新content hashへ更新する。

### T502-REV-002 high

Global snapshotのtop-level revisionだけが進み、無関係な保持fileのfile-level revisionが旧revisionへ残る問題へ対応した。

- editor change後に、対象file以外を含む全保持fileの`revisionId`をnew revisionへ進める。
- Git mapping後も、transition後に保持された全fileの`revisionId`をnew revisionへ進める。
- 無関係fileのreviewed range、path、content hash、updatedAtは維持する。

### T502-REV-003 high

current PR diffがmissingまたはidentity mismatchの場合にlower-priority layerをfail-open表示する問題へ対応した。

- PR contextではdiffのcontext/base/head identityを必須証拠とする。
- 証拠がmissing、stale、mismatchの場合はcurrent context以外のother-contextとGlobalを表示しない。
- valid diffに対象fileが存在しない場合だけ「当該fileにPR変更なし」と確定する。

### T502-REV-004 medium

other-context intervalの一部だけがGlobalと重なる場合に、全区間へGlobal activeを表示する問題へ対応した。

- visible other-context rangeをGlobal overlap部分と非overlap部分へ分割する。
- 各区間へ正確な`globalActive`を付与する。

## TDD

### Red

findingごとの回帰を`test/unit/global-review-mapping-display-priority.test.ts`へ先行追加した。

- Red HEAD: `6c7576ef6ba9f8af7999c8a164dcbe5a4ecbff6d`
- HEAD一致CI run: `30748755739`
- conclusion: failure
- diagnostic artifact: `8833738404`
- artifact name: `ci-failure-diagnostics-30748755739-1`

### 実装中診断

- HEAD: `1de180f2a0d6f782a2cd6712074827f0378f95a0`
- HEAD一致CI run: `30748798525`
- conclusion: failure
- failure: immutable `PullRequestDiffSnapshot.files`をtest fixtureで再代入していたためTypeScript compile failure
- diagnostic artifact: `8833753460`
- production contractは変更せず、fixtureをimmutable constructionへ修正した。

### Green

- Green HEAD: `baa116755f28b2f22dc84fd6fdc30dd57635f975`
- HEAD一致CI run: `30748862936`
- conclusion: success
- 別SHAのrunは代用していない。

成功工程:

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T502 focused tests
- T503 focused tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

## 変更file

- `src/application/global-review-mapping/global-review-mapping.ts`
- `src/application/editor-decoration/normal-editor-decoration-model.ts`
- `test/unit/global-review-mapping-display-priority.test.ts`
- 本report
- review follow-up handoff

## 意図的に変更していない範囲

- Global理解率calculator/cache: T504
- Global Understanding UI: T505
- task/phase進捗: 専用manager責務
- review report原文
- merge

## 次のアクション

通常reviewerによるT502-REV-001〜004のfix verificationが必要である。実装者自身によるreview verdictは出していない。

mergeは行っていない。

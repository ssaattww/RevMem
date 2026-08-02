# T304 Fix Verification R3 レポート

## 1. Metadata

- repository: `ssaattww/RevMem`
- Pull Request: `#38`
- task: `T304`
- review mode: `fix verification`
- reviewer: ChatGPT normal reviewer（初回reviewおよび前回fix verificationと同一chat）
- reviewer continuity: 維持。T304実装およびreview fixには参加していない
- branch: `task/t304-pr-progress-tree`
- base ref: `main`
- base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- previous reviewed implementation HEAD: `47cbc813e828c4cb26c9fcba417298c89d83ceb2`
- previous review evidence HEAD: `52ed5ca2753326b9c1d80bb810717215a61c5898`
- reviewed implementation HEAD: `283fa41b37c79c802ec2e93a7e67f4941603bb40`
- fix range: `52ed5ca2753326b9c1d80bb810717215a61c5898..283fa41b37c79c802ec2e93a7e67f4941603bb40`
- exact-head CI: run `30752596290`、job `91509172807`、`success`
- report path: `reports/issue-1-t304-fix-verification-r3-20260803045900.md`
- merge: 実施しない

Technical verdictはreviewed implementation HEAD `283fa41b37c79c802ec2e93a7e67f4941603bb40`にだけ適用する。

## 2. Purpose and scope

前回fix verification R2でopenとなった次のfindingのclosureを確認した。

- `T304-R3-P1 / medium`: 行単位レビュー対象外nodeがtext diffを開く
- `T304-R3-P2 / medium`: effective projectionをraw T301型として公開する
- `T304-R3-P3 / medium`: `empty` descriptorとexternal content sourceの契約不整合

あわせて、fix rangeの全変更、変更されたT302/T303境界、public barrels、consumer fixtures、設計、test discovery、reports/handoffs、current-HEAD CIを確認し、同じdefect classと新規変更領域を再監査した。

Authoritative requirementsは次を使用した。

- `tasks/tasks-status.md` T304
- `doc/design/vscode-review-range-tracker-design.md` 2.1、7章、8.2〜8.5、11.2、16.3、20章、21章
- previous review report `reports/issue-1-t304-fix-verification-r2-20260802225900.md`
- project instructionのexact-head CI、診断artifact、詳細report、PR簡易report、no-merge規則

## 3. Inspected fix set and direct dependencies

### R3 changed files

- `doc/design/vscode-review-range-tracker-design.md`
- `src/application/diff-document/contracts.ts`
- `src/application/diff-document/index.ts`
- `src/application/diff-document/review-diff-uri-codec.ts`
- `src/adapters/diff-document/local-git-revision-text-content-source.ts`
- `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`
- `src/ui/pr-progress/index.ts`
- `test/unit/t304-review-followup-r3.test.ts`
- `test/unit/ci-workflow-contract.test.ts`
- `type-fixtures/contracts/t302-diff-document.fixture.ts`
- `type-fixtures/contracts/t304-pr-progress-tree.fixture.ts`
- `package.json`
- R3 report/handoff

### Direct dependencies inspected

- `src/ui/diff-editor/review-diff-editor-controller.ts`
- `src/application/diff-document/revision-text-content-provider.ts`
- `src/application/repository-path/repository-relative-path.ts`
- `src/core/pr-progress/pr-diff-progress.ts`
- `test/unit/pull-request-progress-tree.test.ts`
- `test/unit/review-diff-editor-controller.test.ts`
- `test/unit/review-diff-content-provider.test.ts`
- `type-fixtures/contracts/review-contracts.fixture.ts`
- `.github/workflows/ci.yml`

## 4. Previous finding closure

### T304-R3-P1 — medium — addressed / closed

- `PullRequestProgressTreeFileNode`がline reviewabilityを保持する。
- `select()`はstale nodeを先に拒否する。
- binary、invalid encoding、unsupported encodingではhostを呼ばず、`line-review-unavailable`とraw file identity・machine-readable reasonを返す。
- reviewable nodeだけがhostを呼び、`opened-diff`を返す。
- 3理由の回帰testとhost非呼出しを確認した。
- 設計16.3、20.1、20.3が同contractへ同期されている。

### T304-R3-P2 — medium — addressed / closed

- `PullRequestEffectiveProgress`と`PullRequestEffectiveFileProgress`がraw `PullRequestDiffProgress`とは別public typeとして定義された。
- effective fileはraw record、reviewability、category、effective reason、effective countを型上で保持する。
- consumer fixtureでeffective aggregateからraw T301 aggregateへの代入をcompile-time errorとして固定した。
- nonzero encoding対象外fileをeffective denominatorから除外する動作を確認した。

ただし、下記`T304-R4-P1`のとおり、実際のruntime object representationには新たな欠陥がある。

### T304-R3-P3 — medium — addressed / closed

- descriptorは`git-commit` / `empty`のdiscriminated unionとなった。
- external `RevisionTextContentSource`は`GitCommitReviewDiffDocumentDescriptor`だけを受理する。
- application providerは`empty`を外部sourceへ渡さず空文字列へ解決する。
- Local Git sourceは型境界に加え、runtimeでも`empty`をrepository resolver・Git access前に拒否する。
- codec、T302 consumer fixture、恒久設計8.2〜8.5・20・21の同期を確認した。

## 5. New findings

### T304-R4-P1 — medium — open

- origin: `introduced_by_fix`
- location:
  - `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts` の `defineEffectiveFile` / `cloneEffectiveFile` / `getEffectiveProgress`
  - `test/unit/pull-request-progress-tree.test.ts` のeffective progress deep-equality assertion
  - `reports/issue-1-t304-review-followup-r3-20260802233700.md` 5.2
- description:
  - public type `PullRequestEffectiveFileProgress`は`raw`、`reviewability`、`category`、`effectiveReason`、effective countを持つDTOとして宣言されている。
  - 実装はraw T301 recordをspreadしたobjectへ、上記4 fieldを`Object.defineProperties(..., enumerable: false)`で追加し、型castして返す。
  - その結果、direct property accessではpublic contractが見える一方、`Object.keys`、object spread、`Object.assign`、JSON serialization、通常のdeep equalityではrequired effective evidenceが消え、代わりにpublic typeに存在しないraw T301 fieldが列挙される。
  - 既存testも`getEffectiveProgress().files`をraw projected file shapeとしてdeep-equalしており、この不一致を固定している。
- impact:
  - T305、Status Bar、cache、diagnostic、handoff等のconsumerが通常のclone/serializationを行うと、reviewability、category、effective reason、raw/effective区別を無言で失う。
  - `excluded=false`かつraw additions/deletionsがnonzero、effective totalが0である理由を復元できなくなり、`T304-R3-P2`で導入した専用public contractがruntime transport時にraw T301風のshapeへ退行する。
  - reportの「detached effective projection」という説明とも一致しない。
- evidence:
  - `defineEffectiveFile`は`projected = { ...rawFile }`を基体とし、`raw`、`reviewability`、`category`、`effectiveReason`を全てnon-enumerableで定義する。
  - initial T304 testはeffective fileを`{ ...invalidUtf8, reviewedLineCount: 0, totalLineCount: 0, progress: 1 }`としてdeep-equalするため、新public fieldsが列挙されない現状でのみ通る。
  - R3 reportはruntime deep-equality互換を理由としてこの表現を明示しているが、`getEffectiveProgress`は本PR内で導入されたAPIであり、raw shapeを維持するaccepted compatibility requirementはない。
- required action:
  - `PullRequestEffectiveFileProgress`を宣言どおりのplain DTOとして構築し、required fieldsを通常のenumerable own propertyにする。
  - undeclared raw T301 fieldをeffective file直下へ展開せず、raw recordは`raw`だけに保持する。
  - `raw.exclusionReason`等のnested objectもcloneし、returned projectionをinput/internal stateから実際にdetachする。
  - object spread、`Object.keys`、JSON round-tripでraw/reviewability/category/effectiveReasonが保持される回帰testへ置き換える。

### T304-R4-P2 — medium — open

- origin: `introduced_by_change` / `coverage_miss`
- location: `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts` の `validateNonEmpty` と `validateFile`
- description:
  - `validateNonEmpty`は`value.trim().length === 0`を拒否し、file `path`、`oldPath`、`newPath`にも同validatorを使用する。
  - POSIX canonical path contractはNULと`/` separator等だけを禁止し、spaceを通常のfilename characterとして保持する。rootに存在するfile名`" "`や`"   "`は有効なGit/POSIX pathである。
  - T304だけがtrim-based validationでこの有効pathを拒否する。
- impact:
  - whitespace-only filenameを変更するPRでは、T301が有効なprogress recordを生成してもTree snapshot replacementが失敗し、未確認file一覧、分類、選択diffを表示できない。
  - 設計7.2〜7.3の「暗黙正規化せずPOSIX filenameを保持」とAC-17のfile一覧を満たさない。
- evidence:
  - `requireCanonicalRepositoryRelativePath`は`value.length === 0`のみを空判定とし、POSIXではspaceを拒否しない。
  - T304の`validateFile`はpath fieldを`trim()`する共通validatorへ渡す。
  - current T304 testsにwhitespace-only POSIX pathがない。
- required action:
  - ID/encoding label用のtrim-aware validationとpath用のexact nonempty validationを分離する。
  - 可能ならsnapshotの`fileSystemPathSemantics`を使ってcanonical repository-relative path validatorを適用する。
  - POSIX root whitespace-only filenameを保持し、Windows trailing-space segmentは既存canonical validatorで拒否する回帰testを追加する。

### T304-R4-P3 — medium — open

- origin: `introduced_by_fix`
- location: `src/ui/diff-editor/review-diff-editor-controller.ts` の `ReviewDiffEditorPresentSideInput` と `openReviewDiff`内descriptor生成
- description:
  - public side inputは`kind?: "present"`と`kind: "absent"`のunionである。
  - runtime dispatchは`value.kind === "absent" ? "empty" : "git-commit"`だけで、`undefined`と`"present"`以外の未知kindも全てGit present sideへ変換する。
  - codecには既に`git-commit`へ正規化されたdescriptorが渡るため、codecのunknown revision-source validationではこのmalformed side inputを検出できない。
- impact:
  - JavaScript caller、破損した境界入力、将来追加されたside variantがfail-closedにならず、存在しないpathへGit readを行う可能性がある。
  - source dispatchの誤りが`missing-file`等へ変換され、入力contract違反と実際のrepository欠落を区別できない。
  - 設計2.1の確実性優先と8.4のunknown source/discriminant reject方針に反する。
- evidence:
  - controllerはtitle以外のruntime side discriminant validationを行わない。
  - current controller testはkind省略のlegacy present sideと空titleだけを検証し、未知kindを検証しない。
- required action:
  - `kind`を`undefined`、`"present"`、`"absent"`のいずれかとして明示検証し、それ以外はURI parse/host call前に`TypeError`または専用validation errorで拒否する。
  - backward compatibilityとしてkind省略をpresent扱いにする場合も、未知値はpresentへ読み替えない。
  - unknown string、非string kind、absent/presentの正常caseをruntime testへ追加する。

## 6. Validation assessment

### Exact-head CI

reviewed implementation HEAD `283fa41b37c79c802ec2e93a7e67f4941603bb40`に一致するrunだけを確認した。

- workflow: `CI`
- run: `30752596290`
- job: `91509172807`
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

別SHAのrunは代用していない。CI greenはcurrent suiteが成功した証拠であり、上記runtime representation、POSIX path、unknown discriminatorの未検証caseを否定する証拠ではない。

### R3 TDD evidence

- Red HEAD: `dbe208cd65afae27ef29a78c323464ea3cded5ce`
- Red run: `30751935700`
- Red artifact: `8834715318` / `ci-failure-diagnostics-30751935700-1`
- Intermediate failure HEAD: `9a1140055eeab0149402301fb79edf1f742d006e`
- Intermediate run: `30752133930`
- Technical Green HEAD: `5beba08823b741b03c22e2b47a5343c219ca9e82`
- Design Green HEAD: `62a361c1036dd187adad4bc5bf10464a8d26af15`
- final reviewed HEAD run: `30752596290`

Red artifactのhead SHA一致と診断workflowを確認した。

## 7. Required coverage dispositions

- requirement and design conformance: `checked_finding` — `T304-R4-P2`、`T304-R4-P3`
- correctness and edge cases: `checked_finding` — runtime DTO transport、whitespace-only POSIX path、unknown side discriminant
- scope discipline and unrelated changes: `checked_no_finding` — R3のT302/T304・design変更はprevious findingsのclosureに必要
- changed files and direct dependency impact: `checked_finding` — effective DTO、repository path contract、diff editor controller
- API, data, configuration, workflow, and compatibility effects: `checked_finding` — `T304-R4-P1`、`T304-R4-P3`
- error handling and failure diagnostics: `checked_finding` — unknown side inputがcontract errorではなくGit presentへ読み替えられる
- security and secret handling: `not_applicable`
- tests and validation adequacy: `checked_finding` — 3 new caseの回帰testがない。R3 regression discovery自体はsupported
- current-HEAD CI evidence: `checked_no_finding` — exact-head success
- report, tracking, and documentation accuracy: `checked_finding` — R3 reportのdetached/public DTO説明とruntime enumerable shapeが一致しない。task trackingはheld
- regression and maintainability risks: `checked_finding` — hidden DTO fieldsとmalformed union normalization

## 8. Held, unknown, and not applicable

### Held

- task tracking sync
  - reason: `tasks/tasks-status.md`は指定progress management skill経由の更新が必須だが、現在のuploaded skill setに該当managerがない
  - owner: progress management worker
  - verdict impact: 今回のtechnical findingsとは独立したheld item。直接編集しない
- concrete VS Code TreeItem/reason notification
  - reason: T305/T306のaccepted scope
  - remaining risk: typed unavailable resultを実UIへ変換するExtension Host behaviorは後続taskで検証する
  - verdict impact: T304 platform-neutral providerの今回判定には追加しない
- PR metadata/diff取得とencoding判定source
  - reason: T402以降のaccepted scope
  - verdict impact: current input contractのreviewを妨げない

### Unknown / unsupported

- Markdown lint: repository-local entry pointがないためunsupported。TypeScript lintを代用していない

### Not applicable

- secret handling: 本差分はcredentialを扱わない
- merge result: mergeはユーザー専有操作

## 9. Verdict

`fail`

Previous finding `T304-R3-P1`〜`P3`はclosureできるが、新規required finding `T304-R4-P1`〜`P3`がopenである。独立最終reviewへは進めない。

## 10. Required next action

同じimplementation chatで次をTDD修正する。

1. effective DTOを宣言どおりのplain enumerable data shapeへ変更し、deep clone/serialization回帰testを追加する。
2. path validationをcanonical filesystem semanticsへ合わせ、POSIX whitespace-only filenameを通す。
3. diff editor side inputの未知runtime discriminantをfail-closedにする。
4. broad/current-head CI、詳細follow-up report、handoff、PR簡易報告を更新する。
5. 同じnormal reviewer chatで`T304-R4-P1`〜`P3`のclosureと新規変更領域を再確認する。

mergeは行わない。

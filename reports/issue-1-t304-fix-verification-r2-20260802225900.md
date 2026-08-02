# T304 Fix Verification R2 レポート

## 1. Metadata

- Repository: `ssaattww/RevMem`
- Pull Request: `#38`
- Task: `T304`
- Review mode: `fix verification`
- Reviewer: ChatGPT normal reviewer（初回reviewおよび前回fix verificationと同一チャット）
- Reviewer continuity: T304の実装・review fixには参加していない。同一reviewerとしてfinding identityとseverityを継続した
- Branch: `task/t304-pr-progress-tree`
- Base ref: `main`
- Base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Previous review evidence HEAD: `9b29b978505255790594eaa412bc7374c6f08cba`
- Reviewed implementation HEAD: `47cbc813e828c4cb26c9fcba417298c89d83ceb2`
- Fix diff: `9b29b978505255790594eaa412bc7374c6f08cba..47cbc813e828c4cb26c9fcba417298c89d83ceb2`
- Full PR range: `76b49e99453ebcf7ebecb2c141ed24d750736abc..47cbc813e828c4cb26c9fcba417298c89d83ceb2`
- Exact-head CI: run `30750677866`、job `91504065803`、`success`
- Report path: `reports/issue-1-t304-fix-verification-r2-20260802225900.md`
- Merge: 実施しない

Technical verdictはreviewed implementation HEAD `47cbc813e828c4cb26c9fcba417298c89d83ceb2`にだけ適用する。

## 2. Purpose and scope

前回fix verification report `reports/issue-1-t304-fix-verification-20260802221700.md`のopen findingを同一normal reviewerとしてverificationした。

対象finding:

- `T304-R1-P1 / high`
- `T304-R1-P2 / high`
- `T304-R1-P3 / medium`（closed状態の維持確認）
- `T304-R2-P1 / medium`

fix diffの全14 commit、変更14 file、変更されたT302/T303公開境界、T304 test・consumer fixture、report/handoff、current-HEAD CIを確認した。findingの直接修正だけでなく、新しく変更された領域と同種のsibling caseも確認した。

## 3. Authoritative requirements and design

- `tasks/tasks-status.md` T304
  - 5分類
  - 未確認数降順・path昇順
  - 各fileの確認数・全変更数・率・追加・削除の整合
  - ユーザー除外の理由表示
  - file選択でdiffを開く
- `doc/design/vscode-review-range-tracker-design.md` 8章、11.1〜11.2、13.2、16.3
  - context、side、revision source、immutable revisionを仮想文書identityへ保持する
  - binary/encoding対象外を「行単位レビュー対象外」へ表示する
  - file選択でそのcontextのdiff editorを開く
  - 公開barrelをconsumer type fixtureで固定する
- Project instruction
  - current HEADと一致するworkflow runだけをCI証拠にする
  - failure diagnostics artifactを保持する
  - detailed reportとPR簡易reportを残す
  - mergeしない

## 4. Inspected change set and direct dependencies

### R2 fix files

- `src/application/diff-document/contracts.ts`
- `src/application/diff-document/review-diff-uri-codec.ts`
- `src/application/diff-document/revision-text-content-provider.ts`
- `src/ui/diff-editor/review-diff-editor-controller.ts`
- `src/ui/diff-editor/index.ts`
- `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`
- `src/ui/pr-progress/index.ts`
- `test/unit/pull-request-progress-tree.test.ts`
- `type-fixtures/contracts/t304-pr-progress-tree.fixture.ts`
- `type-fixtures/contracts/tsconfig.json`
- R2 report/handoffおよび前回証跡の訂正

### Direct dependencies

- `src/core/pr-progress/pr-diff-progress.ts`
  - raw T301 `PullRequestDiffProgress` contract
- `src/adapters/diff-document/local-git-revision-text-content-source.ts`
  - public `RevisionTextContentSource` implementation
- `src/application/diff-document/revision-text-content-provider.ts`
  - invalid encodingのstable failure
- `type-fixtures/contracts/t302-diff-document.fixture.ts`
  - T302 public consumer contract
- `type-fixtures/contracts/review-contracts.fixture.ts`
  - T303 public consumer contract
- `doc/design/vscode-review-range-tracker-design.md`
- `tasks/tasks-status.md`

## 5. Previous finding dispositions

### T304-R1-P1 — high — addressed / closed

- added fileのoriginal側とdeleted fileのmodified側が`absent`として表現される。
- `ReviewDiffEditorController`はabsent sideを`revisionSource: "empty"`へ変換する。
- `RevisionTextContentProvider`はempty descriptorで外部sourceを呼ばず空文字列を返す。
- Tree → diff controller → URI codec → content providerの回帰testで、addedは`"" -> "added\n"`、deletedは`"deleted\n" -> ""`を確認する。
- present sideだけが外部content sourceへ渡される。

前回の不存在side欠陥はclosureした。

### T304-R1-P2 — high — addressed / closed

- providerはraw T301 file/aggregate count・ratioを先に検証する。
- line reviewabilityを適用し、encoding対象外fileのeffective reviewed/totalを0、progressを1へprojectionする。
- nonzero additions/deletionsを持つinvalid encoding fileがeffective denominatorから除外されるtestが追加された。
- raw additions/deletionsと理由はTree nodeへ保持される。

前回要求したnonzero encoding対象外fileのauthoritative projectionは実装された。

### T304-R1-P3 — medium — addressed / closed maintained

`test:unit`、`npm test`、`test:t304`、CI stepへの登録は維持され、current-HEAD CIで成功した。

### T304-R2-P1 — medium — addressed / closed

- `type-fixtures/contracts/t304-pr-progress-tree.fixture.ts`が追加された。
- `type-fixtures/contracts/tsconfig.json`へ登録された。
- snapshot、reviewability、present/absent side、diff target、host、providerをpublic barrelから利用し、negative shapeもcompile-timeで固定した。

## 6. New findings

### T304-R3-P1 — medium — open

- Origin: `coverage_miss` / `introduced_by_fix`
- Location:
  - `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts` の `toFileNode`、`createOpenTarget`、`select`
  - `src/application/diff-document/revision-text-content-provider.ts` の invalid-encoding failure
  - `test/unit/pull-request-progress-tree.test.ts`
- Description:
  - `line-review-unsupported` nodeにも通常の`openTarget`が作られ、`select`はcategoryやreviewabilityを確認せず常に`host.openDiff`を呼ぶ。
  - invalid encoding fileのpresent sideは`git-commit` descriptorとなるため、実content sourceが`invalid-encoding`を返すと`RevisionTextContentProviderError`でdiff openがrejectされる。
  - binary fileもtext content providerで安全に復元できないため同じ問題を持つ。
  - 現在の回帰testはunsupported nodeの分類・projectionだけを検証し、unsupported nodeの選択動作を検証しない。
- Impact:
  - T304の終了条件および設計16.3の「ファイルを選択すると、そのcontextのdiff editorを開く」を、binary/encoding対象外categoryで満たせない。
  - UIは選択可能なnodeを表示するが、実行時にはstable errorとなる。選択不能にする仕様、placeholder表示、診断表示のいずれもcontract化されていない。
- Evidence:
  - `select`はcurrent nodeであれば無条件に`host.openDiff(node.openTarget)`を実行する。
  - `RevisionTextContentProvider`は`invalid-encoding` resultをerrorとしてthrowする。
  - T304 testにbinary/invalid-encoding node選択scenarioがない。
- Required action:
  - line-review unsupported fileの選択contractを明示する。
  - diffを開く要件を維持する場合は、binary/invalid encodingを表示可能なplaceholderまたは専用viewerへidentity-boundに接続する。
  - 選択不能とする場合はnode contract・T305 UI・設計16.3・task終了条件を更新し、hostを呼ばないtestを追加する。
  - binary、invalid encoding、unsupported encodingの各選択scenarioを追加する。

### T304-R3-P2 — medium — open

- Origin: `introduced_by_fix` / `api_contract`
- Location:
  - `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts` の `projectFileProgress`、`effectiveProgress`、`getEffectiveProgress`
  - `src/core/pr-progress/pr-diff-progress.ts` の `PullRequestDiffFileProgress` / `PullRequestDiffProgress`
  - `type-fixtures/contracts/t304-pr-progress-tree.fixture.ts`
- Description:
  - `getEffectiveProgress()`はprojection後の結果をraw T301型`PullRequestDiffProgress`として公開する。
  - encoding対象外fileは`additions/deletions`がnonzero、`excluded=false`のまま、`totalLineCount=0`へ変換される。
  - raw T301 contractはaggregate `totalLineCount`をincluded fileの追加・削除行、file `totalLineCount`をreviewable changed linesとして定義し、zero countの理由をshared exclusion policyの`excluded/exclusionReason`で表す。projection結果にはline reviewabilityが含まれない。
  - consumer fixtureも`getEffectiveProgress()`を`PullRequestDiffProgress`へ代入し、このraw/effective contract混同を固定している。
- Impact:
  - downstream consumerは同じ型からraw T301 resultとT304 projection resultを区別できない。
  - projected fileがなぜ`additions + deletions`と`totalLineCount`で一致しないか、なぜ`excluded=false`で分母0なのかを型・dataから復元できない。
  - T305/Status Bar以外のconsumerがT301 invariantを前提に再検証・再利用すると誤判定またはcontract変更の波及が発生する。
- Evidence:
  - `projectFileProgress`はunsupported時にcountだけを0へ変更し、status、additions、deletions、excluded、exclusionReasonをそのまま保持する。
  - `getEffectiveProgress`のreturn typeは`PullRequestDiffProgress`である。
  - T304 fixtureはその型代入をpositive contractとして固定する。
- Required action:
  - raw T301 resultとT304 effective projectionを別型に分離する。
  - projected file typeへline reviewabilityまたはeffective exclusion reasonを保持し、raw additions/deletionsとeffective denominatorの意味を明示する。
  - aggregateだけを外部公開する設計なら、per-file raw T301型を返さない専用summary contractにする。
  - consumer fixtureでraw/effectiveの誤代入をnegative contractとして固定する。

### T304-R3-P3 — medium — open

- Origin: `introduced_by_fix` / `api_contract` / `documentation_drift`
- Location:
  - `src/application/diff-document/contracts.ts`
  - `src/application/diff-document/revision-text-content-provider.ts`
  - `src/adapters/diff-document/local-git-revision-text-content-source.ts`
  - `type-fixtures/contracts/t302-diff-document.fixture.ts`
  - `doc/design/vscode-review-range-tracker-design.md` 8.2〜8.4
- Description:
  - `ReviewDiffDocumentDescriptor.revisionSource`を`"git-commit" | "empty"`へ広げたが、`RevisionTextContentSource.readTextContent`の引数は広いdescriptorのままである。
  - interface JSDocはgit-commit descriptorだけを読むと説明する一方、型はempty descriptorも許可する。
  - public `LocalGitRevisionTextContentSource`は`revisionSource`を確認せず、empty descriptorを直接渡すとGit blobを読む。
  - 同じempty descriptorでも`RevisionTextContentProvider`経由では`""`、public source直接呼出しではGit contentとなり、公開境界で結果が一致しない。
  - 設計8.2はdescriptorを`revisionSource: "git-commit"`だけと定義したままで、empty sourceのidentity・producer・validation contractが反映されていない。T302 consumer fixtureもempty sourceを固定していない。
- Impact:
  - public application portとadapterのsubstitutabilityが崩れ、caller経路によって同一descriptorの意味が変わる。
  - future GitHub/snapshot sourceがemptyを誤処理しやすく、text sourceを直接利用するconsumerが存在しないblobを実在contentとして扱う可能性がある。
  - accepted designと公開URI grammarが不一致になる。
- Evidence:
  - `RevisionTextContentSource`のparameter typeは`ReviewDiffDocumentDescriptor`。
  - `LocalGitRevisionTextContentSource.readTextContent`は`descriptor.revisionSource`を分岐・rejectせずGit adapterを呼ぶ。
  - `RevisionTextContentProvider`だけがemptyをshort-circuitする。
  - design 8.2はgit-commit onlyである。
- Required action:
  - descriptorをrevision sourceごとのdiscriminated unionにし、external content source portを`git-commit` descriptorへ型でnarrowする、または全sourceがemptyを同じ意味で処理・rejectするcontractにする。
  - `ReviewDiffEditorController`、URI codec、provider、LocalGit sourceのruntime validationを同じsource contractへ揃える。
  - T302 consumer fixtureにempty sourceのpositive/negative contractを追加する。
  - design 8.2〜8.4へempty synthetic documentのidentity、revision、path、source dispatch、互換性を反映する。

## 7. Validation assessment

### R2 Red

- HEAD: `ec493bc682bdb7d5a181c75055e382707e92aeaa`
- Run: `30750333643`
- Job: `91503128102`
- Conclusion: `failure`
- Failed step: Contract typecheck
- Diagnostic artifact: `8834227607` / `ci-failure-diagnostics-30750333643-1`
- Artifact head SHAはRed HEADと一致する。別SHAは代用していない。

### R2 Green technical HEAD

- HEAD: `4139b7538b0051ec21f30de1c9ddffff86469cd3`
- Run: `30750518751`
- Job: `91503639040`
- Conclusion: `success`

### Reviewed implementation HEAD

- HEAD: `47cbc813e828c4cb26c9fcba417298c89d83ceb2`
- Run: `30750677866`
- Job: `91504065803`
- Conclusion: `success`
- Successful steps:
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

CI successは実行済みtestの成功を示す。新規findingは未定義または未testのpublic contract・unsupported selection behaviorであり、green CIと矛盾しない。

## 8. Required coverage dispositions

- Requirement and design conformance: `checked_finding` — T304-R3-P1、T304-R3-P3
- Correctness and edge cases: `checked_finding` — unsupported node selection、empty source direct call
- Scope discipline and unrelated changes: `checked_no_finding` — R2変更はfinding closureに関連する。ただし依存設計更新が欠落
- Changed files and direct dependency impact: `checked_finding` — T302/T303 public boundaryとLocalGit source
- API, data, configuration, workflow, compatibility effects: `checked_finding` — T304-R3-P2、T304-R3-P3
- Error handling and failure diagnostics: `checked_no_finding`
- Security and secret handling: `not_applicable`
- Tests and validation adequacy: `checked_finding` — unsupported selection、source dispatch、raw/effective type separationのtest欠落
- Current-HEAD CI evidence: `checked_no_finding` — exact-head success
- Report, tracking, and documentation accuracy: `checked_finding` — design 8.2〜8.4がempty source未反映。task trackingはheld
- Regression and maintainability risks: `checked_finding` — raw/effective型混同とsource port不整合

## 9. Held, unexplored, and not applicable

### Held

- `tasks/tasks-status.md` / `tasks/phases-status.md`同期
  - Repository ruleにより指定progress-management skill経由が必要だが、本review runtimeには利用可能なmanagerがない。
  - T304はtracking上`未着手`のままであり、技術review通過後も別ownerによる同期が必要。
- Concrete VS Code TreeItem/event、Activity Bar、Current Context、Status Bar
  - Owner: T305
  - 本reviewではplatform-neutral providerと公開境界のみ評価した。
- PR metadata/diff acquisition、encoding判定source、cache、refresh source
  - Owner: T402以降

### Unexplored

- Actual VS Code Tree selection UX for unsupported file
  - T305/T306未実装のためExtension Host上の具体的なselection enablement、message、placeholder表示は未検証。
  - Core contractが未定義であること自体をT304-R3-P1としてfinding化した。

### Not applicable

- Secret/token handling: 本差分にcredential処理なし
- Markdown lint: repository-local entry pointなし。TypeScript lintを代用していない
- Merge result: mergeはユーザー専用

## 10. Verdict and next action

- Verdict: `fail`
- Open findings:
  - `T304-R3-P1 / medium`
  - `T304-R3-P2 / medium`
  - `T304-R3-P3 / medium`
- Closed findings:
  - `T304-R1-P1 / high`
  - `T304-R1-P2 / high`
  - `T304-R1-P3 / medium`
  - `T304-R2-P1 / medium`

Implementation chatで新規3 findingをTDDで修正し、report/handoff、commit/push、current-HEAD CIを完了する。その後、同じnormal reviewerでfix verificationを行う。通常findingが全てclosedするまで独立最終reviewへ進めない。mergeは行わない。

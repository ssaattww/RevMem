# T304 Fix Verification R3 指摘対応 R4 レポート

## 1. Metadata

- repository: `ssaattww/RevMem`
- Pull Request: `#38`
- task: `T304`
- mode: review follow-up R4
- branch: `task/t304-pr-progress-tree`
- base ref: `main`
- base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- source verification report: `reports/issue-1-t304-fix-verification-r3-20260803045900.md`
- source verification handoff: `handoffs/issue-1-t304-fix-verification-r3-20260803050000.yaml`
- source reviewed implementation HEAD: `283fa41b37c79c802ec2e93a7e67f4941603bb40`
- source review evidence HEAD / work start HEAD: `7f2cb2b93e58376d8be4975fe464eebedd909e50`
- technical implementation HEAD: `ad40ae8db02d4750221b8cca644d223f6447a560`
- report path: `reports/issue-1-t304-review-followup-r4-20260803055200.md`
- merge: 実施しない

## 2. 作業開始時の診断workflow確認

`.github/workflows/ci.yml`には作業開始時点で、失敗原因調査に必要なdiagnostic artifact処理が存在した。

- 各commandの標準出力・標準エラーを`2>&1 | tee test-output/ci/*.log`へ保存
- environment、Git status、生成物一覧を収集
- `test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、`tools/`、`type-fixtures/`、package/configuration/workflowをartifactへ保存

R4 Redおよび中間失敗でartifactが生成されたため、workflow自体の変更は不要だった。

## 3. 対応対象

### T304-R4-P1 / medium

`PullRequestEffectiveFileProgress`のpublic required fieldをnon-enumerable propertyとして後付けし、spread・JSON serialization・一般的なclone処理で`raw`、`reviewability`、`category`、`effectiveReason`が消失する問題。

### T304-R4-P2 / medium

PR progress pathを`trim()`で空判定していたため、POSIXでは有効なroot直下の空白だけのfilenameを拒否し、filesystem semanticsに依存しない独自path規則を作っていた問題。

### T304-R4-P3 / medium

`ReviewDiffEditorSideInput.kind`へ未知値がruntime cast等で到達した場合、`absent`以外をすべて`present`として扱い、未知sideを`git-commit` URIとして開く問題。

## 4. TDD Red

### Red HEAD

- HEAD: `b2f6a7137c98afffa2ea43e3bfa5e4e3665c886e`
- workflow run: `30766227561`
- job: `91545342170`
- conclusion: `failure`
- failed step: `Unit tests`
- diagnostic artifact: `8839022955`
- artifact name: `ci-failure-diagnostics-30766227561-1`

### 追加した回帰test

既存の標準・focused suiteに登録済みの`test/unit/t304-review-followup-r3.test.ts`へ、次を先に追加した。

- effective fileをspreadおよびJSON round-tripした結果がpublic DTO shapeを完全保持する
- `Object.keys()`へ宣言済みfieldだけが現れ、raw T301 fieldがtop-levelへ混入しない
- 複数回取得したDTOの`raw`、`reviewability`、unsupported reasonがdetachedである
- POSIXでは空白だけのroot filenameを受理し、Windowsではcanonical path validatorに従い拒否する
- originalまたはmodified sideの未知`kind`を、codec encode・URI parse・host openより前に拒否する

Red runでは3 testがすべて意図どおり失敗した。

## 5. 実装

### 5.1 Plain enumerable effective DTO

`PullRequestEffectiveFileProgress`を、raw-like objectへnon-enumerable evidenceを追加する実装から、宣言済みfieldだけを持つplain object literalへ変更した。

- `raw`: detachedなauthoritative T301 file record
- `reviewability`: detachedなline-reviewability evidence
- `category`
- optional `effectiveReason`
- effective `reviewedLineCount`
- effective `totalLineCount`
- effective `progress`

raw T301の`fileId`、path、status、additions、deletions、excluded等はtop-levelへ複製せず、`raw`の内部だけへ保持する。`Object.defineProperties`によるhidden contractを廃止した。

`getEffectiveProgress()`は毎回、file object、raw record、exclusion reason、reviewability、unsupported reasonをdetached cloneとして返す。spread、JSON serialization、`Object.keys()`のいずれでもpublic typeとruntime shapeが一致する。

### 5.2 Filesystem-semantics-aware path validation

PR progressの`path`、`oldPath`、`newPath`を、共通の`requireCanonicalRepositoryRelativePath()`で検証するよう変更した。

- POSIX semanticsでは空白だけのroot filenameを保持する
- Windows semanticsではtrailing space等の既存canonical ruleに従い拒否する
- absolute path、`.`、`..`、空segment、NUL、Windows禁止文字・予約名等も共通validatorと同一規則になる
- validator errorを包む場合も`cause`を保持する

file ID、context ID、encoding label等、filenameではない識別子だけにnon-blank検証を使用する。

### 5.3 Unknown side discriminant rejection

`ReviewDiffEditorController.openReviewDiff()`の冒頭でoriginal・modified両sideのruntime `kind`を検証する。

許可値:

- `undefined`（既存present callerとの互換）
- `present`
- `absent`

それ以外は`TypeError`で拒否する。両sideを検証してからdescriptor生成へ進むため、modified sideが不正な場合もoriginal URIを先にencodeしない。codec、parse host、diff hostはいずれも呼ばれない。

## 6. 中間失敗と修正

### Lint failure

- HEAD: `0215835e7db595b4d7a97c73bcefa70d49bc8cda`
- workflow run: `30766328027`
- job: `91545605579`
- conclusion: `failure`
- failed step: `Lint`
- diagnostic artifact: `8839055564`
- artifact name: `ci-failure-diagnostics-30766328027-1`
- cause: canonical path validator errorを`RangeError`へ包む際、元errorを`cause`へ保持していなかった
- correction: symptom errorへ`{ cause: error }`を追加

### Existing expectation drift

- HEAD: `6ebdf4e5fa263b493a9fe111a776efde3d40d671`
- workflow run: `30766443103`
- job: `91545908428`
- conclusion: `failure`
- failed step: `Unit tests`
- diagnostic artifact: `8839091984`
- artifact name: `ci-failure-diagnostics-30766443103-1`
- cause: R2の既存testが、R3/R4で廃止されたraw-like effective shapeを期待していた
- correction: 既存testを`raw`、`reviewability`、category、effective reasonを持つplain DTO contractへ更新

回帰testを一時的に重複fileとして追加したcommitがあったが、標準suiteへ登録済みの既存R3 test fileへ統合し、重複fileは削除した。

## 7. Green検証

### 技術実装HEAD

- HEAD: `ad40ae8db02d4750221b8cca644d223f6447a560`
- workflow run: `30766516189`
- job: `91546099726`
- conclusion: `success`
- exact-head verified: `true`
- substituted run: `false`

成功step:

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

- `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`
- `src/ui/diff-editor/review-diff-editor-controller.ts`

### Tests

- `test/unit/t304-review-followup-r3.test.ts`
- `test/unit/pull-request-progress-tree.test.ts`

### Evidence

- 本report
- R4 handoff

恒久設計のcanonical POSIX/Windows path、public DTOのraw/effective分離、known revision source/sideという既存方針を変更するものではなく、今回の変更は実装を既存設計へ一致させるため、設計書の追加変更は行っていない。

## 9. Finding disposition

| Finding | 対応 | Implementation worker disposition |
|---|---|---|
| `T304-R4-P1` | effective projectionをplain enumerable DTO化し、spread・JSON・detached cloneを検証 | addressed。通常reviewer closure待ち |
| `T304-R4-P2` | 共通canonical path validatorへ統合し、POSIX空白filenameとWindows拒否を検証 | addressed。通常reviewer closure待ち |
| `T304-R4-P3` | original/modifiedの未知kindを全URI/host call前に拒否 | addressed。通常reviewer closure待ち |

## 10. 対象外・held

- VS Code TreeItem、Activity Bar、Current Context、Status Barの具体的表示・event wiringは後続UI scope
- PR metadata/diff取得、encoding判定source、cache、refresh sourceは後続GitHub integration scope
- 独立最終reviewは通常finding closure後
- mergeはユーザーが実施するため禁止
- `tasks/tasks-status.md`は指定progress management skillが利用できず、直接編集していない

## 11. 次のaction

同じ通常reviewerが、最終提出HEADで`T304-R4-P1`、`T304-R4-P2`、`T304-R4-P3`のclosureと新規回帰を確認する。通常reviewがpassした場合だけ独立最終reviewへ進む。mergeは行わない。

# T402 初回レビュー指摘対応レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Task: `T402`
- Pull Request: `#40`
- Branch: `task/t402-pr-diff-acquisition`
- Mode: initial review follow-up
- Review report: `reports/issue-1-t402-review-20260802221650.md`
- Reviewed implementation HEAD: `4c5f0dd87073ca1de3e4e559b0a07e7f890f7aae`
- Review-report HEAD at follow-up start: `a5137a73841d9940a9fa3e7d3443ac41b20f4e56`
- Fixed implementation HEAD before this report: `1c37b35a9719d193c372dc32efcf13b10df8cf7d`
- Merge: 未実施

## 対応対象

初回レビューで記録された次の4 findingを、identityとseverityを維持して対応した。

| Finding | Severity | 対応結果 |
| --- | --- | --- |
| `T402-R001` | high | duplicate lineを含むcontent fallbackで複数の最適line alignmentが存在する場合、座標を推測せず`invalid-data`でfail closedするよう修正した。 |
| `T402-R002` | high | GitHub `changed` statusを`modified`へ変換せず拒否し、patchless zero-stat modified fileはcontent fallbackへ送り、NULまたはinvalid UTF-8 blobをbinary evidenceとして共有binary exclusionへ到達させた。 |
| `T402-R003` | medium | 通常copy検出でadded fileが存在する場合だけ、`--find-copies-harder -l1000`によるbounded second passを実行するよう変更した。Gitがexhaustive rename/copy detectionをskipした場合は`diff-too-large`でfail closedする。 |
| `T402-R004` | high | paginationの`page + 1`、`per_page=100`、query key、30 page上限、3000 file上限、empty page + nextを検証し、不完全なpage chainを拒否するよう修正した。 |

## 作業開始時の診断artifact確認

`.github/workflows/ci.yml`を確認した。既存workflowは各commandの標準出力と標準エラーを`tee`で`test-output/ci/*.log`へ保存し、failure時に次をartifactへ保存する。

- test/build/lint/typecheck/architecture/Git/GitHub/VS Code log
- `dist/`、`test-dist/`
- `src/`、`test/`、`tools/`、`type-fixtures/`
- package、TypeScript、ESLint、workflow設定
- environment、Git status、生成file一覧

必要な診断情報が既に保存されるためworkflowは変更していない。

## TDD証跡

### Test-first

次の回帰testを`test/integration/t402-review-followup.test.ts`へ追加し、`test:github`と`test:t402`へ接続した。

- duplicate lineで最適alignmentが複数存在するcontent fallback
- GitHub `changed` status
- patchless zero-stat binary blobとT301 shared binary exclusion
- unchanged sourceからのpure copy
- exhaustive copy detection skip時のfail closed
- pagination page jump / `per_page`変更
- empty pageによるunbounded next chain

### Test harness lint correction

- HEAD: `05aaf79ade188f717aa43146696604fbed9a9da4`
- Matching run: `30750196281`
- Result: failure
- Cause: 新規testのtemplate literal内に不要なescapeがありESLintで停止した。
- Artifact: `8834183529`

実装は変更せず、test表記だけを修正した。

### Behavioral Red

- HEAD: `bdb0f5bb8950a14fdc9c3a9dd8ffd8985aca05d2`
- Matching run: `30750255484`
- Job: `91502914172`
- Result: failure
- Artifact: `8834206749`

build、contract typecheck、architecture、lint、unit、T503、temporary Gitは成功し、Mock GitHub integrationでfindingを再現した。

- `T402-R001`: actual `acquired`、expected `unavailable`
- `T402-R002 changed`: actual `available/modified`、expected `unavailable/api`
- `T402-R002 binary`: actual `github-patch`、expected `github-content/binary`
- `T402-R003`: actual `added` 3 lines、expected `copied` 0 lines
- `T402-R004`: empty-page chainがtest側上限までrequestし、`network`へ誤分類

## 実装詳細

### 一意なcontent alignmentだけを採用

`content-diff-builder.ts`は前方・後方LCS長を計算し、各LCS rankに属し得る一致pairを列挙する。1 rankに複数pairが存在する場合、変更行数が一致していても座標が一意ではないためsnapshotを生成しない。

これにより、Gitと異なるduplicate line alignmentから確認済み座標を推測する経路を閉じた。計算量上限超過は従来どおり`diff-too-large`、alignment ambiguityは`invalid-data`として区別する。

### GitHub statusとbinary evidence

GitHub adapterは正式に扱える`added`、`removed`、`modified`、`renamed`、`copied`だけを受理し、`changed`を拒否する。API上のtype/mode changeをtext `modified`へ推測しない。

patchless zero-stat `modified`はpatch routeで成功させずcontent routeへ送る。immutable raw contentがNULを含む、またはfatal UTF-8 decodeに失敗する場合はbinary evidenceとして返す。base/headの存在するsideがすべてbinaryかつline statisticsが0の場合だけ`binary` snapshotを生成する。text/binary混在やzero-stat text `modified`はtype/mode ambiguityとしてrejectする。

### Bounded harder copy detection

通常の`--find-copies` diffにadded fileが存在する場合だけ、`--find-copies-harder -l1000`のsecond passを実行する。通常の変更では追加processを起動しない。

Gitのdiagnosticがexhaustive rename/copy detection skipを示す場合、不完全なadded classificationを採用せず`diff-too-large`を返す。temporary Git fixtureでunchanged sourceからのpure copyが`copied`、0 additions、0 deletions、0 hunksになることを検証した。

### Pagination hardening

GitHub files API requestは`per_page=100&page=1`から開始し、next linkについて次を検証する。

- configured API origin・protocol・pathとの一致
- userinfo、password、fragmentなし
- query keyは`page`と`per_page`だけ
- `per_page=100`
- `page=current + 1`
- page数30以下
- file数3000未満
- empty pageにnext linkが存在しない

不正chainではpartial file listを返さない。

## 変更file

- `test/integration/t402-review-followup.test.ts`: 4 findingとsibling boundaryの恒久回帰test。
- `package.json`: `test:github`と`test:t402`へfollow-up testを接続。
- `src/application/github-pr-diff/content-diff-builder.ts`: unique alignment、binary/text evidence、zero-stat modified ambiguity。
- `src/application/github-pr-diff/contracts.ts`: immutable binary read result。
- `src/application/github-pr-diff/pull-request-diff-acquisition-service.ts`: binary evidence transport。
- `src/application/github-pr-diff/github-patch-diff-builder.ts`: patchless zero-stat modifiedのcontent fallback。
- `src/adapters/local-git/local-git-pull-request-diff-adapter.ts`: conditional bounded harder copy detection。
- `src/adapters/github/fetch-github-pull-request-diff-adapter.ts`: status、binary、pagination validation。

## 検証

### Artifact workspace focused validation

behavioral Red artifactのsource一式へ修正を適用し、生成済みdependency outputと差し替えて実行した。

- T402 focused: `22/22` pass
- Mock GitHub + T402 integration: `35/35` pass
- pure-copy temporary Git fixture: pass

### Exact-head CI

- Fixed implementation HEAD: `1c37b35a9719d193c372dc32efcf13b10df8cf7d`
- Matching workflow run: `30750810988`
- Job: `91504417280`
- Conclusion: `success`

成功したgate:

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- ESLint
- Unit tests
- T503 repository enumeration tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのrunは使用していない。

## Intentionally untouched

- `.github/workflows/ci.yml`: 既存diagnostic artifactが要件を満たす。
- `tasks/tasks-status.md`: repository記載の専用task/progress Skill更新対象。
- T403 cache、T404永続PR layer、T405 UI。
- merge。

## 次のaction

同じ初回reviewerが、`T402-R001`〜`T402-R004`のclosureだけをfix verificationする。新規通常reviewは実施しない。report/handoff追加後のcurrent HEADについては、そのSHAに一致するworkflow runだけを最終CI証拠として確認する。

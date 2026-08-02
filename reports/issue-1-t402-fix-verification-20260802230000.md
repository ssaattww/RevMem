# T402 初回レビュー指摘 Fix Verification 報告

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: `#40`
- Task: `T402`
- Review mode: `fix verification`
- Reviewer continuity: 初回通常レビューを実施した同一ChatGPTレビューチャット
- Base: `main` (`76b49e99453ebcf7ebecb2c141ed24d750736abc`)
- Source finding reviewed HEAD: `4c5f0dd87073ca1de3e4e559b0a07e7f890f7aae`
- Fix verification target HEAD: `b908472c33b16a2001e005de2fde67ee4744bd50`
- Follow-up start HEAD: `a5137a73841d9940a9fa3e7d3443ac41b20f4e56`
- Relevant comparison: `4c5f0dd87073ca1de3e4e559b0a07e7f890f7aae..b908472c33b16a2001e005de2fde67ee4744bd50`
- Merge: 未実施

## 結論

**Verdict: fail**

初回レビューの4 findingについて、`T402-R001`と`T402-R002`はaddressedを確認した。`T402-R003`と`T402-R004`は主要再現caseを修正しているが、元findingの要求を満たさない同一欠陥classの残存境界があるためpartialである。finding identityとseverityは初回レビューから変更していない。

| Finding | Severity | Fix verification disposition |
| --- | --- | --- |
| `T402-R001` | high | addressed |
| `T402-R002` | high | addressed |
| `T402-R003` | medium | partial / required fix remains |
| `T402-R004` | high | partial / required fix remains |

## 対象と確認範囲

初回レビューreport `reports/issue-1-t402-review-20260802221650.md`に記録した4 findingだけをcontinuity-bearing findingとして確認した。fix diff、新規回帰test、直接依存、同じ欠陥classのsibling boundary、follow-up report/handoff、TDD Red artifact、fix target HEADに一致するCIを確認した。

`4c5f0dd...b908472...`は14 commits aheadで、次の12 pathsを変更している。

- `package.json`
- `reports/issue-1-t402-review-20260802221650.md`
- `reports/issue-1-t402-review-handoff-20260802221650.yaml`
- `reports/issue-1-t402-review-followup-20260802225300.md`
- `reports/issue-1-t402-review-followup-handoff-20260802225300.yaml`
- `src/adapters/github/fetch-github-pull-request-diff-adapter.ts`
- `src/adapters/local-git/local-git-pull-request-diff-adapter.ts`
- `src/application/github-pr-diff/content-diff-builder.ts`
- `src/application/github-pr-diff/contracts.ts`
- `src/application/github-pr-diff/github-patch-diff-builder.ts`
- `src/application/github-pr-diff/pull-request-diff-acquisition-service.ts`
- `test/integration/t402-review-followup.test.ts`

直接依存としてT203 Git diff parser、T301 PR progress/binary exclusion、Git command executor、GitHub pull request metadata/files API、CI workflowを再確認した。

## Finding verification

### T402-R001 — High — addressed

#### Source finding

content fallbackの独自LCSが、duplicate lineを含む内容でGitと異なる変更行座標を生成し、件数一致だけで誤ったsnapshotを成功させていた。

#### Fix

`content-diff-builder.ts`は前方・後方LCS長を構築し、最長共通部分列の各rankに属し得るline pairを列挙する。1 rankに複数のpairが存在する場合、`AmbiguousDiffError`としてsnapshotを生成しない。`PullRequestDiffAcquisitionService`はこの結果を`github-content / invalid-data`としてfail closedにする。

#### Evidence

- `test/integration/t402-review-followup.test.ts`はold `a\n`、new `b\na\na\n`を固定し、`unavailable`と`invalid-data`を要求する。
- Behavioral Red run `30750255484`では修正前actualが`acquired`だった。
- fix target HEADのCI run `30750936634`は新規testを含むgateでsuccessした。
- reviewer-sideで2記号alphabet、old/new各0〜4行の全組合せについて、実装と同じrank判定を全最適LCS alignment列挙と照合した。unique alignmentの誤拒否およびmultiple alignmentの誤受理は検出されなかった。

#### Disposition

`addressed`。座標が一意に証明できないcontent fallbackは保守的に拒否され、初回findingの誤った確認済み推測経路は閉じられた。

### T402-R002 — High — addressed

#### Source finding

GitHub標準`changed` statusを`modified`へ変換し、標準files APIに存在しない`binary` statusへ依存していた。patchless zero-stat recordも完全なtext diffとして受理していた。

#### Fix

- GitHub adapterは`added`、`removed`、`modified`、`renamed`、`copied`だけを受理し、`changed`を拒否する。
- patchless zero-stat `modified`はpatch routeで`missing-patch`となりcontent routeへ進む。
- raw immutable contentにNULがある場合、またはfatal UTF-8 decodeに失敗する場合、portは`kind: binary`を返す。
- 存在するsideがすべてbinaryかつGitHub line statisticsが0の場合だけ`status: binary` snapshotへ変換する。
- text/binary混在、binaryなのにline statisticsが非0、zero-stat text modifiedは`invalid-data`で拒否する。

#### Evidence

- `changed` rejection testはadapter結果`unavailable / api`を固定する。
- binary testはNULを含むraw contentから`github-content` snapshotを生成し、T301 shared exclusion policyが`{ kind: "binary" }`を返すことまで確認する。
- Behavioral Red run `30750255484`では`changed`が`available/modified`となり、binary caseが`github-patch`で誤成功していた。
- current exact-head CI `30750936634`は新規回帰testを含めsuccessした。

#### Disposition

`addressed`。type/mode ambiguityを`modified`へ推測せず、binaryをraw content evidenceで分類できる場合だけshared binary exclusionへ接続し、分類不能なcaseはfail closedとなる。

### T402-R003 — Medium — partial

#### Source finding

local Gitが未変更fileをcopy元候補へ含めないためpure copyをadded fileとして扱い、全行をPR進捗の変更行へ計上していた。copyを扱う場合は性能上限付きで未変更sourceを含む検出が必要だった。

#### Addressed portion

- ordinary passに`new file mode`が存在する場合、`--find-copies-harder -l1000` second passを実行する。
- temporary Git repository testでunchanged `source.txt`から`copied.txt`を作成し、`copied`、0 additions/deletions、0 hunksを確認する。
- exhaustive rename/copy detection skip diagnosticを`diff-too-large`へ分類する。

この変更により、初回findingのpure-copy再現case自体は修正されている。

#### Remaining defect in the same finding class

最初のordinary passは引き続き次のargumentで実行される。

```text
--find-renames --find-copies
```

このpassには明示的な`-l1000`がない。Gitの`-M`/`-C`はunpaired source/destinationに対してO(N^2)のexhaustive fallbackを持ち、`-l<num>`を省略するとrepository/user configurationの`diff.renameLimit`へ従う。Git公式documentationは`diff.renameLimit=0`をunlimitedとしている。

そのため、ユーザー設定が0または大きな値の場合、added fileの有無を判定するためのordinary pass自体が要求された安全な上限なしで高コスト処理を実行し得る。second passだけをboundedにしても、最初のprocessの終了保証・性能上限は固定されない。

Reference: `https://git-scm.com/docs/diff-options` の`--find-copies-harder`および`-l<num>`。

#### Required action

ordinary passにも明示的なnon-zero `-l`を指定し、repository/user `diff.renameLimit`に依存しない上限を固定する。少なくともmock invocation testでordinaryとharderの両passが明示上限を持つこと、`diff.renameLimit=0`のrepository設定がCLI上限を上書きしないことをtest-firstで固定する。

#### Disposition

`partial`。severityは初回の`medium`を維持する。

### T402-R004 — High — partial

#### Source finding

files API paginationがrequest数を拘束せず、page jump等で変更fileを欠落させた一覧を完全なsnapshotとして受理し得た。

#### Addressed portion

- `per_page=100&page=1`から開始する。
- next URLは同一origin/protocol/path、userinfo/password/hashなしを要求する。
- query keyを`page`と`per_page`だけに限定する。
- `page=current+1`と`per_page=100`を要求する。
- 30 page/3000 file上限を持つ。
- empty pageにnextがあるchainを拒否する。
- page jump、per-page変更、empty-page chainのtestを追加している。

これにより、初回findingで示したpage 1からpage 3へのjumpとunique empty-page chainは修正されている。

#### Remaining defect in the same finding class

`nextPage()`は`Link` headerがない場合を常に`kind: none`として扱い、呼出側はその時点の`files`を完全な一覧として返す。一方、metadata parserはGet Pull Request responseの`changed_files`を取得・保持しておらず、終端時に取得件数との一致を検証しない。

したがって、metadataが2 changed filesを示していても、files pageが1件だけ返して`Link`を欠落させた場合、adapterは1件のpartial listを`kind: available`として返す。この経路はpage jumpと同じく変更fileをPR進捗の分母から消し、誤った完了率を生成する。

GitHubのGet Pull Request responseは`changed_files`を返し、List pull requests files endpointは最大3000 filesでpaginationされる。現在のimplementationは取得可能な総数evidenceを利用していない。

Reference:

- `https://docs.github.com/en/rest/pulls/pulls?apiVersion=latest` Get a pull request responseの`changed_files`
- 同page List pull requests filesの最大3000 filesとpagination contract

#### Required action

PR metadataから`changed_files`をsafe integerとして取得し、files取得終了時に`files.length === changedFiles`を要求する。`changedFiles >= 3000`の扱いは既存fail-closed policyと整合させる。代替として総数evidenceを利用しない場合は、少なくとも満杯pageでnextがない終端をambiguousとして拒否する必要がある。

次のtestをtest-firstで追加する。

- metadata `changed_files=2`
- files page 1は1 file
- `Link` headerなし
- expected: `unavailable`でpartial snapshotを返さない

#### Disposition

`partial`。severityは初回の`high`を維持する。

## TDD・診断artifact確認

### Behavioral Red

- HEAD: `bdb0f5bb8950a14fdc9c3a9dd8ffd8985aca05d2`
- Run: `30750255484`
- Job: `91502914172`
- Conclusion: failure
- Artifact: `8834206749` / `ci-failure-diagnostics-30750255484-1`

artifactをdownloadし、`test-output/ci/test-github.log`を確認した。34 tests中29 passed、5 failedで、R001、R002 changed、R002 binary、R003 pure copy、R004 empty chainが修正前behaviorを再現していた。artifactにはcommand log、stdout/stderr、environment、Git status、generated output、source、tests、tools、configuration、workflowが含まれていた。

### Fix target exact-head CI

- HEAD: `b908472c33b16a2001e005de2fde67ee4744bd50`
- Workflow run: `30750936634`
- Job: `91504744528`
- Status: completed
- Conclusion: success

別SHAのrunは使用していない。CI successは登録済みtestとrepository gateの通過を示すが、R003/R004の残存caseはtestされていないためpartial dispositionを否定しない。

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement and design conformance | checked_finding | R003の明示的性能上限とR004の完全file一覧保証が未完 |
| correctness and edge cases | checked_finding | ordinary copy passのconfig依存上限、missing Linkとmetadata count不一致が残存 |
| scope discipline and unrelated changes | checked_no_finding | fixはT402 code/test/reportに限定され、T403〜T405、workflow、task trackingを変更していない |
| changed files and direct dependency impact | checked_finding | 12 changed pathsとT203/T301/Git/GitHub API dependencyを確認 |
| API and data contract | checked_finding | PR metadataの`changed_files`を完全性evidenceとして利用していない |
| configuration and compatibility | checked_finding | ordinary Git passが`diff.renameLimit` user/repository configへ依存する |
| error handling and failure diagnostics | checked_no_finding | TDD Red artifactは必要なdiagnostic evidenceを保持し、既知failureはfail closedへ分類される |
| security and secret handling | checked_no_finding | token永続化・log出力・cross-origin forwardingの追加はない |
| tests and validation adequacy | checked_finding | source findingsの主再現caseは追加済みだがR003/R004 sibling casesが欠落 |
| current-HEAD CI evidence | checked_no_finding | `b908472...`に一致するrun `30750936634`はsuccess |
| report and documentation accuracy | checked_finding | follow-up reportの`bounded` pagination/copy detection表明は残存境界を含めると完全ではない |
| regression and maintainability risk | checked_finding | runtime configとAPI Link欠落によってroute completenessが変わる |

## Held / unexplored

- Held: なし
- Unexplored: 実GitHub Enterprise serverでのfiles pagination end-to-endは環境がないため未実施。R004残存はstatic contractとmock可能なresponseだけで再現できるためverdictを妨げない。

## Remaining risks

- content fallbackはambiguityを安全側に拒否するため、duplicate lineを多く含むfileではremote routeが利用不能になり得る。これは誤座標を返すより安全でありblocking findingではない。
- NULまたはinvalid UTF-8を含まないbinaryはbinary evidenceとして識別できない場合があるが、statistics/content不一致またはzero-stat ambiguityでfail closedする。誤ったtext snapshotへ推測しない限り許容される。

## 次のaction

実装チャットで`T402-R003`と`T402-R004`の残存caseをTDDで修正する。`T402-R001`と`T402-R002`は再修正対象ではない。修正後は新しいcurrent HEADに一致するworkflow runのみを確認し、この同じ通常レビューチャットで再度fix verificationを行う。mergeは利用者が行う。

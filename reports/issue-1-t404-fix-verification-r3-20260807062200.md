# T404 fix verification R3 レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T404
- Pull Request: #48
- Review mode: fix verification R3
- Reviewer role: normal reviewer
- Reviewer continuity: 初回通常reviewから同じChatGPT chat / 同じ通常reviewer
- Previous review evidence HEAD: `033dbbe5b4d24d58bad9f1588dae41dd7ec44f40`
- Reviewed fix implementation/report/handoff HEAD: `b0c03c8c1b1c2a9e1b290ce54a041c9c5b61cb69`
- Fix range: `033dbbe5b4d24d58bad9f1588dae41dd7ec44f40..b0c03c8c1b1c2a9e1b290ce54a041c9c5b61cb69`
- Generated at: `2026-08-07T06:22:00+09:00`
- Merge: 未実施

## 目的

前回fix verification R2でopenだった`T404-R003`、`T404-R004`、`T404-R006`、`T404-R008`だけを、finding IDとseverityを保持したままclosure確認する。前回closedの`R001`、`R002`、`R005`、`R007`は再展開しない。

## 変更範囲

前回review evidence HEADからcurrent implementation/report/handoff HEADまでの主な変更は次のとおり。

- `src/application/github-pr-context/github-pull-request-context-layer-store.ts`
- `src/core/repository-identity/hosted-git-repository-identity.ts`
- `src/core/repository-identity/index.ts`
- `src/adapters/local-git/git-remote-normalization.ts`
- `test/unit/t404-review-followup-r3.test.ts`
- `test/unit/t404-history-integration.test.ts`
- `package.json`
- `reports/issue-1-t404-review-followup-r3-20260807054902.md`
- `reports/issue-1-t404-review-followup-r3-handoff-20260807054902.yaml`

## Exact-head CI

Reviewed fix implementation/report/handoff HEAD `b0c03c8c1b1c2a9e1b290ce54a041c9c5b61cb69`に一致するworkflow runだけを判定対象とした。

- Workflow: CI
- Run: `31128238812`
- Status: completed
- Conclusion: success
- Head SHA: `b0c03c8c1b1c2a9e1b290ce54a041c9c5b61cb69`

別SHAのrunは代用していない。

## TDD evidence

R3 follow-upはtest-only commit `738e1a0e0e7c7442a02c7d7d8079047af75a914b`から開始している。`033dbbe5..738e1a0`は1 commitで、変更fileは`test/unit/t404-review-followup-r3.test.ts`だけであり、production fixよりtest追加が先行したことは確認できる。

ただし、project instructionは「先にテストを追加して失敗を確認してから実装」を要求する。implementation report自身が、test-first HEADに一致するworkflow runはなく、local/CIのRed実行結果もないと記録している。missing moduleでcompile-time Redになる構成だったことはsource inspectionで確認できるが、実際にtest/compileを実行して失敗を確認した証跡ではない。このためTDDの「失敗確認」は未成立として`T404-R008`をopenのまま維持する。

## Finding dispositions

| Finding | Severity | Disposition | Summary |
| --- | --- | --- | --- |
| T404-R003 | high | open | mapped snapshotの形は強化されたが、actual immutable diff/blob mapping evidenceやT203/T204/T205 mapping implementationへ接続していない |
| T404-R004 | high | open | shared repository canonicalizerは導入されたが、T404独自`:443`除去でmalformed/default-port variantのalias/splitが残る |
| T404-R006 | medium | closed | explicit closed/merged overrideをmetadata refreshとrevision transitionで保持する実装と回帰testを確認 |
| T404-R008 | medium | open | focused/standard/history/multiple-PR coverageは改善したが、test-first Redを実行して失敗確認した証跡がない |

## Detailed verification

### T404-R003 — high — open

#### 改善済み

- mapperの入力に`PullRequestRevisionMappingEvidence`を追加した。
- mapper戻り値をContext/Global complete commitとして扱う。
- mapped PR descriptor、Context/Global repository identity、base/head、Global current revisionを検証する。
- 全Context fileとGlobal fileの`revisionId`がtarget headと一致することを検証する。
- mismatch時はrepository commit前にrejectするtestを追加した。

#### 残存問題

`PullRequestRevisionMappingEvidence`に含まれるのはrepository/context/source/target SHAだけであり、変更行・rename・delete・ambiguous mappingを判定するimmutable diff/blob/content evidenceではない。

また、production adapter `createNodeGitHubPullRequestContextStateService`は依然として任意の`PullRequestRevisionMapper`を外部から受け取るだけで、T203/T204/T205のmapping engineまたはT402のimmutable PR diff evidenceへ接続するconcrete mapperを提供しない。

そのため、mapperが全fileの`revisionId`だけを新headへ書き換え、`modifiedReviewed` / `originalReviewedByDiff` / Global `reviewed`を旧状態のまま保持しても、現行`requireMappedCommit`は通過する。変更行を確認済みのまま新revisionへ持ち越す誤りをservice境界で検出できない。

#### Required action

- PR revision transitionをactual immutable diff/blob evidenceへ接続したconcrete mapperとして実装する。
- T203/T204/T205の既存mapping/fail-closed contractを再利用するか、同等のmapping result evidenceをserviceが検証可能な形で返す。
- 「file revisionだけtargetへ更新しreviewed rangesをそのまま保持するmapper」をrejectまたは生成不能にするRed testを先に追加する。
- changed line、rename、delete、ambiguous/missing evidenceで未確認化されることを確認する。

### T404-R004 — high — open

#### 改善済み

- `canonicalizeHostedGitRepositoryIdentity`をcoreへ追加し、T202 Local Git normalizationとT404のrepository path canonicalizationで共有している。
- `createGitHubPullRequestContextIdFromRepositoryId`はcanonical `host/owner/repository`以外をrejectする。
- create/load/update境界でrepositoryId、contextId、PR descriptor identityを照合する。

#### 残存問題

T404の`canonicalizePullRequestHost`は、shared canonicalizerへ渡す前にhost文字列の末尾`:443`を単純に削除する。

このため例えば`ghe.example:8443:443`は、本来malformed authorityであるにもかかわらずT404では`ghe.example:8443`へ変換され、その後valid identityとして受理される。T401の`canonicalGitHubAuthority`やT202のURL parserは同じ入力をvalid authorityとして扱わない。

同様に`github.com:0443`のようなdefault-port variantはT404側の単純suffix処理ではcanonical `github.com`へ統一されず、URL semanticsを使うT202/T401とidentityが分裂し得る。

#### Required action

- protocol/default-port semanticsを含むauthority canonicalizationを1つのshared boundaryへ統合する。
- T404側の`endsWith(":443")`削除を廃止し、T202/T401と同じauthority parser/canonicalizerを使用する。
- `ghe.example:8443:443`、`github.com:0443`、invalid port、credential/path/query付きauthorityのRed testsを先に追加する。

### T404-R006 — medium — closed

`preserveVisibilityOverride`により、保存済み`decorationEnabled`が存在し、後続metadata refreshでfieldが省略された場合は既存overrideを引き継ぐ。revision transitionでも同じnormalized `nextPullRequest`をmapperへ渡すためoverrideが保持される。

`test/unit/t404-review-followup-r3.test.ts`はclosed PRのexplicit `true` overrideがmetadata refreshおよびhead revision transition後も有効であることを確認する。persisted PR descriptorは既存Review State repositoryのJSONへそのまま保存されるためrestart loadでもfieldは保持される。

元findingの「closed/mergedを常にfalseへ強制し明示的再有効化を永続化できない」という根本原因は解消したためclosedとする。

### T404-R008 — medium — open

#### 改善済み

- `test:t404` scriptを追加した。
- T404 testsを`test:unit`へ直接登録した。
- mapped snapshot mismatch、canonical repository identity、closed override、multiple-PR restart、PR history JSONL restartを追加した。
- current HEAD exact CI `31128238812`はsuccessしている。
- test-only commitがproduction fixより先行したこと自体は確認できる。

#### 残存問題

project instructionはtest-firstだけでなく「失敗を確認してから実装」を要求する。test-first HEAD `738e1a0...`にはworkflow runが存在せず、implementation reportもlocal test/compileの実行失敗を記録していない。source上missing moduleで失敗するはずだったという静的推論は、実行によるRed確認の代替にはならない。

またR003/R004がopenであるため、それらのdefect-class test coverageもclosureしていない。

#### Required action

- R003/R004の追加Red testsをtest-only commitで作成する。
- production fix前に、そのtest-only HEADで実際にfocused testまたはcompileを実行してfailureを確認し、command/output/exit statusをreportへ残す。CI runが生成されない場合でもlocal execution evidenceを保存する。
- その後production fixを行い、`test:t404`、`test:unit`、full CIをGreenにする。

## Overall verdict

`fail`

- Closed this round: `T404-R006`
- Remain open: `T404-R003` high、`T404-R004` high、`T404-R008` medium
- Previously closed and unchanged: `T404-R001`、`R002`、`R005`、`R007`
- New finding: なし

## Next action

implementation workerは`T404-R003`、`T404-R004`、`T404-R008`だけをTDDで修正する。test-only HEADで実行Redを確認した後にproduction fixを行い、同じ通常reviewerが残存3 findingのみを再fix verificationする。

mergeは利用者が行う。reviewerはmergeしない。

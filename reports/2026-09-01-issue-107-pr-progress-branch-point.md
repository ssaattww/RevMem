# Issue #107 PR Progress比較基準修正 実装報告

## 1. 対象

Issue #107「pr progressが、mainの最新と、ローカルの最新との比較になっている」に対応した。

要求は、PR Progressの比較元を現在のbase branch先端ではなく、PRブランチの切り出し元（merge base / branch point）に固定し、その地点とPRの最新HEADを比較することである。

対象PRは #109 `Fix PR Progress comparison base for #107`、baseは `main` である。

本報告には、初回実装後にPRコメント `#issuecomment-5486757621` で報告された「CI artifactを使用した非公開リポジトリでReview Contexts / Current Context更新が失敗するデグレード」の追加調査・修正も含む。

## 2. 失敗診断artifact workflowの確認

作業開始時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。

既存CIは各コマンドを `tools/run-ci-command.mjs` 経由で実行し、少なくとも次を `test-output/ci` に保存する。

- `<label>.stdout.log`
- `<label>.stderr.log`
- `<label>.log`
- `<label>.result.json`

workflowは失敗時に実行環境、git status、生成物一覧に加え、`test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、`tools/` 等を `ci-failure-diagnostics-${run_id}-${run_attempt}` artifactへアップロードする。

したがってIssue #107向けにdiagnostic workflowを追加変更する必要はなかった。実際にTDD Red、fixture回帰、非公開リポジトリ回帰の原因調査でこれらのartifactを使用した。

## 3. 初回原因と設計方針

RevMemはGitHub Pull Request APIが返す `base.sha` を、そのままPR比較の基準revisionとして扱っていた。

Issue #107で必要なのは「API payloadに現れたbase SHA」ではなく、「PR HEADと対象base系列のbranch point」である。実APIの追加確認ではPRの状態・履歴により `base.sha` が現在のbase先端と一致する場合も、古いbase SHAを保持している場合も確認されたため、`base.sha` 自体をbranch pointのauthoritative valueとして扱うことが問題であると整理した。

そこでopen PRではGitHub Compare API

`/repos/{owner}/{repository}/compare/{baseSha}...{headSha}`

の `merge_base_commit.sha` をbranch pointのauthoritative valueとして利用する。

## 4. 初回TDD

### 4.1 Red 1: lifecycle metadata

commit `85d3933f444ff1b9ef89cfa7d17cd7132e95f395` (`test: cover PR branch-point lifecycle baseline (#107)`) に対するworkflow run `33448825923` でT405は59/60となった。

新規Issue #107テストだけが、期待するbranch pointと返却base SHAの不一致で失敗した。失敗診断artifactは `9779026173` である。

### 4.2 Red 2: remote PR diff

commit `f0b5243d4237e6cbf60ccb4641d3358e93c4b74a` (`test: cover remote PR diff branch-point baseline (#107)`) に対するworkflow run `33449176087` でT405は59/61となり、lifecycleとremote diffの両経路でbranch point正規化が必要なことを確認した。失敗診断artifactは `9779137356` である。

### 4.3 初回Green実装

commit `052ef6577388b6d49aff57cdf9106b8e0703c69f` (`fix: base PR Progress on branch point (#107)`) で `src/adapters/github/fetch-github-pull-request-merge-base.ts` を追加した。

次の2経路でopen PRの `baseSha` をCompare APIの `merge_base_commit.sha` へ正規化した。

- `FetchGitHubPullRequestLifecycleAdapter`
- `FetchGitHubPullRequestDiffAdapter`

HTTP 401/403、rate limit、network、API不正応答、AbortSignalについては既存adapterと同じfail-closed方針を維持した。closed/merged PRについては不要な追加compare呼び出しを行わない。

## 5. 初回fixture回帰とT404月境界修正

Compare API呼び出し追加により、GitHub fetchを完全mockしていた既存fixtureへcompare応答を追加した。

主なfixture修正commitは次のとおり。

- `c655b28cd9b607840fd76d642d8bf8f3528f83e3`: private PR fixture
- `bc78c5bca48ad027e5527b4a0c1636c81c208798`: Review Contexts fixture
- `978f035c388cd8c41f3311b028138f65901fb0c7`: T405 composition fixture
- `e0e18fc035e7d14b1c286d8419c4698d6fd7341f`: T606 fixture
- `78cfabfe36e81fb2842651bde4270788274e5f58`: T402 GitHub fixture

commit `052ef657...` のrun `33449402643` ではT407 mockがcompare応答不足で失敗し、artifact `9779204284` を使用して原因を特定した。commit `e0e18fc...` のrun `33450390560` ではMock GitHub integrationのT402 2件が同じfixture不足で失敗し、artifact `9779716931` を使用した。

また、report追加後のHEAD `7aaee6c91d3426f92141b53ab497496e4ddef183` / run `33498129932` で、既存T404テストが月境界により687/688となった。artifact `9796579178` から、固定 `events-2026-08.jsonl` だけを読むテストが、9月実行時に別月へ保存されたrevision eventを見失っていたことを確認した。

commit `eba2bfdce6261c7877e87c50ddb975fb29e6f10d` (`test: make T404 history assertion month-safe`) で月次history JSONLを横断するテストへ修正し、同SHA run `33498499210` はsuccessとなった。production behaviorは変更していない。

## 6. 非公開リポジトリで発生したデグレード

### 6.1 実機報告

初回Green後、PRコメント `5486757621` でCI artifactを使用した非公開リポジトリについて次の現象が報告された。

- `Review Contextsを更新` が `repositories=1` まで進む
- `pull-request-contexts=1` まで進む
- その直後に `Review Contextsを更新` がERROR
- 続いて `Current Contextを更新` もERROR

このため、初回CI Greenだけでは実利用の完了条件を満たしていないと判断し、同コメントをblocking evidenceとして再調査した。

### 6.2 非公開GitHub APIの切り分け

GitHub connectorでアクセス可能な認証済み非公開リポジトリのopen PRを使い、次を実APIで確認した。

- open PR一覧 `/pulls?state=open`
- PR詳細 `/pulls/{number}`
- Compare API `/compare/{base}...{head}`
- PR files `/pulls/{number}/files`

いずれも認証下で正常に取得でき、Compare API自体がprivate repositoryで利用できないことは原因ではなかった。

また、実APIではopen PRの `base.sha` が現在のbase先端と一致するケースだけでなく、過去のbase SHAを保持するケースも確認した。このため「GitHub `base.sha` をbranch pointとみなす」のではなく、「Compare APIのmerge baseをbranch pointとして正規化する」設計を維持することを確認した。

### 6.3 デグレード原因A: PR検索・保存経路の正規化漏れ

初回修正ではlifecycleとremote diffをmerge-base化した一方、`FetchGitHubPullRequestAdapter` のPR一覧検索candidateは `base.sha` をそのまま返していた。

`detectPullRequest()` はこのcandidateをpersisted PR stateへ保存するため、新規検出直後から次の不整合を作れる状態だった。

- persisted PR state: PR一覧candidate由来のbase SHA
- lifecycle / remote diff: Compare API由来のmerge base

つまり、同一artifact内でも保存されたPR identityと後続のPR Progress identityが食い違う経路が残っていた。

### 6.4 デグレード原因B: 旧persisted baseとのread-only互換不足

Review Contextsのbackground refreshはpersisted Review Stateを暗黙に変更せず、lifecycle取得結果をephemeral projectionとして扱う。

初回修正後はephemeral contextとregistered diffがmerge baseへ正規化される一方、旧artifactで保存済みのPR stateには旧base SHAが残り得る。

その状態でPR Progress計算が `PullRequestReviewRuntime` のstrict identity checkへ進むと、同一repository・同一context・同一HEADであってもbase SHAだけの差で

`Persisted pull-request context does not match the registered diff revision`

となる。

実機ログの `pull-request-contexts=1` の直後に失敗する順序とも一致した。

## 7. 非公開リポジトリ回帰のTDD

### 7.1 Red 3: PR検索candidateのbranch-point正規化

commit `f1d6122d9d52a6d1ce213a8e304a566fd2e406f2` (`test: cover private PR search branch-point regression (#107)`) で、PR一覧がcurrent base SHAを返し、Compare APIが別のbranch pointを返す条件を追加した。

同SHAのworkflow run `33553843377` は意図どおりfailureとなり、candidate `baseSha` がcurrent baseのままであることを確認した。失敗診断artifactは `9818542899`。

テストでは、private PR一覧取得とmerge-base取得の双方に同じ `Bearer` tokenが渡ることも契約化した。

### 7.2 Green 3: 検出candidateを保存前に正規化

commit `fd7fd8c1112055bd3545acbfc25e34ea423ca63a` (`fix: normalize detected PRs to branch point (#107)`) で `FetchGitHubPullRequestAdapter` を修正した。

exact HEADのcandidateを収集後、同じAPI root・token・fetch implementationを使用して各candidateのmerge baseを取得し、`baseSha` をbranch pointへ正規化してからresolverへ返す。

これにより今後新規作成されるpersisted PR stateもlifecycle/diffと同じbranch-point identityになる。

### 7.3 Red 4: 旧persisted baseと新branch pointの互換

commit `b4aaa1bccfc0af56cf030510dd403f1c24bb8d3f` (`test: isolate read-only PR progress mismatch regression (#107)`) で、旧artifact相当のpersisted stateを明示した。

条件は次のとおり。

- persisted base = 旧base SHA
- registered diff base = normalized merge base
- persisted head = registered head（同一HEAD）
- modified-side reviewed evidenceは保持
- old base/head pairのoriginal-side reviewed evidenceは新pairへ流用しない
- background progress計算でpersisted stateを書き換えない

同SHA run `33554371241` はT405 61/62で、追加回帰だけがstrict base mismatchにより失敗した。失敗診断artifactは `9818740106`。

### 7.4 Green 4: read-only PR Progressだけbaseをephemeral投影

commit `a35fc592721954f89c67bc5858b583d19c2ec2f1` (`fix: keep PR Progress readable across base normalization (#107)`) で `PullRequestReviewRuntime.calculateProgress()` のread-only入力だけに互換投影を追加した。

互換投影は次の条件をすべて満たす場合だけ許可する。

- pull-request contextである
- contextId一致
- repositoryId一致
- HEAD SHA一致
- 差異がbase SHAだけである

base SHAだけ異なる場合はpersisted commitを保存せず、メモリ上の計算入力で `pullRequest.baseSha` をregistered snapshotのmerge baseへ合わせる。

重要な境界として、`openSession()` やmutationで使用する既存 `requireMatchingContext()` は変更していない。異なるHEAD、異なるcontext/repository、stale mutationは従来どおりfail closedする。

同SHA run `33555206678` ではT405 62/62となり、追加したlegacy persisted base回帰もGreenになった。その後T406で新しいCompareリクエストを知らない既存mock 2件だけが失敗し、artifact `9819070360` を保存した。

### 7.5 T406 fixture修正とfull Green

commit `494afd0da4aab98ee270cc8d2b2696080be87249` (`test: align PR search fixtures with branch-point lookup (#107)`) で、pagination fixtureとpublic PR fixtureへCompare API応答を追加した。

public PR fixtureではPR一覧とCompareの双方がunauthenticatedであることも確認する。production codeの追加変更はない。

同SHA run `33555338296` は全必須gate `success`。user validation artifactは `9819382259`、digestは `sha256:c0c8862e2025fd5c563f11be7a4087544169ff98f0e131e6609101565a43a2bb` で、run head SHAも `494afd0d...` と一致した。

### 7.6 progress coreへの互換処理一本化

commit `f1c62c35a09d11f2d7409ef86b24a49c04937b14` (`refactor: keep base-normalization compatibility in progress core (#107)`) で、wrapper側に重複していた `AsyncLocalStorage` ベースのprogress base投影を削除した。

base-normalization互換は `src/t405-pull-request-review-runtime-base.ts` の `calculateProgress()` / `projectPersistedProgressCommit()` に一本化され、`getProgress()` と `activateProgress()` は通常どおりcore実装を呼ぶ構造に戻した。

これは仕様変更ではなく、read-only compatibility boundaryをprogress coreの1箇所へ集約するrefactorである。mutation/openSessionのstrict checkは引き続き変更していない。

同SHA run `33556361647` は全必須gate `success`。user validation artifactは `9819753122`、digestは `sha256:1b2f05b764b0ffbd4683dccf7c2b499cf72d8a704e790a65e4f804074c5d576c` で、run head SHAも `f1c62c35...` と一致した。

## 8. 最終変更範囲

### production

- `src/adapters/github/fetch-github-pull-request-merge-base.ts`
  - Compare APIからmerge baseを取得する共通helper。
- `src/adapters/github/fetch-github-pull-request-lifecycle-adapter.ts`
  - open PR lifecycle metadataのbaseをmerge baseへ正規化。
- `src/adapters/github/fetch-github-pull-request-diff-adapter.ts`
  - remote diff identity / metadataのbaseをmerge baseへ正規化。
- `src/adapters/github/fetch-github-pull-request-adapter.ts`
  - PR検索candidateをresolver/persistenceへ渡す前にmerge baseへ正規化。
- `src/t405-pull-request-review-runtime-base.ts`
  - read-only PR Progress計算で、同一HEADのlegacy persisted baseだけをephemeral投影して互換化。
- `src/t405-pull-request-review-runtime.ts`
  - wrapper側の重複compatibility layerを除去し、progress coreの実装へ一本化。

### regression / fixture

- `test/integration/mock-github.test.ts`
  - PR検索candidate正規化とprivate token伝播、pagination/public fixtureを更新。
- `test/unit/t405-github-lifecycle.test.ts`
  - lifecycle / remote diff branch-point回帰とlegacy persisted base互換を追加。
- `test/unit/t405-composition-regression.test.ts`
- `test/unit/t407-private-pr-context.test.ts`
- `test/unit/issue-84-pr85-review-closure-followup.test.ts`
- `test/unit/t606-r6-real-composition.test.ts`
- `test/integration/t402-review-followup.test.ts`
  - Compare API追加に対応した既存fixture。
- `test/unit/t404-review-followup-r3.test.ts`
  - 月境界history test修正。

storage schema、Global Understanding計算式、通常editorのreview semanticsは変更していない。

## 9. Technical Green

report最終更新直前のtechnical HEADは `f1c62c35a09d11f2d7409ef86b24a49c04937b14` である。

このSHAと完全一致するpull_request workflow run `33556361647` は `success`。

成功した必須gateは次のとおり。

- Build
- Contract typecheck
- Architecture validation / negative contract
- Lint
- Unit tests
- T602 / T603
- T403 / T404 / T405 / T406
- T304
- T502 / T503 / T504 / T505 / T506
- T604 / T605 / T606
- T609 / T610
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests
- user validation package / artifact upload

user validation artifact:

- ID: `9819753122`
- digest: `sha256:1b2f05b764b0ffbd4683dccf7c2b499cf72d8a704e790a65e4f804074c5d576c`
- workflow run head SHA: `f1c62c35a09d11f2d7409ef86b24a49c04937b14`

別SHAに紐づくworkflow runはGreen判定へ代用していない。

## 10. 境界条件・残存リスク

- open PRではPR検索、lifecycle、remote diffでCompare API呼び出しが追加される。rate limit、authentication、network failure時は既存方針どおりfail closedする。
- Compare APIの `merge_base_commit.sha` をbranch pointのauthoritative valueとする。
- legacy persisted base互換はread-only PR Progress計算だけで、同一HEADに限定する。
- background refreshはpersisted Review Stateを暗黙migrationしない。
- mutation/openSessionのstrict revision identityは緩和していない。
- old base/head pairに紐づくoriginal-side review evidenceを新しいmerge-base pairへ流用しない。
- closed/merged PRの既存metadata取得経路は変更していない。
- PR Progress以外のGlobal Understanding等の比較基準はIssue #107の対象外であり変更していない。
- T404月境界修正はtest-onlyである。
- mergeは実施しない。

## 11. PRと完了attestation

変更はPR #109 `Fix PR Progress comparison base for #107` に集約した。

本report自身を保存するcommit SHAは本文から自己参照できないため、本reportではreport保存直前のtechnical HEAD `f1c62c35...` とmatching CI `33556361647` を固定記録する。

report保存後のcurrent PR HEAD、およびそのHEADと完全一致する最終CI run / conclusionは、repository内容を変更しないPR本文・PRコメントへattestationとして記録する。

mergeは利用者が行うため実施しない。

# Issue #107 PR Progress比較基準修正 実装報告

## 1. 対象

Issue #107「pr progressが、mainの最新と、ローカルの最新との比較になっている」に対応した。

Issueの要求は、PR Progressの比較元を現在のbase branch先端ではなく、PRブランチの切り出し元（merge base / branch point）に固定し、その地点とPRの最新HEADを比較することである。

対象PRは #109 `Fix PR Progress comparison base for #107`、baseは `main` である。

## 2. 失敗診断artifact workflowの確認

作業開始時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。

既存CIは各コマンドを `tools/run-ci-command.mjs` 経由で実行し、少なくとも次を `test-output/ci` に保存する構成であった。

- `<label>.stdout.log`
- `<label>.stderr.log`
- `<label>.log`
- `<label>.result.json`

workflowは失敗時に実行環境、git status、生成物一覧に加え、`test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、`tools/` 等を `ci-failure-diagnostics-${run_id}-${run_attempt}` artifactへアップロードする。

したがってIssue #107向けにdiagnostic workflowを追加変更する必要はなかった。実際にTDD Redおよび回帰失敗の原因調査でこのartifactを使用した。

## 3. 原因

GitHub Pull Request APIの `base.sha` は、open PRについて「PR作成時の切り出し元」を表す固定値ではなく、現在のbase branch先端を表す。

RevMemはこの値をそのままPR lifecycle metadataおよびremote PR diffの `baseSha` として利用していた。このためPR作成後に `main` が進むと、PR Progressの比較基準も新しい `main` 先端へ移動し、PR自身と無関係なbase branch側の変更が比較対象へ混入していた。

## 4. TDD

### 4.1 Red 1: lifecycle metadata

最初にPR lifecycle側の回帰テストを追加した。

commit `85d3933f444ff1b9ef89cfa7d17cd7132e95f395` (`test: cover PR branch-point lifecycle baseline (#107)`) に対するworkflow run `33448825923` で、T405は59/60となった。

新規Issue #107テストだけが、期待するbranch pointと実際に返されたcurrent base tipの不一致で失敗した。失敗診断artifactは `9779026173` である。

### 4.2 Red 2: remote PR diff

続いてremote PR diff取得側にも同じ条件の回帰テストを追加した。

commit `f0b5243d4237e6cbf60ccb4641d3358e93c4b74a` (`test: cover remote PR diff branch-point baseline (#107)`) に対するworkflow run `33449176087` でT405は59/61となり、lifecycleとremote diffのIssue #107テストがともにcurrent base tipを使っていることを確認した。失敗診断artifactは `9779137356` である。

### 4.3 Green実装

commit `052ef6577388b6d49aff57cdf9106b8e0703c69f` (`fix: base PR Progress on branch point (#107)`) で実装した。

`src/adapters/github/fetch-github-pull-request-merge-base.ts` を追加し、open PRについてGitHub Compare APIの

`/repos/{owner}/{repository}/compare/{currentBaseSha}...{headSha}`

を呼び出し、`merge_base_commit.sha` をbranch pointとして取得するようにした。

このbranch pointを次の2経路へ適用した。

- `FetchGitHubPullRequestLifecycleAdapter`: open PRのmetadata `baseSha` をmerge baseへ正規化
- `FetchGitHubPullRequestDiffAdapter`: open PRのremote diff identityと返却metadata `baseSha` をmerge baseへ正規化

HTTP 401/403、rate limit、network、API不正応答、AbortSignalについては既存adapterと同じfail-closed方針を維持した。closed/merged PRについては追加compare呼び出しを行わない。

## 5. fixture回帰と修正

Compare API呼び出しが1回追加されたため、GitHub fetchを完全mockしていた既存テストfixtureがcompare endpointを知らず、production実装ではなくfixture側の不足で失敗した。

順次、次のfixtureを実際のproduction呼び出し順序に合わせた。

- `c655b28cd9b607840fd76d642d8bf8f3528f83e3`: private PR fixture
- `bc78c5bca48ad027e5527b4a0c1636c81c208798`: Review Contexts fixture
- `978f035c388cd8c41f3311b028138f65901fb0c7`: T405 composition fixture
- `e0e18fc035e7d14b1c286d8419c4698d6fd7341f`: T606 fixture
- `78cfabfe36e81fb2842651bde4270788274e5f58`: T402 GitHub fixture

commit `052ef657...` のrun `33449402643` では既存T407 mock 7件がcompare応答不足で失敗し、diagnostic artifact `9779204284` を使用して原因を特定した。

その後、commit `e0e18fc...` と一致するrun `33450390560` では主要gateは通過したが、Mock GitHub integrationのT402 2件がcompare応答不足で失敗した。diagnostic artifactは `9779716931` である。

最終修正では失敗していた2件だけでなく、compare応答不足のため本来の検証経路へ到達せず偶然 `api` failureで通っていた同系統fixtureも修正し、false-greenを残さないようにした。

## 6. 変更ファイル

### production

- `src/adapters/github/fetch-github-pull-request-merge-base.ts`
  - GitHub Compare APIからmerge baseを取得する共通helperを追加。
- `src/adapters/github/fetch-github-pull-request-lifecycle-adapter.ts`
  - open PRのlifecycle metadataでbranch pointを `baseSha` として返す。
- `src/adapters/github/fetch-github-pull-request-diff-adapter.ts`
  - remote diff取得時のidentityおよび返却metadataをbranch point基準へ変更。

### regression / fixture

- `test/unit/t405-github-lifecycle.test.ts`
  - Issue #107のlifecycle / remote diff回帰テストを追加。
- `test/unit/t405-composition-regression.test.ts`
- `test/unit/t407-private-pr-context.test.ts`
- `test/unit/issue-84-pr85-review-closure-followup.test.ts`
- `test/unit/t606-r6-real-composition.test.ts`
- `test/integration/t402-review-followup.test.ts`
  - 新しいcompare API呼び出しを既存GitHub mock fixtureへ追加。
- `test/unit/t404-review-followup-r3.test.ts`
  - CI実行月がfixture作成月をまたいだ場合も、月次history JSONL全体からrestart前後の履歴順序を検証するよう修正。

UI、PR Progress計算式、Global Understanding計算、storage schemaは変更していない。

## 7. 検証結果

### 7.1 Issue #107実装のtechnical Green

technical HEAD `78cfabfe36e81fb2842651bde4270788274e5f58` と完全一致するpull_request workflow run `33451471828` は `success` となり、Issue #107の直接回帰を含むT405/T406、Mock GitHub integrationを含む全必須gateが成功した。

成功runのuser validation artifactはID `9780096282`。artifact名にはpull_request eventのmerge ref側 `GITHUB_SHA` が含まれるが、CI一致判定にはworkflow runの `head_sha` を使用した。

### 7.2 report追加後に検出した月境界テスト不具合

最初のreport commit `7aaee6c91d3426f92141b53ab497496e4ddef183` と完全一致するrun `33498129932` ではUnit testsが687/688となり、既存テスト `Node PR context service records create and revision history across restart` が失敗した。

failure diagnostic artifact `9796579178` とjob logを確認すると、テストはhistoryを固定で `events-2026-08.jsonl` からしか読んでいなかった。fixtureの `context-created` は2026年8月時刻で記録される一方、revision historyは実行時刻で記録されるため、2026年9月1日UTCのCIではrevision eventが `events-2026-09.jsonl` へ分割された。actualが `['context-created']` のみになったのはこのためであり、Issue #107 production変更やreport追加の副作用ではなかった。

commit `eba2bfdce6261c7877e87c50ddb975fb29e6f10d` (`test: make T404 history assertion month-safe`) で、固定月ファイル参照を廃止し、history directoryにある `events-YYYY-MM.jsonl` をファイル名順に横断してevent順序を検証するようにした。

同commitと完全一致するrun `33498499210` は `success` となり、月境界で失敗していたUnit/T404を含め、次の全必須gateが成功した。

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

別SHAに紐づくworkflow runは各HEADのGreen判定に代用していない。

## 8. 境界条件・残存リスク

- open PRのmetadata/diff取得時にCompare API呼び出しが1回追加されるため、GitHub rate limit、authentication、network failureの影響点が1つ増える。失敗時は既存方針どおりunavailableとしてfail closedする。
- Compare APIが返すmerge baseをPR branch pointのauthoritative valueとして扱う。
- closed/merged PRの既存metadata取得経路は変更していない。
- PR Progress以外のGlobal Understanding等の比較基準は今回の対象外であり変更していない。
- T404の月境界修正はproduction behaviorを変更せず、historyテストの読み取り対象だけを実際の月次保存仕様に合わせた。
- mergeは実施していない。

## 9. PRと完了手順

変更はPR #109 `Fix PR Progress comparison base for #107` に集約した。

このreportはIssue #107実装、compare API追加に伴うfixture修正、および2026年9月1日のCIで顕在化したT404月境界テスト修正まで記録している。このreport更新commitによりPR HEADが進むため、最終PR HEADと完全一致するpull_request CIを別途確認し、そのrun ID・結論・最終HEADをPRコメントへ記録する。

mergeは利用者が行うため実施しない。

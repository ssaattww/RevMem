# T404 通常review指摘対応 R4 レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: `#48`
- Task: `T404`
- Branch: `feature/t404-pr-context-layers`
- Review source: T404 fix verification R3 (`pullrequestreview-4878314014`)
- Reviewed implementation/report/handoff HEAD: `b0c03c8c1b1c2a9e1b290ce54a041c9c5b61cb69`
- Review evidence HEAD: `909665bbe269fb870a115bc54f4373ec59154405`
- 本follow-up対象: `T404-R003` high / `T404-R004` high / `T404-R008` medium
- 既にclosedで対象外: `R001` / `R002` / `R005` / `R006` / `R007`
- Merge: 実施しない

## 指摘と原因

### T404-R003 high

既存実装はmapper結果のContext/Global identity、PR descriptor、top-level revision、各file revisionをcommit前に検証していたが、mapper自体は任意注入であり、実際のimmutable diff/blob/content evidenceに基づいてreviewed rangesを再mappingするproduction実装が存在しなかった。そのため、旧reviewed rangesを保持したままrevision IDだけを新headへ進める実装でもsnapshot validationを通過できた。

### T404-R004 high

T404側でPR hostを`trim/lowercase`した後、文字列末尾が`:443`なら無条件に除去していた。この処理では`ghe.example:8443:443`のような不正authorityが`ghe.example:8443`へaliasされ得る一方、T202/T401のLocal Git URL側はURL parserとprotocol default-port semanticsを利用しており、authorityの正規化境界が共有されていなかった。

### T404-R008 medium

前回はtest-only commitがproductionより先行したことまでは確認できたが、そのtest-only HEADでfocused testまたはcompileを実際に実行してfailureを確認した証跡がなかった。今回もGitHub connector経由のtest-only commitで`pull_request synchronize` workflow runが生成されず、PR close/reopenによる`reopened`イベントも試したがmatching runは生成されなかった。そのためRed実行確認を成功扱いしない。

## TDD順序

R003/R004の残存defectを再現するtestをproduction修正より先に追加した。

Test-only commits:

- `0370ac03cccc4e9dc10646cfecdd78037e18fb6d`
- `4a7aa6e14cef530e1759bb765331b66220e04154`
- `e1d077b9f3bebb1758ac74fa2526f919dcb33184`

最終test-only HEADは`e1d077b9f3bebb1758ac74fa2526f919dcb33184`。このHEADでは次を要求するtestが存在し、production API `createImmutablePullRequestRevisionMapper`はまだ存在しない状態だった。

1. immutable transition diffとold/new blob textを使い、変更されたreview済み行のみを無効化してContext/Globalのreviewed rangesを再mappingする。
2. `ghe.example:8443:443`のようなmalformed authorityを有効なPR identityへaliasしない。

ただし、このtest-only HEADに一致するGitHub Actions workflow runは取得できず、実行failureは確認できていない。PRを一時closeして同一HEADのままreopenしたが、matching runは生成されなかった。したがってR008の「実際のRed失敗確認」要件は未検証として扱う。

## 実装変更

### 1. shared hosted Git authority parser

`src/core/repository-identity/hosted-git-repository-identity.ts`へ`canonicalizeHostedGitAuthority`を追加した。

- authorityはhostと高々1つのportだけを許可する。
- userinfo、path、bracket、複数colon authorityをfail closedにする。
- portは1..65535のdecimal integerのみ許可する。
- default portの除去はcallerがprotocol/default-portを明示した場合のみ行う。
- repository path canonicalizationはこのauthority parserを共有する。

T202/T401の`normalizeGitRemoteUrl`も同parserへ接続し、URL schemeごとのdefault port (`http:80`, `https:443`, `ssh:22`, `git:9418`)だけを除去する。T404 PR identityはGitHub API HTTPS authorityとしてdefault `443`を明示し、同じparserを利用する。これによりmalformed multi-port authorityをaliasしない。

関連commit:

- `d2e7d037d5b3d9a19efa7387a2e8401aa7353f81`
- `3cf77e40f6a8582a4d8ab0f343d7418194c66694`
- `1532fbc54b659885d2fb9fd678fdcf27e8204898`
- `83f1af68e3774facd513a2ee63e6b339e20e149d`

### 2. immutable diff/blob/content evidenceによるconcrete PR revision mapper

`src/application/github-pr-context/immutable-pull-request-revision-mapper.ts`を追加した。

`createImmutablePullRequestRevisionMapper`はrevision transitionごとに次のimmutable evidenceをloaderへ要求する。

- source base SHA
- source head SHA
- target base SHA
- target head SHA
- complete zero-context Git diff
- old pathごとのcomplete old text
- new pathごとのfile metadataとcomplete new text

loaderのrevision identityがrequest evidenceと一致しない場合はfail closedにする。また、ContextまたはGlobalで追跡中のpathにdiffが触れる場合、そのold/new blob textが欠けていればmappingを拒否する。

Contextは既存T204 `applyGitFileStateTransitions`を利用し、rename/add/copy/deleteとreviewed rangesのtransitionを処理する。unresolved transitionがあればcommitしない。Globalは既存T502 `mapRepositoryGlobalStateThroughGitDiff`を同一diff/content evidenceで実行する。Context/Globalは同一target headへ進み、変更されたreview済み行は旧rangeのまま保持しない。

Contextには存在せずGlobalだけに残るtracked fileについてもcontent evidenceを要求するよう補強した。

関連commit:

- `e70ba7dc3eae6af28df5239c526f239d02e8f8c1`
- `acf219381c259018b9bfca8b8fbcc635556f40ef`
- `4371cd5877176f8fbe818b0f35d9d5c2eb1f2be0`
- `c6a96390e36e13e2e77293d57b9cc203c9af586c`

## 回帰test

`test/unit/t404-review-followup-r3.test.ts`へ以下のdefect-class testを追加した。

- malformed multi-port authority `ghe.example:8443:443`をrejectする。
- immutable diff/content mapperでline 2の変更を与え、Context/Global両方の`[0,3)` reviewed rangeが`[0,1)`と`[2,3)`へmappingされることを要求する。
- mapped resultのContext/Global file revisionがtarget headへ進むことを要求する。

既存のmapped snapshot fail-closed、closed override、multiple-PR/restart testは維持した。

## CI / 実行証跡

### Red phase

- Test-only HEAD: `e1d077b9f3bebb1758ac74fa2526f919dcb33184`
- GitHub connector `fetch_commit_workflow_runs`: matching pull-request workflow runなし
- PR close/reopenを実施し、同じtest-only HEADで`reopened`イベント発火も試行
- 結果: matching pull-request workflow runなし
- Red execution verdict: **未実施 / 未確認**

別SHAのrunは代用していない。

### Production phase

Implementation HEAD before this report: `c6a96390e36e13e2e77293d57b9cc203c9af586c`

このHEADについてもreport作成時点でmatching pull-request workflow runは確認できていない。別SHAのrunは代用していない。

`.github/workflows/ci.yml`には既にfailure diagnosticsがあり、test/buildのstdout/stderrをlogへ保存し、失敗時にdiagnostic artifactをuploadするためworkflow自体は変更していない。

## Base branch追従状況

作業中に`main`が`112198c33823a5fc6681399a19e0c5361614143f`から`d83d59a39de35e764bc025be661192847c2a1bcf`へ1 commit進んだ。変更内容は`README.md`とREADME更新reportの追加であり、T404 production codeとのファイル重複はない。PR metadata上は一時`mergeable: false`を返しているため、matching `pull_request` workflow runが生成されない要因の一つとして記録する。mainの変更内容をT404で独自変更してはいない。

## 残存事項

- R003/R004に対するproduction修正とdefect-class testは追加済み。
- R008のうち「test-only HEADで実際のRed失敗を実行・確認」は、matching workflow runが生成されず未成立。実行した事実はないためPASS/failedとは記録しない。
- current/final HEADのCIは、report/handoff commit後のPR current HEADとrun `head_sha`が一致するものだけを判定する。
- `tasks/tasks-status.md`はファイル自身がprogress-management Skill経由のみ更新可としており、そのSkillが今回のuploaded worker skill setに存在しないため直接更新しない。
- mergeは実施しない。

## 次のアクション

1. report/handoff後のPR current HEADに一致するworkflow runだけを確認する。
2. matching runが生成されなければCI未実施としてPRへ明記する。
3. 同じ通常reviewerが`T404-R003` / `R004` / `R008`のみを再fix verificationする。

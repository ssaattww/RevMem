# Review report

## Review type

`independent_final_review_ci_delta_limited_closure`。初回一度限り・全範囲 independent final review とfinding-limited closureを行った同一reviewer `/root/issue81_independent_review` が、失敗したexact-head pull-request CIで観測されたT405/T406 failureと `4fc4bed...815fc87` deltaだけを処分した。新規観点、新規finding探索、severity再分類、実装、test/build/lint/Host/CI実行・待機は行っていない。

## Target identity

Issue #81 / T609 / PR #82。初回independent reviewed HEADは `ecd2b0b8e09c614bb351ed958d09d5ee3180bc30`、finding closure reviewed HEADは `0cc50f7e22f6ae47bfea572535f690c6f0a63f4f`、失敗CIの旧attestation HEADは `4fc4bedb53645ba0054b153b8d49f510eca39c39`、CI-delta production/test technical HEADは `e1021f7720efc0828aa77e850c4f0eb6bdd27acc`、本closureのfrozen reviewed HEAD/upstreamは `815fc877eead1a85afa4ffc4fe7334ac70ae9beb` である。base / merge-baseは `3bba5defe32b7da134817492427e09c70c97beaf`。旧attestation `4fc4bed` はCI run `32562360871` / job `97005812011` のfailureと後続production commitによりinvalidかつnon-reusableである。

## Scope

Scopeはobserved T405/T406 duplicate UI error、`src/ui/review-contexts/vscode-review-contexts-runtime.ts` のterminal outcome・provider clear・post-failure refresh停止、`test/unit/t405-composition-regression.test.ts` のactual URI field shapeとproduction composition、direct cancellation/feedback/error contract、focused evidence、package/CI wiring、implementation/normal reports、tasks/phases/handoff/PR body factsに限定した。`T609-IFR001`〜`T609-IFR006` はdeltaが直接回帰させる場合だけ再処分した。code、test、design、workflow、configuration、tracking、handoff、PRの編集、commit、push、CI待機、mergeは対象外で、write boundaryは本予約reportの9 placeholder置換だけである。

## Evidence reviewed

- Failure authority: exact-head pull-request CI run `32562360871` / job `97005812011`。T406 production seamは不完全なfake URIによるvalidation errorの後、terminal mutation failure後のprovider refreshで同じUI errorを再通知し、expected 1 / actual 2でfailedした。
- Delta: `4fc4bed...e1021f7` のproduction/test/implementation report全3 pathsと、`e1021f7...815fc87` のnormal CI-delta report、tasks/phases/current handoff administrative paths。production/testは `e1021f7` 後に不変である。
- Direct contract: `runOperation`、`mutate`、`settleReviewContextsRepositorySelection`、`runWithActiveOperationFeedback`、`hasOperationFeedbackFailure`、tree provider generation/clear、T405 runtimeの`workspaceUriToFilesystemPath` consumer、T406 composition assertion、`package.json`、`.github/workflows/ci.yml`。
- Provided validation: exact failing T406 testはRed 0 pass / 1 failからGreen 1 pass / 0 fail。`npm run test:t405` は49/50でchanged T406 composition testは別のfocused/`test:t406` evidenceでpassし、唯一のfailureは非変更 `t405-selected-pr-session` active-editor ownership。build、lint、diff-checkはpass。これらを本reviewでは再実行していない。
- Administrative/external facts: tasks/phases/handoffは旧attestation無効、fix `e1021f7`、same-normal `pass_with_held`、same-independent CI-delta closure待ちを記録する。PR #82 body/headもadmin HEAD `815fc87`、failure/fix、Red/Green、49/50 held、新attestationとexact-head CI待ちへ同期済みである。

## Finding dispositions

- Observed T405/T406 CI failure — **closed**。Required actionはterminal mutation failureを一度だけ通知し、旧projectionをclearして重複するpost-mutation provider refreshを開始しないことである。Production pathは`runOperation`が `completed | cancelled | terminal` を返し、exceptionを`settleReviewContextsRepositorySelection`で一度reportした後、`mutate`の`terminal` branchがproviderをclearしてreturnする。Actual composition fixtureはproduction runtimeのpublic cache-refresh/redetect commandとreal storage/network failure seamを通り、offline/cache-write error 1件、旧projection消去、明示的live recoveryをassertする。Focused evidenceは同一testのRed 0/1→Green 1/1である。required action、production path、actual composition、focused evidence、tracking/PR factsの全cellをsatisfiedとした。
- Cancellation / terminal / clear semantics — **checked_no_finding**。Repository picker cancellationは従来どおり`cancelled`を返してclear/report/refreshを行わない。Thrown terminal failureだけが1回report後にclearされ、feedback context内で記録されたterminal failureは既存`terminalFailure` branchでclear-returnする。成功時だけ後続provider refreshへ進み、旧generationが新projectionをclearしない境界も不変である。
- Actual URI fixture contract — **checked_no_finding**。active documentとworkspace folderのfake file URIはproduction helperが読む `scheme`、`authority`、`fsPath`、`query`、`fragment` を備え、local file URIのempty authority/query/fragmentというactual shapeを表す。production URI/security contract自体は変更していない。
- `T609-IFR001` High — **closed維持**。encoding change/redecode pathへのdeltaなし。
- `T609-IFR002` High — **closed維持**。Current Context cancel/stale contractへのdeltaなし。共有Review Contexts cancellation boundaryは上記のとおりnon-destructiveを維持する。
- `T609-IFR003` High — **closed維持**。atomic storage containment production/testへのdeltaなし。既存Windows fixture limitationはheldを維持する。
- `T609-IFR004` Medium — **closed維持**。T305/T405 shared URI boundary production helperへのdeltaなし。fixture shape修正により既存actual contractへ一致した。
- `T609-IFR005` Medium — **closed維持**。T609 Host semantic matrix、runner、package/CI T609 wiringへのdeltaなし。
- `T609-IFR006` Low — **closed維持**。current tasks/phases/handoff/PR bodyはCI failure、旧attestation無効化、fix/normal verdict、残るclosure/CI/mergeを正確に同期する。
- Severity reclassification: なし。High 3、Medium 2、Low 1をsource reportどおり保持し、新規findingはない。

## Validation assessment

Observed failure completeness matrixは required action=`satisfied`、production path=`connected`、actual composition fixture=`present`、focused evidence=`Red 0/1 -> Green 1/1`、tracking/PR facts=`current`。Changed production/test、direct consumer/contract、cancellation、terminal error、clear/generation、actual URI shape、public/API/data/config/workflow compatibility、scope discipline、gate wiring、IFR001-006 direct regressionはすべて `checked_no_finding` とした。`runOperation`のreturn unionはregistration closure内のprivate contractでpublic API/Breaking Changesを生じない。`test:t405` 49/50はsuite Greenへ読み替えず、非変更failureをheldへ分離する。本closureでtest/build/lint/Host/CIを実行・待機した回数は0である。

## Held items

- `npm run test:t405`: 50件中、非変更 `t405-selected-pr-session` のselected-PR active-editor ownership failure 1件。changed T406 composition testのfailureではなく、successへ読み替えない。
- CI-delta後のfull local equivalence / Extension Hostは未再実行。deltaのactual production compositionはfocused T406 Greenで固定済み。
- 既存full local gate: base exact-match unit 22 failures、current-only Windows file-symlink fixture setup `EPERM`、T207 Windows Temp cleanup `EBUSY`を従前どおりheld。
- Markdown wording check: repository-local `tools/lint/`、`lint:md`、対応設定がないためunsupported。代替未定義checkerは実行していない。
- 新report-only attestation HEADに一致するrequired pull-request CIはmerge gateとしてheld。今回inspect/waitしていない。新CI failureは本verdict/attestationを無効化する。

## Unexplored

`0`。Observed CI failure、全7 changed paths、production/test/direct contract、terminal/cancel/feedback-failure/clear lifecycle、actual URI fixture、Red/Greenと49/50 failure、package/CI wiring、tracking/handoff/PR body、既存IFR direct regression、attestation boundaryを処分した。未再実行full/Host、known local failures、Markdown、new exact-head CIはunexploredへ隠さずheldとして明示した。

## Verdict

`pass_with_held`。Observed T405/T406 duplicate-error CI failureはclosedし、`T609-IFR001`〜`T609-IFR006` は全件closedを維持する。required finding、incomplete matrix、verdict-blocking unexploredはない。technical verdictはfrozen reviewed HEAD `815fc877eead1a85afa4ffc4fe7334ac70ae9beb` にだけ適用され、旧attestation `4fc4bed` へは適用も再利用もしない。

`report_attestation_allowed = true`。ただし、本予約reportだけを変更する**即時の exactly one report-only commit**を作成し、そのfirst parentが `815fc877eead1a85afa4ffc4fe7334ac70ae9beb`、変更pathが `reports/issue-81-t609-independent-ci-delta-20260822175815.md` だけであることが必須である。commit前後にimplementation、test、Skill、design、workflow、configuration、tracking、handoff、他reportを変更せず、そのcommit後は新exact-head CI確認とmergeまでrepository writeまたは後続commitを一切行わない。attestation SHA/reportはcommit後にPR metadataへ外部記録し、その新exact HEADのrequired pull-request CIをGreenで確認してからmergeする。

first-parent/path/no-later-write条件またはnew exact-head CI Greenを満たさない場合、attestationと本completionは無効でありmergeしてはならない。後続repository writeが必要な場合はnormal fix verificationと同一independent reviewerのbounded CI-delta closureを再度行う。

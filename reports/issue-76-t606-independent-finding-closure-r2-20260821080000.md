# T606 independent finding closure R2 report

## タスク

T606 / Issue #76 / PR #77 の一度限りの independent final review に対する、同一 reviewer `/root/t606_independent_review` の finding-limited closure R2を実施した。新しい full review ではなく、既存の `T606-IFR001`〜`T606-IFR005` のrequired actionだけを一括判定し、finding identityとseverityを維持した。

対象branchは `review/t606-independent-closure-r2`、review target admin HEADは `2b5df5db91298efa7c156b9dc1c03c96e38df105`、technical R2 HEADは `bdf6f4ab693e8fb126b0306cdf7690d12b813128`、prior closure targetは `ba6a4a9d94391f7c4fb65d6eae6687fabaa7c18a`、original reviewed HEADは `e73e87bef409c92a9508e90bd86da10c9fcdffac`、baseおよびmerge-baseは `fb7df6ab79bb23ae16b43b61aa66ab743460be69` である。technical判定対象は `ba6a4a9d94391f7c4fb65d6eae6687fabaa7c18a..bdf6f4ab693e8fb126b0306cdf7690d12b813128`、admin evidence判定対象は `bdf6f4ab693e8fb126b0306cdf7690d12b813128..2b5df5db91298efa7c156b9dc1c03c96e38df105` とした。

## sub-agentを使う理由

Original independent reviewerとのcontinuityを保ち、既存5 findingのrequired actionだけを同じ基準でclosureするため、このtaskは `/root/t606_independent_review` に割り当てられた。追加sub-agentは使用していない。実装owner、normal reviewer、新しいfresh reviewerへの再委譲も行っていない。

## 対象範囲

Authoritative evidenceとして、original independent report、prior finding closure report、R2 implementation follow-up report `reports/issue-76-t606-independent-review-followup-r2-20260821072632.md`、handoff `handoffs/issue-76-t606-independent-review-followup-r2-20260821072632.yaml`、PR #77 current bodyを確認した。

`T606-IFR001`はpost-publish same snapshotとstorage failure時のunknown/fail-closed、`T606-IFR002`はpure acquisition、typed result-union、actual feedback context/AbortSignal/retry、`T606-IFR003`はsingle generic Global UIとPR Progress whole-operation lifecycle/redaction/retry/cancellation、`T606-IFR004`はactual production regressions、旧fresh期待の修正、`test:t606`/CI contract配線、`T606-IFR005`はREADME、tracking、report、handoff、PR bodyのexact syncだけを確認した。全5件を `open` または `closed` に分類した。新規観点、新規finding、sibling defect探索、severity変更、full independent reviewの再実施は行っていない。

## 対象外

Original full reviewでfinding化されなかった要件、baseからの全changed file再巡回、無関係なdependency/consumer、Remote/network E2E、性能、VSIX、merge判断は対象外である。実装、test/build/typecheck/lint/architecture/CIの実行・再実行・待機、commit、push、PR/Issue変更、mergeは行っていない。

Provided validation evidenceは再実行せず、その実行範囲に限って受領した。Exact-head CI acceptanceはmerge-gate ownerへheld、Markdown focused/full wording checkはrepository tooling不在のため `unsupported` / held とした。

## 実行コマンド

Read-only evidence collectionとして `git status --short --branch`、`git branch --show-current`、`git rev-parse`、`git merge-base`、`git log`、`git show`、path限定 `git diff --name-status/--stat/--unified`、`rg -n`、`rg --files`、`Get-Content`、`Select-String`、`Test-Path` を使用した。PR #77は `gh pr view 77 --json ...` でcurrent bodyとhead identityだけをread-only参照した。Test/CI commandは使用していない。

Provided evidenceはfocused Red 5 pass / 2 fail、`test:t606` 197 pass / 1 old-expectation fail / 2 Windows POSIX skip、修正後T406 production seam 1/1 Green、build、`typecheck:contracts`、lint、architecture positive/negative、`git diff --check` passである。Full `test:t606`の修正後rerunは提供されておらず、修正後Greenは指定T406 selectionだけである。

Markdown word checkerのdiscoveryでは `tools/lint/`、そのREADME/targets/whitelist/`prh.yml`、`cspell.config.jsonc`、`lint:md`、その他のMarkdown wording scriptが不在だった。Focused/fullとも未実行の `unsupported`、aggregate stateも `unsupported`、caller dispositionはheldである。

## 対象ファイル

Technical R2として `src/application/github-pr-cache/github-pull-request-cache-service.ts`、`src/t305-extension.ts`、`src/t405-pull-request-review-runtime.ts`、`src/t405-review-contexts-runtime.ts`、`src/ui/current-context/current-context-runtime-composition.ts`、`src/ui/current-context/current-context-runtime-coordinator.ts`、`src/ui/current-context/current-context-ui-controller.ts`、`src/ui/current-context/vscode-current-context-runtime.ts`、`src/ui/global-understanding/global-understanding-ui-model.ts`、`src/ui/global-understanding/vscode-global-understanding-runtime.ts`、`src/ui/review-contexts/vscode-review-contexts-runtime.ts` と、それらのfinding-specific direct contracts/adaptersを確認した。

Regression/evidenceとして `test/unit/t606-r6-production-matrix.test.ts`、`test/unit/t405-composition-regression.test.ts`、`package.json`、`.github/workflows/ci.yml`、`test/unit/ci-workflow-contract.test.ts` を確認した。Admin syncとして `README.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`、original/prior/R2 reports、R2 handoff、PR #77 current bodyを確認した。その他のfileはこのfinding-limited closure R2では再reviewしていない。

## 指摘事項

- **T606-IFR001 — severity `high` — `open`。** `src/t405-review-contexts-runtime.ts:339-358` とReview Contexts providerはdeferred publish後にprojectionを再生成し、publish後にもowner failureを確認するため、same-snapshotの構造は改善された。しかし `src/application/github-pr-cache/github-pull-request-cache-service.ts:195-203` は通常のstorage write失敗をcatchして成功形の `live/not-cached` を返し、`src/t405-review-contexts-runtime.ts:735-746` もこの結果をcache statusへ格納するだけでactive operation failureを報告しない。したがってstorage failureがcurrent-generation failureとしてunknown/clearへ遷移せず、terminal lifecycleも成功し得る。`test/unit/t606-r6-production-matrix.test.ts:187-206` はENOSPCを `live/not-cached` と期待し、`246-256` は配列差し替えだけでstorage failureを再現しない。Required actionは、storage write failureをtyped owner failureとしてlosslessに伝播し、同一snapshotをclear/unknownへfail-closedさせ、production seamで固定すること。

- **T606-IFR002 — severity `high` — `open`。** Current Context augmentationはpersistent synchronizationをread-only projectionへ分離し、lifecycle unavailableをtyped `OperationDiagnosticError`へ変換したため、pure acquisitionとtyped failureの一部は満たす。しかしrefreshだけがfeedback contextをcompositionへ渡し、`src/ui/current-context/vscode-current-context-runtime.ts:114-125`、`current-context-runtime-coordinator.ts:27-28`、`current-context-runtime-composition.ts:44-54` のselection pathはowner contextを渡さない。また `src/t405-review-contexts-runtime.ts:691-749,817-841` はAbortSignalをawait前後で確認するだけで、auth、local/remote diff、cache read/publish、lifecycle `fetchCurrent`のactual I/O portへ渡していないためin-flight I/Oを停止できない。Required actionは、refresh/selectの両方で同一feedback ownerをactual T305→T405 acquisitionへ渡し、AbortSignalをauth/lifecycle/diff/cache portsまで伝播し、typed result-unionのtransientだけをretry、permanentを一回でterminalにするactual production boundaryを完成させること。

- **T606-IFR003 — severity `medium` — `open`。** Global open controllerはraw callbackを除去してthrowし、VS Code command boundaryはshared lifecycleとgeneric formatterを一回使用するため、Global側はrequired actionを満たす。PR Progressも計算、line reviewability、publicationを一つの `runWithActiveOperationFeedback` へ入れた。しかし `src/t405-pull-request-review-runtime.ts:454-484,698-714` はline content I/OへAbortSignalを渡さず、supersede時のgeneration mismatchはcallbackをreturnしてterminal cancellationではなくOKとなり得る。Whole-operation cancellation契約は未充足である。Required actionは、line-reviewabilityのactual content I/Oまで同じsignalを渡し、superseded operationを同一lifecycleのcancellation terminalとして一回だけ完了させ、production command regressionで証明すること。

- **T606-IFR004 — severity `high` — `open`。** `test/unit/t405-composition-regression.test.ts:713-725` の旧fresh期待は `not-cached` へ修正され、R2 testsは `test:t606` とCI contractに配線されている。しかし追加testはpost-publish配列差し替えとGlobal controller throwを直接検証するだけで、storage failure unknown、actual T305→T405 owner/result-union retry/I/O cancellation、single Global production command UI、dedicated PR Progress whole-operation cancellationを検証しない。Provided full `test:t606` は197 pass / 1 fail / 2 skipのままで、修正後はその旧期待selection 1/1だけがGreenである。Required actionはIFR001〜IFR003の残required actionをactual production reproducerでRed/Green化し、`test:t606`必須suiteとCI contractへ維持配線し、修正後full-suite evidenceを同期すること。

- **T606-IFR005 — severity `medium` — `open`。** README、tracking、R2 report/handoff、PR #77 current bodyはtechnical HEAD `bdf6f4ab693e8fb126b0306cdf7690d12b813128`、admin HEAD `2b5df5db91298efa7c156b9dc1c03c96e38df105`、provided validation値、closure R2 pending、exact-head CI heldを概ね同期している。しかしこれらはIFR001〜IFR004をaddressed済みとしており、本closureで確認した未充足required actionと一致しない。Required actionは、同一reviewer closure R2の実dispositionとvalidation範囲に合わせてREADME/current tracking/report/handoff/PR bodyをexact syncし、historical original/prior reportsとsource severityを変更しないこと。

Severity reclassificationは全件なし。既存finding identityとsource severityを保存した。新規findingはない。

## 結果

**Technical verdict: FAIL.** `T606-IFR001`〜`T606-IFR005` はすべて `open` である。R2で修正済みの部分は認めるが、各findingのrequired actionに未充足項目が残るためfinding単位ではcloseしない。

Dispositionは、IFR001 post-publish same snapshot/storage fail unknown `checked_finding`、IFR002 pure acquisition/typed union/actual context-signal-retry `checked_finding`、IFR003 single generic Global UI/PR Progress whole operation `checked_finding`、IFR004 production regressions/old expectation correction `checked_finding`、IFR005 README/tracking/report/handoff/PR exact sync `checked_finding` である。Heldはexact-head CI merge-gate acceptanceとMarkdown focused/full unsupportedの2件。Unexploredはfinding-limited scope内で `none`、Unknownも `none`。対象外範囲やprovided evidenceの未実行範囲をpassへ変換していない。

`report_attestation_allowed: false`。現target `2b5df5db91298efa7c156b9dc1c03c96e38df105` に対するreport-only attestation commitは不可であり、この予約reportをcommitしてはならない。将来すべてのopen required actionを同一reviewerがfinding-limitedでcloseした場合に限り、その時点でfreezeされたadmin targetをfirst parentとする後続commitが正確に1件、変更pathが事前予約されたclosure reportだけ、report本文がtechnical/admin identityを明記、後続commitなし、attestation SHAをbranch外へ記録、という全条件をcallerが再検証する必要がある。

## リスク

Current remaining riskは、cache storage write failureが成功形 `live/not-cached` として扱われunknownへfail-closedしないこと、Current Context selectionがfeedback ownerを失いactual I/OへAbortSignalが届かないこと、PR Progressのline content I/Oがsupersede後も継続してOK terminalになり得ること、production testsがこれらを検出せず修正後full `test:t606` Greenも未提示であること、tracking/evidenceが実dispositionより先行していることである。これらはすべて既存IFR001〜IFR005の未充足required actionであり、新規findingではない。

次actionはimplementation ownerが上記の各open findingのrequired actionだけを修正し、必要なvalidation/evidence同期を行った後、この同じ reviewer `/root/t606_independent_review` が同じ5件だけを再度finding-limited closureすることである。新しいfull independent review、新規観点、新規finding、sibling探索、severity変更は行わない。Exact-head CIとMarkdown wordingは引き続きheldであり、本reportはmerge authorizationを与えない。

Persistence pathは `reports/issue-76-t606-independent-finding-closure-r2-20260821080000.md`。このclosure R2では当予約report以外を変更していない。

# T606 independent finding closure report

## タスク

T606 / Issue #76 / PR #77 の一度限りの independent final review に対する、同一 reviewer `/root/t606_independent_review` の finding-limited closure を実施した。新しい full review ではなく、既存の `T606-IFR001`〜`T606-IFR005` の required action だけを一括判定した。

対象branchは `review/t606-independent-closure`、review target admin HEADは `ba6a4a9d94391f7c4fb65d6eae6687fabaa7c18a`、technical fix HEADは `65d3b29dcf7f5030679a2a44269f832eda9daace`、original reviewed HEADは `e73e87bef409c92a9508e90bd86da10c9fcdffac`、baseおよびmerge-baseは `fb7df6ab79bb23ae16b43b61aa66ab743460be69` である。technical判定対象は `e73e87bef409c92a9508e90bd86da10c9fcdffac..65d3b29dcf7f5030679a2a44269f832eda9daace`、admin evidence判定対象は `65d3b29dcf7f5030679a2a44269f832eda9daace..ba6a4a9d94391f7c4fb65d6eae6687fabaa7c18a` である。

## sub-agentを使う理由

original independent reviewerとのcontinuityを保ち、各findingのidentity・severity・required actionを変更せずclosureするため、このtaskは `/root/t606_independent_review` に割り当てられた。追加sub-agentは使用していない。実装owner、normal reviewer、新しいfresh reviewerへの再委譲も行っていない。

## 対象範囲

Authoritative evidenceとして、original report `reports/issue-76-t606-independent-final-review-20260821063000.md`、implementation follow-up report `reports/issue-76-t606-independent-review-followup-20260821070602.md`、handoff `handoffs/issue-76-t606-independent-review-followup-20260821070602.yaml`、PR #77 current bodyを確認した。

`T606-IFR001`はReview Contextsのstale/unknown遷移、typed failure propagation、deferred cache publish後の同一snapshot freshness、explicit mutation/fallback failureを確認した。`T606-IFR002`はresult-union retry、AbortSignal/owner propagation、Git timeoutとpermanent failureの分類、pure-read限定retryを確認した。`T606-IFR003`はGlobal toggle/openとdedicated PR Progressの共通lifecycle、redaction、retry/cancellationを確認した。`T606-IFR004`はこれらのactual production regression、`test:t606`、CI contract wiringを確認した。`T606-IFR005`はREADME、tracking、PR body、validation evidence、identity同期だけを確認した。

全5件を `open` または `closed` に分類した。新規観点、sibling defect探索、新規finding、severity変更は行っていない。

## 対象外

original full reviewでfinding化されなかった要件、baseからの全changed file再巡回、無関係なdependency/consumer、T607/T608、実Remote/network E2E、性能、VSIX、merge判断は対象外である。実装、test/build/typecheck/lint/architecture/CIの実行・再実行・待機、commit、push、PR/Issue変更、mergeは行っていない。

provided validation evidenceは再実行せず、その実行範囲に限って受領した。exact-head CI acceptanceはmerge-gate ownerへheld、Markdown focused/full wording checkはrepository tooling不在のため `unsupported` / held とした。

## 実行コマンド

Read-only evidence collectionとして `git status --short --branch`、`git branch --show-current`、`git rev-parse`、`git merge-base`、`git log`、`git show`、path限定 `git diff --name-status/--stat/--unified`、`rg -n`、`rg --files`、`Get-Content`、`Select-String`、`Test-Path` を使用した。PR #77は `gh pr view 77 --json ...` でcurrent bodyとhead identityだけをread-only参照した。CI commandは使用していない。

Provided evidenceは focused Red 11 pass / 1 fail、focused Green 12/12、`test:t606` 194 pass / 2 old-expectation fail / 2 Windows POSIX skip、修正後exact failed selections 2/2、T405 composition 3/3、Review Contexts wiring + T606 R6 matrix 12/12、build、`typecheck:contracts`、architecture positive/negative、`git diff --check` pass、lint修正後targeted ESLint passである。full `test:t606`とfull lintの最終Greenは提供されておらず、targeted evidenceをそのまま記録した。

Markdown word checkerのdiscoveryでは `tools/lint/`、そのREADME/targets/whitelist/`prh.yml`、`cspell.config.jsonc`、`lint:md` がすべて不在だった。focused/fullとも未実行の `unsupported`、aggregate stateも `unsupported`、caller dispositionはheldである。

## 対象ファイル

Technical fixとして確認したfileは `src/adapters/local-git/local-git-pull-request-diff-adapter.ts`、`src/application/github-pr-diff/contracts.ts`、`src/application/github-pr-diff/pull-request-diff-acquisition-service.ts`、`src/application/operation-feedback/operation-feedback.ts`、`src/t305-extension.ts`、`src/t405-pull-request-review-runtime.ts`、`src/t405-review-contexts-runtime.ts`、`src/ui/global-understanding/global-understanding-ui-model.ts`、`src/ui/global-understanding/vscode-global-understanding-runtime.ts`、`src/ui/review-contexts/vscode-review-contexts-runtime.ts` である。

Finding-specific regressionとして `test/unit/t606-failure-policy-retry-diagnostics.test.ts`、`test/unit/t606-r6-production-matrix.test.ts`、`test/unit/t405-composition-regression.test.ts`、`test/unit/review-contexts-runtime-wiring.test.ts` を確認した。Admin/evidenceとして `README.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`、original report、follow-up report、handoff、PR #77 current bodyを確認した。その他のfileはこのfinding-limited closureでは再reviewしていない。

## 指摘事項

- **T606-IFR001 — severity `high` — `open`。** 失敗をthrowする `progressFor` / `readSynchronizedRepository`、provider clear、mutation failure clearはrequired actionの一部を満たす。しかし `src/t405-review-contexts-runtime.ts:338-344` はcache mapからtree itemを構築した後、`348-351` の `publishLoaded()` がcache statusを更新し、`src/ui/review-contexts/vscode-review-contexts-runtime.ts:185-196` は更新前の `loaded` をそのままpublishする。さらにhandled failure確認はpublish前の `189-192` だけで、deferred publish中のstorage diagnosticを再確認しない。したがって「deferred publish後の実resultを同じtree snapshotへ反映」とcurrent-generation storage failureのfail-closedは未充足である。Required actionは、publish結果を再projectionするかpublishが更新済みitemを返す構造にし、publish後にもowner failureを確認してclear/unknownへ遷移させ、初回live cache success、`not-cached`、storage failureを同じproduction tree snapshotで固定すること。

- **T606-IFR002 — severity `high` — `open`。** `git-timeout`と`git-failure`の分類、Review Contextsでのtyped throw、T305からaugmentationへのsignal引渡し、dedicated PR Progressのcontrollerは追加された。しかし Current Context の `src/t405-review-contexts-runtime.ts:373-378` はretry対象のcandidate acquisition内で `synchronizeRepository` を実行し、`780-803` はlifecycle unavailable resultをtyped failureへ伝播せずcontinueし、available時はpersistent stateを更新する。外側の `src/ui/current-context/current-context-ui-controller.ts:163-166` はこの全体をretryするため、pure-readだけという境界になっていない。また `src/t305-extension.ts:265-271` はsignalだけを渡しowner contextを渡さず、T405のauth、lifecycle fetch、cache acquisitionへAbortSignal自体は渡されないためin-flight I/Oを停止できない。Required actionは、Current Context augmentationをread-only projectionへ分離し、result-union failureをlosslessにthrowしてnetwork/timeoutだけをretryし、同一owner contextとAbortSignalをactual lifecycle/diff/cache portsまで伝播すること。auth/validation/stale/storage/permanentの一回性もactual compositionで固定すること。

- **T606-IFR003 — severity `medium` — `open`。** Global toggleはshared lifecycleとgeneric UI errorへ接続された。しかし Global open は `src/ui/global-understanding/global-understanding-ui-model.ts:277-289` でraw errorを `reportOpenError` へ先に渡し、`src/t305-extension.ts:378-380` のformatterがraw `error.message`をUIへ含めた後、`src/ui/global-understanding/vscode-global-understanding-runtime.ts:300-310` がもう一度generic errorを表示するため、generic UI message一回というrequired actionを満たさない。dedicated PR Progressも `src/t405-pull-request-review-runtime.ts:454-458` でshared lifecycleが終了した後にline-reviewability取得とtree publicationを `459-478` で続行するため、observable activity全体のSTART/terminal境界になっていない。Required actionは、Global openのcontrollerをraw-reportせずthrowする単一boundaryへ統合し、PR Progressの計算、line-reviewability、publication全体を一つのowner lifecycle/cancellationで囲むこと。

- **T606-IFR004 — severity `high` — `open`。** old fresh-cache expectationのclear化、Git classifier、generic Review Contexts retry/cancellation、Global toggle、package/CI wiringは改善された。しかし `test/unit/t606-r6-production-matrix.test.ts:187-206` は依然としてacquisition成功を一回直接呼ぶだけでresult-union retryを発生させず、追加されたGlobal test `209-245` はtoggleだけでopenを検証しない。actual T305→T405 owner/signal/I/O cancellation、Current Contextのresult-union retryと副作用一回性、deferred publish後のsame-snapshot cache status、dedicated PR Progress全体のlifecycleもproduction testがない。provided full `test:t606` は194 pass / 2 failで、修正後はその2 selectionだけがGreenである。Required actionはIFR001〜IFR003の残required actionをactual production reproducerでRed/Green化し、`test:t606`必須suiteとCI contractへ維持配線すること。

- **T606-IFR005 — severity `medium` — `open`。** PR #77 current bodyはtechnical/admin HEADとprovided validationを同期している。一方、READMEとcurrent task/phase trackingはIFR001〜IFR004をaddressed済みとし、PR body external syncを依然pendingと記録しており、現在のcode/evidenceおよびcurrent PR bodyと一致しない。follow-up report/handoffも同じaddressed/pending状態を保持する。Required actionはtechnical fixesと同一reviewer closureの事実に合わせてREADME/current tracking/handoff/PR bodyを再同期し、historical original reportとsource severityは変更しないこと。

Severity reclassificationは全件なし。既存finding identityとsource severityを保存した。新規findingはない。

## 結果

**Technical verdict: FAIL.** `T606-IFR001`〜`T606-IFR005` はすべて `open` である。修正済み部分は認めるが、各findingのrequired actionに未充足項目が残るためfinding単位ではcloseしない。

Dispositionは、IFR001 stale/unknown・typed propagation `checked_finding`、IFR002 result-union retry・AbortSignal・Git taxonomy `checked_finding`、IFR003 Global/PR Progress lifecycle・redaction・retry/cancel `checked_finding`、IFR004 production matrix・focused/CI wiring `checked_finding`、IFR005 README/tracking/PR/evidence sync `checked_finding` である。Heldはexact-head CI merge-gate acceptanceとMarkdown focused/full unsupportedの2件。Unexploredはfinding-limited scope内で `none`、Unknownも `none`。対象外範囲をpassへ変換していない。

`report_attestation_allowed: false`。現target `ba6a4a9d94391f7c4fb65d6eae6687fabaa7c18a` に対するreport-only attestation commitは不可である。したがって current reserved reportをcommitしてはならず、completion pairも作成しない。将来すべてのopen required actionを同一reviewerがfinding-limitedでcloseした場合に限り、その時点でfreezeされたadmin targetをfirst parentとする後続commitが正確に1件、変更pathが事前予約されたclosure reportだけ、report本文がtechnical head/admin targetを明記、後続commitなし、attestation SHAをbranch外へ記録、という全条件をcallerが再検証する必要がある。

## リスク

Current remaining riskは、deferred cache publish後もtreeが更新前freshnessを表示し得ること、Current Contextのretry対象にpersistent synchronizationが混在しresult-union failureが失われること、AbortSignalがactual I/O portまで到達しないこと、Global openがraw messageを含む二重UI reportを出すこと、PR Progress lifecycleがpublication前にOKとなること、focused matrixがこれらを検出しないことである。これらはすべて既存IFR001〜IFR004の未充足required actionであり、新規findingではない。

次actionはimplementation ownerが上記の各open findingのrequired actionだけを修正し、必要なvalidation/evidence同期を行った後、この同じ reviewer `/root/t606_independent_review` が同じ5件だけを再度finding-limited closureすることである。新しいfull independent review、新規観点、新規finding、severity変更は行わない。exact-head CIとMarkdown wordingは引き続きheldであり、本reportはmerge authorizationを与えない。

Persistence pathは `reports/issue-76-t606-independent-finding-closure-20260821073000.md`。このclosureでは当予約report以外を変更していない。

# T606 independent final review report

## タスク

T606 / Issue #76 / PR #77 の一度限りの全範囲 independent final review を実施した。review mode は `independent_final_review`、reviewer identity は `/root/t606_independent_review` であり、implementation owner と normal reviewer `/root/t606_normal_review` のいずれとも異なる fresh reviewer である。

reviewed branch は `review/t606-independent-final`、base は `main` の `fb7df6ab79bb23ae16b43b61aa66ab743460be69`、reviewed implementation/admin HEAD は `e73e87bef409c92a9508e90bd86da10c9fcdffac`、merge-base は `fb7df6ab79bb23ae16b43b61aa66ab743460be69`、range は `fb7df6ab79bb23ae16b43b61aa66ab743460be69...e73e87bef409c92a9508e90bd86da10c9fcdffac` である。技術verdictは frozen reviewed HEADだけに適用する。

## sub-agentを使う理由

fresh independent reviewer identityをnormal cycleから分離し、implementation、normal review、R001〜R007 closure、admin verificationに依存しない一巡を行うためである。このreviewerは実装、normal review、finding fix、test/CI実行を担当していない。追加sub-agentは使用せず、reviewer continuityをこの一度限りのfull reviewへ固定した。

## 対象範囲

Authoritative sourceとしてIssue #76、PR #77、`doc/design/vscode-review-range-tracker-design.md` §2.1、§5.5、§9.5、§13、§15.2、§16.10、§17、§18、§20.4、§21、`Design/BreakingChanges.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`、`README.md`を確認した。base...HEADの全64 changed files、各変更のdirect dependency/consumer/composition、T402/T403/T405/T604/T605の既存contract、T606 focused/CI wiring、全normal report・closure R1〜R8・admin delta R1/R2・handoff・pre-independent syncを確認した。

Issueの全failure matrixとしてGit executable missing、timeout、non-zero、corruption、safe.directory、GitHub 401/403/404/429、network、malformed/incomplete response、storage ENOSPC/EACCES/partial write/flush/replace、lock timeout、process interruption、retry/cancellation/idempotency、Output redaction/dedup、Current Context、PR Progress、Global、Review Contexts、mark/unmark、multi-root/root-switch/concurrencyをproduction call graphとprovided evidenceへ照合した。

対象criteriaは requirement/design conformance、correctness/edge case、scope discipline、public/internal API、data/storage/atomicity、configuration/workflow/compatibility、security/privacy、failure diagnostics、retry/cancellation/idempotency、redaction/dedup、UI lifecycle/freshness、multi-root/concurrency、tests/local validation/CI、reports/tracking/README/PR accuracyである。各criterionは `checked_no_finding`、`checked_finding`、`held`、`not_applicable` のいずれかへ分類し、`unexplored` は none とした。

## 対象外

実Remote service/network E2E、性能計測・最適化（T607）、初期版全体acceptance・VSIX（T608）、mergeはIssueの明示non-goalとして `not_applicable` とした。実装、fix、test/build/lint/architecture/CIの実行・再実行・待機、PR/Issue操作、commit、push、mergeは行っていない。既存report、handoff、tracking、design、workflow、source、testは変更せず、予約済みの当reportだけを更新した。

exact-head CI acceptanceはcaller所有のmerge gateとして `held` のまま扱い、review verdictやmerge authorizationへ変換していない。Markdown word checkもrepository tooling不在のため `unsupported` / `held` であり、passへ変換していない。

## 実行コマンド

Read-only evidence collectionとして `git status --short --branch`、`git rev-parse`、`git merge-base`、`git log`、`git diff --name-status/--stat/--check`、path限定 `git diff`、`git show`、`rg -n`、`rg --files`、`Get-Content`、`Select-String`、`Test-Path`を使用した。GitHubは `gh issue view 76`、`gh pr view 77`、`gh pr checks 77`、既存run metadataの `gh run view`をread-onlyで参照したが、CIを起動・再実行・待機していない。

Provided evidenceは `npm run test:t606` 195 pass / 2 Windows POSIX skip / 0 fail、`npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check` passとして受領し、再実行していない。このGreen evidenceは実行されたsuiteの成功として認めるが、以下の未検証production behaviorや誤った期待値を成功へ変換しない。

Markdown word checkerのrequired discoveryとして `tools/lint/`、`tools/lint/README.md`、`markdown-targets.json`、`markdown-whitelist.yaml`、`prh.yml`、`cspell.config.jsonc`、`package.json`の`lint:md`を確認した。すべて不在のためfocused/fullとも `unsupported`、aggregate gateは `unsupported`、caller dispositionは `held` である。通常proseをbacktick/quoteでlint回避した箇所は目視上確認しなかった。

## 対象ファイル

Changed production/config/tracking filesは `.github/workflows/ci.yml`、`README.md`、`package.json`、`src/adapters/github/fetch-github-pull-request-adapter.ts`、`src/adapters/github/fetch-github-pull-request-diff-adapter.ts`、`src/adapters/github/fetch-github-pull-request-lifecycle-adapter.ts`、`src/application/github-pr-cache/github-pull-request-cache-service.ts`、`src/application/github-pr-context/contracts.ts`、`src/application/github-pr-diff/contracts.ts`、`src/application/operation-feedback/operation-feedback.ts`、`src/application/review-contexts/review-contexts-controller.ts`、`src/t305-extension.ts`、`src/t405-pull-request-review-runtime.ts`、`src/t405-review-contexts-runtime.ts`、`src/t505-global-understanding-source.ts`、`src/ui/current-context/current-context-runtime-composition.ts`、`src/ui/current-context/current-context-runtime-coordinator.ts`、`src/ui/current-context/current-context-ui-controller.ts`、`src/ui/current-context/vscode-current-context-runtime.ts`、`src/ui/global-understanding/global-understanding-ui-model.ts`、`src/ui/global-understanding/vscode-global-understanding-runtime.ts`、`src/ui/normal-editor/review-command-registration.ts`、`src/ui/review-contexts/index.ts`、`src/ui/review-contexts/vscode-review-contexts-runtime.ts`、`tasks/tasks-status.md`、`tasks/phases-status.md`である。

Changed testsは `test/integration/mock-github.test.ts`、`test/unit/ci-workflow-contract.test.ts`、`test/unit/current-context-ui.test.ts`、`test/unit/normal-editor-review-command-registration.test.ts`、`test/unit/review-contexts-runtime-wiring.test.ts`、`test/unit/review-contexts-ui.test.ts`、`test/unit/t405-composition-regression.test.ts`、`test/unit/t604-storage-lock-cleanup.test.ts`、`test/unit/t606-failure-policy-retry-diagnostics.test.ts`、`test/unit/t606-production-failure-matrix.test.ts`、`test/unit/t606-r6-production-matrix.test.ts`である。

Changed admin evidenceは `reports/issue-76-t606-implementation-20260820225743.md`、normal initial/follow-up/closure R1〜R8の全report、normal admin delta R1/R2、pre-independent sync report、implementation/R5/R6/R7/R8/pre-independentの全handoffである。全fileは `git diff --name-status base...HEAD` と一致した。

Direct dependency/consumerとしてoperation feedback startup/Vscode host、Git executor/blob reader/stable-code boundary、T402 acquisition、T403 cache entry/storage、T405 lifecycle/context state/revision evidence/PR progress/diff commands、T603 migration/quarantine、T604 lock/coordinator/atomic store、T605 storage route/root registry/workspace identity、Global recalculation、Current Context selection、normal/PR diff mutation、state/history/snapshot/cache repositories、および各public barrel/contract fixtureを追跡した。

## 指摘事項

- **T606-IFR001 — severity `high` — origin `independent_final_review` — location `src/t405-review-contexts-runtime.ts:282-342,754-775,811-850`、`src/ui/review-contexts/vscode-review-contexts-runtime.ts:185-193,242-280`、`test/unit/t405-composition-regression.test.ts:713-755`。** Description: Review ContextsのGitHub lifecycle/progress/cache failureは`reportActiveOperationFailure`でouter lifecycleをERRORにする一方、sourceはpersisted contextを通常itemとして返すかprogressだけをomitして成功returnする。providerは`hasOperationFeedbackFailure`を確認せずそのitemをpublishする。explicit cache refresh/storage failureでは`mutate`がprovider refreshを止めるだけで既存projectionをstale/unknownへ変えず、production regression testもoffline-stale/cache-write failure後に以前の`fresh` cache表示を保持することを正解としている。Impact: operationがERRORでも以前のPR lifecycle、cache freshness、contextがfreshに見える。Issueの「直前の確実な状態は明示staleとしてのみ保持」「failure時にstale/unknown/freshnessを区別」とdesign §17.1/§17.3、AC-24相当のfail-closed contractに違反する。Required action: handled failureをdata-bearing successと分離し、current generationにfailureがあればtreeをclear/unknownへ戻すか明示stale projectionをpublishする。cache statusはdeferred publish後の実resultから同じtree snapshotへ反映し、explicit mutation/fallbackのpartial successでもcurrent/stale identityを一貫させるproduction testを追加する。

- **T606-IFR002 — severity `high` — origin `independent_final_review` — location `src/application/operation-feedback/operation-feedback.ts:256-288,310-336`、`src/t405-review-contexts-runtime.ts:356-380,680-775,811-838`、`src/t305-extension.ts:264-272`、`src/t405-pull-request-review-runtime.ts:424-479`。** Description: bounded retryはthrowされたerrorだけを分類するが、production GitHub adapter/acquisitionはrate-limit/network/authentication/apiをresult unionへ変換し、T405 `progressFor`と`readSynchronizedRepository`はそのresultをreportして成功returnするため、Review Contextsのpure-read retry boundaryへretryable failureが届かない。Current ContextのT405 candidate augmentationはAbortSignal/feedback contextを受けず、`enumerateContexts`もsignalを渡さない。専用PR Progress `activateProgress`もgeneration fenceだけでAbortSignalとbounded retryを持たない。さらに`PR_PROGRESS_UNAVAILABLE`の最終`git-failure`を常にretryableとするため、timeoutとnon-zero/corruption/safe.directoryのpermanent failureを区別できない。Impact: READMEが主張する一時read/refresh最大3回、supersede cancellation、stable permanent classificationがproductionで成立せず、古いrootのI/Oが継続し、逆にpermanent Git failureを再試行し得る。Required action: typed resultにtimeout/retryableとnon-zero/corruption/safe.directory/permanentをlosslessに保持し、副作用前のpure acquisitionだけがresult-based retryを実行するよう接続する。Current Context augmentationと専用PR Progressまで同じAbortSignal/owner contextを伝播し、auth/validation/stale/storage/permanentは一回、network/timeoutだけ最大3回であることをactual compositionで固定する。

- **T606-IFR003 — severity `medium` — origin `independent_final_review` — location `src/ui/global-understanding/vscode-global-understanding-runtime.ts:278-311`、`src/ui/global-understanding/global-understanding-ui-model.ts:214-223,264-288`、`src/t405-pull-request-review-runtime.ts:439-479`。** Description: Global refreshはshared lifecycleへ接続されたが、Global layer toggleのconfig write/decoration failureとGlobal file-open failureはshared `OperationFeedback`を通らず、raw UI reportだけで終わる。専用PR Progress activationも上記のとおりcancel/retry ownerを持たない。Impact: Issueが列挙するGlobal/PR Progressのobservable activityについてSTART/OK/ERROR once、privacy-safe terminal、cancellationという統一contractが部分的で、failure時のactivity完了をOutputから追跡できない。Required action: Global toggle/openとdedicated PR Progress refreshを一つのexplicit owner lifecycleへ接続し、side-effect commandは非retry、readだけretry、failure時はgeneric UI messageと一terminalだけを出すproduction command testを追加する。

- **T606-IFR004 — severity `high` — origin `independent_final_review` — location `package.json:148`、`.github/workflows/ci.yml:71-72`、`test/unit/t606-failure-policy-retry-diagnostics.test.ts`、`test/unit/t606-production-failure-matrix.test.ts`、`test/unit/t606-r6-production-matrix.test.ts:187-206`、`test/unit/t405-composition-regression.test.ts:713-755`。** Description: `test:t606`とCI stepの配線自体は存在するが、production result-union retry、handled-failure stale/unknown projection、Current Context→T405 signal、dedicated PR Progress、Global toggle/openを検証しない。`T606 R6 cache retries acquisition only` testはacquisitionを一回だけ直接呼びretryable failureを発生させず、T405 composition testはfailure後のold `fresh` cache保持を期待している。Impact: provided 195 pass / 2 skip / 0 failとGreen CI wiringはIFR001〜IFR003を検出できず、Issueが要求するfull production failure fixture、retry/cancel、UI freshness matrixのacceptance evidenceにならない。Required action: IFR001〜IFR003のactual production reproducerをRed/Greenで追加し、T402/T403/T405/T604/T605の既存suiteを維持したまま`test:t606`とCI contractへ必須配線する。Windows POSIX 2 skipは環境限定として引き続き明示する。

- **T606-IFR005 — severity `medium` — origin `independent_final_review` — location `README.md:26`、`README.md`「現在の制限」のretry/failure説明、`tasks/tasks-status.md:12-17,366,390`、`tasks/phases-status.md:40,186`、PR #77 body、normal closure/admin reports/handoffs。** Description: README/tracking/normal evidenceはR001〜R007 closedとproduction retry/freshness完了を記録するが、IFR001〜IFR004と一致しない。PR bodyはfocused validationを21/21、normal/independent review pendingとしており、frozen HEADのprovided 195 pass / 2 skip、normal closure完了とも同期していない。Impact:次工程と利用者が未充足contractを完了済みと解釈する。Required action: technical fixesとsame-reviewer closure後にREADME、current tracking、handoff、PR body/validationをexact reviewed identityへ同期する。historical normal reportsとseverityは書き換えず、本reportをclosure discrepancyのcurrent erratumとして保持する。

Severity reclassificationはない。normal finding R001〜R007のhistorical identity/severityは変更せず、全件closedというnormal conclusionとfrozen implementationの現状との差を上記fresh independent findingsとして記録した。

## 結果

**Verdict: FAIL.** Required findingsはHigh 3件（T606-IFR001、IFR002、IFR004）、Medium 2件（T606-IFR003、IFR005）である。`report_attestation_allowed: false`。予約reportは `reports/issue-76-t606-independent-final-review-20260821063000.md` だが、passing verdictではないためadministrative attestation commit条件を使用できない。

Criterion disposition:

- requirement/design conformance、correctness/edge cases、failure/freshness: `checked_finding`（IFR001〜IFR003）。
- Git missing/timeout/non-zero/corruption/safe.directory: `checked_finding`（raw Git boundaryは既存stable detailを保持するが、diagnostic/result taxonomyとproduction retryはIFR002）。
- GitHub 401/403/404/429/network/malformed/incomplete、T402/T403 fallback: `checked_finding`（adapter reason/fallbackのbase regressionはなし。result-based retry/freshnessはIFR001/IFR002）。
- storage ENOSPC/EACCES/partial write/flush/replace、lock timeout/process interruption、T603/T604 atomicity: `checked_no_finding` for durable atomic publication/root lock、`checked_finding` for cache failure UI projection（IFR001）。
- retry/cancellation/idempotency: `checked_finding`（IFR002）。mark/unmark、Quick Pick、cache mutationのnon-retry意図は確認した。
- PR Progress/Global/Review Contexts/Current Context/mark-unmark lifecycle: `checked_finding`（IFR001〜IFR003）。Current Context generation fence、Global refresh、mark/unmarkの基本接続は確認した。
- Output single-line/bounded redaction、secret/path/source/stack suppression、same-error dedup: `checked_no_finding`。raw dependency textをOutputへコピーする経路は確認しなかった。
- data/API/config/file-format/breaking compatibility: `checked_no_finding`。新しいfailure reason/exportはrepository内部で整合し、`Design/BreakingChanges.md`追加を要する外部/persisted breaking changeは確認しなかった。
- multi-root/root-scoped storage/URI、T605 isolation: `checked_no_finding` for storage routing、`checked_finding` for superseded T405 workへのsignal伝播（IFR002）。root Bへroot Aのpersisted stateをpublishする経路は確認しなかった。
- concurrency/generation/dedup: `checked_finding`（generation fence自体は旧publicationを抑止するがhandled failure projectionとuncancelled augmentationがIFR001/IFR002）。
- focused tests/package/CI contract/provided validation: `checked_finding`（IFR004）。provided local/static evidenceは実行範囲についてaccepted、exact-head CI acceptanceはmerge gate ownerへ `held`。
- reports/tracking/README/PR/admin/handoffs: `checked_finding`（IFR005）。全normal closure/admin filesはidentity手順上の整合を確認したが、technical conclusion discrepancyをcurrent erratumとして記録した。
- scope discipline/unrelated change: `checked_no_finding`。
- Markdown word check: `held`（focused/full `unsupported`）。
- real Remote/network E2E、T607、T608、merge: `not_applicable`。

Heldは (1) exact-head CI merge-gate acceptance、(2) Markdown wording focused/full unsupported の2件。Unexploredは `none`。Unknownは `none`。次actionはimplementation ownerがT606-IFR001〜IFR005を修正し、required local validationとtracking/PR evidenceを同期した後、この同じindependent reviewer `/root/t606_independent_review`へ既存finding限定closureを依頼することである。新しいfull independent reviewは実施しない。

## リスク

Frozen targetはreview中不変で、review終了時のGit HEADも `e73e87bef409c92a9508e90bd86da10c9fcdffac` である。FAILのためreport-only attestation commitは不可であり、`reviewed_implementation_head + report_attestation_head` completion pairは作成しない。修正はfrozen stateを無効化してnormal implementation/verification cycleへ戻し、その後はこのreviewerによるT606-IFR001〜IFR005限定closureだけを行う。

Remaining riskは、Review ContextsがERROR後もold fresh projectionを表示すること、GitHub result-based transient failureがretryされないこと、permanent Git failureをretryableへ畳むこと、Current Context/T405とdedicated PR Progressのsuperseded I/Oが継続すること、Global/PR Progressの一部activityがshared lifecycle外であること、focused Greenがこれらを検出しないことである。

Persistence modeはreserved repository report fileであり、report attestationではない。report pathは `reports/issue-76-t606-independent-final-review-20260821063000.md`。Merge boundaryは維持し、merge authorizationは与えない。

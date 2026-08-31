# Sub-agent実行レポート

## タスク

PR #94 / Issue #92 の一度限りの独立final review。

## sub-agentを使う理由

実装者および通常reviewerと異なるfresh Sol/high reviewerによる独立性を確保する。

## 対象範囲

`origin/main`（`017e5aeebadbd8b676f72af6791ca455b926c55d`）からreviewed implementation HEAD `afa7ccfdccca43f6c83dc58f6e64e35b02e1a1f3`までのPR #94全差分。

## 対象外

Issue #106の恒久multi-context/shared-Global CAS実装、performance CI追加、merge操作。

## 実行コマンド

review mode=`independent final review`。reviewer identity=`/root/pr94_independent_final_review`。実装者・修正担当・通常reviewerではないfresh reviewerとして、過去verdictを前提にせずbuilt-in code reviewで一度限りの全体確認を行った。nested agent、development-orchestrator再入、実装、commit、push、CI wait、mergeは行っていない。

開始時に指定4 Skill、`AGENTS.md`、予約reportを完全に読み、`git status --porcelain=v2 --branch`、`git rev-parse`、`git merge-base`、`git log`、`git diff --stat/--name-status/--unified`、`rg`、`Get-Content`で対象同一性、97 changed filesの全差分、直接依存、設計、test、workflow、reports、trackingを確認した。`gh pr view 94`、`gh issue view 92/106`、`gh run view 33438752543`、artifact APIでPR・Issue・CI・artifact identityをread-only照合した。

focused validationは各1回だけ実行した。

- `npm run compile:test` — PASS。
- current compiled codeへのread-only inline Node reproduction — `HASH_LOSS_REPRODUCED`、`BASE_ONLY_PAIR_LOSS_REPRODUCED`。既存hash付きPR stateのcommand後snapshotがauthoritative hash restoreを拒否すること、およびsame-HEAD/base-only transitionが過去comparison pairを消去することをassertした。
- `node --test`でIssue #92 context menu/selection、original projection、diff command、T405 PR runtime、immutable snapshot、PR context store、local Git lifecycle、PR evidence loader、CI contractの10 focused files — 83 passed / 0 failed。既存suiteがIFR-001を覆わず、IFR-002の誤った消去を期待してGreenになることも確認した。
- `git diff --check origin/main...HEAD` — PASS。

default full suite、performance、`test:t607`、追加CI待機、VSIX生成は行っていない。Markdown wording checkは`markdown-word-checker`に従って確認したが、repo-local `tools/lint/`、`lint:md`、設定付きfocused commandがないためfocused/fullとも`unsupported`。対象は本予約reportだけで、設定変更やbacktick/quoteによるlint回避は行っていない。

## 対象ファイル

base=`origin/main` / `017e5aeebadbd8b676f72af6791ca455b926c55d`、initial/frozen reviewed implementation HEAD=`afa7ccfdccca43f6c83dc58f6e64e35b02e1a1f3`、range=`017e5aeebadbd8b676f72af6791ca455b926c55d...afa7ccfdccca43f6c83dc58f6e64e35b02e1a1f3`、branch=`codex/pr94-ci-review`。

97 changed filesを確認した。対象は2 design文書、`package.json`、48 reports、2 tracking文書、21 production/source path、23 unit/contract fixture pathである。productionではPR Progress provenance/menu、original projection、typed atomic mutation/history、PR/local Git snapshot capture/restore、persistence validation、PR evidence loader、shared-Global compatibility、T305/T405 compositionを追跡した。直接依存としてinterval normalization、Git diff transition/global mapping、filesystem CAS/recovery、diff URI codec、PR progress tree selection、normal Git session target/hash経路、CI workflowとartifact packagingを確認した。

開始statusは予約済み`reports/2026-09-01-pr94-independent-final-review.md`だけがuntrackedで、tracked deltaはなかった。review前後でHEADは`afa7ccfdccca43f6c83dc58f6e64e35b02e1a1f3`のまま安定している。`fb495665e209d48e586db05bf7948c3eb1c9f5ec..afa7ccf...`は`tasks/tasks-status.md`、`tasks/phases-status.md`、pre-independent tracking reviewだけで、実行可能code、design、workflow、configurationは変わっていない。

## 指摘事項

severity順のopen findingsは4件。

- **PR94-IFR-001 — High — origin: correctness/data/persistence — `src/t405-pull-request-review-runtime-base.ts:740`**: `openSession`が作る`ReviewStateFileTarget`は`lineCount`までしか渡さず、persisted Context/Globalに存在する`contentHash`を渡さない。`src/core/review-state/review-state-service.ts:186-210`はtarget hashが未指定ならnext fileからhashを意図的に除くため、PR Progressのmark/unmark/file操作が成功するとcurrent stateと同transactionで書くrevision snapshotのhashも消える。後でexact revisionへ戻る際、PR evidence loaderが取得したauthoritative target hashとsnapshotの`undefined`が一致せずrestoreが拒否され、中心要件のexact snapshot復元が成立しない。inline Redでhash付きContext/Globalからcommand相当transactionを作り、両hash消失と`restoreImmutableRevisionSnapshots`の`does not match immutable evidence`を再現した。required actionは、PR sessionがauthoritative current hashをtargetへ保持し、Context/Global hashの一致をfail closedで検証した上でwrite-throughし、実runtime command→revision transition→exact restoreのcomposition fixtureを追加すること。
- **PR94-IFR-002 — High — origin: requirement/design/data loss — `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts:204`**: same-HEAD/base-only transitionで`invalidateOriginalReviewedByDiff`を適用し、`originalReviewedByDiff`の全comparison pairを消去する。同じ消去はmiss/mixed側の`:225-245`にもある。これは`doc/design/immutable-revision-review-snapshots.md:89-91,136`と統合design `doc/design/vscode-review-range-tracker-design.md:139,456`の「過去pairを保持し、新pairだけ未確認から開始」に反し、BASEを戻しても旧pairの確認状態を復元できない。inline Redで旧`${sourceBase}..${head}` pairが`{}`になることを再現し、既存`github-pr-context-layer-store` testはこの誤動作を明示的に期待して83/83 Greenを通している。required actionは過去pairを保持し、新しいexact pairを未確認として扱い、current pairだけがprogress/decorationへ入るbase A→B→A compositionを固定すること。
- **PR94-IFR-003 — Medium — origin: design/fail-closed contract — `doc/design/vscode-review-range-tracker-design.md:135`**: 統合designの`:135,452,1171`はinvalid target snapshotでmappingへsilent fallbackせずtransition全体を拒否すると定める一方、詳細design `doc/design/immutable-revision-review-snapshots.md:43`は安全な通常mappingへ進むと定める。productionの`src/application/review-context/git-context-revision-mapper.ts:318-321`はrestore validation errorを無条件にcatchして後者を選ぶ。hash/path/content evidence mismatch時の永続化・診断契約が相反し、どちらをacceptance criterionとしてtestすべきか一意でない。required actionはauthoritative behaviorを決定して両designを一致させ、target-content mismatchのactual local-Git fixtureをその契約へ固定すること。
- **PR94-IFR-004 — Low — origin: reports/tracking accuracy — `tasks/tasks-status.md:31`**: `PR94-NR-003/004`は`reports/2026-08-31-pr94-normal-fix-verification-r2.md`でclosedとされるがtrackingは`:31-32`で`verification待ち`のまま。また両tracking文書の`:7`は設計根拠をrev6とするが、同PRの統合design headerはrev9である。pre-independent tracking reviewの「tracking accuracy checked_no_finding」とも整合しない。required actionはnormal-review closure identityと現行design revへtrackingを同期すること。

severity reclassification/erratumはない。4 findingともこのfresh independent review起源である。

## 結果

verdict=`fail`。technical verdictはfrozen reviewed implementation HEAD `afa7ccfdccca43f6c83dc58f6e64e35b02e1a1f3`だけに付く。open findings=`PR94-IFR-001 High`、`PR94-IFR-002 High`、`PR94-IFR-003 Medium`、`PR94-IFR-004 Low`。blocking unexplored areaはないが、required findingsがあるためpassまたはpass_with_heldではない。

required coverage disposition:

- requirements/design conformance — `checked_finding`（IFR-002/003）。
- full changed-file diff and direct dependencies — `checked_finding`（IFR-001/002をfull production routeで確認）。
- correctness and edge cases — `checked_finding`（hash付きstate、same-HEAD/base-only）。
- API/data/persistence/history/CAS/compatibility — `checked_finding`。atomic transaction、post-CAS history、stale/CAS no-publish自体は`checked_no_finding`だが、hash persistenceとpair retentionにfindingあり。
- error/cancellation/stale/fail-closed — `checked_finding`（IFR-003）。cancel/no-op/stale generation/CAS conflict経路は`checked_no_finding`。
- security/privacy/no secret or content logging — `checked_no_finding`。新しいcredential取扱い、secret/content loggingはなく、sensitive-pattern scanでも実tokenは検出しなかった。
- tests/wiring/workflow/artifact — `checked_finding`。required workflow、Issue #92 test wiring、performance非配線、run/artifact identityは`checked_no_finding`だが、IFR-001欠落とIFR-002誤期待がある。
- reports/tracking — `checked_finding`（IFR-004およびbase-only report/design不一致）。
- Issue #106 separation — `checked_no_finding`。target一致かつsource不一致の既知sequential compatibilityだけに限定され、他Global mismatchは拒否される。恒久redesignはIssue #106へ分離済み。
- performance CI absence — `checked_no_finding`。`test:t607`はdefault/required CIへ追加されていない。
- exact target/CI identities — `checked_no_finding`。required pull_request run `33438752543`は`fb495665e209d48e586db05bf7948c3eb1c9f5ec`でsuccess、artifact `9775656596`も同run/head。reviewed `afa7ccf...`とは一致せず、後続3 pathがtracking/reportだけである事実を区別して記録した。
- scope discipline/unrelated changes — `checked_no_finding`。private PR integration compatibilityとIssue #106境界以外のredesignはない。

finding completeness matrix:

| Finding | Required action | Production path | Actual composition fixture | Focused evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| PR94-IFR-001 | hashをPR target/snapshotへ保持し一致を検証 | missing | missing | Red reproduction complete | incomplete |
| PR94-IFR-002 | 過去pair保持、新pair未確認、current pairのみ表示 | current path is destructive | current fixture asserts wrong result | Red reproduction complete | incomplete |
| PR94-IFR-003 | fail-closed/fallback契約を一意化 | conflicting implementation/design | target mismatch fixture missing | static evidence complete | incomplete |
| PR94-IFR-004 | tracking/revをauthoritative evidenceへ同期 | not implemented | not applicable | discrepancy evidence complete | incomplete |

verification capability=`local_execution_available`。execution stateはtechnical_head=`afa7ccfdccca43f6c83dc58f6e64e35b02e1a1f3`、administrative_parent=`null`、commit=`not_required by reviewer`、push=`unauthorized`、ci_wait=`not_required`。reserved report path=`reports/2026-09-01-pr94-independent-final-review.md`、persistence intent=`report_attestation_commit only after a passing closure`。

`report_attestation_allowed=false`。fail verdictのため現在はattestation commitを作成してはならない。next actionは通常implementation/fix verificationで4 findingを解消し、同じindependent reviewerへfinding/CI-delta限定closureを戻すこと。一度限りの全体reviewを再実行しない。closureがpassした場合だけ、更新reviewed HEADの直後にexactly one commit、first parent一致、このreserved reportだけのdiff、他path変更なし、後続commitなしを検証し、attestation SHAは外部に記録する。

## リスク

held itemsは、既知のIssue #13/owned-host fixtureによりWindows default full local suiteが完走しないこと、Issue #106が所有するmulti-context/shared-Global all-or-nothing redesign、reviewed `afa7ccf...`そのものに一致するremote CIがないこと、Markdown wording lintがrepo-local設定不在で`unsupported`なことである。Linux required CIは実行可能code head `fb49566...`でUnit/Hostを含めGreenだが、finding修正後はupdated exact headのrequired CI/artifactが必要になる。これらheldは今回のHigh/Medium/Low findingsを弱めない。

unexplored in-scope area=`none`。remaining risksは、hashなしsnapshotが既に永続化され得る場合のmigration/recovery方針、same-HEAD snapshotへ過去pairを戻す際の既存消去データ復元不能、fail-closed設計決定後のdiagnostic互換性である。reportは行政的attestationではなくfail evidenceであり、mergeを許可しない。

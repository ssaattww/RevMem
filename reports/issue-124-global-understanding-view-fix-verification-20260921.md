# Issue #124 / PR #125 Fix Verification レポート

## メタデータ

- report type: verification report
- review mode: fix verification
- generated at: 2026-09-21T23:51:32+09:00
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- initial reviewed implementation HEAD: `4e6ddb45966ec96e7b5e16834f44af7e5858979d`
- initial review record HEAD: `81d7d078cf8ecf4f7c3dc6464c487138e88d65d2`
- fix technical HEAD: `b4436d5a864b7133c78750e5dcece447d54f6c0e`
- reviewed current HEAD: `94fceee9ab1e587b034131cb25bd3484e10dfdb6`
- execution environment: FA780 / Windows / PowerShell / RDC
- worktree: `C:\Users\donabe\Project\RevMem-issue124`
- verification capability: local_execution_available

## Reviewer continuity

初回 normal review と同じ chat / reviewer で fix verification を実施した。
初回 finding ID と severity は変更していない。

## Verification scope

初回 required finding:
- I124-R001 / High
- I124-R002 / High
- I124-R003 / Medium

fix diff `81d7d07..94fceee` の production source/model、追加fixture、
follow-up report/handoff/tracking、直接依存する repository identity と
Global Understanding bounded-stage design を確認した。

review-worker の fix verification 契約に従い、
各 finding の required action、production path、actual composition fixture、
focused evidence に加え、同じ defect class の sibling case も確認した。

## Finding completeness matrix

| Finding | Required action | Production path | Actual composition fixture | Focused evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| I124-R001 / High | failed rowを公開し開始actionを残す | failure lifecycle publication + published-progress preserve | actual source + runtime provider failed-row fixture | T610 77/77 | **closed** |
| I124-R002 / High | running中もcurrent owner/revisionの既知file rowを維持 | retained last snapshot + lifecycle overlay | 129-file single-root fixture | single-root Green / cross-root probe failure | **not closed** |
| I124-R003 / Medium | discovered/progress/open-target validationを128-item budget内へ収める | incremental shared validation budget | 10,000 path-only fixture | focused T607 3/3 | **closed** |

## I124-R001 / High — closed

source failure path は `folderScopes.fail(...)` 後に current lifecycle snapshot を publish する。
`GlobalUnderstandingRefreshController` は progress publication 済みの current generation で
source error が発生した場合、presentation を clear しない。

actual source + actual runtime provider fixture で、失敗後も `src` row が
`failed`、warning icon、`開始` action のまま残ることを確認した。

local evidence:
- `npm run test:t610`: 77/77 pass
- `I124-R001 keeps the actual failed folder row visible and restartable after source failure`: pass

初回 required action を満たしており、I124-R001 は closed とする。

## I124-R002 / High — not closed

### 期待する owner isolation

初回 required action は running generation でも
**current owner / current revision** の既知file rowsを維持することだった。

設計書では folder scope identity を
`Repository ID + canonical repository root URI + canonical repository-relative folder path`
としており、別 checkout / multi-root を混在させない契約である。

production の Git repository ID は remote URL がある場合その normalized URL であり、
同じremoteの別checkoutは同じ `repositoryId` になり得る。

### 実装上の問題

`ownerEvidenceKey(owner)` は `owner.target` と revision だけで構成され、
canonical repository root / scopeRoot を含めていない。

そのため `lastSnapshotByEvidenceKey` は、同じ repositoryId / contextId / revision を持つ
別 checkout 間で同一keyになり、root A の成功snapshotをroot Bのrunning lifecycleへ再利用する。

### Reproduction

current compiled source に対する cross-root probe で次を確認した。

1. root A に `src/a.ts` を持つ成功snapshotを作る。
2. 同じ remote-derived repositoryId と同じ revision の root B に切り替える。
3. root B の recalculation が running をpublishした時点を観測する。

結果:
- root B の最初の running publication に `src/a.ts` が存在した。
- open target も root A の `...\a\src\a.ts` を指していた。
- final snapshot では root B の `src/b.ts` に置換された。

evidence log:
`C:\Users\donabe\Project\RevMem-pr125-fixverify-20260921\r002-cross-root-probe.log`

impact:
- current ownerと異なるcheckoutのfile rowが収集中に表示される。
- rowを開くと別checkoutのworking-tree fileへ到達し得る。
- multi-root/root URI isolation contractに違反する。

required action:
`lastSnapshotByEvidenceKey` のidentityに canonical repository root URI / scopeRoot を含め、
root変更時に別rootのsnapshotを再利用しない。
同じremote・同じrevision・異なるrootのactual composition fixtureを追加する。

severity は初回どおり High を維持する。I124-R002 は closed にできない。

## I124-R003 / Medium — closed

`validateTreeSnapshotIncrementally()` の discovered path、progress membership、
open target validation は共通 `pendingValidationItems` budgetで処理され、
128 itemごとにyieldしcurrent generationを再確認する。

local evidence:
- `I124-R003 bounds path-only validation before the first scheduler yield`: pass
- large Global Tree bounded-stage test: pass
- 10,000-file projection accounting test: pass

初回 finding が要求した validation 部分は修正されており、I124-R003 は closed とする。

## I124-R004 / Medium — new sibling finding

origin: introduced_by_change / coverage_miss

location:
- `src/ui/global-understanding/global-understanding-ui-model.ts:480-484`

description:
`createGlobalUnderstandingTreeModelIncrementally()` は validation 後に
`validated.progress.files` 全件を同期loopして `progressByPath` を構築する。
このloopには `yieldControl()` も `isCurrent()` check もない。

design 19.1 は validation / sorting / projection を含む各初期段階を
同じ明示item budgetに収める契約である。

reproduction:
10,000 current-evidence file の `progress.files` accessをProxyで計測したところ、
`maxFilesPerStage=128` に対し scheduler yield 間の最大accessは **10,032** だった。

evidence log:
`C:\Users\donabe\Project\RevMem-pr125-fixverify-20260921\r003-sibling-budget-probe.log`

impact:
- large repositoryでExtension Hostを長い同期loopに拘束する。
- loop中はnewer generation / cancel / disposeを拒否できない。
- 既存R003 fixtureは「最初のyield」だけを見るため、この後続projection preparationを検出しない。

required action:
`progressByPath` 構築も `maxFilesPerStage` と同じ cooperative budget に含め、
budget checkpointごとに current generation を確認する。
10,000 current-evidence file fixtureで「隣接する全yield間」の最大workが128以下であることを固定する。

severity: Medium

## Validation assessment

reviewed current HEAD `94fceee9ab1e587b034131cb25bd3484e10dfdb6`:

- `npm run test:t610`: 77/77 pass
- focused T607:
  - large Global Tree bounded-stage: pass
  - 10,000-file projection accounting: pass
  - I124-R003 path-only first-yield fixture: pass
- `npm run test:t607`: 85/88
  - failure 3件は初回時からclean `origin/main` でも再現済みの既存baseline failureと同一
  - 新規test failureなし
- R002 cross-root probe: defect reproduced
- R004 sibling budget probe: defect reproduced

GitHub exact-head CI:
- HEAD: `94fceee9ab1e587b034131cb25bd3484e10dfdb6`
- run: `35601536693` / CI #4603
- status: completed
- conclusion: success
- artifact: `review-range-user-validation-0.1.55-pre+94fceee`
- artifact id: `10638638710`
- artifact head_sha: reviewed current HEAD と一致

CI success はR002/R004のcoverage gapを否定しない。

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_finding | R002 root isolation、R004 bounded projection |
| correctness / edge cases | checked_finding | cross-root same-remote/same-revision case |
| scope discipline | checked_no_finding | fix diffはfinding対応とrecord/trackingに限定 |
| changed files / direct dependencies | checked_finding | source/model/tests + repository identity dependencyを確認 |
| API / data / configuration / workflow / compatibility | checked_no_finding | workflow変更なし、exact-head CI success |
| error handling / failure diagnostics | checked_no_finding | R001 failure presentation closure確認 |
| security / secret handling | checked_no_finding | credential/secret exposure変更なし |
| tests / validation adequacy | checked_finding | R002 cross-root、R004 all-yield budget coverage不足 |
| current-HEAD CI evidence | checked_no_finding | exact-head run 35601536693 success |
| report / tracking / documentation accuracy | checked_no_finding | follow-up reportはtechnical HEADとadmin HEADを区別 |
| regression / maintainability risk | checked_finding | cross-root stale target、unbounded projection loop |

## Held / unexplored

- held: なし。
- unexplored: 実VSIXの手動視覚操作は実施していない。
  R001/R002/R004はいずれもactual source/runtimeまたはcurrent compiled modelで再現可能なため verdict を保留しない。

## Verdict

**fail**

- I124-R001 / High: closed
- I124-R002 / High: not closed
- I124-R003 / Medium: closed
- I124-R004 / Medium: new required finding

required finding が残るためPR #125は現 reviewed HEAD のままでは pass としない。

## 次のアクション

実装担当へ I124-R002 と I124-R004 を返す。

I124-R002:
- snapshot identityにcanonical repository root URI / scopeRootを含める。
- same remote + same revision + different root のactual composition Red→Greenを追加する。

I124-R004:
- `progressByPath` preparationをcooperative budgetへ含める。
- 10,000 current-evidence fileで全yield間work <= 128を固定する。

修正後は finding completeness matrix に
required action / production path / actual composition fixture / focused evidence
を揃え、同じnormal review chatで再度fix verificationする。

新HEADのCI確認では、その時点のPR current HEAD SHAとrun head SHAが一致するものだけを使用する。
mergeは行わない。

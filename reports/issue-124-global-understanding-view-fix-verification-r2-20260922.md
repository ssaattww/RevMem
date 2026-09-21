# Issue #124 / PR #125 Fix Verification R2

## メタデータ

- report type: verification report
- review mode: fix verification
- generated at: 2026-09-22T06:12:37+09:00
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- previous review record HEAD: `c139eefa6c39670f2516e786ba7bf1f8bdb4de2f`
- fix technical HEAD: `5358788110bd907f0ec54f7e14c67ee2b5b7888e`
- reviewed current HEAD: `69d177952549bf797abcf393678334a7bf216c03`
- execution environment: FA780 / Windows / PowerShell / RDC
- worktree: `C:\Users\donabe\Project\RevMem-issue124`
- verification capability: local_execution_available

## Reviewer continuity

初回review、前回fix verificationと同じnormal review chatで実施した。
finding IDとseverityは継続する。
## Verification scope

前回未解消だった次の2 findingをclosure対象とした。

- I124-R002 / High
- I124-R004 / Medium

I124-R001 / High と I124-R003 / Medium は前回closedのまま維持する。

fix diff `c139eef..69d1779` のproduction source/model、
追加fixture、follow-up report/handoff/tracking、
repository-root identityとbounded-stage contractを確認した。

## Finding completeness matrix

| Finding | Required action | Production path | Actual composition fixture | Focused evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| I124-R002 / High | retained snapshotをexact root + revisionで分離 | root-aware owner/evidence key | same-revision different-root T305 fixture | T610 78/78 | **closed** |
| I124-R004 / Medium | progress preparationを同一128-item budgetへ含め、隣接する全yield間workを128以下にする | incremental validator内でmap構築 | 10,000 current-evidence fixture | fixture自体はGreen / review probeで144 | **not closed** |

## I124-R002 / High — closed
`ownerIdentityKey` は `owner.target + scopeRoot`、
`ownerEvidenceKey` はそれに `currentRevisionId` を加える構成へ変更された。

opened evidence、PR evidence、retained snapshotは同じroot-aware keyを利用する。
same remote / same revision / different rootでもrootごとにidentityが分離される。

actual composition fixture
`I124-R002 isolates retained running files across same-revision repository roots`
はproduction T305 sourceを使い、root A成功後のroot B running publicationに
root Aのrow/open targetが存在しないことを確認している。

local evidence:
- `npm run test:t610`: 78/78 pass
- single-root R002 fixture: pass
- cross-root R002 fixture: pass

前回required actionとsibling caseを満たしているためI124-R002はclosedとする。

## I124-R004 / Medium — not closed

### 前回required action

`progressByPath` preparationを`maxFilesPerStage`と同じcooperative budgetへ含め、
checkpointごとにcurrent generationを確認する。
また、10,000 current-evidence fileで
**隣接する全scheduler yield間のworkが128以下**
であることをfixtureで固定することを要求した。

### 今回の実装

`progressByPath`構築は後段の無yield loopから
`validateTreeSnapshotIncrementally()` のprogress membership loopへ移された。
このloop自体は128件ごとにyieldし、`isCurrent()`を確認する。

この変更により前回の10,016件無yieldscanは解消している。

### Closureできない理由

追加fixture
`I124-R004 bounds current-evidence preparation between every scheduler yield`
が計測しているのは `progress.files` のnumeric index accessだけであり、
その直後に続くfile-node projection workを同じyield intervalへ加算していない。

current HEADのexternal review probeでは、
validationの最後に残る16件と、次phaseのfile-node projection 128件が
同一scheduler intervalに連続することを確認した。

結果:
- `maxFilesPerStage = 128`
- 隣接するyield間の計測work最大値: **144**

evidence:
`C:\Users\donabe\Project\RevMem-pr125-fixverify-r2-20260922\r004-all-work-budget-probe.log`
production code上も、incremental validatorが残余budgetを返却せず、
後続projection loopが独立した128件カウンタで開始するため、
phase境界でbudgetがリセットされる。

impact:
- design 19.1の「決定的item budgetでstageを区切る」契約を完全には満たさない。
- phase境界で1 intervalの同期workが設定budgetを超える。
- cancellation/newer generationがschedulerへ戻るまでの最大workが128を超える。

required action:
- validationからprojectionへ残余budgetを引き継ぐ、またはphase境界で必要なyieldを行う。
- validation / projectionを合算した実workを計測し、
  **すべての隣接yield間でwork <= maxFilesPerStage**
  を固定するfixtureへ修正する。

severityは前回どおりMediumを維持する。
I124-R004はnot closedとする。

## Validation assessment

reviewed current HEAD:
`69d177952549bf797abcf393678334a7bf216c03`

- `npm run test:t610`: 78/78 pass
- focused T607:
  - large Global Tree bounded-stage: pass
  - 10,000-file projection accounting: pass
  - I124-R003: pass
  - I124-R004 implementation fixture: pass
- `npm run test:t607`: 86/89
  - 失敗3件は以前clean `origin/main`でも再現済みのbaseline failureと同一
  - 今回fixによる追加test failureなし
- R004 all-work review probe: **144 > 128**, fail

GitHub exact-head CI:
- run: `35654398828` / CI #4611
- head_sha: `69d177952549bf797abcf393678334a7bf216c03`
- conclusion: success
- artifact: `review-range-user-validation-0.1.55-pre+69d1779`
- artifact id: `10663826855`
- artifact head_shaはreviewed current HEADと一致

CI successはR004のcoverage mismatchを否定しない。

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_finding | R004 stage budgetがphase境界で144 |
| correctness / edge cases | checked_no_finding | R002 cross-root sibling caseはGreen |
| scope discipline | checked_no_finding | fixはR002/R004とrecord/trackingに限定 |
| changed files / direct dependencies | checked_finding | source/model/testsとroot identityを確認 |
| API/data/config/workflow/compatibility | checked_no_finding | workflow変更なし、exact-head CI success |
| error handling / diagnostics | checked_no_finding | R001 closed状態を維持 |
| security / secret handling | checked_no_finding | secret/credential exposure変更なし |
| tests / validation adequacy | checked_finding | R004 fixtureが全workを計測していない |
| current-HEAD CI evidence | checked_no_finding | exact-head CI #4611 success |
| report / tracking / documentation accuracy | checked_finding | follow-up reportの「全yield interval <=128」はfixture計測範囲より強い主張 |
| regression / maintainability risk | checked_finding | phase境界でbounded scheduling契約未達 |

## Held / unexplored

- held: なし
- unexplored: 実VSIXの手動視覚smoke test
  - R004はcurrent compiled modelのdeterministic probeで判定可能なためverdictを保留しない。

## Verdict

**fail**

- I124-R001 / High: closed
- I124-R002 / High: closed
- I124-R003 / Medium: closed
- I124-R004 / Medium: not closed

required findingが1件残るため、現reviewed HEADをpassとしない。

## 次のアクション

実装担当へI124-R004だけを返す。
修正ではfinding completeness matrixに次を揃える。

- required action
- production path
- actual composition fixture
- focused evidence

fixtureは`progress.files` accessだけでなく、
validation残余workと後続projection workを同じcounterで数え、
すべての隣接yield間で`<= maxFilesPerStage`を検証する。

修正後は同じnormal review chatでI124-R004だけを再fix verificationする。
新HEADのCIはPR current HEADとrun head SHAが完全一致するrunだけを使用する。

mergeは行わない。

# Issue #124 / PR #125 Normal Fix Verification — Independent Findings R2

## メタデータ

- report type: verification report
- review mode: fix verification
- generated at: 2026-09-22T21:12:40+09:00
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base SHA: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- previous normal review record: `c120c7e46f7ca732113598672df52c0ce63260db`
- reviewed technical HEAD: `cd0f2a288e762d8d2406e78a6ca3bacea03bbdc8`
- pre-review current PR HEAD: `1a8d5ba8c46721f00236c31f0b61c06d4a8dbd28`
- execution: FA780 / Windows / PowerShell / Remote Desktop Commander
- verification capability: local_execution_available

## Reviewer continuity

Issue #124のinitial normal reviewおよびprior normal fix-verification roundsと同じnormal reviewerで実施した。
finding IDとseverityは独立reviewから変更していない。

## Review scope

前回normal fix verificationで未closureだった:

- I124-IFR-001 / High
- I124-IFR-002 / Low
- I124-IFR-003 / High
- I124-IFR-004 / Medium
- I124-IFR-005 / Medium

をfinding-limitedで再検証した。

technical delta:
`c120c7e..cd0f2a2`

post-technical administrative delta:
`cd0f2a2..1a8d5ba`

後者はreport / handoff / trackingのみで、production source/test/design/workflowに追加変更はない。
## Finding completeness matrix

| Finding | Required action | Production path | Actual committed fixture | Focused evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| I124-IFR-001 / High | stopped body access=0 + running→stopped prior row/progress/target retention | candidate-aware production reader + accepted-folder retention | stopped-body source fixture + mid-refresh source fixture + public STOP runtime fixture | targeted Green + reviewer probes | **closed** |
| I124-IFR-002 / Low | product normal closure後にtask/PR metadataをfinal stateへ同期 | task ledger + GitHub PR body | state comparison | final sync intentionally pending | **not closed** |
| I124-IFR-003 / High | actual source/runtime spinner regression | post-accept lifecycle publish | actual T305 source + VS Code runtime/provider | targeted Green + reviewer runtime probe | **closed** |
| I124-IFR-004 / Medium | actual PR non-diff path-only composition regression | sparse exact-HEAD target + conditional command | actual PR source + runtime/provider | targeted Green + reviewer runtime probe | **closed** |
| I124-IFR-005 / Medium | source-path stale work non-publication regression | bounded source-path scheduler + abort/current fence | 10k actual source canonicalize-abort fixture | targeted Green + reviewer cancellation probe | **closed** |

## I124-IFR-001 / High — closed

### stopped open-document body access

production open-document readerを
`src/composition/global-understanding/global-understanding-open-document-reader.ts`
へ分離し、candidate predicateを `getText()/lineAt()` より前に評価する契約へ変更した。

source側はcandidate setをcanonical predicateとしてreaderへ渡すため、
stopped/non-candidate open documentはbody materialization前に除外される。

committed regression:
`stopped sibling open-document bodies are filtered before Global evidence materialization`

reviewer production-reader probe:
`C:\Users\donabe\Project\RevMem-pr125-normal-fixverify-ifr-r2-20260922\ifr001-production-reader-probe.log`

結果:
- stopped `one`: body access 0
- active `two`: body access 3
- discovered paths: `one/a.ts`, `two/a.ts`
- stopped state保持
### running -> stopped during current refresh

sourceはrefresh開始時のactive setではなく、
current generationで `accept(...)` に成功したscopeだけを `acceptedFolders` として記録する。

final retained projectionは、
acceptedされなかったscopeのprevious row/progress/targetを保持する。

committed regressions:
- `a sibling stopped from its running publication retains prior file evidence after the refresh completes`
- `actual Global runtime stop command retains a running sibling file row and open target`

前回reviewer probeをcurrent compiled sourceへ再実行した結果:
- before: `one/a.ts, two/a.ts`
- running中にone stop
- after: `one/a.ts, two/a.ts`
- one state: stopped
- two state: active

previous row/target lossは解消した。

required action / production path / actual fixture / focused evidence が揃ったためclosed。

## I124-IFR-003 / High — closed

post-accept lifecycle publicationは維持され、
今回requiredだったactual source + actual VS Code runtime/provider fixtureがrepositoryへ追加された。

fixture:
`actual Global runtime shows a spinner only on the sibling that is still running`

reviewer probeでも:
- one: active / icon `folder`
- two: running / icon `loading~spin`

を確認。

独立review required regression cellを満たしたためclosed。

## I124-IFR-004 / Medium — closed

actual PR source + actual runtime/provider regressionがrepositoryへ追加された。

fixture:
`actual PR Global composition keeps an unchanged path-only row visible without an open command`

確認内容:
- changed.ts: visible / pull-request-head targetあり / open commandあり
- unchanged.ts: visible / targetなし / commandなし

source/unit分離ではなく1つのactual composition fixtureとして固定されたためclosed。
## I124-IFR-005 / Medium — closed

10,000-path actual source budget fixtureに加えて、
source-path scheduler中のstale/cancel publicationを固定するregressionが追加された。

fixture:
`actual Global source abort during path canonicalization never publishes a stale file projection`

確認内容:
- `source-path-canonicalize` でabort
- result: AbortError
- initial current lifecycle publicationは許可
- discovered/progress fileを含むstale projectionはpublishされない

reviewer前回probeの再実行でも同じbehaviorを確認。

bounded work + stale fenceのrequired actionを満たしたためclosed。

## I124-IFR-002 / Low — not closed

このfindingのrequired actionは、
**product findingsがnormal reviewerでclosedした後**に
task ledger / PR body / final HEAD / exact-head CI metadataを最終同期すること。

今回のreviewでIFR-001/003/004/005はclosed可能になったが、
review開始時のrecordは意図的に:

- normal review verdict: fail / re-verification pending
- IFR-002 final sync: pending
- tracking: normal再verification待ち

としている。

したがってproduct closure後のfinal syncはまだ実行されておらず、
IFR-002はnot closedを維持する。

次のimplementation passでtrackingとPR bodyをterminal normal-review stateへ同期し、
そのdeltaだけを同じnormal reviewerで確認する必要がある。

## Validation

current source / pre-review current HEAD:
`1a8d5ba8c46721f00236c31f0b61c06d4a8dbd28`

Reviewer rerun:
- `npm run compile:test`: pass
- required actual regressions:
  - IFR001 stopped body filter
  - IFR001 running→stopped source retention
  - IFR001 public STOP runtime retention
  - IFR003 actual runtime spinner
  - IFR004 actual PR non-diff runtime
  - IFR005 10k source budget
  - IFR005 source-path abort
  - **7/7 pass**
Implementation evidence on technical HEAD:
- `npm run test:t505`: 26/26
- `npm run test:t610`: 86/86
- performance focused: 6/6
- `npm run test:t607`: 89/92
  - 3 failures are known baseline failures reproduced on PR base
- build / lint / contracts / architecture positive+negative: Green
- default `npm test`: exit 0
- Extension Host: success

## Exact-head CI

pre-review current HEAD:
`1a8d5ba8c46721f00236c31f0b61c06d4a8dbd28`

matching run only:
- workflow: CI
- run id: `35725084722`
- run number: #4654
- conclusion: **success**
- artifact: `review-range-user-validation-0.1.55-pre+1a8d5ba`
- artifact id: `10693627553`
- artifact head SHA:
  `1a8d5ba8c46721f00236c31f0b61c06d4a8dbd28`

別SHAのrunは代用していない。

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_finding | product findings closed; IFR002 record-sync remains |
| correctness / edge cases | checked_no_finding | IFR001 stopped-body and mid-refresh stop sibling cases Green |
| scope discipline | checked_no_finding | technical delta limited to IFR fixes and required tests |
| changed files / direct dependencies | checked_no_finding | candidate reader, source retention, runtime composition tests reviewed |
| API/data/config/workflow/compatibility | checked_no_finding | readOpenDocuments contract update compiled across repo; PR sparse-open behavior stable |
| error handling / diagnostics | checked_no_finding | source-path AbortError/stale publication fence fixed |
| security / secret handling | checked_no_finding | no secret/credential change |
| tests / validation adequacy | checked_no_finding | independent required composition cells now committed |
| current-HEAD CI evidence | checked_no_finding | exact-head #4654 success |
| report / tracking / documentation accuracy | checked_finding | IFR002 final terminal sync still pending |
| regression / maintainability risk | checked_no_finding | prior uncovered defect classes now have committed regression fixtures |
## Held

- T607 known baseline failures 3件。
  - PR baseでも同じfailure classesを再現済み。
  - Issue #124 product acceptanceを阻害しない。
  - owner: repository maintenance / separate task。

## Unexplored

- installed VSIX manual visual smoke test。
  - actual source/runtime/provider regressionとexact-head CIがあり、
    finding closureには非blocking。

## Verdict

**fail**

Required finding:
- I124-IFR-002 / Low: **not closed**

Closed:
- I124-IFR-001 / High
- I124-IFR-003 / High
- I124-IFR-004 / Medium
- I124-IFR-005 / Medium

product findingsはnormal fix verificationでclosed。
残作業はIFR-002のfinal metadata synchronizationのみ。

## 次のアクション

implementation routeへIFR-002だけを返す。

1. `tasks/tasks-status.md` をnormal product closure済みの状態へ更新。
2. PR bodyをcurrent final HEAD / normal verdict / current exact-head CI stateへ同期。
3. 旧「normal re-verification待ち」「final sync未完」をcurrent stateとして残さない。
4. record/tracking commit後のPR current HEADを明記する。
5. matching current-HEAD CIがある場合のみそのrunを記録。なければ未実施とする。
6. 同じnormal reviewerへIFR-002だけを返す。
7. normal closure後、各findingを発行した同じindependent reviewerへlimited closure。
8. mergeしない。

# Issue #124 / PR #125 レビュー指摘対応 R3

## メタデータ

- report type: implementation report / review follow-up
- generated at: 2026-09-22
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- latest review-record HEAD: `700d9b40b06c7789d19cab22648088069a169213`
- fix technical HEAD: `8db0cafedadcce6db1ef9de5b0aa111de60721ef`
- implementation environment: FA780 / Windows / PowerShell / RDC
- record publication fallback: GitHub connector after FA780 disconnected

## 対象

再fix verification R2で未解消だった **I124-R004 / Mediumのみ** を修正した。

以下はnormal reviewでclosed済みのため変更対象外とした。

- I124-R001 / High
- I124-R002 / High
- I124-R003 / Medium

## I124-R004 / Medium

### Required action

validationからprojectionへ残るbudgetを引き継ぐかphase境界で必要なyieldを行い、
validationとprojectionを同じcounterで計測して、
すべての隣接scheduler yield間のworkを `maxFilesPerStage` 以下へ固定する。

### TDD Red

既存R004 fixtureを `progress.files` accessだけの計測から、
次のworkを同じcounterへ加算するall-work fixtureへ変更した。

1. validation中のcurrent-evidence `progress.files` access
2. 後続projectionの `built-file-node` work

review-record HEAD `700d9b40...` 上でRedを確認した。

- `maxFilesPerStage = 128`
- observed maximum validation/projection work between yields: **144**
- expected: `<= 128`

reviewで報告された「validation残余16 + projection128」のphase-boundary超過をproduction incremental model上で再現した。

### Production path

`validateTreeSnapshotIncrementally()` の完了直前で
`pendingValidationItems > 0` の場合にschedulerへ制御を返す。

- 残余validation budgetが0なら追加yieldしない。
- 残余がある場合だけ `yieldControl()` する。
- yield直後に `isCurrent()` を再確認し、stale generationならprojectionへ進まない。
- projectionは新しいscheduler intervalから開始する。

これによりvalidation末尾の残余workとprojectionの最初の128件が同一intervalへ連結されない。

### Actual composition / workload fixture

`I124-R004 bounds validation and projection work between every scheduler yield`

10,000 current-evidence fileでvalidation accessとfile-node projection workを同じcounterへ加算し、
各 `yieldControl` でcounterを確定・resetする。
全隣接intervalの最大workが128以下であることをassertする。

### Green evidence

technical HEAD `8db0cafedadcce6db1ef9de5b0aa111de60721ef`:

- R004 all-work fixture: pass
- R003 + R004 + existing bounded-stage focused: **4/4 pass**
- `npm run test:t610`: **78/78 pass**
- `npm run test:t607`: **86/89**
  - 3 failureは既にclean `origin/main`でも再現済みの既知baseline failureと同一
  - R004による新規failureなし
- `npm run lint`: pass

commit:
`8db0cafedadcce6db1ef9de5b0aa111de60721ef`
`fix: flush Global validation budget before projection`

## Static / default local gate

technical HEADで以下を確認した。

- `npm run build`: pass
- `npm run lint`: pass
- `npm run typecheck:contracts`: pass
- `npm run validate:architecture`: pass
- `npm run validate:architecture:negative`: expected 11 findings一致
- default `npm test`:
  - unit: 863 pass / 0 fail / 2 skip
  - Git integration: 35 pass / 0 fail / 3 skip
  - GitHub integration: 48/48 pass
  - T502: 11/11 pass
  - VS Code Extension Host phase開始後にFA780のRDC接続が切断したため、local processのterminal exitは取得できなかった

local full gateについて、確認できていないExtension Host terminalを成功へ丸めない。

## Technical HEAD CI

technical HEAD `8db0caf...` のpull_request CI run:
`35662709435` / CI #4615。

attempt 1:
- conclusion: failure
- failure step: T606 failure-policy tests内の
  `T604 uses an owned OS child-process lease and releases it for a successor`
- actual: `acquired`
- expected: `StorageRootLockTimeoutError`
- failure diagnostics artifact:
  `ci-failure-diagnostics-35662709435-1`
  artifact id `10667981517`
- Build / contracts / architecture / lint / unit / T602 / T603 / T403 / T404 / T405 / T406 /
  T304 / T502 / T503 / T504 / T505 / T506 / standalone T604 / T605 はfailure前までsuccess。

このT604 child-process timing failureは直前のreview-record HEADでもattempt 1で発生し、
同HEAD retryで成功した既知の不安定経路と同一で、R004のUI scheduling差分とは独立している。
same technical HEADのfailed job rerunを要求済み。

## Finding completeness matrix

| Finding | Required action | Production path | Actual fixture | Focused evidence |
| --- | --- | --- | --- | --- |
| I124-R004 / Medium | validation + projectionの全隣接yield intervalを128以下にする | validation残余があるphase境界でyieldしcurrent generation再確認 | 10,000 current-evidence all-work fixture | Red 144 → Green <=128、focused 4/4 |

## Intentionally untouched

- I124-R001 / High: closed済み
- I124-R002 / High: closed済み
- I124-R003 / Medium: closed済み
- repository root/evidence identity
- folder state machine
- PR Progress
- CI workflow
- T607既知baseline failure 3件

## 現在状態

I124-R004の実装とfocused/static/local主要phase検証は完了した。
normal review verdictは実装担当では変更しない。
同じnormal review chatによるI124-R004限定の再fix verificationが次のreview stepである。

このreport/handoff/tracking更新後のPR current HEADと完全一致するCI runだけを最終CI証拠とする。
別SHAのrunは代用しない。mergeは行わない。

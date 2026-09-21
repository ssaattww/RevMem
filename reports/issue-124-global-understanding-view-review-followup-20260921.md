# Issue #124 / PR #125 レビュー指摘対応レポート

## メタデータ

- report type: implementation report / review follow-up
- generated at: 2026-09-21T21:40:42+09:00
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- reviewed implementation HEAD: `4e6ddb45966ec96e7b5e16834f44af7e5858979d`
- review-record HEAD: `81d7d078cf8ecf4f7c3dc6464c487138e88d65d2`
- fix technical HEAD: `b4436d5a864b7133c78750e5dcece447d54f6c0e`
- execution: FA780 / Windows / PowerShell / RDC
- worktree: `C:\Users\donabe\Project\RevMem-issue124`

## 対象

初回normal reviewでrequiredとなった次の3 findingだけを修正した。

- I124-R001 / High: failed scope rowがrefresh errorでclearされる。
- I124-R002 / High: running publicationで既知file一覧が一時消える。
- I124-R003 / Medium: discovered path validationが最初のyield前に全件同期走査する。

関連しないT607既存failure、PR Progress、folder scope semanticsの再設計は変更していない。
## I124-R001 / High

### Required action

failed current generationをTreeへ公開し、actual providerでwarning iconと`開始` actionを維持する。

### Production path

- `T505GlobalUnderstandingSource.recalculate()` の非Abort failure pathで、`folderScopes.fail(...)`後にcurrent folder lifecycle snapshotを`publishProgress`する。
- `GlobalUnderstandingRefreshController.refresh()` はcurrent generationでprogress publication済みの場合、その後のsource errorでhostをclearしない。
- progressを一度もpublishしていない通常failureは従来どおりclearする。

### Actual composition fixture

`I124-R001 keeps the actual failed folder row visible and restartable after source failure`

real T305 Global source + actual VS Code Global runtime providerを組み、owner-shared capture failure後に`src` rowが`failed`、iconが`warning`、command titleが`開始`で残ることを確認する。

### TDD evidence

- Red: failed rowがproviderから消え、state取得が`undefined`。
- Green: R001 fixture pass。
- 既存`Global refresh clears stale presentation when the current recalculation fails`もpass。
- commit: `f46df7e5245f13ee514d89a861d6d3bb9ae94fd9`.
## I124-R002 / High

### Required action

成功済みsnapshotの後に同じscopeがrunningへ入っても、既知のpath-only file rowsを消さず、spinnerと`停止` actionを同時に表示する。

### Production path

- sourceへ`lastSnapshotByEvidenceKey`を追加し、owner identity + exact revisionごとの最後の成功snapshotを保持する。
- running / failed / stopped等のlifecycle publicationは`lifecycleSnapshot`で現在folder stateだけを更新し、同一revisionの既知file progress、discovered path、open target、diagnosticsを維持する。
- owner revision変更時は旧snapshot cacheをopened/PR evidenceと同時に破棄する。
- 成功したfinal snapshotだけを次generationの既知file projectionとして保存する。

### Actual composition fixture

`I124-R002 keeps known file rows while the actual source publishes a running generation`

129 direct filesを持つreal source + actual providerで、一度成功した後の次refreshをenumeration checkpointで停止する。running中もfile rowが129件のまま、`src` rowが`running`、`loading~spin`、`停止`であることを確認する。

### TDD evidence

- Red: running中のfile rowが129件から0件へ消失。
- Green: running中も129件を維持。
- `npm run test:t610`: 77/77 pass。
- commit: `12908695a094394bb4e754541290dc99aed5a9e2`.
## I124-R003 / Medium

### Required action

discovered path validationとprogress-path membership validationをcooperative/boundedにし、10,000 path-only fixtureでも最初のyieldまでのworkを`maxFilesPerStage=128`以内にする。

### Production path

`validateTreeSnapshotIncrementally()`のvalidationを次の順で同じ`pendingValidationItems` budgetへ統合した。

1. discovered file pathの非空・重複検証
2. progress fileがdiscovered setに含まれることの検証
3. open target重複検証

128 item到達ごとに`yieldControl()`し、その都度current generationを再確認する。同期版`createGlobalUnderstandingTreeModel()`のvalidatorは変更していない。

### Actual composition fixture

`I124-R003 bounds path-only validation before the first scheduler yield`

10,000 path-only entriesをProxyで計測し、最初のscheduler yieldまでのindex accessが128以下であることをactual incremental model上で固定した。

### TDD evidence

- Red: first yieldまで`10,128` path access。
- Green: fixture passし、128-item上限assertionを満たす。
- 既存257-file bounded-stage testと10,000-file projection accounting testもpass。
- commit: `b4436d5a864b7133c78750e5dcece447d54f6c0e`.
## 検証

technical HEAD `b4436d5a864b7133c78750e5dcece447d54f6c0e`で実施。

成功:
- `npm run build`
- `npm run lint`
- `npm run typecheck:contracts`
- `npm run validate:architecture`
- `npm run validate:architecture:negative` — expected 11 findings一致
- `npm run test:t610` — 77/77
- default `npm test` — exit code 0
  - unit: 863 pass / 0 fail / 2 skip
  - Git integration: 35 pass / 0 fail / 3 skip
  - GitHub integration: 48/48
  - T502: 11/11
  - VS Code Extension Host: runner全phase成功

`npm run test:t607`は85/88。失敗3件は初回実装時にclean `origin/main`でも同一再現済みの既存baseline failureであり、今回のfinding修正による追加failureはない。
## Finding completeness matrix

| Finding | Required action | Production path | Actual composition fixture | Focused evidence |
| --- | --- | --- | --- | --- |
| I124-R001 / High | failed rowを公開し開始actionを残す | source failure publish + refresh published-progress preserve | `I124-R001 keeps the actual failed folder row visible and restartable after source failure` | Red `undefined` → Green、T610 77/77 |
| I124-R002 / High | running中も既知file rowを維持 | exact owner/revision last snapshot + lifecycle projection | `I124-R002 keeps known file rows while the actual source publishes a running generation` | Red 0/129 → Green 129/129、spinner/停止確認 |
| I124-R003 / Medium | validationを128-item budgetへ収める | incremental shared validation budget | `I124-R003 bounds path-only validation before the first scheduler yield` | Red 10,128 access → Green、既存bounded tests Green |

## Intentionally untouched

- `FolderUnderstandingScopeController`のstate machine自体
- repository-wide本文scan禁止契約
- PR Progress
- CI workflow
- T607既存baseline failure 3件

## 現在状態

3 findingの実装とlocal validationは完了した。normal review verdictはこの実装担当では変更しない。同じnormal review chatによるfix verificationが次のreview stepである。

このreport、tracking、handoffをadministrative commitとしてpushした後、PR current HEADと完全一致するpull_request CIだけを確認する。別SHAのrunは代用しない。mergeは行わない。

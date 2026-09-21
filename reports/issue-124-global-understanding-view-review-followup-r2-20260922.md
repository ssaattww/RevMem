# Issue #124 / PR #125 レビュー指摘対応 R2

## メタデータ

- report type: implementation report / review follow-up
- generated at: 2026-09-22T05:55:32+09:00
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- latest review-record HEAD: `c139eefa6c39670f2516e786ba7bf1f8bdb4de2f`
- fix technical HEAD: `5358788110bd907f0ec54f7e14c67ee2b5b7888e`
- execution: FA780 / Windows / PowerShell / RDC

## 対象

前回fix verificationで残った2 findingのみを修正した。

- I124-R002 / High: same remote + same revision + different rootでretained snapshotが混線する。
- I124-R004 / Medium: `progressByPath`構築が全current-evidence fileを同期走査する。

I124-R001 / High と I124-R003 / Medium は前回reviewでclosed済みのため変更対象外とした。

## I124-R002 / High

### Required action

retained snapshot identityへcanonical repository root URI / scopeRootを含め、
same remote・same revisionでも別rootのrow/open targetを再利用しない。

### Production path

- `ownerIdentityKey`を`target + scopeRoot`で構成する。
- `ownerEvidenceKey`を`target + scopeRoot + currentRevisionId`で構成する。
- `activateEvidenceRevision`と`requireActiveEvidenceKey`は
  `scopeRoot(owner)`で得たcanonical root identityを必須とする。
- opened evidence、PR evidence、`lastSnapshotByEvidenceKey`は同じroot-aware evidence keyを共有する。

### Actual composition fixture

`I124-R002 isolates retained running files across same-revision repository roots`

同じrepositoryId・同じrevisionを持つroot A / root Bをproduction T305 sourceで切り替える。
root Aの成功snapshot作成後、root Bのrunning publicationにroot Aの`src/a.ts`および
root A working-tree open targetが存在しないことを固定した。

### TDD evidence

- Red: root B running snapshotへ`src/a.ts`が混入。
- Green: root B running snapshotのdiscovered paths / open targetsはいずれも空。
- 既存single-root I124-R002 fixtureもGreen。
- commit: `655b7dd8bf001e096eb884c3a612b053f2b005b3`.

## I124-R004 / Medium

### Required action

`progressByPath` preparationを`maxFilesPerStage`と同じcooperative budgetへ含め、
checkpointごとにcurrent generationを確認する。
10,000 current-evidence fileで隣接する全yield間workを128件以下に固定する。

### Production path

- `ValidatedTreeSnapshot`へ`progressByPath`を追加した。
- incremental validatorがprogress membershipを検証する同じloopでmapを構築する。
- validation budgetの128件checkpointと`isCurrent()`確認をそのまま適用する。
- `createGlobalUnderstandingTreeModelIncrementally()`後段の無yield全件scanを削除した。
- 同期版Tree modelもvalidatorが構築した同じmapを利用し、duplicate path契約を維持する。

### Actual composition fixture

`I124-R004 bounds current-evidence preparation between every scheduler yield`

10,000 current-evidence fileの`progress.files`をProxyで計測し、
各`yieldControl`間のnumeric index access最大値が128以下であることを検証する。

### TDD evidence

- Red: 最大`10,016` progress-file access。
- Green: 全yield intervalが128件以内。
- R003 fixture、257-file bounded-stage、10,000-file projection accountingもGreen。
- commit: `5358788110bd907f0ec54f7e14c67ee2b5b7888e`.

## 検証

technical HEAD `5358788110bd907f0ec54f7e14c67ee2b5b7888e`で実施。

Focused:
- I124-R002 single-root + cross-root: 2/2 pass
- I124-R003/R004 + existing bounded-stage probes: 4/4 pass
- `npm run test:t610`: 78/78 pass
- `npm run test:t607`: 86/89
  - failure 3件は既にclean `origin/main`で再現済みのbaseline failureと同一
  - 今回のR002/R004による新規failureなし

Static:
- `npm run build`: pass
- `npm run lint`: pass
- `npm run typecheck:contracts`: pass
- `npm run validate:architecture`: pass
- `npm run validate:architecture:negative`: expected 11 findings一致

Default full local gate:
- `npm test`: exit code 0
- unit: 863 pass / 0 fail / 2 skip
- Git integration: 35 pass / 0 fail / 3 skip
- GitHub integration: 48/48
- T502: 11/11
- VS Code Extension Host: runner全phase成功

## Finding completeness matrix

| Finding | Required action | Production path | Actual composition fixture | Focused evidence |
| --- | --- | --- | --- | --- |
| I124-R002 / High | exact root + revisionだけでsnapshotを再利用 | root-aware owner/evidence key | same-revision different-root actual T305 source fixture | Red root-A row leak → Green、T610 78/78 |
| I124-R004 / Medium | progress preparationを128-item budget化 | incremental validator内でmap構築 | 10,000 current-evidence all-yield fixture | Red 10,016 → Green <=128、bounded 4/4 |

## Intentionally untouched

- I124-R001 / High: closed済み
- I124-R003 / Medium: closed済み
- `FolderUnderstandingScopeController` state machine
- repository-wide本文scan禁止契約
- PR Progress
- CI workflow
- 既知T607 baseline failure 3件

## 現在状態

R002/R004の実装とlocal validationは完了した。
normal review verdictは実装担当では変更しない。
同じnormal review chatによる再fix verificationが次のreview stepである。

このreport/tracking/handoffをadministrative commitとしてpushした後、
PR current HEADと完全一致するpull_request CIのみを確認する。
別SHAのrunは代用せず、mergeは行わない。

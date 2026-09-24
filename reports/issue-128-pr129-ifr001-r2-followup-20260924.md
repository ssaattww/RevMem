# Issue #128 / PR #129 I129-IFR-001 R2 Follow-up

## Metadata

- generated_at: 2026-09-24T12:32:30+09:00
- repository: ssaattww/RevMem
- issue: #128
- pull_request: #129
- branch: fix/issue-128-global-understanding-folder-scan
- independent_closure_reviewed_head: 893ab7d94368ab0366d5afaf4898206c5cf28d27
- independent_closure_record_head: 50132abaccce82c5eb63ef8831930109acc0fc70
- tracking_head: 4c8266c26416e78c147ccde541d8c0970c937010
- red_test_head: 4fa17efe7f88983a7f36da8476f0f634d017ad85
- fix_head: 2a0369301c140d758a3fdba2d6a07aca080b617d
- merge: not performed

## Scope

Independent closure re-reviewで唯一openだった I129-IFR-001 の追加対応のみを行った。
I129-IFR-002〜004はclosed済みのため製品経路を変更していない。

前回fixでcurrent-generation line evidence自体はfailure-time partial snapshotへ保持できるようになったが、
accepted successful scopeの opened/unopened classification、excluded file count、
pruned excluded directory count が previous snapshot由来のままでcurrent generation metadataを反映していなかった。

## TDD Red

製品コード変更前にactual composition回帰を2件追加した。

Red-only HEAD:
`4fa17efe7f88983a7f36da8476f0f634d017ad85`

### Opened metadata

- root `root.txt`: production open-document readerから2 non-empty lines
- child `child/bad.txt`: shared capture後に削除してENOENT
- repository totalは既存fixにより2を保持
- actual openedFileCount: 0
- expected openedFileCount: 1
- actual unopenedFileCount: 2
- expected unopenedFileCount: 1

Observed Red:
`0 != 1`

### Exclusion metadata

- root `root.txt`: 2 non-empty lines
- root `payload.bin`: NUL binary、dynamic excluded file
- root `node_modules/...`: excluded/pruned directory
- child `child/bad.txt`: shared capture後にENOENT

Observed Red:
- actual [excludedFileCount, prunedExcludedDirectoryCount] = [0, 0]
- expected = [1, 1]

## Production fix

Fix HEAD:
`2a0369301c140d758a3fdba2d6a07aca080b617d`

`lifecycleSnapshot` がfailure-time partial publication用にcurrent-generation metadataを受け取れるよう拡張した。

- current progress files
- current opened-path classification
- current excluded file count
- current pruned excluded directory count

scope failure時は、recalculation local stateで既にaccept済みのこれらmetadataを
`lifecycleSnapshot` に渡す。

これにより、previous snapshotへ退行せず、現在成功済みscopeで確定したmetadataをpartial snapshotへ反映する。
通常のfinal snapshot計算やrepository-wide scan境界は変更していない。

## Green evidence

Focused result:
- existing line-evidence partial regression: pass
- opened metadata regression: pass
- exclusion/pruned metadata regression: pass
- focused total: 3/3 pass

Expected values:
- repository partial total: 0/2
- root file row: 0/2
- opened root fixture: opened=1 / unopened=1
- exclusion fixture: excluded=1 / prunedExcludedDirectoryCount=1
- child scope: failed

## Validation

Validated fix HEAD:
`2a0369301c140d758a3fdba2d6a07aca080b617d`

- focused I129-IFR-001 R2 + existing partial regression: 3/3 pass
- `npm run test:t610`: 98/98 pass
- `npm run build`: pass
- `npm run typecheck:contracts`: pass
- `npm run validate:architecture`: pass
- `npm run validate:architecture:negative`: pass
- `npm run lint`: pass
- `npm test`: pass / exit 0
- unit phase: 865 pass / 2 skip / 0 fail
- VS Code Extension Host phases: success

Logs:
- `test-output/issue128/ifr001-r2-red/`
- `test-output/issue128/ifr001-r2-final/`

Per the user's 2026-09-24 instruction, successful local validation is sufficient and final CI completion is not awaited.
If CI evidence is referenced later, only the workflow run whose head SHA exactly matches the referenced PR HEAD is valid.

## Closure matrix

| Required action | Production path | Red | Green |
| --- | --- | --- | --- |
| retain opened/unopened classification | T505 scope success -> failure-time lifecycleSnapshot | opened 0 != 1 | opened 1 / unopened 1 |
| retain excluded file count | dynamic binary exclusion -> failure-time lifecycleSnapshot | excluded 0 != 1 | excluded 1 |
| retain pruned excluded directory count | path enumeration -> failure-time lifecycleSnapshot | pruned 0 != 1 | pruned 1 |
| preserve known line evidence | current progress merge | already fixed | partial 0/2 + root row 0/2 |

## Commits

- `4c8266c` — track IFR-001 R2
- `4fa17ef` — Red-only metadata regressions
- `2a03693` — retain current-generation partial metadata

## Next action

Return to the same independent reviewer for I129-IFR-001-only closure and CI delta review.
I129-IFR-002〜004 remain closed.
Do not merge.

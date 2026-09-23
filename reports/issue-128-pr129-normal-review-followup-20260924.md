# Issue #128 / PR #129 Normal Review Follow-up

## Metadata

- generated_at: 2026-09-24T07:16:00+09:00
- repository: ssaattww/RevMem
- issue: #128
- pull_request: #129
- branch: fix/issue-128-global-understanding-folder-scan
- reviewed_normal_head: 95471dc843d25a73e202f568974b2757128206ec
- red_test_head: d7481d143b6d3daa090764582f0a59291e5fd9f0
- fix_head: 1895d4101a78604acd843263c06bd8bd1732376f
- merge: not performed

## Summary

Normal review の I128-NR-001〜003 に対応した。
I128-NR-001/002 はtest-only commitでRedを固定してから製品コードを修正した。
I128-NR-003 は過去のTDD時系列を捏造せず、original chronologyをunverifiedへ訂正した。

## I128-NR-001

Required action:
explicit-folder filesystem fallbackでも既存binary / invalid UTF-8分類を維持し、対象外fileをdenominatorへ入れない。

対応:
- repository enumeratorのNUL binary判定を共有関数化した。
- Node Global filesystem sourceはbinary / invalid UTF-8をtyped exclusionとして返す。
- folder sourceはtyped exclusionをscope failureにせずdynamic excluded fileとして扱う。
- dynamic exclusionはdiscovered pathから除外し、excludedFileCountへ加算する。
TDD evidence:
- Red HEAD: d7481d143b6d3daa090764582f0a59291e5fd9f0
- binary fixture: actual total 1, expected 0。
- invalid UTF-8 fixture: content load例外、expected exclusion。
- CI #4694 / run 35924811150: T610 failure。
- failure artifact: ci-failure-diagnostics-35924811150-1 / id 10779260305。
- Green HEAD: 1895d4101a78604acd843263c06bd8bd1732376f。
- NUL binary / invalid UTF-8 ともtotal 0、progress fileなし、excludedFileCount 1、complete scope。

## I128-NR-002

Required action:
pull-request ownerでimmutable PR HEAD evidenceがないpathをworking-tree本文から補完しない。

対応:
- explicit-folder filesystem fallbackをnon-PR ownerだけへ限定した。
- PR ownerはreadPullRequestHeadFilesが返したimmutable evidenceだけをline evidenceへ昇格する。
- immutable evidenceのないpathはdiscovered path-only / uncollectedのまま保持する。

TDD evidence:
- Red HEAD: d7481d143b6d3daa090764582f0a59291e5fd9f0。
- fixture: PR HEAD changed.ts=1行、working-tree unchanged.ts=2行。
- Red: actual total 3, expected 1。
- Green HEAD: 1895d4101a78604acd843263c06bd8bd1732376f。
- Green: total 1、progress.filesはchanged.tsのみ、unchanged.tsはpath-only。
## I128-NR-003

Required action:
I128-IMPL-001のRed-before-Green証拠を捏造せず、存在しない場合はunverifiedと記録する。

対応:
- tasks/tasks-status.md のI128-IMPL-001記録を original TDD Red chronology=unverified へ訂正した。
- original implementation reportへ同じ訂正を追記した。
- pre-implementation HEADでの後日再現はTDD chronologyと明確に分離した。

Retrospective reproduction:
- base source HEAD: af71e1f9571380853c4753537620e1b04c9cf38d
- temporary regression-test patch hash: 9aa843440c36c5f20516efbb21a5e58479db5801
- compile:test: pass
- focused test: fail
- observed: actual 0 / expected 5
- この再現は元実装が要求を満たさなかった証拠であり、当時Redを先に実行した証拠ではない。

## Local validation on fix HEAD

fix HEAD: 1895d4101a78604acd843263c06bd8bd1732376f

- new/affected focused tests: 5/5 pass
- npm run test:t610: 94/94 pass
- T503/T504 related regression: 23/23 pass
- npm run test:t606: 223 pass / 2 skip / 0 fail
- npm run build: pass
- npm run typecheck:contracts: pass
- npm run validate:architecture: pass
- npm run validate:architecture:negative: pass
- npm run lint: pass
- npm test: pass
## Finding closure matrix

| Finding | Required action | Production path | Actual composition fixture | Focused evidence |
| --- | --- | --- | --- | --- |
| I128-NR-001 | same binary/encoding exclusion | NodeGlobalUnderstandingFileSource -> T505 source dynamic exclusion | NUL binary + invalid UTF-8 explicit root start | Red d7481d1, Green 1895d41, T610 94/94 |
| I128-NR-002 | no mutable fallback in PR | T505 source owner.target.kind pull-request fence | immutable changed.ts + local-only unchanged.ts | Red 3!=1, Green total 1 |
| I128-NR-003 | honest evidence correction | tracking/report only | af71e1f retrospective reproduction | chronology marked unverified; NR001/002 have preserved Red CI artifact |

## CI handling

Red evidence CI:
- test-only HEAD d7481d143b6d3daa090764582f0a59291e5fd9f0
- CI #4694 / run 35924811150: failure at T610 as expected
- failure diagnostics artifact id 10779260305
- artifact workflow head SHA matches d7481d1

Final exact-head CI:
- pending metadata commit at report creation time
- only a run whose head SHA equals the then-current PR #129 HEAD is valid
- no prior SHA run will be substituted

## Remaining work

- commit/push this report, corrected tracking, and handoff
- rerun exact final-head local gate
- verify current PR HEAD and matching pull_request CI
- post concise PR follow-up comment
- request same normal reviewer finding-limited fix verification
- do not merge

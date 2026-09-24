# Issue #128 / PR #129 Independent Review Follow-up

## Metadata

- generated_at: 2026-09-24T10:46:05+09:00
- repository: ssaattww/RevMem
- issue: #128
- pull_request: #129
- branch: fix/issue-128-global-understanding-folder-scan
- independent_reviewed_head: 8d09587e27396027ad808c312ab46e826ebddb19
- review_record_head: 2f2c568a72a54cb9c62704b8c49a9703eb66a720
- tracking_head: 45fdff7fe17a8a8a82e0010e5249e37426b8c359
- red_test_head: 3b29d2b5d3d7261adfa0c42e2a2a6f8064e86c9d
- ifr001_fix_head: 84592ff896f7ed6ca3c2234e2f1e9772acc74e9b
- ifr002_ifr003_fix_head: 3e4d9ad2a7f3ce5115adc25dd77ce856f5d7efb4
- validated_candidate: 4387d09767d5874f3c25848f1f18e78012f0af20
- merge: not performed

## Summary

Independent final review findings I129-IFR-001〜004 を対応した。
I129-IFR-001〜003 は product code を変更する前に focused Red を保存し、その後 Green 化した。
I129-IFR-004 は normal review closure済みの状態へ task ledger を同期した。
## I129-IFR-001

Finding:
success済み root scope の line evidence が、後続 child scope の ENOENT failure 時に partial lifecycle snapshot から落ちていた。

Red:
- Red HEAD: `3b29d2b5d3d7261adfa0c42e2a2a6f8064e86c9d`
- root.txt: 2 non-empty lines
- child/bad.txt: shared capture後に削除して ENOENT
- actual repository total: 0
- expected repository total: 2
- root folder totalは2のままだが、repository progressとroot rowが未収集へ退行していた。

Fix:
- `lifecycleSnapshot` へ current recalculation でaccept済みの progress files を渡せるようにした。
- previous snapshotだけでなく current-generation success evidence を path単位でmergeする。
- 後続scope failure publicationで current success evidence を渡す。
- fix HEAD: `84592ff896f7ed6ca3c2234e2f1e9772acc74e9b`

Green:
- repository partial total: 0/2
- root.txt row: 0/2
- root folder total: 2
- child folder: failed
- partial statusは percentage complete として扱わない。
## I129-IFR-002

Finding:
`NodeGlobalUnderstandingFileSource.load` が `AbortSignal` を受け取っても bounded content analysis 中に確認せず、abort後も残りchunkを処理していた。

Red:
- Red HEAD: `3b29d2b5d3d7261adfa0c42e2a2a6f8064e86c9d`
- 256 KiB file / maxWorkBytes=1024
- first yield で abort
- actual: load fulfilled
- expected: AbortError
- independent reviewでは remaining 255 yields が継続していた。

Fix:
- load開始前、lstat/readFile後、各analysis chunk前後、yield復帰後、final publish前に `signal.aborted` を確認。
- abort時は `DOMException(..., "AbortError")` をthrow。
- fix HEAD: `3e4d9ad2a7f3ce5115adc25dd77ce856f5d7efb4`

Green:
- first yield後にAbortError
- additional yieldなし
- focused regression pass。

## I129-IFR-003

Finding:
invalid UTF-8解析中にfileがvalid contentへ変化した場合、`NodeGlobalUnderstandingFileExcludedError` が final stability check を迂回し、stale exclusionを採用できた。
Red:
- Red HEAD: `3b29d2b5d3d7261adfa0c42e2a2a6f8064e86c9d`
- first chunk後に invalid UTF-8 file を valid UTF-8へ置換
- actual: invalid-encoding exclusion
- expected: file changed while reading/analyzing

Fix:
- binary / invalid-encoding typed exclusionをcatchした時も、exclusionを再throwする前に abort check と final `assertStableRegularFile` を通す。
- fileが解析中に変化していれば stale exclusion を採用しない。
- fix HEAD: `3e4d9ad2a7f3ce5115adc25dd77ce856f5d7efb4`

Green:
- invalid→valid変更fixtureは file-changed error
- existing invalid UTF-8 exclusion contractは安定fileで維持。

## I129-IFR-004

Finding:
normal review I128-NR-001〜003 が全件closed後も、`tasks/tasks-status.md` に NR-002 / FINAL の normal reviewer待ち表記が残っていた。

Fix:
- I128-NR-002を `normal review closed` へ同期。
- I128-FINALを `independent findings対応中` へ同期。
- I129-IFR-004を `対応完了` へ同期。
- normal review closure履歴は保持し、independent finding対応へ現在状態を進めた。
- tracking sync HEAD: `4387d09767d5874f3c25848f1f18e78012f0af20`
## TDD evidence

- Red-only HEAD: `3b29d2b5d3d7261adfa0c42e2a2a6f8064e86c9d`
- focused Red:
  - IFR-001: repository total `0 != 2`
  - IFR-002: expected rejection missing; load fulfilled
  - IFR-003: stale `invalid-encoding` exclusion instead of file-changed error
- product fixes follow Red-only commit in separate commits.

## Validation

Validated candidate: `4387d09767d5874f3c25848f1f18e78012f0af20`

Focused:
- IFR-001/002/003: 3/3 pass
- `npm run test:t610`: 96/96 pass
- T504-related direct suites: 17/17 pass

Full local gate:
- `npm run build`: pass
- `npm run typecheck:contracts`: pass
- `npm run validate:architecture`: pass
- `npm run validate:architecture:negative`: expected 11 violations / pass
- `npm run lint`: pass
- `npm test`: pass / exit 0
- unit phase: 865 pass / 2 skip / 0 fail
- VS Code Extension Host phases: success

Logs:
- `test-output/issue128/independent-red/`
- `test-output/issue128/independent-final/`

Per the user's instruction, final CI completion is not a wait condition after successful local validation.
If CI evidence is referenced later, only a run whose head SHA matches the referenced PR HEAD may be used.
## Closure matrix

| Finding | Required action | Production path | Evidence | Status |
| --- | --- | --- | --- | --- |
| I129-IFR-001 | retain accepted current-generation evidence on sibling failure | T505 recalculate -> lifecycleSnapshot | Red total 0!=2; Green partial 0/2 + root row 0/2 | implementation complete |
| I129-IFR-002 | honor AbortSignal during bounded file analysis | NodeGlobalUnderstandingFileSource.load/analyzeContent | Red fulfilled after abort; Green first-yield AbortError | implementation complete |
| I129-IFR-003 | stability-check exclusion before acceptance | NodeGlobalUnderstandingFileSource exclusion path | Red stale invalid-encoding; Green file-changed error | implementation complete |
| I129-IFR-004 | synchronize ledger after normal closure | tasks/tasks-status.md | old normal-review wait removed | record correction complete |

## Commits

- `45fdff7` — track independent findings
- `3b29d2b` — Red-only regressions
- `84592ff` — retain accepted Global evidence on partial failure
- `3e4d9ad` — cancellation and exclusion stability fences
- `4387d09` — synchronize review tracking

## Next action

Return to the same independent reviewer for finding-limited closure of I129-IFR-001〜004.
Do not merge.

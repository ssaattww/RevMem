# Issue #128 / PR #129 Independent Findings Follow-up

## Metadata

- generated_at: 2026-09-24T10:44:42+09:00
- repository: ssaattww/RevMem
- issue: #128
- pull_request: #129
- branch: fix/issue-128-global-understanding-folder-scan
- independent_reviewed_head: 8d09587e27396027ad808c312ab46e826ebddb19
- independent_report_head: 2f2c568a72a54cb9c62704b8c49a9703eb66a720
- tracking_head: 45fdff7fe17a8a8a82e0010e5249e37426b8c359
- red_test_head: 3b29d2b5d3d7261adfa0c42e2a2a6f8064e86c9d
- ifr001_fix_head: 84592ff896f7ed6ca3c2234e2f1e9772acc74e9b
- ifr002_003_fix_head: 3e4d9ad2a7f3ce5115adc25dd77ce856f5d7efb4
- local_candidate_head: 4387d09767d5874f3c25848f1f18e78012f0af20
- execution_environment: FA780 / Windows / PowerShell / Remote Desktop Commander
- merge: not performed

## Summary

Independent final review の I129-IFR-001〜004 を対応した。
I129-IFR-001〜003 はtest-only commitでRedを固定してから製品コードを修正した。
I129-IFR-004 はnormal review closure済みの事実とindependent finding対応状態へtask ledgerを同期した。
## I129-IFR-001 — successful scope evidence retention

Red:
- root `root.txt` は2 non-empty linesで先に成功。
- child scope は後続content readでENOENT。
- Red-only HEAD `3b29d2b...` ではroot folder totalは2を保持する一方、
  repository progress totalは0、`root.txt` rowはuncollectedだった。
- focused assertion: repository total `0 != 2`。

Fix:
- `lifecycleSnapshot` がprevious snapshotだけでなくcurrent recalculationで既に成功した
  file progressを受け取れるようにした。
- scope failure publicationではcurrent-generationのaccepted `files` をpartial snapshotへ統合する。
- previous evidenceとのmergeはpath単位でcurrent progressを優先する。

Green:
- repository status: partial (0/2)
- `root.txt`: 0% (0/2)
- root folder known total: 2
- child folder: failed
- discovered pathsはroot/childの既知2件を保持。
- `npm run test:t610`: 96/96 pass。
## I129-IFR-002 — bounded filesystem cancellation

Red:
- 256 KiB file / maxWorkBytes=1024。
- first yieldでAbortControllerをabort。
- Red-only HEADではload()がfulfilledし、bounded workを最後まで継続した。

Fix:
- `NodeGlobalUnderstandingFileSource` に共有 `throwIfAborted` fenceを追加。
- filesystem read前後、analysis開始、各chunk開始、yield直後、analysis完了前にsignalを確認する。
- cancellationは `AbortError` で終了する。

Green:
- first yieldでabort後、追加chunk yieldなし。
- `load()` はAbortError reject。
- stale publication防止だけでなく、bounded work自体を停止する。

## I129-IFR-003 — exclusion stability validation

Red:
- first chunk後のyield中にinvalid UTF-8 fileをvalid UTF-8内容へ置換。
- Red-only HEADでは旧bufferのinvalid-encoding exclusionをそのまま返した。
Fix:
- binary / invalid-encoding のtyped exclusionをcatchした場合も、
  exclusionを確定する前に元のfile metadataに対するstability checkを必ず実行する。
- cancellation fenceもstability validationより先に確認する。
- 通常successful analysisのpost-analysis checkは従来どおり維持。

Green:
- invalid→valid変更fixtureはstale invalid-encoding exclusionを採用せず、
  `Included repository file changed while reading or analyzing` としてreject。
- T504関連回帰: 17/17 pass。

## I129-IFR-004 — tracking synchronization

- normal fix verification R2で I128-NR-001〜003 が全件closed済みであることを台帳へ反映。
- I128-NR-002の旧「reviewer確認待ち」を `normal review closed` へ更新。
- I128-FINALをnormal review待ちではなくindependent finding closure待ちへ更新。
- I129-IFR-004自体を対応完了へ同期。

## TDD evidence

- Red-only commit: `3b29d2b5d3d7261adfa0c42e2a2a6f8064e86c9d`
- I129-IFR-001 Red: repository total 0 / expected 2
- I129-IFR-002 Red: missing expected AbortError rejection
- I129-IFR-003 Red: stale `NodeGlobalUnderstandingFileExcludedError` instead of changed-file rejection
- Red stdout/stderr: `test-output/issue128/independent-red/`
## Commits

- `45fdff7fe17a8a8a82e0010e5249e37426b8c359` — track independent findings
- `3b29d2b5d3d7261adfa0c42e2a2a6f8064e86c9d` — Red-only regression tests
- `84592ff896f7ed6ca3c2234e2f1e9772acc74e9b` — retain accepted Global evidence in partial publication
- `3e4d9ad2a7f3ce5115adc25dd77ce856f5d7efb4` — cancellation and exclusion stability fences
- `4387d09767d5874f3c25848f1f18e78012f0af20` — synchronize tracking

## Local validation

Candidate `4387d09767d5874f3c25848f1f18e78012f0af20`:
- finding-focused: 3/3 pass
- `npm run test:t610`: 96/96 pass
- T504 related: 17/17 pass
- `npm run build`: pass
- `npm run typecheck:contracts`: pass
- `npm run validate:architecture`: pass
- `npm run validate:architecture:negative`: pass
- `npm run lint`: pass
- `npm test`: pass / exit 0
- VS Code Extension Host phases: succeeded

Full-gate logs:
`test-output/issue128/independent-final/`
## Verification policy and next action

Per the user's 2026-09-24 instruction, successful local testing is sufficient for this fix cycle;
final CI completion is not awaited.
If CI evidence is referenced later, only a workflow run whose head SHA exactly matches the referenced PR HEAD is valid.

Required next action:
- same independent reviewer performs finding-limited closure for I129-IFR-001〜004.
- verify the required-action / production-path / focused-evidence matrix only.
- do not merge.

## Closure matrix

| Finding | Required action | Production path | Evidence |
| --- | --- | --- | --- |
| I129-IFR-001 | retain accepted scope evidence in later partial publication | T505 scope loop -> lifecycleSnapshot current progress merge | Red 0!=2 at 3b29d2b; Green partial 0/2 at 84592ff+ |
| I129-IFR-002 | stop bounded content work on AbortSignal | NodeGlobalUnderstandingFileSource analyzeContent/load | Red fulfilled at 3b29d2b; Green AbortError + one yield at 3e4d9ad |
| I129-IFR-003 | validate stability before accepting exclusion | NodeGlobalUnderstandingFileSource exclusion catch | Red stale invalid-encoding at 3b29d2b; Green changed-file rejection at 3e4d9ad |
| I129-IFR-004 | synchronize closed normal review and independent work state | tasks/tasks-status.md | corrected at 4387d09 |

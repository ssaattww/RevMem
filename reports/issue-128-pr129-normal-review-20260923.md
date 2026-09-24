# Issue #128 / PR #129 Normal Review Report

## Metadata

- generated_at: 2026-09-23T23:24:03.1698122+09:00
- repository: ssaattww/RevMem
- issue: #128
- pull_request: #129
- review_mode: initial normal review
- reviewer: ChatGPT normal-review chat
- branch: fix/issue-128-global-understanding-folder-scan
- base: df1501358be6ad0e6e03989ddc9e08f67a6e1996
- reviewed_implementation_head: 255d8247fe7d9d97b8f9656f7ae2a4c6049be5b2
- execution_environment: FA780 / Windows / PowerShell / Remote Desktop Commander
- verification_capability: local_execution_available
- verdict: fail
- merge: not performed

## Purpose and scope

Issue #128 の要求、既存設計、PR #129 の全差分、直接依存、追加test、tracking/report、current-HEAD CI evidence を対象に通常レビューした。
実装修正は行わず、製品挙動を確認するための再現fixtureだけを reviewed worktree 外へ作成した。

## Authoritative contracts inspected

- Issue #128 acceptance: 明示folder startで未open fileを再帰集計し、既知file countを失敗後も保持し、partialをcomplete ratioとして表示せず、安全なfailure diagnosticsを出す。
- `doc/design/vscode-review-range-tracker-design.md` 11.3: direct resultの`included`はline-reviewableと確定したfileのみ。binary / fatal UTF-8 invalid encoding等は`excluded`。
- 同11.3/16.5: PR contextのimmutable PR snapshot契約を維持し、content evidenceがないpath-only rowは未収集のまま扱い、表示のためにworking-tree本文を追加読込しない。
- 同18: folder content read境界とprivacy-safe diagnostic。
- `.github/workflows/ci.yml`: failure時に`test-output/`、stdout/stderr、generated/source/test等をdiagnostic artifactへ保存する。

## Reviewed files and direct dependencies

- changed: `src/composition/global-understanding/global-understanding-source.ts`
- changed: `src/application/operation-feedback/operation-feedback.ts`
- changed: `src/ui/global-understanding/global-understanding-ui-model.ts`
- changed: `test/unit/t610-folder-understanding.test.ts`
- changed: `test/unit/global-understanding-ui.test.ts`
- changed: `tasks/tasks-status.md`, `tasks/phases-status.md`, implementation report/handoff
- direct dependency: `src/adapters/repository-files/node-global-understanding-file-source.ts`
- direct dependency: `src/adapters/repository-files/node-repository-file-enumerator.ts`
- direct dependency: `src/application/global-understanding/global-understanding-background-recalculator.ts`
- direct dependency: `src/application/global-understanding/folder-understanding-scope-controller.ts`

## Coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_finding | I128-NR-001, I128-NR-002 |
| correctness / edge cases | checked_finding | binary fixture, PR immutable-boundary fixture |
| scope discipline | checked_finding | PR context working-tree fallback expands evidence beyond immutable snapshot |
| changed files / direct dependency impact | checked_finding | changed composition path traced into both repository file adapters |
| API / data / compatibility | checked_finding | progress rows can now contain unopened files; PR revision evidence can mix with working-tree content |
| error handling / diagnostics | checked_no_finding | allowlisted structured diagnostic preserves original error identity and hides raw path/message |
| security / secret handling | checked_finding | I128-NR-002 permits local working-tree content to affect PR-context evidence |
| tests / validation adequacy | checked_finding | I128-NR-001/002 are not asserted by existing tests; I128-NR-003 TDD evidence gap |
| current-HEAD CI | checked_no_finding | run 35870419230 / CI #4689 matches reviewed HEAD and succeeded |
| report / tracking accuracy | checked_finding | I128-NR-003 |
| regression / maintainability risk | checked_finding | new generic filesystem fallback bypasses established classification and PR evidence boundaries |
| workflow / failure artifact | checked_no_finding | existing failure diagnostic artifact includes required logs/results |

## Findings

### I128-NR-001 — High — Explicit folder filesystem fallback bypasses binary / encoding classification

- origin: normal review
- location: `src/composition/global-understanding/global-understanding-source.ts:349-360`; direct dependency `src/adapters/repository-files/node-global-understanding-file-source.ts:63-155`
- contract: design 11.3/12 requires binary and non-reviewable encoding to be excluded from the Global denominator; the existing repository enumerator classifies NUL-containing content as binary.

Description:

PR #129 sends every path without opened evidence to `NodeGlobalUnderstandingFileSource`. That source performs fatal UTF-8 decode and line analysis but has no binary classification. The path enumerator deliberately calls the exclusion policy with `isBinary:false` because content classification is deferred, so the new fallback becomes the only remaining content gate and does not apply the established binary rule.

Impact:

A binary file containing NUL but otherwise valid UTF-8 is accepted as line evidence and changes Global Understanding totals. Invalid UTF-8 is turned into a scope failure instead of following the existing explicit exclusion contract. Repository contents with binary assets can therefore produce an incorrect denominator or an unnecessary failed/partial scope.

Direct reproduction on reviewed product source:

- fixture: one `payload.bin` containing bytes `00 41 0A`, no open documents, explicit root start.
- existing `NodeRepositoryFileEnumerator`: `included=[]`, `excluded=[payload.bin: binary]`.
- PR #129 production composition: `actualTotal=1`, progress row for `payload.bin`, `actualExcludedFileCount=0`.
- evidence file: `C:\Users\donabe\Project\RevMem-review-evidence\issue128-255d824\binary-contract-output.json`
- evidence SHA-256: `637A97304E0A49E402EC08AE207C901A2CD3D1C6166D67B043C1B88D2A8DFF4A`.

Required action:

Route explicit-folder filesystem evidence through the same content classification contract used by repository enumeration, or extend the file-source result so binary/invalid-encoding can be represented as exclusions rather than line evidence. Dynamic exclusions must contribute to `excludedFileCount` and never to the denominator. Add an actual `createT305GlobalUnderstandingSource` regression fixture with a NUL binary file and the authoritative invalid-encoding behavior.

### I128-NR-002 — High — PR context mixes working-tree content into immutable PR HEAD evidence

- origin: normal review
- location: `src/composition/global-understanding/global-understanding-source.ts:349-360`
- affected existing fixture: `test/unit/t610-folder-understanding.test.ts:874` (`actual PR Global composition keeps an unchanged path-only row visible without an open command`)
- contract: PR context keeps immutable PR HEAD evidence; unchanged/path-only rows without PR evidence remain uncollected and must not gain content by reading the working tree.

Description:

The new fallback runs for every `availablePaths` entry not already in `evidenceByPath`, regardless of owner kind. In a pull-request owner, `capturePullRequestHeadFiles` can intentionally return immutable evidence only for reviewable PR HEAD files. Any remaining path is then loaded from `owner.repositoryRoot` by `NodeGlobalUnderstandingFileSource` and tagged with the PR head revision supplied by the caller, even though the bytes came from the mutable working tree.

Impact:

PR Global Understanding can include unchanged, locally modified, or local-only working-tree content that is not in the immutable PR HEAD snapshot. This corrupts PR-context totals and breaks revision provenance; a local file can affect the PR denominator without a PR-head open target.

Direct reproduction on reviewed product source:

- PR HEAD provider returns only `changed.ts` with one non-empty line.
- working tree also contains `unchanged.ts` with two local lines.
- after opening `changed.ts`, PR #129 reports total `3` and includes both files in progress, while only `changed.ts` has a `pull-request-head` open target.
- evidence file: `C:\Users\donabe\Project\RevMem-review-evidence\issue128-255d824\pr-immutable-boundary-output.json`
- evidence SHA-256: `E95483C0656DF5F4C0C40D3DCB187C139B4C839840A62BFD23393A6B282E0835`.

Required action:

Do not use working-tree filesystem fallback for PR owners when immutable PR evidence is absent. Preserve such paths as path-only/uncollected unless an authoritative PR HEAD source supplies content. Add an actual PR composition regression asserting that an unchanged/local-only working-tree file does not enter `progress.files` or the PR denominator.

### I128-NR-003 — Medium — I128-IMPL-001 TDD Red is not demonstrated by the persisted evidence

- origin: normal review
- location: `reports/issue-128-global-understanding-folder-scan-implementation-20260923.md`, `test-output/issue128/red-test.stdout.log`, commit history `af71e1f..cea770b`
- contract: RevMem implementation work must add the regression test first and confirm Red before implementation.

Description:

The implementation report explicitly states that the implementing chat did not directly observe the I128-IMPL-001 Red and inherited only a tracking claim of `0 != 5`. The persisted file named `red-test.stdout.log` contains `pass 2 / fail 0`; the compile log is also successful. The product test and implementation were committed together in `cea770b`, so the commit graph does not independently prove the required Red sequence. By contrast, I128-IMPL-002 has a concrete persisted failing log showing `discoveredFilePaths` was `undefined`.

Impact:

The first TDD acceptance requirement is not auditable from the current repository/evidence set, and the implementation report overstates verification if read as direct proof that the Red was observed.

Required action:

Do not fabricate or retroactively claim a Red run. If an original pre-implementation Red artifact with a source fingerprint exists, attach/reference it; otherwise correct the tracking/report to state that I128-IMPL-001 Red is unverified. For the required I128-NR-001/002 fixes, add focused failing regressions and preserve their Red evidence before changing production code.

## Validation and CI

- worktree at review start: clean; branch `fix/issue-128-global-understanding-folder-scan`.
- reviewed implementation HEAD: `255d8247fe7d9d97b8f9656f7ae2a4c6049be5b2`.
- `3ffc3ad..255d824` changes only implementation report/handoff/task metadata; product source is unchanged from the technical source build.
- exact reviewed-HEAD workflow: run `35870419230`, CI `#4689`, conclusion `success`.
- all reported jobs succeeded, including build, type contracts, architecture positive/negative, lint, unit, T606, T609, T610, Git/GitHub integration, VS Code Extension Host, and packaging.
- exact-head user-validation artifact: id `10755445684`, `review-range-user-validation-0.1.56-pre+255d824`, artifact head SHA matches reviewed HEAD.
- CI success does not close I128-NR-001/002 because the required edge cases are absent from the suite.

## Existing test gaps that explain the Green CI

- Issue #128 added valid UTF-8 `.txt` filesystem coverage and invalid UTF-8 failure coverage, but no valid-UTF-8 NUL/binary classification fixture.
- the existing actual PR composition test verifies that an unchanged row has no open command, but does not assert that the row remains `uncollected` or absent from the line denominator.
- I128-IMPL-001 has no persisted failing Red run tied to a pre-implementation source fingerprint.

## Held / unexplored / intentionally untouched

- held: none.
- unexplored: manual VS Code UI interaction was not needed to establish the two production-path defects; composed runtime/data-path evidence was sufficient.
- intentionally untouched: implementation, design, workflows, task tracking, Issue/PR state, merge.

## Verdict and next action

`fail`.

I128-NR-001 and I128-NR-002 are required product fixes. I128-NR-003 requires evidence/report correction and proper TDD evidence for the follow-up fixes. The same normal reviewer should perform finding-limited fix verification after the fix chat supplies, for each finding, the required-action / production-path / actual composition-fixture / focused-evidence matrix. Merge was not performed.
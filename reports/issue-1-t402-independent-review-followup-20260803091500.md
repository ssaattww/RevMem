# T402 Independent Review Follow-up

## Metadata

- Report type: implementation follow-up report
- Repository: `ssaattww/RevMem`
- Pull request: `#40` (`task/t402-pr-diff-acquisition`)
- Task: `T402`
- Source independent-final-review report: `reports/issue-1-t402-independent-final-review-20260803062300.md`
- Reviewed implementation HEAD from source report: `1e2309d331aa908aa9cb90ebd96da821139f1af5`
- Current Git HEAD: `1e2309d331aa908aa9cb90ebd96da821139f1af5`
- Mode: one-pass implementation of only `T402-IFR-P1`, `T402-IFR-P2`, and `T402-IFR-P3`
- Commit, push, PR mutation, merge: not performed

This report records uncommitted follow-up implementation evidence. The current Git HEAD remains the source review target because this task expressly forbids committing. It is not a review verdict and does not attest a new implementation HEAD.

## Accepted scope and non-goals

Only the three required findings from the authoritative independent-final-review report were addressed:

- `T402-IFR-P1` High: prevent local Git textconv output from being used as immutable source-line coordinates.
- `T402-IFR-P2` High: prevent patchless zero-stat added, deleted, renamed, or copied binaries from bypassing immutable-content classification and shared binary exclusion.
- `T402-IFR-P3` Medium: synchronize T402, P4, and report references with the actual follow-up state.

T403-T405 runtime/cache/UI work, Issue #28 fixture portability, Issue #36, workflow changes, API expansion, design changes, breaking-change records, commit, push, PR mutation, and merge remain outside this scope.

## Design and standards disposition

The changes correct implementation behavior to the existing T402/T301 immutable-diff and binary-exclusion contracts. They add no public or protected API, schema, configuration, workflow, or user-facing contract. Design documentation and `Design/BreakingChanges.md` therefore remain unchanged. No new public/protected member requires XML documentation.

Repository Markdown lint wiring is absent: no `tools/lint/` directory and no `lint:md` package script are present. This report and the tracking updates were manually checked for wording and reference consistency; this is an unsupported Markdown-lint check, not a pass.

## Implemented finding follow-up

### T402-IFR-P1 — High — textconv-safe local Git diff

- Changed `src/adapters/local-git/local-git-pull-request-diff-adapter.ts` to pass `--no-textconv` with `--no-ext-diff` for every local diff invocation, including the harder-copy pass because both share `executeDiff`.
- Updated existing invocation-contract tests to require `--no-textconv`.
- Added a temporary real-Git-repository regression with `*.foo diff=foo` and `diff.foo.textconv = git hash-object`. It changes only actual line 2 and proves the acquired local snapshot has the raw deletion/addition text and line-2 coordinates.

### T402-IFR-P2 — High — fail closed until zero-stat content is classified

- Changed `src/application/github-pr-diff/github-patch-diff-builder.ts` so every non-`binary`, patchless zero-stat record is `missing-patch`, rather than accepting non-`modified` statuses as an empty patch snapshot.
- This sends added, deleted, renamed, and copied records through the existing exact base/head content fallback. Binary evidence becomes the existing shared `binary` file change and its T301 exclusion reason.
- Added one regression covering all four status variants with binary content, including content-read count and shared binary-exclusion assertions.
- Added a companion regression proving valid empty-text added content and rename-only text still return their original status with no hunks through the fallback.

### T402-IFR-P3 — Medium — authoritative progress synchronization

- Updated `tasks/tasks-status.md` T402 from `未着手` to follow-up implemented with normal fix verification pending, including both authoritative report references and remaining lifecycle gates.
- Updated `tasks/phases-status.md` P4 current progress with the source findings, this implementation batch, report references, and the remaining normal verification, exact-head CI, and fresh independent-final-review gates.

## Changed files

- `src/adapters/local-git/local-git-pull-request-diff-adapter.ts`: disable Git text conversion.
- `src/application/github-pr-diff/github-patch-diff-builder.ts`: route all patchless zero-stat nonbinary records to immutable content.
- `test/integration/t402-pr-diff-acquisition.test.ts`: retain argument-array contract coverage.
- `test/integration/t402-pr-diff-boundary.test.ts`: retain local adapter invocation contract coverage.
- `test/integration/t402-review-followup.test.ts`: add P1 real-Git and P2 binary/text fallback regressions.
- `tasks/tasks-status.md`, `tasks/phases-status.md`: synchronize T402/P4 state and report references.
- This report: implementation evidence only.

## TDD evidence

The user explicitly required TDD for this follow-up. Before implementation, `npm run test:t402` failed with the newly added P1/P2 regressions:

- P1 invocation contract expected `--no-textconv`, but the adapter omitted it.
- P2 added-binary fixture returned `github-patch` instead of `github-content`.

After the minimal implementation changes, the same focused command passed all 26 tests.

## Validation evidence

| Command | Result |
| --- | --- |
| `npm run test:t402` | passed: 26 passed, 0 failed |
| `npm run build` | passed |
| `npm run typecheck:contracts` | passed |
| `npm run validate:architecture` | passed |
| `npm run validate:architecture:negative` | passed: expected 11 violations reported |
| `npm run lint` | passed: 0 warnings allowed |
| `npm run test:git` | passed: 33 passed, 0 failed, 3 Windows/POSIX skips |
| `npm run test:github` | passed: 39 passed, 0 failed |
| `npm test` | stopped in `test:unit`: 366 passed, 19 failed, 2 skipped; all failures are the known Windows/POSIX fixture portability error `document path is outside the resolved Git working tree` tracked by Issue #28. Later chained suites did not run in this command; their relevant Git/GitHub suites were run separately above. |
| `git diff --check` | passed |

## origin/main integration evidence

`origin/main` at `974dd0a` is being merged into this worktree. The only conflict was `package.json`; it is resolved and staged without a merge commit. The resolved script wiring keeps the main-side `test:t502`, `test:t304`, expanded `test:unit`, and default `test` wiring, while retaining the PR #40 `test:t402` command and the T402 cases in `test:github`. There are no duplicate script keys.

The auto-merged `tasks/tasks-status.md` and `tasks/phases-status.md` retain T402, T502, T304, and T504 actual progress records. `type-fixtures/contracts/tsconfig.json` retains the T304 and T402 fixture entries; T502 and T504 do not define contract fixtures in this repository.

Integration validation after resolving the manifest:

| Command | Result |
| --- | --- |
| `npm run test:t402` | passed: 26 passed, 0 failed |
| `npm run test:t502` | passed: 11 passed, 0 failed |
| `npm run test:t304` | passed: 21 passed, 0 failed; includes package/CI contract and T502 default-wiring checks |
| T503/T504 focused node tests | passed: 23 passed, 0 failed |
| `npm run lint` | passed |
| `npm run package` | passed; VSIX packaged |
| `git diff --check` and `git diff --cached --check` | passed |

The merge remains in progress. No merge commit, ordinary commit, push, PR mutation, or merge was performed.

## Held, unknown, and intentionally untouched

- Held: Issue #28 owns the 19 broad-suite Windows/POSIX fixture portability failures; Issue #36 is outside the accepted follow-up scope.
- Unknown: no new unknowns found for the three targeted finding actions. Exact-head CI is unavailable until a later authorized commit and push.
- Intentionally untouched: T403-T405, all workflow/configuration/design/BreakingChanges files, existing source review report contents, and unrelated product code.

## Next action and boundaries

The parent must perform normal fix verification for only `T402-IFR-P1` through `T402-IFR-P3`, then an authorized commit/push, exact-head CI, and a fresh independent final review. No closure or independent-review verdict is issued here. No merge is authorized or performed.

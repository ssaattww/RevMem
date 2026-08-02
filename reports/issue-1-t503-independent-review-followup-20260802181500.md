# T503 Independent Review Follow-up

## Target and scope

- Pull Request: #34 `T503: repository file列挙とGlobal集計候補を実装`
- Branch: `task/t503-repository-file-enumeration`
- Reviewed implementation HEAD: `c0215bb3d715b152946c0e3eccae67a01ccc1985`
- Follow-up mode: independent-review finding implementation; this report addresses only `T503-IR-001` and `T503-IFR-001` through `T503-IFR-005`.
- Non-goals: a new independent-review perspective, completed normal-review rerun, nested `.gitignore` / full Git wildmatch compatibility, and Issue #28 Windows POSIX-path fixture failure.

## Design and tracking synchronization

`doc/design/vscode-review-range-tracker-design.md` now explicitly requires that a policy subtree may be pruned only when an explicit recursive glob proves every descendant excluded. It also records directory-only `.gitignore` entry-kind behavior and locale-independent code-unit path ordering. These are bug-fix clarifications of existing T300/T503 contracts, not breaking changes; `Design/BreakingChanges.md` is unchanged.

`tasks/tasks-status.md` now records the T503 PR #34 lifecycle, both independent-review report paths, its closure-only next action, and the existing-finding-only review policy. The parent will correct the already-posted PR comment's stale R4 report path after this change is committed; that external comment cannot be corrected from this implementation worktree.

## Finding closure implementation

| Finding | Implemented closure evidence |
| --- | --- |
| `T503-IR-001` | Added `ReviewFileExclusionPolicy.evaluateDirectory()`. It returns exclusion only for an explicit `/**` recursive glob whose compiled expression matches the directory boundary. `NodeRepositoryFileEnumerator` uses this decision instead of a synthetic `.enumeration-probe` child. Regressions cover `src/*`, `src/.*`, literal `.enumeration-probe`, and safe `src/**` pruning. |
| `T503-IFR-001` | `GitIgnoreRule` retains `directoryOnly`; matching receives `Dirent` entry kind and does not apply a trailing-slash rule to a regular file. Regressions cover a regular `cache`, directory `cache/`, and negated `!cache/`. |
| `T503-IFR-002` | Non-empty line counting now splits `CRLF`, `LF`, and lone `CR` separately. Regressions cover each separator, mixed separators, trailing separators, and empty/whitespace-only lines. |
| `T503-IFR-003` | Current task state, PR/report references, current action, and closure-only review policy were synchronized in `tasks/tasks-status.md`. The stale external PR comment path is explicitly assigned to the parent for correction after commit. |
| `T503-IFR-004` | File symlink creation is capability-aware on Windows: `EPERM`/`EACCES` skips only that optional assertion while all other T503 assertions execute. A Windows-only directory-junction regression verifies a privilege-free link is retained as `symbolic-link` and never traversed. Linux file-symlink coverage remains mandatory. |
| `T503-IFR-005` | Replaced `localeCompare("en")` with a locale-independent string code-unit comparator that returns non-zero for distinct path strings. The composed/decomposed `é.ts` pair now has deterministic output order. |

## Validation

| Command | Result |
| --- | --- |
| `npm run compile:test && node --test test-dist/test/unit/repository-file-enumerator.test.js` | pass: 7/7, including all six finding regressions and Windows junction coverage. |
| `npm run test:t300` | pass: 31/31. |
| `npm run compile` | pass. |
| `npm run lint` | pass. |
| `npm run typecheck:contracts` | pass. |
| `npm run validate:architecture` | pass. |
| `npm run validate:architecture:negative` | pass with expected 11 violations. |
| `git diff --check` | pass. |
| `npm run test:unit` | non-blocking held under Issue #28: 366 pass, 19 fail. Every failure is in unchanged document-review-state / Issue-13 fixture paths on Windows and reports `document path is outside the resolved Git working tree`; T503 focused and T300 suites pass. No duplicate issue is needed. |
| Markdown focused/full lint | unsupported: repository has neither `tools/lint/` configuration nor a `lint:md` script. No lint configuration was changed; ordinary prose was not wrapped in code formatting to evade a gate. |

## Next action

Commit and push these non-final changes, obtain exact-head CI, then have the same independent reviewer verify closure of only the six listed findings. Do not add a new review perspective or rerun normal review.

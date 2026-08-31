# PR #94 Issue #106 defer normal review

## Scope

PR94-CI-005 compatibility path and Issue #106 scope separation.

- Review mode: same Sol/high reviewer, bounded normal review
- Branch: `codex/pr94-ci-review`
- Reviewed immutable HEAD: `f842226f01a76f2117712e601cd74e99d1ddf528`
- Relevant range: `695f0528d2d027f3f6577379aeaf01c38cea9bec..f842226f01a76f2117712e601cd74e99d1ddf528`
- Verification capability: `local_execution_available`; local TypeScript compilation and focused Node tests are available.
- Non-goals: Issue #106 multi-context/shared-Global atomic redesign, different-HEAD Global ownership semantics, performance/Host/full-suite work, CI execution or waiting, independent review, implementation, commit, push, and merge.
- Allowed persistence: this pre-reserved normal-review report only. Persistence mode is `repository_file`; no report-attestation commit is authorized or created.

## Findings

No required or new findings.

### Compatibility condition — checked_no_finding

- `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts:165-182` admits the compatibility path only when Global is already at this transition's `targetHeadSha` and is not at `sourceHeadSha`. The ordinary single-context case (`Global == source`) continues through immutable snapshot capture; a Global revision equal to neither source nor target still enters the existing capture invariant and fails closed.
- Only the known sequential shared-Global shape skips snapshot capture, target snapshot restore, and new snapshot write-through. It still loads exact transition evidence, validates all source/base/target identities and required tracked blob text, parses the actual diff, and throws on unresolved Context mapping (`:183-258`). It neither fabricates a revision nor restores guessed reviewed ranges.
- Existing loaded persistence remains schema/snapshot validated by the repository recovery boundary. Corrupt ordinary single-context snapshots still fail through immutable capture/restore validation; the compatibility path does not consume snapshots as mapping evidence.

### Actual composition, CAS, and history — checked_no_finding

- `test/unit/t405-composition-regression.test.ts:779-825` reaches the real `reviewRange.redetectPullRequest` command, actual T405 synchronization loop, evidence loader, immutable PR mapper, filesystem repository, and history recorder. The command helper itself asserts that no UI/generic error was reported. The strengthened fixture proves PR #52, PR #53, their file revisions, and shared Global converge to the recovered target HEAD.
- The compatibility mapper returns the legacy actual-diff `mapped` disposition without partial snapshot restoration. `GitHubPullRequestContextStateService.update` retains one expected-current per-context CAS followed by `recordRevisionMapping` only after a successful commit (`src/application/github-pr-context/github-pull-request-context-layer-store.ts:133-149`). No new cross-context transaction or inferred history was introduced; all-or-nothing multi-context publication remains Issue #106 scope.
- Later assertions in the same production fixture continue to prove Context ownership isolation, shared-Global equality, context-owned append-only history, restart durability, and mark/unmark operations for both PR owners. The added PR #53 convergence assertions strengthen rather than replace those checks.

### Snapshot and fail-closed regressions — checked_no_finding

- The ordinary `Global == source` branch is unchanged semantically: capture, independent Context/Global restore, bounds validation, mixed mapping, and target snapshot capture remain enabled. The 18-test snapshot-focused run covers full/mixed hits, Global-only bounds, invalid snapshot rejection, actual loader evidence, base-only behavior, and store/CAS regressions.
- Non-target mismatches are not treated as compatibility. They reach `captureImmutableRevisionSnapshots`, whose Global/source-revision invariant throws before evidence mapping or publication. Incomplete tracked diff evidence and unresolved Context transitions also remain terminal.

### Windows/POSIX fixture — checked_no_finding

- `test/unit/t405-selected-pr-session.test.ts` replaces Windows-dependent `path.resolve("/repo")` values with canonical POSIX `/repo` values while keeping `fileSystemPathSemantics: "posix"`. Production ownership validation is untouched.
- The positive selected-PR owner assertions, stale-head rejection, foreign-root rejection, and no-state-creation assertions remain present. The fixture now tests the declared POSIX contract consistently on Windows rather than weakening ownership checks.

### Tracking and Issue #106 separation — checked_no_finding

- GitHub Issue #106 is open and explicitly owns different-PR-HEAD Global semantics, multi-context/shared-Global CAS, CAS-conflict no-publication, cancellation/stale/failure partial-state prevention, actual PR #52/#53 composition, and the no-performance-CI condition.
- `tasks/tasks-status.md:27-28`, `tasks/phases-status.md:40`, and the implementation report consistently limit PR94-CI-005 to a compatibility boundary and defer the redesign/data model to Issue #106. No design document or breaking-change claim was added for the deferred redesign.

### Coverage disposition summary

- Requirement/scope conformance: `checked_no_finding`.
- Correctness and sibling mismatch handling: `checked_no_finding`.
- Changed product, test, tracking, and report paths plus direct dependencies: `checked_no_finding`.
- API/data/config/workflow compatibility: `checked_no_finding`; no public API, schema, package, or workflow change.
- Error handling and diagnostics: `checked_no_finding`; generic command error absent and non-target mismatch remains fail closed.
- Security/secrets: `not_applicable`; no credential or logging change.
- Test adequacy and regression risk: `checked_no_finding` for the bounded criteria.
- Exact-head remote CI: `held`; not run or awaited in this review.
- Issue #106 redesign and multi-context atomicity: `held`, explicitly owned by Issue #106 and non-blocking for this compatibility review.
- Unexplored in-scope areas: none.

## Validation

- `npm run test:t405` — PASS, run once; includes `compile:test`; 57 passed, 0 failed.
- `node --test test-dist/test/unit/immutable-revision-review-snapshot.test.js test-dist/test/unit/github-pr-context-layer-store.test.js test-dist/test/unit/t405-revision-evidence.test.js` — PASS, run once; 18 passed, 0 failed.
- Deliberately not run: separate compile rerun, full/default suite, performance, Host, `test:t607`, remote CI, or CI waiting.
- Current execution state: technical HEAD committed locally; no commit was created by this review, push is unauthorized/not performed, CI wait is not required for this bounded local verdict, and the full local equivalence gate was not part of this review.
- Final identity/status: HEAD remained `f842226f01a76f2117712e601cd74e99d1ddf528`; the only working-tree delta is this reserved report.

## Verdict

`pass_with_held`

PR94-CI-005 satisfies the bounded compatibility requirements at reviewed HEAD `f842226f01a76f2117712e601cd74e99d1ddf528`, with no new finding, no blocker, no user-confirmation-required gap, and no in-scope unexplored branch. Held items are the intentionally deferred Issue #106 redesign and not-yet-obtained exact-head remote CI; neither blocks this normal-review verdict. The next authorized workflow action belongs to the parent: persist this normal report, then obtain exact-head required CI without starting independent review until the user directs it.

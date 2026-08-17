# T506 Review Follow-up R3 — T506-REV-002 real multi-instance regression

## Scope

- Repository: `ssaattww/RevMem`
- Pull request: #55
- Task: T506
- Branch: `task/t506-global-integration`
- Base: `main` (`146aec15783294da1795f268315c85d1a0dffa56`)
- Reviewed implementation head: `e704b12a3ebeabe41c6a270ff7590cc559bdd7b1`
- Finding addressed: `T506-REV-002` — High — `introduced_by_fix`
- `T506-REV-001` was already closed by reviewer fix verification before this R3 follow-up.

## Review finding

The R2 production fix moved state serialization to a module-shared storage-root queue and history serialization to a module-shared history-file queue. The remaining review finding was a verification gap: the prior GREEN concurrency test used one test-only `ControlledSharedRepository` and one shared history recorder/store. That test could remain GREEN even if the production module-shared queues later regressed back to instance-local queues.

The requested closure evidence was therefore a deterministic regression using separate production persistence objects over the same logical storage location:

1. separate real `FileSystemReviewStateRepository` instances using the same storage root,
2. an intentional state CAS race followed by stale detection/replan,
3. proof that both state changes survive,
4. separate real `JsonlReviewHistoryStore` and `ReviewHistoryRecorder` instances targeting one JSONL file,
5. proof that both history events survive.

## Diagnostic workflow

The repository already had the required failure-diagnostic workflow and no workflow modification was necessary.

`.github/workflows/ci.yml` executes commands through `tools/run-ci-command.mjs`. Failure diagnostics include per-command stdout, stderr, combined log, result metadata, environment information, git status, generated files, source, tests, tools, and configuration needed for investigation.

## TDD evidence

### RED

Test-only commit:

- `e12f13ad1b45775f8392745650fa63c28ffd68d2` — `test(t506): require real multi-instance concurrency regression`

The unit contract was changed first to require the real multi-instance regression in the canonical `test:t506` command. No regression implementation or focused wiring was present yet.

Exact-HEAD CI:

- HEAD: `e12f13ad1b45775f8392745650fa63c28ffd68d2`
- Workflow run: `31973152168`
- Job: `95228599576`
- Conclusion: `failure`
- Failing step: `Unit tests`
- Observed failure: `test:t506 must execute the real multi-instance state/history concurrency regression.`
- Build, contract typecheck, architecture validation, architecture negative contract, and lint all succeeded before the intended unit failure.
- Failure artifact: `9270342981` (`ci-failure-diagnostics-31973152168-1`)

No different-SHA run was substituted for this RED result.

### Regression implementation

Commits:

- `5f8c4fde831fcb45f96871a92e39df4f3f4375a7` — `test(t506): add real multi-instance persistence regression`
- `b40bbd9eb3e180c788f3d28ab8d3605616f5cef3` — `test(t506): wire real multi-instance regression into focused CI`

The intermediate HEAD `5f8c4fde831fcb45f96871a92e39df4f3f4375a7` still failed the intentionally unmet focused-command contract in run `31973302348`; compile/test compilation and lint succeeded, proving the new integration-test source compiled before it was wired into `test:t506`. Its failure artifact was `9270380582`.

## Permanent regression design

New file:

- `test/integration/t506-real-multi-instance-concurrency.integration.test.ts`

### State: separate real repository instances

The test creates two distinct `FileSystemReviewStateRepository` objects with the same `ReviewStateStorageUris`. Each repository receives its own `AtomicTextFileStore` wrapper object, while both wrappers delegate to one deterministic controlled backend representing the same storage.

The race is forced at the repository manifest path, which is the repository-style state publication pointer:

1. the edit-side repository starts a real `commit()` from the initial complete snapshot;
2. its first manifest replacement is blocked immediately before publication;
3. while it is blocked, the command-side repository starts a real `commit()` from the same old complete snapshot;
4. the first manifest write is released;
5. with the production module-shared storage-root queue intact, the second repository cannot perform its CAS comparison until the first commit is visible;
6. the second commit therefore rejects with `StaleReviewStateError`;
7. the command side reloads the latest complete snapshot, replans `markReviewedRanges`, and commits again.

The final persisted snapshot must simultaneously contain:

- file A edit mapping: reviewed intervals `[0,1)` and `[2,3)`, new content hash, and three-line metadata;
- file B command update: Context reviewed interval `[0,1)`;
- file B Global reviewed interval `[0,1)`.

If the production outer write queue is changed back from module-shared to instance-local, the competing repository can pass CAS against the old manifest while the first manifest publication is blocked. The stale assertion and final combined-state assertions then fail. The regression therefore directly protects the production cross-instance queue behavior rather than a test-only shared repository.

### History: separate real store/recorder instances

The history test creates:

- two distinct `JsonlReviewHistoryStore` objects,
- two distinct `ReviewHistoryRecorder` objects,
- separate atomic-store wrapper objects,
- one shared logical history path: `events-2026-08.jsonl`.

The first history file replacement is blocked before publication. A second recorder/store then appends concurrently to the same JSONL path. With the production module-shared file-path queue intact, the second append waits, rereads the first published event, and appends its own event.

The final JSONL must contain exactly both events:

- `invalidated-by-edit` / `event-edit`
- `marked-reviewed` / `event-command`

If the production history queue becomes instance-local, the second store can read the old empty file while the first replacement is blocked, allowing a later replacement to lose one event. The final count/type/event-ID assertions then fail.

## Production changes in R3

None.

The production module-shared state/history serialization behavior was already implemented by the R2 fix. R3 closes the reviewer-identified verification gap by making that exact multi-instance behavior a required focused regression.

## Focused CI integration

`package.json` now runs both T506 Node integration suites before the T506 Extension Host phases:

- `t506-global-multi-context.integration.test.js`
- `t506-real-multi-instance-concurrency.integration.test.js`
- `run-extension-host.js --t506`

`test/unit/ci-workflow-contract.test.ts` requires the new real multi-instance suite to remain in the canonical `test:t506` command.

## Technical GREEN

Technical implementation HEAD:

- `b40bbd9eb3e180c788f3d28ab8d3605616f5cef3`

Exact-HEAD workflow:

- Run: `31973380147`
- Conclusion: `success`
- HEAD SHA matched exactly; no other SHA was substituted.

Successful gates included:

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T602 history rewrite recovery tests
- T403 GitHub cache tests
- T404 GitHub PR context layer tests
- T304 PR progress tree tests
- T502 Global mapping and display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- T505 Global understanding tests
- T506 Global multi-context integration, including both new real multi-instance regressions
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

## Finding status

### T506-REV-002 — High — introduced_by_fix

Implementation response: **completed**.

The permanent regression now directly exercises the production multi-instance repository and history-store boundaries requested by the reviewer. Reviewer closure remains pending normal fix verification; the review thread is intentionally left unresolved by the implementation worker.

### T506-REV-001 — High

Already closed by reviewer fix verification before this R3 work. No additional implementation was made for it.

## Scope boundaries

- T604 cross-window / cross-process locking remains outside T506 R3 scope.
- No breaking change was introduced by R3.
- `tasks/tasks-status.md` was not modified because the dedicated task-management Skill is not present in this worker set.
- No merge was performed.

## Handoff

Lossless handoff:

- `handoffs/issue-1-t506-review-followup-r3-20260817062846.yaml`

After committing this report/handoff, the PR HEAD changes. The final PR CI verdict must therefore be taken only from a workflow run whose `head_sha` exactly equals that resulting docs HEAD; the technical GREEN run above must not be substituted for the final verdict.

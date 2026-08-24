# Issue #84 / PR #85 normal-review closure R2

## Review metadata

- Repository: `ssaattww/RevMem`
- Pull Request: #85 `Issue #84: PR Progressの競合解消と進捗診断の具体化`
- Review mode: fix verification / normal-review closure R2
- Reviewer continuity: same `chat-review-worker` normal-review chat as the prior PR85 review rounds
- Base ref: `main`
- Base SHA: `4535c2a3836c032cd7efaeaddbb543bedfcdb528`
- Reviewed implementation HEAD: `deff9453fc382abca8e71406ee16232379785672`
- Previous reviewed implementation HEAD: `760ec468ff957af10ceb77cf21b251e26e54c800`
- Technical fix HEAD inside the reviewed history: `fe67ab16b3d4b92aa8c91f284d04efb0e786b15e`
- Verification capability: `remote_ci_only`
- Verdict: `fail`
- Merge: not performed

## Scope

This round is finding-limited verification of the remaining normal-review findings:

- `PR85-NR-002` — High
- `PR85-NR-003` — Medium

`PR85-NR-001` was closed in the prior normal-review closure and was checked only for regression interaction; no regression was found in its fail-closed ordering contract.

## Authoritative requirements

The accepted design requires Review Contexts long-running work to expose privacy-safe count-only progress as work advances, and PR-file progress to belong to the PR Progress operation rather than Review Contexts, Global, or another concurrent operation. The selected PR Progress UI path is the production composition `refreshSelectedPullRequestProgress(...) -> PullRequestReviewRuntime.activateProgress(...)` from `src/t305-extension.ts`.

## Finding completeness matrix

| Finding | Required action | Production path | Actual composition fixture | Focused evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| PR85-NR-002 | Advance `pull-request-contexts` when each PR lifecycle synchronization completes, before later PRs finish; keep payload count-only | `T405ReviewContextsSource.load` -> `readSynchronizedRepository` -> `FetchGitHubPullRequestLifecycleAdapter.fetchCurrent` -> `reportSynchronizedPullRequest` | `test/unit/issue-84-pr85-review-closure-followup.test.ts` registers `registerT405ReviewContextsRuntime`, uses persisted PR #52/#53 and blocks the second actual lifecycle fetch | RED `eb69a472...` / run `32733580907`; intermediate `878cc492...` demonstrated `firstContextWasReported: true`; reviewed current-head CI `32772191903` is Green | complete / closed |
| PR85-NR-003 | Keep every PR-file count owned by selected PR Progress; Review Contexts/Global must not advance it; verify the actual selected PR Progress composition including cache-hit/recalculation behavior | Production selected Tree path is `refreshPullRequestProgressForSelection` -> `refreshSelectedPullRequestProgress` -> `PullRequestReviewRuntime.activateProgress` | Supplied fixture verifies Review Contexts through production composition, but selected-side assertion manually calls `feedback.run("PR進捗を計算", () => pullRequestReviewRuntime.getProgress(...))`; it does **not** execute `activateProgress`, the production Tree path | Current code adds cache-independent start/end reporting only to `getProgress`; `activateProgress` still reports file counts only when wrapped `readTextContent` is invoked. `readCachedFullText` skips that callback on a cache hit. Current-head CI is Green but does not cover this production path/cache-hit case | incomplete / open |

## Finding dispositions

### PR85-NR-002 — High — closed

The previous defect was that the PR-context counter advanced only after all persisted PR lifecycle synchronization for a repository had completed. The fix moves per-context completion reporting to the successful lifecycle boundary. It uses a `WeakMap<OperationFeedbackContext, Set<string>>` to deduplicate identities within an operation and emits only the allowlisted `pull-request-contexts` stage plus a count.

The focused production-composition test creates two persisted PR contexts, starts a real `registerT405ReviewContextsRuntime` refresh, blocks the second GitHub lifecycle request, and observes `completed=1` before releasing it. This directly closes the required action and the prior sibling case.

No identifying repository path, PR title, file path, source content, credential, or token is placed in the progress payload.

### PR85-NR-003 — Medium — open

The Review Contexts half of this finding is fixed: a caller that supplies a `feedbackContext` to `PullRequestReviewRuntime.getProgress` now delegates to the base method without emitting `pull-request-files`, so Review Contexts no longer receives those start/end observations.

The selected PR Progress half is not verified against, and is not fully implemented on, the production Tree path. `src/t305-extension.ts` refreshes the selected PR Progress tree through `PullRequestReviewRuntime.activateProgress`, not `getProgress`. The new cache-independent start/end observations were added only to `getProgress` when no explicit context is supplied.

`activateProgress` creates `activeFileProgress`, then relies on the registration wrapper around `readTextContent` to emit `pull-request-files`. The base runtime's `lineReviewabilityFor` calls `readCachedFullText`; when an immutable full-text entry already exists, `readCachedFullText` returns the cached Promise without calling `registration.readTextContent`. Therefore a same-snapshot recalculation/cache-hit path can complete without any PR-file count observation from `activateProgress`.

The new regression test does not exercise this path. Its selected-side check manually opens a `PR進捗を計算` feedback operation and calls `pullRequestReviewRuntime.getProgress(...)`, which exactly exercises the newly added wrapper branch but bypasses `refreshPullRequestProgressForSelection -> activateProgress` used by the actual PR Progress Tree.

Impact: the ownership leak into Review Contexts is removed, but the user-facing selected PR Progress operation can still lose concrete `pull-request-files completed/total` diagnostics during a same-snapshot/cache-hit recalculation. This conflicts with the accepted long-running/count-only diagnostic contract and with the implementation report's claim that selected PR Progress remains concrete on cache hits.

Required action: put cache-independent start/end (and, where available, incremental) PR-file reporting on the actual `activateProgress` operation context, without reintroducing reporting for Review Contexts/Global reads. Replace or extend the focused regression so it invokes the production selected Tree composition (`refreshSelectedPullRequestProgress`/`activateProgress`) after priming the immutable full-text cache, and assert that all `pull-request-files` events remain under `PR進捗を計算` and concrete progress still appears.

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirement/design conformance | `checked_finding` | NR-003 selected Tree/cache-hit path remains incomplete |
| Correctness and edge cases | `checked_finding` | same-snapshot/cache-hit `activateProgress` can skip count observations |
| Scope discipline | `checked_no_finding` | fix changes are limited to the supplied findings/tests/reports |
| Changed files/direct dependencies | `checked_finding` | lifecycle adapter, PR runtime, T405 composition, focused tests inspected |
| API/data/config/workflow compatibility | `checked_no_finding` | no incompatible persistent data/config/workflow change found |
| Error handling/failure diagnostics | `checked_no_finding` | existing diagnostic artifact workflow remains present and exercised by RED runs |
| Security/secret handling | `checked_no_finding` | structured progress remains count-only; no identifying payload added |
| Tests/validation adequacy | `checked_finding` | NR-003 fixture bypasses actual selected PR Tree composition |
| Current-HEAD CI | `checked_no_finding` | exact current reviewed HEAD `deff945...` run `32772191903` succeeded through all gates |
| Report/tracking/documentation accuracy | `checked_finding` | implementation report overstates cache-hit selected-tree coverage because it tests `getProgress`, not production `activateProgress` |
| Regression/maintainability | `checked_finding` | diagnostic behavior is split between `getProgress` and `activateProgress`; only the former has cache-independent start/end reporting |

## Validation assessment

### Exact reviewed-HEAD CI

Accepted CI evidence belongs to reviewed HEAD `deff9453fc382abca8e71406ee16232379785672` only:

- Workflow: `CI`
- Run: `32772191903`
- Conclusion: `success`
- Job: `build-and-lint` / `97574865812`
- All configured gates succeeded: build, contract typecheck, architecture validation/negative contract, lint, Unit, T602/T603/T403/T404/T405/T406/T304/T502/T503/T504/T505/T506/T604/T605/T606/T609/T610, temporary Git integration, mock GitHub integration, and VS Code Extension Host.

Green CI does not close NR-003 because the focused test exercises a different selected-side API than the production Tree update path.

### TDD / failure diagnostics

The implementation report records formal RED run `32733580907` at `eb69a4723031752ff90c5271a6a73e84087cc9a2` and diagnostic artifact `9522364043`, plus intermediate failure artifacts. The existing workflow captured test result/output/error/context evidence, so no review-side workflow change is required.

## Held, unexplored, and unknown

- Held: none.
- Unexplored: none within the finding-limited scope after tracing the production selected Tree composition and direct cache dependency.
- Unknown: actual VS Code visual rendering is not directly observable through the GitHub connector; this does not block the code-level finding because the production call graph and behavior are explicit.

## Verdict

`fail`

- `PR85-NR-002` — High — closed
- `PR85-NR-003` — Medium — open

The implementation worker should address only NR-003, add an actual selected-Tree/cache-hit composition regression, obtain a new exact-current-HEAD pull_request CI success, and return to this same normal-review chat for bounded closure. Do not merge.

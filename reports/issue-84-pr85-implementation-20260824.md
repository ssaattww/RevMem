# Issue #84 / PR #85 実装レポート

## 1. Metadata / target identity

- Repository: `ssaattww/RevMem`
- Issue: `#84 Review Contexts操作に失敗しました`
- Pull Request: `#85 Issue #84: PR Progressの競合解消と進捗診断の具体化`
- Branch: `fix/issue-84-pr-progress-diagnostics`
- Base: `main`
- Base SHA: `4535c2a3836c032cd7efaeaddbb543bedfcdb528`
- Technical/design HEAD covered by this report: `1244649bb6c335b6772dcc28e66babfe12764129`
- Verification capability: `remote_ci_only`
- Merge: not performed
- Review: not started by this worker; PR remains draft

## 2. Purpose, scope, and non-goals

Issue #84 reported that long-running Current Context / Review Contexts work was not diagnosable enough from `Review Range` Output. The user additionally clarified that PR Progress had never been observed to render at all, regardless of branch/context switching. The implementation therefore treats the missing PR Progress as a bootstrap/order defect rather than a branch-switch-only defect.

Scope:

- make selected PR Progress start only after Review Contexts has acquired and registered the matching immutable PR diff runtime;
- prevent equivalent refreshes for the same immutable PR snapshot from cancelling one another and leaving the view empty;
- retain the last accepted complete Tree while the same snapshot is recalculated;
- make Review Contexts rows use stable `contextId` identity so equal PR numbers/labels in different repositories do not collide;
- add privacy-safe count progress for repositories, PR contexts, and PR files to Status Bar and Output;
- document the no-overall-wall-clock-timeout policy for Current Context / Review Contexts / PR Progress;
- preserve existing bounded timeout/retry contracts on individual Git, storage-lock, and GitHub I/O boundaries.

Non-goals:

- do not expose repository name/path, file name/path, PR number/title, source text, credential, or token in progress diagnostics;
- do not treat `0/0` during bootstrap as a completed PR Progress snapshot;
- do not merge PR #85;
- do not start the review phase.

## 3. Authoritative requirements and design

The implementation follows the user clarification that PR Progress has never successfully appeared, so the production bootstrap sequence must be correct even without any explicit context switch.

`doc/design/vscode-review-range-tracker-design.md` was advanced from rev6 to rev7 at `1244649bb6c335b6772dcc28e66babfe12764129`. The added design contract states:

- Review Contexts must register the PR diff runtime before PR Progress is calculated;
- the immutable refresh identity is `contextId + baseSha + headSha + originalDiffId`;
- duplicate refreshes of the same immutable snapshot must not supersede/cancel each other;
- a previously accepted complete Tree is retained while that same snapshot is recalculated;
- initial calculation uses activity progress until a complete Tree exists rather than presenting `0/0` as completion;
- upper-level Current Context / Review Contexts / PR Progress operations do not fail solely due to total wall-clock duration;
- progress output is restricted to allowlisted count-only stages (`repositories`, `pull-request-contexts`, `pull-request-files`);
- Review Contexts Tree row identity is bound to `contextId`, not display label.

## 4. Diagnostics workflow check

Before implementation, `.github/workflows/ci.yml` was inspected. The existing workflow already creates failure diagnostics and uploads an artifact on failure. The artifact contains separated result metadata, stdout, stderr, combined command logs, generated/source/test context, and environment information. No workflow change was required.

This contract was exercised during the final design-HEAD CI failure attempt: artifact `9506307871` (`ci-failure-diagnostics-32687824636-1`) was created and contained `test-t606.result.json`, `test-t606.stdout.log`, `test-t606.stderr.log`, combined logs, source, compiled tests, and environment evidence.

## 5. TDD chronology

### RED

Test-first commit:

- `6577785ea24f6aded37389fb2f7e09ea0ff7d15d` — `test: enforce PR Progress bootstrap ordering`

Exact-head CI:

- run `32674164919`
- result: failure as intended
- behavior covered by the Red set included the selected-PR runtime registration ordering and same-snapshot PR Progress refresh behavior.

The bootstrap regression specifically requires PR Progress to observe that Review Contexts has registered the selected PR runtime before calculation begins.

### GREEN implementation

The implementation introduced or updated:

- `src/t305-projection-refresh.ts` — Current Context dependent refresh ordering;
- `src/t405-pull-request-review-runtime-base.ts` — extracted existing PR runtime base implementation;
- `src/t405-pull-request-review-runtime.ts` — same-snapshot refresh ownership, accepted snapshot retention, and PR-file progress reporting;
- `src/application/operation-feedback/operation-feedback.ts` — validated count-only progress events and Output formatting;
- `src/ui/operation-feedback/vscode-operation-feedback.ts` — Status Bar count progress presentation;
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts` — stable Tree item IDs plus repository/PR-context progress counts;
- `test/unit/issue-84-review-context-progress.test.ts` — Issue #84 behavior regressions;
- `test/unit/t305-projection-refresh.test.ts`, `test/unit/t305-validation-wiring.test.ts`, `test/unit/review-contexts-runtime-wiring.test.ts`, `test/unit/core-contracts.test.ts` — production ordering and suite wiring.

Technical implementation HEAD before the requested design revision:

- `e0e815ba19ede4869e143ff4ea68d62d97c5e78b`
- exact-head CI run `32675130113`: success

### Design synchronization

- `1244649bb6c335b6772dcc28e66babfe12764129` — `docs: define PR progress refresh lifecycle`
- only `doc/design/vscode-review-range-tracker-design.md` changed from `e0e815b...` to this HEAD (`46` additions, `7` deletions).

## 6. Implementation behavior

### PR Progress bootstrap

`refreshCurrentContextDependents` now awaits the Review Contexts refresh first. Review Contexts owns PR diff acquisition and `PullRequestReviewRuntime.register(...)`; only after that boundary settles does the selected PR Progress calculation start. This removes the prior state where PR Progress could calculate against an unregistered context, clear to an empty projection, and never receive a subsequent recalculation trigger.

### Equivalent refreshes

The PR Progress wrapper keys an immutable snapshot by context/base/head/original-diff identity. Equivalent refreshes are joined/serialized rather than cancelling one another. When a complete result for the same snapshot has already been accepted, recalculation does not clear it; a new complete result replaces it atomically. A genuinely different snapshot can supersede old work.

### Progress diagnostics

The operation feedback layer supports an allowlisted progress event with non-negative safe integer counts and an optional total. `completed = 0` is valid. Progress events are deduplicated when stage/count are unchanged.

Production emits anonymous counts for:

- repositories;
- pull-request contexts;
- pull-request files.

Status Bar and `Output > Review Range` use the same lifecycle. Paths, names, source text, PR titles/numbers, credentials, and tokens are excluded from progress payloads.

### Review Contexts identity

VS Code Tree item IDs are based on `contextId`. Two repositories can therefore show the same PR number/display label without VS Code reusing one row identity for the other.

## 7. Validation and CI evidence

### Technical Green before design synchronization

- HEAD: `e0e815ba19ede4869e143ff4ea68d62d97c5e78b`
- workflow: `CI`
- run: `32675130113`
- conclusion: `success`

### Design HEAD exact-match CI

- HEAD: `1244649bb6c335b6772dcc28e66babfe12764129`
- workflow: `CI`
- run: `32687824636`

First job attempt failed in the `T606 failure policy and diagnostics tests` step. The diagnostic artifact showed exactly one failure inside the existing T604 child-process lease regression:

`T604 uses an owned OS child-process lease and releases it for a successor`

Observed mismatch:

- expected: `StorageRootLockTimeoutError`
- actual: `acquired`

All preceding build/typecheck/architecture/lint/unit/T304/T405/T406 and other executed tests were Green. The design commit changed no executable/test file. Artifact `9506307871` preserved the failure evidence.

The same job was rerun without changing HEAD. On rerun:

- Build: success
- Contract typecheck: success
- Architecture positive/negative: success
- Lint: success
- Unit: success
- T602/T603/T403/T404/T405/T406/T304/T502/T503/T504/T505/T506: success
- T604: success
- T605: success
- T606: success
- T609: success
- T610: success
- Temporary Git integration: success
- Mock GitHub integration: success
- VS Code Extension Host: success

The workflow run `32687824636` therefore completed with conclusion `success` for exact HEAD `1244649bb6c335b6772dcc28e66babfe12764129`.

The first-attempt T604 failure is recorded as non-deterministic evidence, not silently converted into a product-code failure or omitted.

## 8. Intentionally untouched / blocked / unknown

Intentionally untouched:

- `.github/workflows/ci.yml`: existing failure artifact contract already satisfies the project requirement;
- merge state: PR remains unmerged;
- review state: no review requested or started by this worker.

No implementation blocker remains at the technical/design HEAD.

The only observed instability was the one-attempt existing T604 OS child-process lease timing failure described above; it passed on an unchanged-HEAD rerun. This remains a CI stability risk independent of the Issue #84 product changes.

## 9. Remaining risk and next action

The implementation and rev7 design are technically Green at `1244649bb6c335b6772dcc28e66babfe12764129`. This report and the required handoff are administrative publication after that technical/design HEAD. Their commit(s) will create a new PR HEAD; therefore the project rule requires a new workflow run whose `head_sha` exactly equals that final PR HEAD before the implementation phase is handed to review.

Next action:

1. persist the schema-v3 handoff;
2. update PR #85 body and concise implementation comment;
3. verify exact-head CI for the final administrative HEAD;
4. stop before review starts.

Persistence mode: repository file.

Merge remains user-owned and is not performed by this worker.

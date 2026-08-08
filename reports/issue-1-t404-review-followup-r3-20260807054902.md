# T404 Review Follow-up R3 Implementation Report

## Metadata

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T404`
- Pull Request: `#48`
- Mode: review follow-up
- Base ref: `main`
- Reviewed implementation HEAD from fix verification R2: `6d5d23ac736b019ec8e7dc8c8be9a9d1edfa063a`
- R2 review evidence HEAD: `033dbbe5b4d24d58bad9f1588dae41dd7ec44f40`
- Test-first commit for this follow-up: `738e1a0e0e7c7442a02c7d7d8079047af75a914b`
- Implementation HEAD before this report: `32eb6700465044419fb1d491f2ad094d0f2fdf41`
- Generated at: `2026-08-07T05:49:02+09:00`

## Purpose

Address the four findings left open by T404 fix verification R2 without reopening the already closed findings.

## Scope

- `T404-R003` high: make PR revision mapping validate the mapped descriptor, every Context/Global file revision, and immutable revision/identity evidence.
- `T404-R004` high: share hosted Git repository canonicalization between T202/T401 Local Git identity and T404 PR identity, and reject malformed/non-canonical repository IDs.
- `T404-R006` medium: preserve explicit closed/merged decoration overrides across metadata refresh and revision transition.
- `T404-R008` medium: establish test-first ordering for this follow-up and add focused T404, multiple-PR/restart, malformed identity, mapped snapshot, override, and PR history coverage.

## Non-goals

- T405 Review Contexts UI.
- Layer selection/deletion UI.
- Merge.
- Re-review verdict generation by the implementation worker.

## Authoritative review input

Fix verification R2 reported `fail` on implementation HEAD `6d5d23ac736b019ec8e7dc8c8be9a9d1edfa063a` and kept the following findings open:

- `T404-R003` high: mapped PR descriptor and Context/Global file revisions were not fail-closed; immutable mapping evidence was not contractized.
- `T404-R004` high: T404 still had independent authority normalization instead of sharing the T202/T401 canonicalizer.
- `T404-R006` medium: explicit closed override could disappear when omitted from a later metadata refresh; restart/revision-transition preservation lacked coverage.
- `T404-R008` medium: test-first evidence and focused/integration coverage were incomplete.

The previously closed findings `R001`, `R002`, `R005`, and `R007` were intentionally left unchanged.

## TDD ordering

A test-only commit was created first:

- `738e1a0e0e7c7442a02c7d7d8079047af75a914b` — `test(t404): reproduce R2 verification findings`

At that commit, the test referenced `src/core/repository-identity/index.js`, which did not exist in the repository yet. The subsequent successful creation of that path confirms the test-first commit preceded the production API it required. No pull-request workflow run was generated for this SHA by GitHub Actions, so there is no matching CI Red run to claim. No run from another SHA is substituted.

Production commits were added only after the test-first commit.

## Implementation

### R003 — revision mapping evidence and mapped snapshot validation

`src/application/github-pr-context/github-pull-request-context-layer-store.ts` now:

- defines `PullRequestRevisionMappingEvidence` with readonly repository/context/source/target revision identity,
- captures that evidence before the mapper runs and freezes the evidence object,
- validates the mapped PR descriptor against the canonical repository identity and PR number,
- validates mapped Context identity and mapped Global identity,
- validates mapped base/head against the target evidence,
- validates `RepositoryGlobalState.currentRevisionId` against the target head,
- validates every Context file `revisionId` against the target head,
- validates every Global file `revisionId` against the target head,
- rejects mismatches before repository commit.

### R004 — shared canonical repository identity

Added:

- `src/core/repository-identity/hosted-git-repository-identity.ts`
- `src/core/repository-identity/index.ts`

The shared pure canonicalizer handles hosted repository authority/path canonicalization. `src/adapters/local-git/git-remote-normalization.ts` now uses this core canonicalizer for ordinary two-segment hosted repository paths, while protocol-specific default-port handling remains at the Local Git URL boundary.

T404 uses the same core canonicalizer after its PR-input boundary removes the implicit HTTPS `:443` default. This avoids conflating protocol-specific port semantics while sharing the host/path identity contract.

`createGitHubPullRequestContextIdFromRepositoryId` now requires a canonical `host/owner/repository` identity and rejects malformed or non-canonical values.

### R006 — persistent explicit lifecycle override

When a later PR metadata refresh omits `decorationEnabled`, the service now carries forward the already persisted explicit override. The normalized next PR descriptor is used for both metadata-only updates and revision transitions, so an explicit closed/merged override survives both paths.

### R008 — focused and integration coverage

Added:

- `test/unit/t404-review-followup-r3.test.ts`
- `test/unit/t404-history-integration.test.ts`

Updated `package.json` to:

- include T404 regression files in `test:unit`,
- expose `test:t404`,
- run the original T404 test plus the R3 follow-up and PR history integration tests.

Coverage includes:

- shared T202/T401/T404 hosted repository canonicalization,
- default HTTPS port handling at the PR boundary,
- malformed repository identity rejection,
- mapped foreign PR descriptor rejection,
- stale Context/Global file revision rejection,
- explicit closed override survival through metadata refresh and revision transition,
- multiple PR contexts persisted independently and reloaded after repository restart,
- pull-request history routing and JSONL persistence across history-store restart.

## Changed files

- `src/core/repository-identity/hosted-git-repository-identity.ts` — new shared hosted repository canonicalizer.
- `src/core/repository-identity/index.ts` — export the canonicalizer.
- `src/adapters/local-git/git-remote-normalization.ts` — reuse shared hosted identity logic without changing protocol-specific default-port semantics.
- `src/application/github-pr-context/github-pull-request-context-layer-store.ts` — mapped snapshot validation, immutable mapping evidence, canonical repository validation, explicit override preservation.
- `test/unit/t404-review-followup-r3.test.ts` — R003/R004/R006/R008 regression cases.
- `test/unit/t404-history-integration.test.ts` — PR history persistence/restart coverage.
- `package.json` — focused `test:t404` and standard-suite registration.

## Intentionally untouched

- `.github/workflows/ci.yml`: existing workflow already captures stdout/stderr, test logs, generated files, and failure diagnostics as an artifact; no additional diagnostic workflow change was required for this follow-up.
- `tasks/tasks-status.md`: repository instructions state this file may only be updated through `task-breakdown-planner`, `task-consistency-manager`, or `progress-sync-manager`; those Skills are not present in the uploaded worker skill set, so this implementation worker did not bypass that rule.
- T405 UI code: out of scope.

## Validation and CI evidence

### Available direct evidence

- The test-first commit exists before every production commit in this follow-up.
- Repository files and package test wiring were read back from the PR branch through the GitHub connector after updates.
- PR current HEAD after implementation and before this report: `32eb6700465044419fb1d491f2ad094d0f2fdf41`.

### Current-HEAD CI

For implementation HEAD `32eb6700465044419fb1d491f2ad094d0f2fdf41`, `fetch_commit_workflow_runs` returned no pull-request workflow run. Therefore CI status is **not executed / unavailable**, not success.

No workflow run from another SHA is used as evidence.

### Red CI

For test-first HEAD `738e1a0e0e7c7442a02c7d7d8079047af75a914b`, no matching pull-request workflow run was generated either. The Red condition is therefore recorded as deterministic compile-time missing-module evidence from the test-first repository state, not as a CI run.

## Finding dispositions for implementation handoff

- `T404-R003` high — addressed by immutable mapping evidence plus descriptor/top-level/file revision fail-closed validation.
- `T404-R004` high — addressed by a shared core hosted repository canonicalizer used by Local Git and T404, with canonical repository ID validation.
- `T404-R006` medium — addressed by override carry-forward through metadata and revision transitions plus restart/multiple-state coverage.
- `T404-R008` medium — addressed for implementation content and commit ordering; `test:t404`, standard-suite registration, multiple-PR, malformed identity, mapped snapshot, override, and PR history tests are present. Matching CI evidence remains unavailable because no current-HEAD workflow run exists.

These are implementation dispositions, not a reviewer verdict. The same normal reviewer must perform fix verification.

## Remaining risks / unknowns

- No matching current-HEAD CI run exists, so the focused and broad suites have not been confirmed by GitHub Actions for this implementation HEAD.
- The implementation worker does not issue a technical pass/fail review verdict.

## Next action

The same normal reviewer should re-run fix verification for `T404-R003`, `R004`, `R006`, and `R008` against the final implementation/report/handoff HEAD lineage, using only a workflow run whose `head_sha` matches the target HEAD if such a run exists.

## Merge boundary

Merge was not performed and is not authorized for this worker.

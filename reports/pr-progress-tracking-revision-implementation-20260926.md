# PR Progress tracking revision implementation report

## Metadata

- Repository: ssaattww/RevMem
- Branch: fix/issue-123-pr-progress-stale-local
- Base: c307868fef33e2e24a3a7a24e4cc54403f77ef93
- Technical/test HEAD: b75defb2d297f75d1750f451b493ab5e766c87f2
- Verification capability: local_execution_available
- Push state: pushed
- CI wait state: not started
- Merge: not performed

## Purpose and scope

Issue #123 reports that PR Progress can stay stale when the local checkout is older than the fetched identity-remote tracking branch. The implementation keeps local HEAD authoritative for branch/editor ownership while allowing a verified fetched upstream commit to act as a separate PR synchronization revision.

Tracked or indexed uncommitted working-tree changes do not block the fetched tracking revision from driving PR synchronization, and synchronization does not modify local HEAD or working-tree contents.

The extension does not fetch, pull, checkout, reset, or merge automatically. Missing upstream, foreign remote, missing tracking object, local-ahead, and diverged cases fail closed to existing local-HEAD behavior.

## Implementation

- Local Git resolves the configured upstream only when its remote name matches the repository identity remote.
- The upstream ref must resolve to a local immutable commit.
- Local HEAD must be an ancestor of the tracking commit; behind/diverged tracking is rejected.
- Current Context carries a separate pullRequestSynchronizationRevision while retaining local headRevision.
- Review Contexts synchronizes the PR Context and owner Global state to that revision before calculating PR Progress.
- PR detection/search uses the synchronization revision, while explicit PR/branch preference remains keyed by local HEAD.
- Prepared Current Context reuse is bound to both local HEAD and the synchronization revision.

Changed product paths:
- src/adapters/local-git/local-git-adapter.ts
- src/composition/current-context/git-context-inspection.ts
- src/composition/extension.ts
- src/composition/review-contexts/review-contexts-runtime.ts
- src/ui/current-context/current-context-ui-controller.ts

## TDD evidence

Red was reproduced on a2a51b28d46f8582ee1c4b957dff669de46a51df:
- PR Progress stayed on the old persisted/local revision instead of the fetched tracking revision.
- LocalGitAdapter did not expose the identity-remote tracking revision resolver.
- Result: 0 pass / 2 fail.

Green on b75defb2d297f75d1750f451b493ab5e766c87f2:
- pr-progress-remote-tracking-revision: 4 pass / 0 fail, including stale local HEAD + dirty working-tree production-composition coverage.
- Direct dependency matrix: 50 pass / 0 fail.
- Git integration: 35 pass / 0 fail / 3 platform skips.
- Full unit gate: 869 pass / 0 fail / 2 skips.

## Validation

Passed on the technical HEAD:
- npm run compile:test
- focused #123 regression
- Current Context / Issue #116 / T405 / T407 / Local Git dependency suites
- npm run build
- npm run lint
- npm run typecheck:contracts
- npm run validate:architecture
- npm run validate:architecture:negative
- npm run test:git
- git diff --check

Logs are retained locally under test-output/issue123. They are not committed because test-output is diagnostic output.

## Remaining work

Normal review, any required fixes, repository-defined full local equivalence gate, independent final review, report attestation, PR creation/update, and exact-current-HEAD pull_request CI remain pending. No unrelated workflow change is required because the existing CI failure diagnostics already archive test-output and command stdout/stderr.

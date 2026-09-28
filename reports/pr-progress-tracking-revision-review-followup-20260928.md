# PR Progress tracking revision normal-review follow-up

## Metadata

- Repository: ssaattww/RevMem
- Pull request: #130
- Issue: #123
- Branch: `fix/issue-123-pr-progress-stale-local`
- Review finding: `I123-NR-001`
- Follow-up start HEAD: `79e5a6edd3834a93f827fba84fa6cb0245e4b426`
- Technical Green HEAD: `1231d64a70e50c7fa24e0bb184a0141a2671923b`
- Merge: not performed
- Review disposition: implementation and local verification complete; normal-review fix verification remains pending

## Failure-diagnostic workflow check

Before implementation, `.github/workflows/ci.yml` was checked. The existing failure path already uploads `test-output/`, command stdout/stderr, generated artifacts, source/test context, environment information, and Git state through the failure-diagnostics artifact. No workflow modification was required.

## Finding and root cause

The normal review identified one required finding, `I123-NR-001`.

Current Context first enumerated each repository with a verified `pullRequestSynchronizationRevision`. A later `vscode.window.visibleTextEditors` pass revisited the same Git repository and created `gitCurrentContextSnapshot(inspection.repository)` without that synchronization revision. Because `currentContextSelectionKey` does not include the synchronization revision, the later `contexts.set(...)` replaced the richer branch candidate. A visible file could therefore make PR synchronization fall back to stale local HEAD.

## TDD chronology

### Red

Commit `db4e10112c365426d12e7c6779322437fd3e3553` added a regression through the actual Extension Host composition. The fixture creates a Git repository whose configured identity-remote tracking branch is one commit ahead, opens a real file in a visible VS Code editor, and reads the candidates produced by the production Current Context enumeration.

On the unfixed implementation, `npm run test:t609:extension-host` failed in the single-root phase.

Diagnostic: `test-output/vscode-launch-diagnostics/t609-single-root-1790543985624.json`

Observed assertion:

- expected tracking revision: `c5a8b39fa31ea8ff94f9fb04f499049e47845b72`
- actual synchronization revision: `undefined`
- assertion: `the verified identity-remote tracking revision must survive visible-editor enumeration`

This directly reproduced `I123-NR-001` on the actual extension/visible-editor path before the product fix.

### Green product fix

Commit `805e8110a6e2d5a443d98a6b48146b7f93e221c6` changed only the duplicate visible-editor candidate insertion.

The visible-editor path now computes the normal selection key and inserts the snapshot only when that key is not already present. The earlier repository candidate is therefore retained when it carries the verified tracking revision. Local HEAD remains the branch/editor ownership revision; only the richer synchronization evidence is preserved.

The same Extension Host regression then passed.

### Test-fixture ownership correction

The focused T609 unit gate correctly rejected the first regression harness because the Host suite invoked `node:child_process` directly. T609 requires the runner to prepare Git fixtures and the Host suite to consume them.

Commit `1231d64a70e50c7fa24e0bb184a0141a2671923b` moved tracking-ahead Git setup into `test/vscode/run-extension-host.ts`. The Host test now only opens the actual visible editor and observes production Current Context output.

After this correction:

- `npm run test:t609`: 81 pass / 0 fail
- T609 Extension Host latest diagnostics:
  - single-root: succeeded
  - prepare: succeeded
  - restart-reopen: succeeded

## Validation on technical Green HEAD

The following validation was run on `1231d64a70e50c7fa24e0bb184a0141a2671923b`:

- Issue #123 focused regression: 4 pass / 0 fail
- `npm run test:i116`: 20 pass / 0 fail
- `npm run test:t405`: 84 pass / 0 fail
- `npm run test:t609`: 81 pass / 0 fail
- `npm run test:t609:extension-host`: single-root, prepare, and restart-reopen all succeeded
- `npm run compile:test`: passed as part of the focused gates
- `npm run build`: passed as part of the Extension Host gate
- `git diff --check`: passed before the technical commits

No full final/independent-review gate was claimed in this normal-review fix loop.

## Commits

- `db4e10112c365426d12e7c6779322437fd3e3553` — test: cover visible-editor PR tracking composition
- `805e8110a6e2d5a443d98a6b48146b7f93e221c6` — fix: preserve PR tracking revision for visible editors
- `1231d64a70e50c7fa24e0bb184a0141a2671923b` — test: prepare tracking-ahead fixture in runner

All three commits were pushed to the existing PR branch as separate reviewable units.

## Changed paths

- `src/composition/extension.ts`
- `test/vscode/t609-suite/index.ts`
- `test/vscode/run-extension-host.ts`

This report and task/handoff metadata are administrative follow-up only.

## CI status and exact-head rule

On technical Green HEAD `1231d64a70e50c7fa24e0bb184a0141a2671923b`, pull_request run `36352116242` and push run `36352114252` both completed successfully, and each run reports that exact `headSha`. No older workflow run is admissible after a HEAD update. The final documentation/tracking commit will change the PR HEAD, so its own exact-head CI must be checked after publication.

## Remaining lifecycle work

`I123-NR-001` is implemented and locally verified, but it is not self-closed by this implementation worker. The corresponding normal reviewer must perform fix verification. After normal-review closure, `I123-FINAL` still requires the repository-defined final local gate, independent final review, report attestation/publication, and exact-current-HEAD CI. Merge remains user-owned.

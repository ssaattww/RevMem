# Issue #63 Implementation Report

## Identity

- Repository: `ssaattww/RevMem`
- Issue: `#63` — `Review Contexts操作に失敗しました: stdout maxBuffer length exceeded`
- Pull Request: `#65`
- Branch: `feature/issue-63-stream-git-output`
- Base branch: `main`
- Accepted base HEAD: `3bed6371b5bde08a3b3d6ae7fa82ef1218bcfd74`
- Technical implementation HEAD validated before this report: `51c2ff13e172a0510711fc4198a4f6b6f2e9a663`
- Generated at: `2026-08-18T11:14:41+09:00`
- Worker mode: implementation
- Merge boundary: merge is user-owned; this worker did not merge.

## Purpose and reported symptoms

Issue #63 was reproduced while a private GitHub repository was open. The reported symptoms were:

- Global Understanding denominator was visible.
- PR Progress did not update.
- Marking reviewed state failed with `stdout maxBuffer length exceeded`.

The implementation also had two requested observability requirements:

1. Write operation diagnostics to the VS Code `Review Range` Output channel.
2. Update a processing status indicator while asynchronous review operations are running.

The design document was explicitly required to be updated before continuing implementation. `doc/design/vscode-review-range-tracker-design.md` was updated to rev5 in commit `c6ff1b628af89fd27334c5f3001f5a777bbbae7a` before the later implementation fixes.

## Root cause

`NodeGitCommandExecutor` used Node child-process buffered execution with a 4 MiB stdout limit. Complete Git diffs are returned through stdout, so a repository/revision comparison larger than that limit threw `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` before the diff parser received the complete result.

This explained the differing symptoms:

- Global Understanding file-count/denominator discovery can proceed through repository filesystem enumeration and therefore does not depend on the same complete diff output.
- PR Progress obtains immutable PR diff evidence; the acquisition path previously converted some failures to `undefined`, leaving the progress UI blank.
- Review-state revision mapping may request a complete Git revision diff. Its max-buffer exception propagated to the review command UI and produced the reported error.

Private-repository status was not the direct cause of the max-buffer exception. It only affects the availability of authenticated GitHub fallback when local Git evidence is unavailable.

## Diagnostic artifact workflow check

Before implementation, the CI workflow was checked. The existing `.github/workflows/ci.yml` already:

- records command result metadata,
- stores stdout,
- stores stderr,
- stores combined logs,
- records environment/Git/generated-file context on failure, and
- uploads a `ci-failure-diagnostics-*` artifact including source, tests, tools, configuration, and generated diagnostics.

No workflow change was required.

## Design changes

`doc/design/vscode-review-range-tracker-design.md` is now rev5 and defines the following contracts:

- Git metadata, complete diff, and blob subprocess stdout/stderr are consumed from pipes instead of relying on `execFile.maxBuffer`.
- The legacy `maxBufferBytes` option is compatibility-only and is not a runtime output ceiling.
- A runtime-neutral Operation Feedback Service owns operation lifecycle state.
- VS Code Status Bar and Output Channel are UI adapters for that service.
- Observable asynchronous operations report `START`, `OK`, or `ERROR` lifecycle events.
- Nested/concurrent operations retain an active operation status until the last operation completes.
- Fail-closed PR Progress / Review Contexts behavior must still leave diagnostic evidence instead of silently converting every failure to an empty UI state.
- Acceptance and test requirements include Git output larger than 4 MiB and status/output observability.

## Implementation

### 1. Stream Git command output

`src/adapters/local-git/node-git-command-executor.ts` now uses `spawn` and consumes stdout/stderr streams incrementally. It waits for process completion, then joins collected text chunks for callers that require a complete textual result.

The previous child-process `maxBuffer` failure mode is therefore removed without merely raising the limit to a larger fixed value.

A regression test writes more than 5 MiB to stdout and verifies successful collection. A real temporary-Git integration test covers a complete Git diff larger than 4 MiB.

### 2. Operation Feedback Service

Added:

- `src/application/operation-feedback/operation-feedback.ts`
- `src/application/operation-feedback/index.ts`

The service records:

- operation start,
- success and elapsed time,
- failure and elapsed time,
- nested/concurrent active operation state,
- one-time failure reporting for the same `Error` object.

It also exposes the active instance to existing composition seams so subsystems can participate without introducing a new dependency from application code to VS Code.

### 3. VS Code Output and status UI

Added:

- `src/ui/operation-feedback/vscode-operation-feedback.ts`
- `src/ui/operation-feedback/index.ts`

The UI host creates:

- Output channel: `Review Range`
- temporary Status Bar activity item using `$(sync~spin)`

The activity item displays the most recently started active operation and reports the number of active operations in its tooltip. It is hidden only when no operation remains active.

Output records use one-line `START`, `OK`, and `ERROR` entries. Failure output is revealed without changing editor focus.

### 4. Global Understanding

`src/ui/global-understanding/vscode-global-understanding-runtime.ts` creates and publishes the shared Operation Feedback instance. Global recalculation is wrapped as `Global理解率を再計算`, so the Status Bar and Output reflect its lifecycle.

### 5. Review commands

`src/ui/normal-editor/review-command-registration.ts` wraps actual review mutations with operation feedback labels such as:

- `選択範囲を確認済みにする`
- `選択範囲の確認済みを解除する`
- `ファイル全体を確認済みにする`
- `ファイル全体の確認済みを解除する`

The failure boundary is outside `runWithActiveOperationFeedback`, ensuring failed state commits produce an Output `ERROR` before the existing UI error presentation handles the exception.

### 6. PR Progress and Review Contexts

`src/t405-pull-request-review-runtime.ts` wraps PR progress calculation as `PR進捗を計算`.

`src/t405-review-contexts-runtime.ts` now records acquisition failures that are intentionally converted to `undefined` by the fail-closed progress path. Acquisition attempt reasons are preserved as operation diagnostics rather than disappearing silently.

`src/ui/review-contexts/vscode-review-contexts-runtime.ts` lets operation feedback observe failures before the existing UI `reportError` boundary. It also preserves the pre-existing T405 behavior that a mutation failure is followed by a Tree refresh, so an offline/stale or not-cached status discovered during the failed operation is still reflected in the UI.

### 7. Existing immutable PR behavior preserved

During development, one restored source file temporarily reintroduced a mutable working-tree candidate-path gate into the immutable PR HEAD full scan. Existing regression `R60-001` detected this immediately. The implementation was restored so immutable PR snapshot paths remain authoritative and are not removed merely because the dirty working tree omits them.

## Files changed

Production/design:

- `doc/design/vscode-review-range-tracker-design.md`
- `src/adapters/local-git/node-git-command-executor.ts`
- `src/application/operation-feedback/index.ts`
- `src/application/operation-feedback/operation-feedback.ts`
- `src/t405-pull-request-review-runtime.ts`
- `src/t405-review-contexts-runtime.ts`
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`
- `src/ui/normal-editor/review-command-registration.ts`
- `src/ui/operation-feedback/index.ts`
- `src/ui/operation-feedback/vscode-operation-feedback.ts`
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`

Tests:

- `test/integration/local-git-adapter.integration.test.ts`
- `test/unit/node-git-command-executor.test.ts`
- `test/unit/normal-editor-review-command-registration.test.ts`
- `test/unit/review-contexts-runtime-wiring.test.ts`
- `test/unit/review-contexts-ui.test.ts`

Intentionally untouched:

- `.github/workflows/ci.yml` — existing diagnostic artifact is sufficient.
- `tasks/tasks-status.md` — no authorized progress-management update was performed.

## TDD and CI evidence

Only workflow runs associated with the exact referenced PR HEAD were used for each judgment.

### RED 1 — large stdout reproduction

- HEAD: `f216b6355cbe77873f2487e21973a88d6b7b1d9a`
- Exact matching CI run: `32086621261`
- Conclusion: `failure`
- Failure: `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` in `streams stdout larger than the legacy 4 MiB child-process buffer`
- Diagnostic artifact: `9306928485`

This directly reproduced Issue #63 before the streaming implementation.

### RED 2 — operation feedback contract

- HEAD: `033d21b672c0f5452d32484abef70cc813303e91`
- Exact matching CI run: `32087043760`
- Conclusion: `failure`
- Diagnostic artifact: `9307057566`

The tests defined Status Bar / Output lifecycle behavior before the feedback implementation was wired.

### RED 3 — failed review command was incorrectly logged as success

- HEAD: `50fcd37ece6f1fbcf1336a1ccf566560d2d66060`
- Exact matching CI run: `32089918157`
- Conclusion: `failure`
- Observed behavior: `START` followed by `succeeded` because the UI caught the error inside the feedback operation.
- Diagnostic artifact: `9307984297`

The catch boundary was moved outside operation feedback. The resulting implementation HEAD `aa791119c5a2874e2ebdb26cc573a765d3143a68` passed exact matching CI run `32090015468`.

### RED 4 — silent fail-closed diagnostics

- HEAD: `388024d68eb7801653699f8bb44a112aa8d3e996`
- Exact matching CI run: `32090241746`
- Conclusion: `failure`
- Diagnostic artifact: `9308088860`

The tests required fail-closed PR Progress acquisition and Review Contexts failures to be observable through operation diagnostics.

### Existing-regression evidence encountered during convergence

Two exact-head failures identified compatibility regressions and were fixed rather than ignored:

1. HEAD `c502b3290b5853df5df65f38d659e0f3ac21cb32`, run `32087859021`, artifact `9307326163`: existing `R60-001` detected accidental loss of immutable PR HEAD authority. Fixed by restoring the existing PR scan contract.
2. HEAD `3a975f581e332500ff2f3747044b9e4f5e745eee`, run `32090611646`, artifact `9308203580`: existing T405 production-composition test detected that a failed cache refresh no longer refreshed the Tree, leaving stale live/fresh presentation. Fixed by refreshing the Tree after error reporting while retaining Output `ERROR` reporting.

### Design-first checkpoint

- Design commit: `c6ff1b628af89fd27334c5f3001f5a777bbbae7a`
- The design document was committed before later implementation work resumed, as explicitly requested.

### Green technical HEAD

- Exact implementation/test/design HEAD: `51c2ff13e172a0510711fc4198a4f6b6f2e9a663`
- Exact matching CI run: `32090827458`
- Conclusion: `success`

The run passed build, contract typecheck, architecture positive/negative validation, lint, Unit tests, T602, T603, T403, T404, T405, T304, T502, T503, T504, T505, T506, temporary Git integration, mock GitHub integration, and VS Code Extension Host tests.

This report and handoff are added after that technical Green. The resulting documentation HEAD must receive its own exact-head CI result before handoff. That final result will be recorded in the PR comment because writing it back into this report would create another HEAD.

## PR handling

A redundant Issue #63 draft PR (`#64`) was closed unmerged at the user's request. All remaining Issue #63 work is contained in PR `#65`; no additional PR was created after that instruction.

## Result

The reproduced `stdout maxBuffer length exceeded` path is removed by streamed child-process output consumption. Review operations now expose processing state and Output lifecycle diagnostics, including failure paths that intentionally remain fail-closed in the UI. Existing immutable PR and cache-status behavior is retained, and the full exact-head CI is Green at the technical implementation HEAD.

## Next action

- Commit this report and its schema-v3 handoff together.
- Verify CI only for the resulting exact PR HEAD.
- Update PR #65 body to the completed implementation summary.
- Mark PR #65 ready for review after final Green.
- Post a concise PR comment with final exact-head CI evidence and report/handoff paths.
- Do not merge PR #65.
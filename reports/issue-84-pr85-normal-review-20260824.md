# Issue #84 / PR #85 通常レビュー report

## 1. Review metadata

- Repository: `ssaattww/RevMem`
- Issue: `#84 Review Contexts操作に失敗しました`
- Pull Request: `#85 Issue #84: PR Progressの競合解消と進捗診断の具体化`
- Review mode: normal review / initial review
- Base ref: `main`
- Base SHA: `4535c2a3836c032cd7efaeaddbb543bedfcdb528`
- Reviewed implementation HEAD: `3b46423aeef7ac62780d09b7ddfb2f838724043d`
- Reviewed range: `4535c2a3836c032cd7efaeaddbb543bedfcdb528..3b46423aeef7ac62780d09b7ddfb2f838724043d`
- Reviewer execution: `chat-review-worker` via GitHub connector
- GitHub mutation identity: `ssaattww`
- Verification capability: `remote_ci_only`
- Verdict: `fail`
- Merge: not performed

## 2. Authoritative requirements reviewed

Review used the following requirements as authoritative:

1. Issue #84 requires diagnostics that make long-running Review Contexts failures diagnosable while avoiding file names and source content in Output.
2. PR #85 additionally targets initial PR Progress bootstrap, same-snapshot refresh cancellation, stable Review Context identity, count-only progress for repositories / PR contexts / PR files, and no upper-level wall-clock timeout.
3. `doc/design/vscode-review-range-tracker-design.md` rev7 requires:
   - PR Progress to start only after Review Contexts has acquired and registered the matching snapshot;
   - if Review Contexts cannot register the target snapshot, failure must be returned and progress must not be inferred from a nonexistent snapshot;
   - same immutable snapshot refreshes to share or serialize rather than cancel one another;
   - accepted PR Progress Tree retention during same-snapshot recalculation;
   - count-only progress to remain visible during long-running operations and to emit when a stage changes or anonymous count advances;
   - `completed = 0` to be a valid progress observation;
   - progress to exclude repository/file/PR identifying values and source/credential data.
4. Project policy requires exact-current-HEAD CI evidence and a failure-diagnostic artifact workflow.

## 3. Scope and coverage

All 14 changed files were inspected:

- `doc/design/vscode-review-range-tracker-design.md`
- `handoffs/issue-84-pr85-implementation-20260824.yaml`
- `reports/issue-84-pr85-implementation-20260824.md`
- `src/application/operation-feedback/operation-feedback.ts`
- `src/t305-projection-refresh.ts`
- `src/t405-pull-request-review-runtime-base.ts`
- `src/t405-pull-request-review-runtime.ts`
- `src/ui/operation-feedback/vscode-operation-feedback.ts`
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
- `test/unit/core-contracts.test.ts`
- `test/unit/issue-84-review-context-progress.test.ts`
- `test/unit/review-contexts-runtime-wiring.test.ts`
- `test/unit/t305-projection-refresh.test.ts`
- `test/unit/t305-validation-wiring.test.ts`

Directly relevant dependencies and contracts were also inspected, including the operation-feedback ownership semantics, PR Progress base runtime cancellation/publication path, current-context dependent refresh sequencing, Review Contexts publication boundary, CI workflow, Issue #84, implementation report, and handoff.

Coverage disposition:

| Review area | Disposition |
| --- | --- |
| Requirement/design conformance | Fail: PR85-NR-001, PR85-NR-002 |
| Correctness / edge cases | Fail: PR85-NR-001, PR85-NR-003 |
| Scope discipline | Pass; changes are related to Issue #84 |
| Changed files / direct dependencies | Reviewed |
| API/data/config/workflow compatibility | No blocking compatibility regression found |
| Error handling / fail-closed behavior | Fail: PR85-NR-001 |
| Security / privacy / secrets | No identifying payload leak found in the new structured progress API; allowlist/count validation is appropriate |
| Tests / validation adequacy | Fail: the three findings are not covered by behavior tests |
| Current-HEAD CI | Pass for reviewed HEAD; exact-head run `32688708721` succeeded |
| Reports / documentation | Design is explicit, but implementation does not fully conform; implementation handoff predates the final exact-head run |
| Regression / maintainability | Medium risk from context-free progress ownership and wrapper-level monkey-patching; blocking impact captured in findings |

## 4. Findings

### PR85-NR-001 — High — PR Progress still starts after Review Contexts registration failure

- Origin: requirement/design conformance, fail-closed correctness
- Location: `src/t305-projection-refresh.ts`, `refreshCurrentContextDependents`
- Evidence: the function catches `refreshReviewContexts()` into `dependentError`, but then unconditionally creates `settleProjectionRefresh(dependencies.refreshPullRequestProgress)`.
- Design conflict: rev7 §16.3.1 states that if Review Contexts cannot register the target `PullRequestDiffSnapshot`, that failure must be returned to the operation boundary and progress must not be inferred from a nonexistent snapshot.
- Impact: a Review Contexts acquisition/registration failure can still launch PR Progress against an absent or stale runtime. This can create a secondary PR Progress failure, clear/replace state for the wrong lifecycle, or recreate the empty/misleading PR Progress behavior this PR is intended to remove.
- Test gap: the added T305 tests cover only successful ordering (`Review Contexts` completes before PR Progress starts). No test asserts that PR Progress is skipped when Review Contexts fails.
- Required action: gate the selected PR Progress refresh on successful Review Contexts acquisition/registration. Decorations and Global may retain their intended failure isolation, but the failed Review Contexts operation must not trigger PR Progress. Add a regression test where `refreshReviewContexts` throws and assert that `refreshPullRequestProgress` is not invoked and no secondary PR-progress error is reported.

### PR85-NR-002 — High — Review Contexts count progress is emitted only after the long-running acquisition has finished

- Origin: Issue #84 primary diagnostic requirement / design conformance
- Location: `src/ui/review-contexts/vscode-review-contexts-runtime.ts`, `ReviewContextsTreeProvider.refresh`
- Evidence: repository and pull-request-context counts are calculated only after `await source.load(...)` and optional `await source.publishLoaded?.()` have both completed. The code then emits only final `completed = total` observations before publishing the Tree.
- Design conflict: rev7 §§16.7 and 16.10 require long-running operations to remain observable with count-only progress, and require `PROGRESS` when a processing stage changes or an anonymous count advances. `completed = 0` is explicitly valid. The Issue #84 example contains a Review Contexts operation lasting about 182 seconds; the current implementation remains at the generic START status throughout that expensive acquisition and only reports counts immediately before OK.
- Impact: if repository enumeration, PR-context acquisition, cache publication, or GitHub/Git work stalls/fails, the newly added counts do not identify how far the operation got. This leaves the core Issue #84 diagnosis problem unresolved for the long-running part of Review Contexts.
- Test gap: `issue-84-review-context-progress.test.ts` statically checks that the source contains stage strings and separately tests the generic progress API, but it does not block a real Review Contexts acquisition between items and verify that progress is observable before completion.
- Required action: emit `repositories` / `pull-request-contexts` progress from the acquisition/enumeration boundaries as counts actually advance, before `source.load` finishes. Preserve privacy by reporting only allowlisted stages and counts. Emit valid zero/unknown-total observations where they describe an entered stage. Add a behavior test that deliberately pauses acquisition and observes Status/Output progress before completion.

### PR85-NR-003 — Medium — PR-file progress can be attributed to the wrong concurrent operation

- Origin: correctness of diagnostic ownership / concurrency
- Location: `src/t405-pull-request-review-runtime.ts` (`register` read wrapper and `activateProgress`); `src/application/operation-feedback/operation-feedback.ts` (`reportProgress` ownership semantics)
- Evidence:
  - `OperationFeedback.reportProgress` without an explicit context assigns progress to `this.active.at(-1)`, the most recently started active operation.
  - `refreshCurrentContextDependents` intentionally starts PR Progress and then performs decoration/Global refresh work, so operation lifetimes can overlap.
  - the base PR runtime already passes a PR operation `feedbackContext` as the second argument to `registration.readTextContent`, but the wrapper reads `args[0]` and calls `reportActiveOperationProgress(...)` without forwarding `args[1]`.
  - `activateProgress` also emits initial/final PR-file observations without an explicit PR operation context.
- Impact: while PR Progress overlaps a later-started Global/other operation, PR-file `PROGRESS` entries and Status Bar state can be logged under that other operation's label. Reads of the same registered snapshot from another path can also advance the shared `activeFileProgress` set, making the PR-file count appear to advance for work not owned by the PR Progress calculation.
- Test gap: no test runs overlapping operation-feedback lifecycles and asserts that `pull-request-files` observations stay bound to `PR進捗を計算`.
- Required action: bind every PR-file progress observation to the PR Progress operation context. Forward the existing read callback `feedbackContext` where appropriate, and structure initial/final progress so it is emitted from the PR operation lifecycle rather than via implicit latest-active ownership. Ensure unrelated Global reads cannot advance the PR Progress counter. Add a concurrent-operation regression test that verifies Output labels and counts.

## 5. Validation and CI assessment

### Failure-diagnostic workflow

`.github/workflows/ci.yml` already wraps commands with `tools/run-ci-command.mjs`, collects failure context, and uploads `test-output/`, generated output, source/test context, environment metadata, and workflow/configuration files on failure. The implementation report records an exercised diagnostic artifact (`9506307871`) containing result metadata, stdout, stderr and combined logs. No review-side workflow modification was required.

### Exact reviewed-HEAD CI

Reviewed HEAD:

`3b46423aeef7ac62780d09b7ddfb2f838724043d`

Accepted CI evidence:

- Workflow: `CI`
- Run: `32688708721`
- Trigger class: pull-request run returned for this exact commit SHA
- Conclusion: `success`
- Job: `build-and-lint` / `97318369865`
- Build, typecheck, architecture positive/negative, lint, unit, T602/T603/T403/T404/T405/T406/T304/T502/T503/T504/T505/T506/T604/T605/T606/T609/T610, temporary Git integration, mock GitHub integration, and VS Code Extension Host all succeeded.

Green CI does not close the findings because the relevant failure, long-running-progress, and concurrent-ownership cases are absent from the current tests.

## 6. Verdict

`fail`

Blocking findings:

- `PR85-NR-001` High
- `PR85-NR-002` High

Non-blocking-but-required finding:

- `PR85-NR-003` Medium

No merge was performed. The implementation worker should address all three findings in one focused follow-up, add the missing regression coverage, push the fixes, and obtain a new pull-request workflow run whose `head_sha` exactly matches the new PR HEAD. Review closure should then be limited to these findings under the same normal-review continuity.

## 7. Held / unexplored / unknown

- Held: none.
- Unexplored: none within the accepted PR scope.
- Unknown: none material to the verdict.

Persistence mode: repository file.

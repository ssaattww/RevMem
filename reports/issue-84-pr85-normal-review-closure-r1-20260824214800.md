# Issue #84 / PR #85 通常レビュー closure R1

## 1. Review metadata

- Repository: `ssaattww/RevMem`
- Issue: `#84 Review Contexts操作に失敗しました`
- Pull Request: `#85 Issue #84: PR Progressの競合解消と進捗診断の具体化`
- Review mode: normal review / fix verification
- Reviewer continuity: same `chat-review-worker` chat as the initial normal review
- Base ref: `main`
- Base SHA: `4535c2a3836c032cd7efaeaddbb543bedfcdb528`
- Initial reviewed implementation HEAD: `3b46423aeef7ac62780d09b7ddfb2f838724043d`
- Fix-verification reviewed HEAD: `760ec468ff957af10ceb77cf21b251e26e54c800`
- Follow-up technical HEAD: `7c4566526cddfaaa6aa4329f502092a3eb28bd4d`
- Fix range inspected: `d1202c90305cb8994940423ba6f68bfe85e1baff..760ec468ff957af10ceb77cf21b251e26e54c800`
- Verification capability: `remote_ci_only`
- Exact reviewed-HEAD CI: `32725370022`, conclusion `success`
- Verdict: `fail`
- Merge: not performed

## 2. Closure scope

This round is finding-limited closure for the three existing normal-review findings only, plus inspection of files newly changed by the fixes for regressions:

- `PR85-NR-001` High
- `PR85-NR-002` High
- `PR85-NR-003` Medium

The implementation follow-up changed production paths `src/t305-projection-refresh.ts`, `src/t405-review-contexts-runtime.ts`, `src/t405-pull-request-review-runtime.ts`, and `src/ui/review-contexts/vscode-review-contexts-runtime.ts`; added `test/unit/issue-84-pr85-review-followup.test.ts`; updated default unit/T606 test wiring; and added its implementation report/handoff.

## 3. Finding completeness matrix

| Finding | Required action | Production path | Actual composition fixture | Focused evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| PR85-NR-001 | Skip PR Progress when Review Contexts acquisition/registration fails; no secondary PR-progress error | `refreshCurrentContextDependents` gates `refreshPullRequestProgress` on `reviewContextsReady` | `issue-84-pr85-review-followup.test.ts` exercises the same refresh coordinator and failure boundary | RED `549af560...`; current-head unit/full CI Green | **closed** |
| PR85-NR-002 | Emit repository/PR-context counts as acquisition actually advances, before completion | start zero-count in `ReviewContextsTreeProvider.refresh`; repository/context counters in `T405ReviewContextsSource.load` | Added blocked-provider fixture proves only zero-count stage entry; no actual T405 composition fixture pauses after one synchronized PR and before a later PR completes | full CI Green, but required in-flight count-advance case is not exercised | **open** |
| PR85-NR-003 | Bind every PR-file progress observation to the owning PR Progress lifecycle; unrelated Review Contexts/Global reads must not own/advance it | explicit context forwarding in `PullRequestReviewRuntime.register`; external-context set around `getProgress` | Added fixture covers `activateProgress` overlapping Global only; actual Review Contexts composition still calls `getProgress(contextId, reviewContextsFeedbackContext, signal)` | full CI Green, but production composition contradicts required ownership | **open** |

## 4. Finding dispositions

### PR85-NR-001 — High — closed

`refreshCurrentContextDependents` now records whether Review Contexts completed successfully. When it fails, selected PR Progress is not started, while decoration and Global refresh isolation is preserved. The new regression checks that PR Progress and the secondary PR-progress error reporter are both untouched after the prerequisite failure.

This satisfies the original required action. No sibling regression was found in this fix path.

### PR85-NR-002 — High — open

The fix improves observability but does not fully implement count progress during the expensive PR-context acquisition.

Current behavior:

1. `ReviewContextsTreeProvider.refresh` emits `repositories 0` and `pull-request-contexts 0` before `source.load`, so the stage becomes visible immediately.
2. `T405ReviewContextsSource.load` increments repository count before reading that repository's persisted/synchronized contexts.
3. However, `readSynchronizedRepository(...)` processes the repository's persisted PR contexts sequentially, including authentication and remote `fetchCurrent(...)` calls, and returns only after every context in that repository has finished.
4. `reportPullRequestContext(...)` is called only afterwards while iterating the already-completed `synchronized` array.

Therefore, with multiple PR contexts in one repository, if PR 1 completes and PR 2 stalls for a long time, the visible `pull-request-contexts` count remains `0` rather than advancing to `1`. This is the same defect class as the original finding: the diagnostic count does not reflect actual acquisition progress at the point where the expensive work advances.

The new regression named `PR85-NR-002 exposes Review Contexts stage progress before acquisition completes` only blocks a stubbed `source.load` and asserts that the two zero-count events exist. It does not exercise the actual T405 synchronization loop or verify `0 -> 1 -> ...` progress while a later PR remains pending.

Required action remains: move or expose PR-context progress at the per-context acquisition boundary (or otherwise report completion immediately after each PR context is acquired), and add an actual composed regression with at least two PR contexts where the second is held pending and the first completed count is observable before overall `source.load` completion.

### PR85-NR-003 — Medium — open

The fix correctly prevents context-free `activateProgress` file reads from falling onto the most recently started Global operation, but the production Review Contexts composition still emits PR-file progress under the Review Contexts operation.

Production path:

- `T405ReviewContextsSource.progressFor(...)` calls `options.getPullRequestReviewProgress(context.contextId, feedbackContext, signal)` using the Review Contexts operation context.
- Actual composition in `t305-extension.ts` maps that port directly to `pullRequestReviewRuntime.getProgress(contextId, feedbackContext, signal)`.
- `PullRequestReviewRuntime.getProgress(...)` immediately emits `pull-request-files 0/total` with the supplied context and emits `total/total` with the same context when done.
- Because the base feedback helper treats a supplied parent context as the existing lifecycle rather than opening a new `PR進捗を計算` lifecycle, these events are logged under `Review Contextsを更新`.

The `externalProgressContexts` set only suppresses per-file read increments from the registration wrapper; it does not suppress the start/end `pull-request-files` events emitted directly by `getProgress` itself.

The added regression exercises `runtime.activateProgress(...)` while a separate Global operation is active. It does not exercise the actual Review Contexts -> `getProgress` composition described above, so it passes while the production ownership defect remains.

Required action remains: distinguish selected-PR Progress lifecycle reporting from Review Contexts' internal progress calculation. Review Contexts must not publish `pull-request-files` under its own feedback context if the contract is that PR-file progress belongs to `PR進捗を計算`. Add an actual composition regression that runs Review Contexts progress acquisition and asserts no `pull-request-files` entries are labeled `Review Contextsを更新`, while selected PR Progress still emits them under `PR進捗を計算`.

## 5. Validation assessment

The current PR HEAD before this report was `760ec468ff957af10ceb77cf21b251e26e54c800`. The GitHub connector returned pull-request workflow run `32725370022` for that exact SHA, with conclusion `success`. Build, contract typecheck, architecture positive/negative, lint, unit, T602/T603/T403/T404/T405/T406/T304/T502/T503/T504/T505/T506/T604/T605/T606/T609/T610, temporary Git integration, mock GitHub integration, and VS Code Extension Host all passed.

The Green CI does not close NR-002/003 because the focused follow-up tests do not execute the production compositions that still exhibit the defects above.

The failure-diagnostic workflow remains present and the implementation follow-up records TDD RED artifact `9512424405`, including the required test/stdout/stderr/log investigation evidence.

## 6. Coverage dispositions

| Criterion | Disposition |
| --- | --- |
| Requirement/design conformance | `checked_finding` — NR-002 and NR-003 remain open |
| Correctness / edge cases | `checked_finding` — multi-PR in-flight progress and Review Contexts ownership |
| Scope discipline | `checked_no_finding` |
| Changed files / direct dependencies | `checked_no_finding` except findings above |
| API/data/config/workflow compatibility | `checked_no_finding` |
| Error handling / fail-closed | `checked_no_finding` — NR-001 closed |
| Security/privacy/secrets | `checked_no_finding`; progress payload remains count-only |
| Tests / validation adequacy | `checked_finding`; NR-002/003 actual composition fixtures are missing |
| Current-HEAD CI | `checked_no_finding`; exact-head run Green |
| Report/tracking/docs accuracy | `checked_finding`; follow-up report claims NR-002/003 addressed more strongly than production evidence supports |
| Regression/maintainability | `checked_finding` through NR-002/003; no additional separate finding introduced |

## 7. Verdict

`fail`

- `PR85-NR-001` High: **closed**
- `PR85-NR-002` High: **open**
- `PR85-NR-003` Medium: **open**

No severity reclassification is made. The existing finding IDs and severities are preserved.

## 8. Held / unexplored / unknown

- Held: none.
- Unexplored: none within the finding-limited closure scope.
- Unknown: none material to the verdict.

## 9. Next action

Return to the implementation worker for the two remaining findings only. For the next closure attempt, provide a complete per-finding matrix including the actual production composition fixture and focused evidence for NR-002 and NR-003. Obtain a pull-request CI run whose `head_sha` exactly matches the updated PR HEAD. Reuse this same normal-review chat for the next fix verification.

This reviewer did not merge the PR.

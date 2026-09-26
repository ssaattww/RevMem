# PR Progress tracking revision normal review

## Metadata

- Repository: ssaattww/RevMem
- Pull request: #130
- Issue: #123
- Branch: `fix/issue-123-pr-progress-stale-local`
- Base: `c307868fef33e2e24a3a7a24e4cc54403f77ef93`
- Reviewed HEAD: `eb52a6fe071c1b19ee42941863a5fb930ddd1809`
- Review type: normal review
- Review date: 2026-09-26
- Merge: not performed

## Verdict

**fail**

One required finding remains. The implementation can lose the verified tracking revision during normal Current Context enumeration when a Git-backed visible editor is present.

## Required findings

### I123-NR-001 — High — visible editor enumeration overwrites the tracking-aware branch candidate

Location:

- `src/composition/extension.ts`, Current Context local enumeration around the initial repository candidate loop and the later `vscode.window.visibleTextEditors` loop.
- `src/ui/current-context/current-context-ui-controller.ts`, `currentContextSelectionKey`.

Evidence:

1. The initial `resolveCurrentContextRepositories(...)` loop resolves `pullRequestSynchronizationRevision` and creates the branch snapshot with `gitCurrentContextSnapshot(repository, pullRequestSynchronizationRevision)`.
2. The later visible-editor loop handles the same Git repository with `gitCurrentContextSnapshot(inspection.repository)` and therefore omits `pullRequestSynchronizationRevision`.
3. `currentContextSelectionKey` keys branch candidates only by repository ID, repository root, and branch ref. It does not include the synchronization revision.
4. The later `contexts.set(...)` therefore replaces the earlier tracking-aware snapshot for the same branch.
5. The new Issue #123 tests manually construct or inject a tracking-aware snapshot before `augmentCurrentContextCandidates`; they do not exercise this actual extension enumeration path with an eligible visible editor.

Impact:

For the common case where a file from the repository is visible in VS Code, local HEAD can remain the effective PR synchronization revision even though the configured identity-remote tracking branch is ahead and already fetched. PR Context / PR Progress can therefore remain stale, which is the core Issue #123 failure this PR is intended to fix.

Required action:

- Add a regression that exercises the actual extension/Current Context composition with a visible Git editor and confirms that the verified tracking revision survives local candidate enumeration.
- Confirm the regression fails on the current implementation before the fix.
- Preserve or re-resolve `pullRequestSynchronizationRevision` for the visible-editor repository path, or avoid replacing an existing richer branch snapshot with a snapshot that lacks it.
- Re-run the Issue #123 focused tests and directly affected Current Context / Review Contexts suites.

## Coverage disposition

| Area | Disposition | Result |
| --- | --- | --- |
| Requirement and design conformance | checked_finding | I123-NR-001 |
| Core correctness and edge cases | checked_finding | I123-NR-001; upstream/foreign-remote/missing-object/local-ahead/detached and GitHub-head mismatch paths otherwise align with design |
| Changed product paths and direct dependencies | checked_finding | I123-NR-001 |
| API / data / configuration compatibility | checked_no_finding | Optional descriptor field; no incompatible persisted schema change found |
| Error handling / cancellation | checked_no_finding | No additional required finding found |
| Security / secrets | checked_no_finding | No new secret persistence or logging found |
| Tests / validation | checked_finding | Actual visible-editor composition path is not covered |
| Performance / regression risk | checked_no_finding | No separate required finding found |
| Reports / tracking / design | checked_finding | Existing implementation report overstates the Current Context behavior until I123-NR-001 is closed |
| Exact-head CI | not_applicable_to_normal_local_review | Final CI must later match the then-current PR HEAD exactly |

## Validation evidence reviewed

- Focused Issue #123 regression: 4 pass / 0 fail.
- Direct dependency matrix: 50 pass / 0 fail.
- Git integration: 35 pass / 0 fail / 3 platform skips.
- Full unit gate re-run on 2026-09-26: 871 tests / 869 pass / 0 fail / 2 skip.
- Build, lint, contract typecheck, positive/negative architecture validation, and `git diff --check` evidence were reviewed.
- Existing CI workflow retains failure diagnostics under `test-output/` including command stdout/stderr; no workflow change is required for this review.

## Held / excluded

- The uncommitted `tasks/tasks-status.md` edit and `reports/pr-progress-dirty-working-tree-followup-20260926.md` present in the worktree were created outside this review and are not part of reviewed HEAD `eb52a6f`. They were not modified or judged as part of this verdict.
- Final independent review and exact-current-HEAD pull-request CI are deferred until normal-review findings are closed.

## Next lifecycle step

Return I123-NR-001 to implementation. After a TDD Red and minimal fix, perform normal fix verification against the new committed implementation HEAD. Independent final review must not begin while this finding remains open.

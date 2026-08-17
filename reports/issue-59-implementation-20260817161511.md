# Issue #59 Implementation Report

## Identity

- Repository: `ssaattww/RevMem`
- Issue: `#59` — Review Contexts load failure with `stdout maxBuffer length exceeded`
- Pull Request: `#60`
- Branch: `feature/issue-59-global-understanding-opened-files`
- Base branch: `main`
- Accepted base HEAD: `f1fa3d658d0391d7e05e492b4239ce770e5b5d30`
- Technical implementation HEAD validated before this report: `3c0abae2960582020bb91758ccb15313014a3f38`
- Generated at: `2026-08-17T16:15:11+09:00`
- Worker mode: implementation
- Merge boundary: merge is user-owned; this worker did not merge.

## Purpose and scope

Issue #59 reports Review Contexts failing with `stdout maxBuffer length exceeded`. The issue discussion identifies Global progress exploration as the likely excessive workload and requests a model where line-based Global progress is based on files that have been opened, while opened/unopened file counts are displayed separately.

The implemented scope is therefore:

1. Stop reading every candidate repository file body during each Global Understanding recalculation.
2. Use only files observed as open VS Code documents as line-count evidence for Global progress.
3. Retain the last observed evidence for those files for the lifetime of the current Extension Host, so closing a file does not remove it from the current revision's denominator.
4. Count candidate repository paths separately as opened and unopened files.
5. Expose opened/unopened counts in the Global Understanding Tree View and Status Bar tooltip.
6. Preserve exclusion-policy directory pruning and `.gitignore` path handling without reintroducing per-file content reads.

## Non-goals

- Increasing Node `exec`/`execFile` `maxBuffer` was not used as the fix.
- Persisting opened-file evidence across Extension Host restarts was not added.
- Reusing opened evidence across Git revisions was not added; evidence is keyed by owner and current revision.
- `tasks/tasks-status.md` was not edited because its repository-local rule permits updates only through designated progress-management skills.
- CI workflow behavior was not changed because the existing workflow already supplied the required diagnostic artifact.

## Diagnostic artifact workflow check

Before implementation, `.github/workflows/ci.yml` was inspected. It already executes CI commands through `tools/run-ci-command.mjs`, saves command result metadata together with stdout/stderr/combined logs under `test-output/ci`, collects environment, Git status, and generated-file information on failure, and uploads `ci-failure-diagnostics-${{ github.run_id }}-${{ github.run_attempt }}` containing test output, generated output, source, tests, tools, type fixtures, package/configuration files, and the workflow itself.

No workflow change was required.

## Design and implementation

### Lightweight repository path enumeration

Added `src/adapters/repository-files/node-repository-file-path-enumerator.ts`.

The enumerator recursively reads directory entries and the root `.gitignore`, applies the existing exclusion-policy path/directory decisions, and returns candidate paths plus known exclusions. It deliberately does not open each candidate file to determine line counts, binary status, or encoding.

This means an unopened binary or invalid-text file is still a candidate unopened path until it is actually opened/observed. That behavior is intentional: content classification would require the same repository-wide content reads that Issue #59 removes.

### Opened-file Global evidence

Changed `src/t505-global-understanding-source.ts`.

- Full `NodeRepositoryFileEnumerator` and disk-backed `NodeGlobalUnderstandingFileSource` use was removed from Global recalculation.
- Current open-document snapshots are canonicalized and retained in memory by repository target plus current revision.
- Only retained/open files that still exist in the lightweight candidate path set are passed to `GlobalUnderstandingBackgroundRecalculator`.
- The recalculator's file source resolves only from opened evidence; it does not fall back to disk file reads.
- Returned snapshots now include `openedFileCount` and `unopenedFileCount` in addition to exclusion diagnostics.
- On revision change, old-revision evidence is not used for the new revision.

### UI

Changed:

- `src/ui/global-understanding/global-understanding-ui-model.ts`
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`

The diagnostics group is now `ファイル状況` and displays:

- `開いたことがあるファイル`
- `未オープンファイル`
- `除外ファイル`
- `pruneした除外ディレクトリ`

The Status Bar tooltip includes the same opened/unopened counts. Snapshot fields are optional at the UI-model boundary for compatibility with existing producers; when absent, opened count falls back to the progress file count and unopened count to zero.

## Files changed

Production:

- `src/adapters/repository-files/node-repository-file-path-enumerator.ts`
- `src/t505-global-understanding-source.ts`
- `src/ui/global-understanding/global-understanding-ui-model.ts`
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`

Tests:

- `test/unit/global-understanding-ui.test.ts`
- `test/unit/t505-global-understanding-source.test.ts`
- `test/unit/t505-review-findings.test.ts`

Intentionally untouched:

- `.github/workflows/ci.yml` — existing diagnostic artifact is sufficient.
- `tasks/tasks-status.md` — direct update is prohibited by its own repository rule without the designated manager.
- local Git command `maxBuffer` configuration — not required by the selected fix.

## TDD evidence

### Red

Test-only behavior was committed before the implementation.

- Exact test-only HEAD: `534553c6bf515b8884fbb62d479c0657f19e6387`
- Exact matching CI run: `32003811348`
- Conclusion: `failure`
- Failed step: `T505 Global understanding tests`
- Added regression: `Issue #59 uses only previously opened files for Global line progress and reports unopened files separately`
- Observed failure: existing implementation produced total non-empty line count `4` while the new contract expected `2`, proving unopened file content still contributed to the denominator.
- Failure diagnostic artifact: `ci-failure-diagnostics-32003811348-1`, artifact id `9279332376`.

### Implementation and regression convergence

Two subsequent exact-head failures were inspected using their diagnostic artifacts rather than treated as infrastructure failures:

- HEAD `a84914fa74e0902fb8507128ec1e1d70c1db9a2c`, run `32004187637`: production compiled/linted; Unit tests exposed legacy UI/R003 expectations for the old full-scan model. Artifact id `9279438461`.
- HEAD `a24e6fbbda7897767105f378703a43144f6858a7`, run `32004392385`: broad Unit tests passed; focused T505 exposed one remaining legacy source expectation for the old full-scan model. Artifact id `9279525521`.

Those expectations were updated to the Issue #59 contract without weakening the new regression.

### Green technical HEAD

- Exact implementation/test HEAD: `3c0abae2960582020bb91758ccb15313014a3f38`
- Exact matching CI run: `32004589338`
- Conclusion: `success`

The matching job explicitly used head SHA `3c0abae2960582020bb91758ccb15313014a3f38`. The full CI completed successfully, including build, contract typecheck, architecture validation, architecture negative contract, lint, Unit tests, T602, T603, T403, T404, T405, T304, T502, T503, T504, T505, T506, temporary Git integration, mock GitHub integration, and VS Code Extension Host tests.

This report and its handoff are added after that technical validation in one documentation-only commit. Per repository policy, that final documentation HEAD must receive its own exact-head CI result before the PR is handed off; the final result is recorded in the PR comment because recording it in this report would itself create another HEAD.

## Review of resulting diff

The final technical diff before report persistence contains exactly seven implementation/test files listed above. No workflow, task-status, unrelated runtime, or generated artifact was included.

No additional correctness issue was identified during the implementation-side diff pass. The main intentional tradeoffs are documented below rather than hidden.

## Known limitations and risks

1. **Extension Host lifetime**: “opened before” evidence is retained in memory only for the current Extension Host. After restart, files must be opened again before they contribute line evidence.
2. **Revision scope**: evidence is keyed to the current revision and is not carried over blindly after HEAD changes. This prevents stale line counts from being treated as current evidence.
3. **Unopened binary classification**: unopened files are not content-read, so binary/encoding classification is deferred; their paths may be counted among unopened candidates. This is the performance tradeoff that avoids reintroducing repository-wide content scanning.
4. **Directory traversal remains**: recalculation still walks repository directory entries to obtain opened/unopened counts. It removes file-body reads, not the path walk itself.

## Next action

- Confirm the exact-head CI result for the final report/handoff commit.
- Post the concise implementation/verification summary to PR #60.
- Leave PR #60 unmerged for the user to review and merge.

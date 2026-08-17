# Issue #59 PR Full-Scan Cache Follow-up Report

## Identity

- Repository: `ssaattww/RevMem`
- Issue: `#59`
- Pull Request: `#60`
- Branch: `feature/issue-59-global-understanding-opened-files`
- Base branch: `main`
- Accepted base HEAD: `f1fa3d658d0391d7e05e492b4239ce770e5b5d30`
- Follow-up technical HEAD validated before this report: `35e597f4933b3121ee4f081cba5ccac8a26186d8`
- Worker mode: implementation
- Merge boundary: merge remains user-owned; this worker did not merge.

## Follow-up requirement

After the initial Issue #59 implementation, the requested behavior was refined as follows:

1. Ordinary Global Understanding must not return to repository-wide file-content scanning. Its line denominator remains based on files that have been opened/observed.
2. A pull-request context is the explicit exception: reviewable files belonging to the PR must be scanned in full even if the user has not opened them in an editor.
3. PR files that exist at the PR HEAD are promoted to Global as equivalent to "opened" evidence after their complete content has been acquired.
4. Deleted PR files have no HEAD-side file to promote into Global, but their complete BASE-side text must still be acquired for the PR full scan.
5. Full immutable PR text and the parsed Global evidence must be cached so repeated Global recalculation does not repeat Git/GitHub reads or line parsing.

## Diagnostic workflow check

The existing `.github/workflows/ci.yml` already satisfies the required failure-diagnostic policy. CI commands are wrapped so result metadata, stdout, stderr, and combined logs are retained, failure context is collected, and a `ci-failure-diagnostics-${{ github.run_id }}-${{ github.run_attempt }}` artifact is uploaded with test output and investigation material.

No workflow change was required. The new Red phases both produced and used this diagnostic path.

## Design

### Lazy PR full scan

Review Contexts may enumerate several saved PRs. Scanning all files for every PR merely because the Review Contexts tree is opened would recreate the performance problem addressed by Issue #59.

A lazy provider boundary was therefore added in:

- `src/application/global-understanding/pull-request-global-head-file-registry.ts`

`PullRequestReviewRuntime.register()` only registers a provider for the PR context. It does not read file bodies. The full scan is requested only when `T505GlobalUnderstandingSource` is recalculating an active `pull-request` Global context.

### Immutable full-text cache

`src/t405-pull-request-review-runtime.ts` now maintains an in-memory full-text cache for each registered PR context. The cache is bound to the exact `baseSha` and `headSha` pair and stores individual reads by `revision + repository path`.

Consequences:

- modified / added / renamed / copied files: complete HEAD-side text is read once;
- deleted files: complete BASE-side text is read once;
- repeated Global refreshes at the same immutable PR revisions reuse the same promises/results;
- a changed BASE or HEAD invalidates the context cache and creates a new immutable cache;
- a failed read is evicted so a later operation may retry rather than permanently caching a transient failure;
- binary and shared-policy excluded files are not line-scanned.

Only HEAD-side files are returned to the Global evidence consumer. Deleted files are scanned and cached but omitted from that return value because they do not exist in the current HEAD tree.

### Parsed Global evidence cache

`src/t505-global-understanding-source.ts` promotes the returned PR HEAD files into the same opened-evidence model used by ordinary editor-opened files.

The raw PR text is converted to:

- line count;
- non-empty line coordinates;
- content hash;
- stable exact-PR cache key.

That parsed representation is cached by repository target + PR context + exact HEAD revision + path. Consequently repeated recalculation reuses both layers:

1. T405 does not reread immutable PR text;
2. T505 does not redo line parsing/hash construction for already parsed exact-HEAD content.

A currently open VS Code document may still provide the live evidence for the current calculation, while the retained immutable PR evidence remains available after the editor closes.

### Ordinary Global behavior remains lightweight

The earlier Issue #59 behavior is preserved:

- repository discovery is path-only;
- unopened ordinary files are not content-read merely to calculate Global progress;
- line progress uses opened/retained evidence;
- opened and unopened candidate counts are displayed separately;
- a PR full scan is initiated only for an active PR Global context.

## TDD evidence

### Original Issue #59 Red

- Test-only HEAD: `534553c6bf515b8884fbb62d479c0657f19e6387`
- Exact matching CI run: `32003811348`
- Conclusion: failure
- Failure: unopened repository content still increased the Global non-empty-line denominator from the expected `2` to `4`.
- Diagnostic artifact id: `9279332376`

This established the initial need to remove ordinary repository-wide content reads.

### Follow-up Red 1: PR scan and cache

- Test-only HEAD: `1aaff563edf756e0237229bfbc5ba0819111c2aa`
- Exact matching CI run: `32009302780`
- Conclusion: failure
- Failed step: `T405 Review Contexts follow-up tests`
- Failure: the regression required `readGlobalHeadFiles`; the existing runtime had no complete-file PR scan/cache API.
- Diagnostic artifact: `ci-failure-diagnostics-32009302780-1`
- Artifact id: `9281164978`

Implementation then added lazy provider registration, immutable HEAD full-text caching, and PR-to-Global evidence promotion.

### Intermediate Green

- Technical HEAD: `e31d0abad257960efd469a1165f7003c7b105407`
- Exact matching CI run: `32009597981`
- Conclusion: success
- Coverage passed: build, contract typecheck, architecture gates, lint, Unit, T602, T603, T403, T404, T405, T304, T502, T503, T504, T505, T506, Git integration, GitHub integration, and VS Code Extension Host.

During implementation self-inspection, the accepted deleted-file behavior was identified as not yet covered: deleted files were omitted entirely instead of having their BASE content scanned.

### Follow-up Red 2: deleted BASE full scan

- Test-only HEAD: `8988ca464ea802651e21a1f75b04c205335a9ae7`
- Exact matching CI run: `32010027596`
- Conclusion: failure
- Failed step: `T405 Review Contexts follow-up tests`
- Expected reads included `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:src/deleted.ts`; actual reads contained only the two HEAD-side files.
- Diagnostic artifact: `ci-failure-diagnostics-32010027596-1`
- Artifact id: `9281427952`

The implementation was then extended to cache both immutable revisions and read deleted files from BASE while keeping them out of Global HEAD evidence.

### Final technical Green

- Technical HEAD: `35e597f4933b3121ee4f081cba5ccac8a26186d8`
- Exact matching CI run: `32010265126`
- Job: `95328130530`
- Conclusion: success
- All required steps succeeded, including:
  - Build
  - Contract typecheck
  - Architecture validation / negative contract
  - Lint
  - Unit tests
  - T602 / T603 / T403 / T404 / T405
  - T304 / T502 / T503 / T504 / T505 / T506
  - Temporary Git integration
  - Mock GitHub integration
  - VS Code Extension Host tests

No workflow run from another SHA was used as evidence for these gates.

## Files added or changed by this follow-up

Production:

- `src/application/global-understanding/pull-request-global-head-file-registry.ts`
- `src/t405-pull-request-review-runtime.ts`
- `src/t505-global-understanding-source.ts`

Tests:

- `test/unit/t405-pull-request-review-runtime.test.ts`
- `test/unit/t505-global-understanding-source.test.ts`

The PR also retains the earlier Issue #59 changes for path-only repository enumeration and Global opened/unopened diagnostics.

## Cache and invalidation semantics

- Cache lifetime: current Extension Host process.
- PR raw text identity: exact PR context plus exact BASE/HEAD pair and revision/path entry.
- Parsed Global identity: repository target + current revision + path.
- HEAD change: no old HEAD evidence is reused for the new revision.
- BASE change: full-text PR cache is invalidated because deleted/base-side content may have changed.
- Read failure: failed raw-text promise is removed to permit a later retry.
- Deleted files: full BASE text may be cached for PR review, but no Global opened evidence is emitted because the file is absent at HEAD.
- Binary / configured exclusions: remain outside line-review/full-line aggregation semantics.

## Remaining trade-offs

- The new caches are in-memory and are intentionally not persisted across Extension Host restart.
- Lightweight repository path enumeration still traverses directories to compute candidate/opened/unopened counts; the change removes unopened content reads, not directory traversal.
- PR full scans can still be expensive for a very large PR on first use. That cost is explicit to the selected PR context and is amortized by immutable revision caching rather than repeated on every Global refresh.

## Repository bookkeeping

`tasks/tasks-status.md` was intentionally not edited. Its repository-local instructions restrict updates to designated progress-management skills, which are not available in this worker context.

## Handoff

A schema-v3 continuation packet for this follow-up is stored at:

- `handoffs/issue-59-pr-full-scan-cache-followup.yaml`

The report/handoff commit itself requires a new exact-HEAD CI run. The PR comment is the authoritative final attestation for that documentation HEAD, because writing a later SHA back into this file would create another HEAD.

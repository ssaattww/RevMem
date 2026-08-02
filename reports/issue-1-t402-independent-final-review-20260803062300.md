# T402 Independent Final Review

## Metadata and immutable target

- Report type: independent final review report
- Repository: `ssaattww/RevMem`
- Pull request: `#40` (`task/t402-pr-diff-acquisition`)
- Task: `T402`
- Base ref: `origin/main`
- Base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Reviewed implementation HEAD: `1e2309d331aa908aa9cb90ebd96da821139f1af5`
- Commit range: `76b49e99453ebcf7ebecb2c141ed24d750736abc..1e2309d331aa908aa9cb90ebd96da821139f1af5`
- Reserved report path: `reports/issue-1-t402-independent-final-review-20260803062300.md`
- Review mode: independent final review
- Reviewer identity: fresh Codex independent reviewer `/root/pr40_independent`
- Independence: the reviewer did not implement T402, did not implement any review fix, and did not serve as the normal reviewer or fix-verification reviewer.
- Merge, commit, push, PR mutation: not performed

The technical verdict in this report applies only to `1e2309d331aa908aa9cb90ebd96da821139f1af5`. Local HEAD, the PR API head, and `origin/task/t402-pr-diff-acquisition` all matched that SHA at the start and end of the review. GitHub `main` and local `origin/main` both matched the base SHA above.

## Purpose, accepted scope, and non-goals

T402 must acquire PR metadata and the complete changed-file set, then obtain one identity-bound diff in this order:

1. local base/head Git objects;
2. GitHub Pull Request Files API patches;
3. immutable base/head file contents with local reconstruction.

Missing, incomplete, stale, transformed, or ambiguous evidence must not be exposed as a complete snapshot or used to infer reviewed lines. The result must remain compatible with the T301 snapshot/progress contract, including binary exclusion and exact changed-line coordinates.

Authoritative sources inspected were `tasks/tasks-status.md` T402 and AC-24, `tasks/phases-status.md` P4, `doc/design/vscode-review-range-tracker-design.md` sections 11.2, 12, 13, 14, 20, and 21, the complete PR diff, PR metadata and reviews, all T402 reports and handoffs, and the current-head CI records.

T403 cache/offline persistence, T404 persistent PR layers, T405 UI/runtime composition, release, and merge remain non-goals. Runtime composition is therefore not treated as a T402 defect. The additive public API does not remove or alter an existing public contract, so a breaking-changes entry is not applicable.

## Inspected change set and direct dependencies

The full PR diff contains 31 changed paths, 5,597 insertions, and 1 deletion. Every changed path was inspected.

### Product and public API paths

- `package.json`
- `src/adapters/github/fetch-github-pull-request-diff-adapter.ts`
- `src/adapters/github/index.ts`
- `src/adapters/local-git/index.ts`
- `src/adapters/local-git/local-git-pull-request-diff-adapter.ts`
- `src/application/github-pr-diff/content-diff-builder.ts`
- `src/application/github-pr-diff/contracts.ts`
- `src/application/github-pr-diff/github-patch-diff-builder.ts`
- `src/application/github-pr-diff/index.ts`
- `src/application/github-pr-diff/local-git-diff-builder.ts`
- `src/application/github-pr-diff/pull-request-diff-acquisition-service.ts`
- `src/application/github-pr-diff/pull-request-diff-builders.ts`
- `src/application/github-pr-diff/request-validation.ts`
- `src/application/github-pr-diff/snapshot-builder-shared.ts`

### Test and contract paths

- `test/integration/t402-pr-diff-acquisition.test.ts`
- `test/integration/t402-pr-diff-boundary.test.ts`
- `test/integration/t402-review-followup.test.ts`
- `type-fixtures/contracts/t402-pr-diff-acquisition.fixture.ts`
- `type-fixtures/contracts/tsconfig.json`

### Reports and handoffs

- `reports/issue-1-t402-implementation-20260802215000.md`
- `reports/issue-1-t402-handoff-20260802215000.yaml`
- `reports/issue-1-t402-review-20260802221650.md`
- `reports/issue-1-t402-review-handoff-20260802221650.yaml`
- `reports/issue-1-t402-review-followup-20260802225300.md`
- `reports/issue-1-t402-review-followup-handoff-20260802225300.yaml`
- `reports/issue-1-t402-fix-verification-20260802230000.md`
- `reports/issue-1-t402-fix-verification-handoff-20260802230000.yaml`
- `reports/issue-1-t402-fix-verification-followup-20260802233000.md`
- `reports/issue-1-t402-fix-verification-followup-handoff-20260802233000.yaml`
- `reports/issue-1-t402-fix-verification-r2-20260803050000.md`
- `reports/issue-1-t402-fix-verification-r2-handoff-20260803050000.yaml`

Direct dependencies inspected include the T203 zero-context Git parser, T301 snapshot validator and progress calculator, shared `PullRequestFileChange` contracts, repository-relative path validation, T300 exclusion policy, T401 GitHub identity/authentication and remote URL helpers, Local Git command executor contracts, `.github/workflows/ci.yml`, and the package test/contract/architecture wiring. The application dependency direction and public barrel fixture are valid. No dependency version or lockfile change is present.

## Findings

### T402-IFR-P1 — High — Local Git accepts textconv output as source-line coordinates

- Origin: independently discovered in final review
- Location: `src/adapters/local-git/local-git-pull-request-diff-adapter.ts:70-91`, especially the Git arguments at lines 80-89
- Description: the adapter passes `--no-ext-diff` but not `--no-textconv`. Porcelain `git diff` can therefore invoke a configured textconv driver and return the driver's transformed text rather than the immutable blob's actual lines. `buildSnapshotFromLocalGitDiff` accepts those transformed hunk coordinates as T301 source coordinates and returns the local route immediately, so the exact-content remote fallbacks never get a chance to correct them.
- Impact: a changed actual line can be reported at a different coordinate, or transformed output can have a completely different line count. The snapshot can then mark or count the wrong source line, violating the exact immutable-diff and AC-24 certainty requirements. It also lets configured external text conversion execute during acquisition even though external diff execution was explicitly disabled.
- Evidence: an independent temporary Git repository configured `*.foo diff=foo` and `diff.foo.textconv = git hash-object`. With the current adapter flags, changing only actual line 2 produced `@@ -1 +1 @@` with blob hashes as the deletion/addition. Repeating the same comparison with `--no-textconv` produced `@@ -2 +2 @@ shared` with `actual-old` and `actual-new`. Existing invocation tests assert `--no-ext-diff` but contain no textconv case.
- Required action: explicitly disable textconv for both ordinary and harder local diff passes, and add a temporary-repository regression that configures a textconv driver, changes only a non-first actual line, and proves that the acquired snapshot uses raw blob coordinates and text. Preserve the existing rename/copy limits and fail-closed diagnostics.

### T402-IFR-P2 — High — Patchless zero-stat binary files bypass immutable-content classification

- Origin: independently discovered sibling of the historical `T402-R002` defect class; this is a new independent finding, not a severity reclassification
- Location: `src/application/github-pr-diff/github-patch-diff-builder.ts:176-185` and `src/application/github-pr-diff/pull-request-diff-acquisition-service.ts:92-112`
- Description: for a non-`modified` file with `additions === 0`, `deletions === 0`, and no patch, the patch builder returns a successful empty-hunk snapshot. It does not prove whether the file is an empty/rename-only text file or a binary file, so the content fallback is skipped. The prior R002 regression covers only patchless zero-stat `modified` files.
- Impact: an added, deleted, renamed, or copied binary can be emitted as a nonbinary status. T301 then reports `excluded: false` and zero-denominator progress `1` instead of the shared binary exclusion reason. This contradicts design sections 11.2 and 12, the implementation report's binary guarantee, and the R002 closure statement. Downstream file classification can display a binary change as completed or rename-only rather than binary/out-of-scope.
- Evidence: an independent source-level probe supplied a remote `added` record for `assets/new.bin` with zero statistics and no patch, while `readFile` was prepared to return `{ kind: "binary" }`. The result was acquired from `github-patch`, `readFile` was called zero times, and the snapshot status remained `added`. Passing that snapshot to the real T301 calculator returned `progress: 1` and `excluded: false`. Existing tests contain only the `modified` binary case.
- Required action: do not treat patchless zero-stat records as classification-complete unless trusted evidence proves their binary/text nature. Route all affected status variants through immutable contents or carry an equivalent trusted binary classification, then test added, deleted, renamed, and copied sibling cases through the shared binary exclusion while retaining valid empty-text and rename-only behavior.

### T402-IFR-P3 — Medium — Authoritative task and phase tracking were not synchronized before freeze

- Origin: independently discovered lifecycle and documentation defect
- Location: `tasks/tasks-status.md:267`, `tasks/phases-status.md:123-133`, and the T402 implementation/follow-up/fix-verification reports
- Description: T402 remains `未着手`, and P4 progress describes only T401 even though the branch contains T402 implementation, normal review, two fix-verification rounds, reports, and current-head CI. Multiple reports explicitly deferred tracking because a dedicated progress Skill owns it, but the independent-final-review pre-freeze gate requires that Skill-owned synchronization to be completed before the target is frozen.
- Impact: repository-authoritative tracking contradicts the implementation and review state, misleads T403 dependency/start decisions, and means the supplied frozen target did not satisfy the pre-freeze lifecycle gate. A report-attestation commit cannot cure this because tracking is outside the reserved report allowlist.
- Evidence: the task row at the reviewed HEAD is unchanged from base and says `未着手`; neither tracking file appears in the 31-path PR diff. The latest normal verification report says task tracking was intentionally unchanged while also declaring the implementation ready for independent final review.
- Required action: use `progress-sync-manager` to update T402 and P4 to the actual state. Because that is a repository change outside this reserved report, invalidate the current freeze, include the tracking update and code fixes in a new implementation HEAD, run normal fix verification and matching CI, then start a fresh independent final review.

## Finding and severity continuity

Historical findings `T402-R001` High, `T402-R002` High, `T402-R003` Medium, and `T402-R004` High remain recorded exactly as issued. This review does not rewrite their historical dispositions or severities. `T402-IFR-P2` identifies a previously untested sibling boundary that makes the current R002 closure claim incomplete; it is recorded as a new High finding. No severity reclassification or erratum to a historical severity is required.

## Coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirement and design conformance | `checked_finding` | P1 violates raw immutable line coordinates; P2 violates binary exclusion; P3 violates the pre-freeze tracking gate. |
| Correctness and edge cases | `checked_finding` | Reproduced textconv coordinate substitution and zero-stat added-binary misclassification. |
| Scope discipline and unrelated changes | `checked_no_finding` | Product changes remain within T402; T403-T405 and runtime composition were not broadened. |
| All changed files and direct dependencies | `checked_finding` | All 31 changed paths plus T203, T301, T300, T401, Git executor, workflow, design, and tracking dependencies were inspected; P1-P3 apply. |
| API, data, configuration, workflow, and compatibility | `checked_finding` | P1 is Git configuration-sensitive; P2 loses remote file-type evidence. Public API is additive and its consumer fixture passes. |
| Error handling and failure diagnostics | `checked_no_finding` | Known unavailable routes remain fail-closed, request arguments are separated, pagination is bounded, and CI retains failure logs/artifacts. P1/P2 are false-success paths, recorded under correctness. |
| Security and secret handling | `checked_no_finding` | No token persistence or logging was added; pagination is same-origin and authentication remains supplied by the T401 boundary. The textconv execution surface is fully recorded in P1. |
| Tests and validation adequacy | `checked_finding` | Registered tests pass but omit both P1 and P2 sibling cases, so CI success does not disprove them. |
| Current-HEAD CI evidence | `checked_no_finding` | Push run `30764761227` and pull-request run `30764763013` both use the exact reviewed HEAD and all configured jobs/steps succeeded. |
| Reports, handoffs, and tracking accuracy | `checked_finding` | P2 contradicts the binary/R002 closure claims; P3 leaves task and phase tracking stale. Historical finding identities and CI SHAs are otherwise consistent. |
| Regression and maintainability risk | `checked_finding` | Repository Git configuration can silently change snapshot semantics, and status-specific patch handling has an untested classification gap. |
| Breaking-change record | `not_applicable` | The PR adds public contracts and barrels without removing or changing an existing contract. |
| Independent-review lifecycle and attestation | `checked_finding` | P3 means the pre-freeze gate was incomplete; P1-P3 make the verdict fail and attestation ineligible. |

## Validation and CI assessment

- `git diff --check origin/main...HEAD`: passed.
- `git merge-tree --write-tree origin/main HEAD`: passed, producing tree `7fb8c6f992e11685d9ebce8cd6fdb2b4ca5b57d7` with no merge conflict.
- `npm ci`: passed. It reported one existing High audit advisory and two allow-scripts notices; no lockfile is changed by this PR.
- `npm run build`: passed.
- `npm run typecheck:contracts`: passed.
- `npm run validate:architecture`: passed.
- `npm run validate:architecture:negative`: passed with the expected 11 violations.
- `npm run lint`: passed.
- `npm run test:t402`: 23 passed, 0 failed.
- `npm run test:github`: 36 passed, 0 failed.
- `npm run test:git`: 33 passed, 0 failed, 3 platform skips.
- `npm test`: stopped in the unit stage with 366 passed, 19 failed, and 2 skipped. All 19 failures are the known Windows/POSIX fixture portability failure tracked by open Issue #28 and share `document path is outside the resolved Git working tree`; the command therefore did not run its later chained stages. The T402, GitHub, and Git stages were run separately as above.
- Independent probe for P1: failed the required raw-coordinate contract under current flags and passed the same comparison with `--no-textconv`.
- Independent probe for P2: failed the required binary exclusion contract, returning `github-patch`, zero content reads, `status: added`, `excluded: false`, and `progress: 1`.
- GitHub Actions pull-request run `30764763013`, job `91541385904`: `head_sha` exactly equals the reviewed HEAD; completed `success`; install, build, contract typecheck, architecture positive/negative, lint, unit, T503, Git, GitHub, and VS Code Extension Host steps all succeeded.
- GitHub Actions push run `30764761227`, job `91541381239`: same exact `head_sha`, completed `success`, and the same configured gates succeeded.
- Exact-head CI is valid evidence for the covered cases, but neither current test suite contains the P1 or P2 reproducer.

## Held, unexplored, unknown, and intentionally untouched

### Held

- Open Issue #28 owns the existing Windows/POSIX fixture portability problem. It is independent of this PR's product diff and does not hide either reproduced T402 finding.
- `npm audit` reports one existing High `brace-expansion` denial-of-service advisory through the development/package chain `@vscode/vsce -> minimatch -> brace-expansion`. `package-lock.json` is unchanged, so dependency remediation is held to repository dependency maintenance and is not used to broaden T402.
- Repository Markdown wording lint is unsupported: there is no `tools/lint/` configuration and no `lint:md` package script. The report was manually checked for unresolved placeholders, terminology context, and backtick/quote evasion; unsupported is not represented as a lint pass.

### Unexplored

- None. Live GitHub Enterprise and T403-T405 runtime/UI behavior are explicit non-goals, not unexplored T402 acceptance areas. The relevant host/token boundary, API shapes, pagination, source construction, and current-head workflow behavior were inspected through direct dependencies, mocks, and CI.

### Unknown

- None.

### Intentionally untouched

- T403 cache/offline behavior, T404 persistence, T405 UI/runtime composition, merge, and release.
- `.github/workflows/ci.yml`, because its configured diagnostics and exact-head gates were inspected and remain sufficient.
- Product, test, design, workflow, configuration, tracking, Skill, feedback, and handoff files were not modified during this independent review. The stale tracking is a required finding, not an accepted omission.

## Remaining risks

After P1-P3 are addressed, expected conservative limitations remain: PRs at or above the 3,000-file endpoint cap may require the local route; content reconstruction rejects large or non-unique LCS alignments; and runtime cache/persistence/UI integration remains assigned to T403-T405. These are explicit fail-closed or later-task boundaries and do not reduce the severity of the current findings.

## Verdict and next action

- Verdict: **fail**
- Required findings: `T402-IFR-P1` High, `T402-IFR-P2` High, `T402-IFR-P3` Medium
- Held items: three non-blocking items recorded above
- Unexplored areas: none
- Report-attestation allowed: **false**
- Report-attestation HEAD: `null`

Return to implementation and normal review. Add failing regressions for P1 and P2 before their fixes, synchronize T402/P4 tracking through the owning Skill, update the implementation evidence, commit and push all non-final changes, obtain current-head validation and CI, and have the normal reviewer perform fix verification. Only after that cycle converges may a different fresh reviewer freeze a new implementation HEAD and perform another independent final review.

## Persistence and attestation boundary

This file uses the pre-reserved path, but the failing verdict means it is a normal repository review artifact, not an administrative report-attestation commit. Committing this report is part of the non-final follow-up cycle and must occur before a later freeze.

For a future passing independent review, an administrative attestation would be acceptable only if exactly one commit follows the newly reviewed implementation HEAD, its first parent is that reviewed HEAD, its diff changes only the path reserved for that review, the report names the reviewed implementation HEAD and administrative purpose, no executable, Skill, design, workflow, configuration, tracking, feedback, handoff, or product path changes, and no later commit exists. The attestation SHA must be recorded externally after commit. Any later Git commit invalidates completion and requires a new normal-review and independent-review lifecycle.

No merge is authorized or performed by this report.

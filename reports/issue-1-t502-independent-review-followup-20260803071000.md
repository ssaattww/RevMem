# T502 independent review follow-up

## Metadata / target identity

- Repository: `ssaattww/RevMem`
- Issue / task / PR: Issue #1 / T502 / PR #37
- Mode: `review_followup_implementation`
- Branch: `task/t502-global-mapping-display-priority`
- Base ref: `origin/main`
- Reviewed implementation HEAD: `a18475ef05e6db7979c2247e4189e57caf9649a4`
- Current HEAD: `a18475ef05e6db7979c2247e4189e57caf9649a4` (uncommitted follow-up workspace)
- Authoritative finding report: `reports/issue-1-t502-independent-final-review-20260803062000.md`
- Reserved report path: `reports/issue-1-t502-independent-review-followup-20260803071000.md`
- Persistence mode: normal repository file; no commit, push, PR update, merge, or independent-review verdict was performed.

## Scope and non-goals

Implemented only `T502-IFR-001` through `T502-IFR-005` in one batch. Global understanding-rate calculation/cache, Global Understanding View, Status Bar, configuration UI, production consumer integration, historical reports, and Issue #28 remediation remain untouched.

The design impact was reviewed before code changes. These are internal fail-closed and evidence-validation corrections required by the existing AC-24 and design section 11.4; they add no public API, schema, configuration, file format, or breaking contract. `doc/design/` and `Design/BreakingChanges.md` therefore remain unchanged.

## Finding dispositions

| Finding | Severity | Disposition | Evidence |
| --- | --- | --- | --- |
| `T502-IFR-001` | high | addressed | `currentPullRequestChangedIntervals` now returns `certain: false` when the target file ID is absent but another diff entry occupies the target current path. Lower-priority other-context/Global decoration is thereby suppressed. The same-path/different-ID regression passes. |
| `T502-IFR-002` | high | addressed | `mapRepositoryGlobalStateThroughGitDiff` validates every ordinary same-path modified destination metadata entry against the original Global stable file ID before invoking the T204 transaction. A mismatch throws, so the complete mapping transaction is rejected with no partial state. The identity-mismatch regression passes. |
| `T502-IFR-003` | medium | addressed | Omitted `oldLineCounts` now uses the maximum of reviewed old extent and validated parsed old-hunk extent; new-revision metadata is never used as old-line-count evidence. The sparse-range, tail-delete rename regression supplies full old/new text evidence and passes without `oldLineCounts`. |
| `T502-IFR-004` | medium | addressed | `tasks/tasks-status.md` records T502 as implemented with normal fix verification still pending, and `tasks/phases-status.md` records the same P5 state. |
| `T502-IFR-005` | low | addressed | Added `test:t502`, included the suite in `test:unit` and `npm test`, changed CI to invoke the canonical script, and added a workflow/package contract regression. |

Source finding identities and severities are preserved. No severity reclassification or erratum was made.

## TDD and regressions

The follow-up added regressions before the production changes. The initial `npm run test:t502` Red result reproduced the two direct behavioral defects:

- same-path/different-ID PR diff exposed other-context decoration instead of failing closed;
- same-path modified Git metadata with a different file ID was accepted instead of rejecting the transaction.

After the implementation, the focused suite is Green at 10/10. The old-extent regression was then strengthened with complete old/new text evidence so it verifies that a sparse reviewed range plus a tail hunk can establish the old extent without using destination metadata. No artificial Red/Green claim is made for that later strengthening.

## Changed files

- `.github/workflows/ci.yml`: invoke `npm run test:t502` in the focused CI step.
- `package.json`: define `test:t502`; include it in `test:unit` and `test`.
- `src/application/editor-decoration/normal-editor-decoration-model.ts`: fail closed on same-path/different-ID diff evidence.
- `src/application/global-review-mapping/global-review-mapping.ts`: validate same-path modified identity and infer only sound old extent.
- `test/unit/ci-workflow-contract.test.ts`: lock focused/default/CI test wiring.
- `test/unit/global-review-mapping-display-priority.test.ts`: add the three product regressions.
- `tasks/tasks-status.md`, `tasks/phases-status.md`: synchronize actual T502/P5 state.
- this report.

## Validation

| Command | Result |
| --- | --- |
| `npm run test:t502` | success, 10/10 |
| `node --test test-dist/test/unit/ci-workflow-contract.test.js` | success, 5/5 |
| `npm run test:t203` | success, 17/17 |
| `npm run test:t204` | success, 45/45 |
| `npm run test:t301` | success, 20/20 |
| `npm run build` | success |
| `npm run lint` | success |
| `npm run typecheck:contracts` | success |
| `npm run validate:architecture` | success |
| `npm run validate:architecture:negative` | success; expected 11 violations reported |
| `npm run test:git` | success, 33 passed and 3 Windows POSIX skips |
| `npm run test:github` | success, 13/13 |
| `npm run test:vscode` | success |
| `git diff --check` | success; CRLF conversion warnings only |

`npm run test:unit` executed the now-wired T502 suite successfully, but its complete result is 378 passed, 19 failed, 2 skipped. Every failure is the existing Windows POSIX fixture portability error `document path is outside the resolved Git working tree`. This exactly matches the documented open Issue #28 evidence (for example `reports/issue-1-t205-ifr1-verification-20260801204500.md`); no T502 changed file occurs in those failure stacks. It remains held and outside this finding batch. No separate Issue #36-specific failure was observed.

Current-HEAD CI is absent because this follow-up has intentionally not been committed or pushed; it is not represented as success.

Focused and full Markdown terminology lint are `unsupported`: this repository has no `tools/lint/`, `lint:md`, `cspell.config.jsonc`, or other Markdown lint wiring. This is recorded rather than treated as pass; no whitelist or terminology configuration was added.

## Standards, risks, and next action

No public/protected C# or exported TypeScript surface was added or changed, so no new API documentation obligation was introduced. TypeScript lint, contracts, and architecture gates above provide the applicable coding-standards evidence.

Remaining required workflow is normal fix verification, commit/push by the owning workflow, matching current-head CI, re-freeze, and a fresh independent final review. This report gives implementation evidence only and does not provide an independent-review verdict.

# T603 review follow-up / evidence correction report

## 1. Metadata

- Repository: `ssaattww/RevMem`
- Pull Request: `#53`
- Task: `T603`
- Branch: `task/t603-schema-migration-recovery`
- Base: `main`
- R2 reviewed implementation HEAD: `6a7d66e2cfbdfe226b8e958151b318ced83e6d13`
- R2 review artifact HEAD: `8a4f79eaa46f3fc98bf71bc3ee6ea588ae21e6e7`
- Review-fix technical HEAD: `1f118bcd77b6481b65d8bff303684b0920322c63`
- Technical exact-head CI: run `31940328280`, job `95148441713`, conclusion `success`
- Merge: not performed. Merge remains reserved for the user.

This report is a follow-up to `reports/issue-1-t603-implementation-20260816145900.md`. The earlier report and handoff are retained as historical records. Where identifiers conflict, the correction table in this report is authoritative for the cited GitHub evidence.

## 2. Diagnostic artifact workflow check

At follow-up start, `.github/workflows/ci.yml` already satisfied the required failure-diagnostic policy:

- command stdout/stderr is captured with `2>&1 | tee test-output/ci/*.log`;
- failure context records environment, Git status and generated files;
- the failure artifact includes `test-output/`, `dist/`, `test-dist/`, `src/`, `test/`, tools, configuration and workflow files;
- `Upload failure diagnostics` is guarded with `if: failure()`.

No separate diagnostic workflow was required. The T603 focused step was extended so review-finding regressions, the JSONL store tests, and the multi-context history regression all execute under the same diagnostic path.

## 3. Review findings disposition

### T603-R001 — deep validation / stale cache / Global uncertainty

**Addressed.** Review-fix commits hardened current-schema validation and fail-closed cache behavior. Regression coverage verifies deep corruption is quarantined, stale cached state is hidden, and owner-wide Global uncertainty invalidates sibling cached contexts.

### T603-R002 — migration chain coupled to current schema constant

**Addressed.** Migration steps are explicit adjacent transitions rather than an implicit `0 -> current` jump. Regression coverage verifies an adjacent `0 -> 1 -> 2` chain can advance to a supplied future target.

### T603-R003 — manifest reference advancement before all contexts migrate

**Addressed.** Repository migration prepares/migrates all manifest-referenced contexts before publishing advanced references. Regression coverage verifies all referenced contexts reach the current schema even when loading an absent target.

### T603-R004 — nested future schema could be downgraded

**Addressed.** Future nested schema is rejected as unsupported and is neither rewritten nor quarantined as ordinary corruption. Regression coverage verifies the original future-schema data remains intact.

### T603-R005 — malformed schema metadata / `null` snapshot schema

**Addressed.** Malformed schema metadata is treated as corruption, while only truly absent legacy metadata follows the legacy migration path. Explicit `null` snapshot schema is quarantined rather than interpreted as missing version information.

### T603-R006 — inner snapshot payload corruption

**Addressed.** Gzip/decompression failure, payload hash mismatch, and invalid decoded envelope are fail-closed. Corrupt snapshot evidence is quarantined and the latest pointer is invalidated. Focused regression coverage exists for all three cases.

### T603-R007 — incorrect durable GitHub evidence identifiers

**Addressed by explicit erratum; historical files were not silently rewritten.** See section 4. The earlier implementation report/handoff contain several incorrect job/artifact/SHA identifiers. This report supersedes those identifiers while preserving the earlier records for auditability.

### T603-R008 — corrupt JSONL salvage+append contradicted accepted design

**Implementation changed to the accepted design behavior.** A corrupt existing monthly JSONL file is copied to quarantine but remains active, and append rejects without adding a new event. No salvage+append path remains in the review-fix implementation.

The reviewer also raised authority conflict `T603-B001`: the task wording can be read as permitting recovery/salvage, while accepted design rev4 §15.4 requires reject/no append. No explicit user/owner decision selecting one interpretation was found during this follow-up. The code currently preserves the accepted design behavior; the authority decision itself remains for the user/reviewer if they require explicit resolution.

### T603-R009 — manifest reference could quarantine/delete valid child evidence

**Addressed.** Manifest-reference validation protects child documents from misreference/cross-subtree corruption. Regression tests verify a valid sibling context and Global document are preserved while the corrupt manifest/pointer is quarantined.

### T603-R010 — migration was lazy rather than startup-staged

**Addressed.** `src/adapters/persistence-startup-migration.ts` performs startup migration for persisted state, historical JSONL, snapshot entries and latest pointers. Extension startup invokes this migration. The focused test verifies legacy data is migrated before normal use and pre-migration backups exist.

A test-wiring defect in this regression was found at HEAD `bc9c291693d3f545833d5789be89749ced140ffe`: the compiled ESM test dynamically imported the startup module without `.js`, producing `ERR_MODULE_NOT_FOUND`. Commit `37f16bfc73636e1d4767f626376a0bbe8f4a7a82` fixed only that import path.

### T603-R011 — changed JSONL test was not executed by CI

**Addressed.** The T603 CI step executes `t603-schema-migration-recovery.test.js`, `t603-review-findings.test.js`, `t603-history-multi-context-regression.test.js`, and `review-history-jsonl-store.test.js`.

### T603-R012 — initial Red did not cover the later review branches

**Addressed for review follow-up evidence.** Commit `1803fd389971230a582c6ef2c555611798cf387f` ran the comprehensive review-finding regression suite before the review-fix implementation. Exact-head run `31933261892` failed in the T603 step with 17 review-finding failures, artifact `9259902656`. The later sibling defect found after the first repair also received a separate test-first Red at `b55c18098734d09a1ad3762cf11d77343365281c`, run `31940277506`, artifact `9261824947`, before the implementation fix.

This does not rewrite history or claim that the original pre-review TDD suite had those cases; it records the explicit Red phase used for the review-fix work.

### T603-R013 — history owner/month/event identity validation

**Addressed, with one sibling-contract correction.** Monthly history validation now rejects wrong repository owner, wrong month and duplicate `eventId`. New event append still requires exact `repositoryId` and `contextId` match with its target.

The first R013 repair over-constrained existing repository history to a single `contextId`. Exact-head run `31940145917` at `37f16bfc73636e1d4767f626376a0bbe8f4a7a82` passed T603 but failed the existing T207 Git integration because one repository-scoped monthly history legitimately contains multiple branch contexts. A focused regression was added first at `b55c18098734d09a1ad3762cf11d77343365281c`; then `1f118bcd77b6481b65d8bff303684b0920322c63` limited existing-file owner consistency to `repositoryId`, preserving multi-context history while retaining exact identity checks for the newly appended event. Exact-head run `31940328280` passed T207 and the full CI.

### T603-R014 — quarantine removal bypassed injected persistence abstraction

**Addressed.** Quarantine removal uses the injected `AtomicTextFileStore` deletion boundary. A virtual-store regression verifies removal and sidecar persistence without direct filesystem deletion.

## 4. R007 evidence erratum

The following GitHub evidence was re-read through the GitHub connector. These values supersede conflicting identifiers in `reports/issue-1-t603-implementation-20260816145900.md`, `handoffs/issue-1-t603-implementation-20260816150000.yaml`, and the earlier PR description.

| Evidence | Earlier recorded value | Authoritative value |
|---|---|---|
| Initial TDD Red run | `31929190714` | `31929190714` |
| Initial TDD Red HEAD | `3c88a86bd0e1a47a43a259b53db431cc8724d40e` | `3c88a86bd0e1a47a43a259b53db431cc8724d40e` |
| Initial TDD Red job | `95120961967` | `95121366762` |
| Initial TDD Red artifact | `5717201218` | `9258779700` (`ci-failure-diagnostics-31929190714-1`) |
| Initial lint-failure run | `31929450198` | `31929450198` |
| Initial lint-failure HEAD | `ac2f13c0fcaf0a7ac32988d636e640b64aef4a0f` | `ac2f13c0fcaf0a7ac32988d636e640b64aef4a0c` |
| Initial lint-failure job | `95121963562` | `95121963562` |
| Initial lint-failure artifact | `5717346948` | `9258848153` (`ci-failure-diagnostics-31929450198-1`) |
| Existing-unit failure run | `31929675591` | `31929675591` |
| Existing-unit failure HEAD | `4e9a09be675bdd3c83312a2717db5f75d4691a8c` | `4e9a09be675bdd3c83312a2717db5f75d4691a8c` |
| Existing-unit failure job | `95122672378` | `95122502746` |
| Existing-unit failure artifact | `5717460644` | `9258909583` (`ci-failure-diagnostics-31929675591-1`) |
| Green run after notification fix | `31929798612` | `31929798612`, job `95122794408`, HEAD `f9dd96383cb17400210e95d8e21ac6e378baf531` |
| Technical implementation Green | `31929935759` | `31929935759`, job `95123109494`, HEAD `95650f72632fa482a08f32a6bf3f6cefeaa7340f` |

## 5. Review-follow-up TDD and CI evidence

### Comprehensive review Red

- HEAD: `1803fd389971230a582c6ef2c555611798cf387f`
- Exact-head run: `31933261892`
- Job: `95131183615`
- Result: `failure`
- T603 focused result: 29 tests, 12 pass / 17 fail
- Diagnostic artifact: `9259902656` (`ci-failure-diagnostics-31933261892-1`)

### Near-Green review fix and test-wiring correction

- HEAD before test import repair: `bc9c291693d3f545833d5789be89749ced140ffe`
- Exact-head run: `31934906491`
- Job: `95135184797`
- Result: `failure`
- T603 focused result: 29 pass / 1 fail (`ERR_MODULE_NOT_FOUND` in R010 test wiring)
- Diagnostic artifact: `9260356423`
- Repair: `37f16bfc73636e1d4767f626376a0bbe8f4a7a82` (`test: fix T603 startup migration module import`)

### Sibling regression discovered by full CI

- HEAD: `37f16bfc73636e1d4767f626376a0bbe8f4a7a82`
- Exact-head run: `31940145917`
- Job: `95148024787`
- Result: `failure`
- T603 focused: success
- Failure: `Temporary Git integration tests`; T207 rejected legitimate multi-context repository history as corrupt
- Diagnostic artifact: `9261796682`

### Test-first sibling Red

- HEAD: `b55c18098734d09a1ad3762cf11d77343365281c`
- Exact-head run: `31940277506`
- Job: `95148328727`
- Result: `failure` in T603 focused test
- Diagnostic artifact: `9261824947`
- New regression: same repository/month must permit history events from multiple contexts.

### Technical Green

- HEAD: `1f118bcd77b6481b65d8bff303684b0920322c63`
- Exact-head run: `31940328280`
- Job: `95148441713`
- Result: `success`
- Passed: build, contract typecheck, architecture validation/negative contract, lint, unit tests, T602, T603 including new multi-context regression, T403, T404, T304, T502, T503, T504, T505, Temporary Git including T207, Mock GitHub, VS Code Extension Host.

Only runs whose `head_sha` exactly matched the cited HEAD were used for each CI conclusion.

## 6. Review-follow-up commits

Review fixes already present before the final sibling correction:

- `8b0735dea303adc1043d816e709a1848aeb25dba` — add T603 review-finding regressions
- `1803fd389971230a582c6ef2c555611798cf387f` — execute review regressions in CI
- `d306ff34059dde765eb8b7dc3b4c4455604b692c` — harden persisted state recovery
- `e8df6e1ffd03fb6c8e235b7e6c381baecf2b714f` — preserve corrupt T603 history and snapshots
- `6115633657e8732e3d7c165ae8aee7d5892df5ef` — run T603 migrations during startup
- `e1af77af11b4dc2dcb56d63da695d8adb123f82a` — preserve owner reconciliation rejection semantics
- `09c50c1797ee51eb783d6305083171299b33b515` — reject initial owner reconciliation validation failure
- `bc9c291693d3f545833d5789be89749ced140ffe` — restore review repository method boundary

Additional fixes in this follow-up:

- `37f16bfc73636e1d4767f626376a0bbe8f4a7a82` — fix R010 compiled ESM test import
- `b55c18098734d09a1ad3762cf11d77343365281c` — add multi-context repository-history regression first
- `1f118bcd77b6481b65d8bff303684b0920322c63` — permit multi-context history within one repository owner while preserving R013 validation

## 7. Remaining authority item

`T603-B001` is not treated as silently resolved. The current code follows accepted design rev4 §15.4: corrupt existing JSONL is quarantined as evidence and append rejects without appending a new event. No explicit user/owner selection between that design wording and the broader task wording was found in available prior context.

Therefore:

- implementation defect R008 is corrected relative to accepted design;
- no `Design/BreakingChanges.md` change was made;
- an explicit user/reviewer authority decision may still be required to close `T603-B001` as a process finding.

## 8. Final administrative HEAD note

This report is committed after technical HEAD `1f118bcd77b6481b65d8bff303684b0920322c63`, so it cannot self-record the SHA of the commit that creates it. The post-report PR current HEAD and its exact matching CI run are recorded in the updated PR description/comment after this report is persisted.

# T504 Independent Fix Verification

## 1. Metadata and review identity

- Repository: `ssaattww/RevMem`
- Issue / task: Issue `#1` / `T504`
- Pull request: `#39` (`draft`, open)
- Review mode: same-reviewer closure-only fix verification
- Reviewer: Codex independent review worker `/root/pr39_independent`
- Source review: `reports/issue-1-t504-independent-final-review-20260803062200.md`
- Follow-up evidence: `reports/issue-1-t504-independent-review-followup-20260803083000.md`
- Failed reviewed implementation HEAD: `3de50b0f768da1d24fb2e87d07e58420482967e0`
- Fix commit: `673d0ead7264a4c0ddb32faf71436b2b691aad50`
- Integrated base: `origin/main` `0fdf87784355dce94fd4f1515a9e62d5257ecb75`
- Verified fix HEAD: `f5a758843facd6b7b00c4324c04b3cb7d819af55`
- Verified fix HEAD parents: `673d0ead7264a4c0ddb32faf71436b2b691aad50` and `0fdf87784355dce94fd4f1515a9e62d5257ecb75`
- PR head check: PR `#39` `headRefOid` matched the verified fix HEAD.
- Commit, push, PR mutation, and merge by this reviewer: not performed.

This verification is limited to closing `T504-IFR-001`, `T504-IFR-002`, and `T504-IFR-003` at the exact fix HEAD. It does not repeat the broad independent review, introduce a new review perspective, or create new finding identities.

## 2. Closure scope and restrictions

The authorized closure scope was:

- `T504-IFR-001`: immutable calculation input snapshot, one-snapshot evidence and calculation, and the interval/revision/included mutation siblings named by the source finding.
- `T504-IFR-002`: fatal malformed UTF-8 handling at the T503 enumeration and T504 source/recalculation boundaries, with synchronized design text.
- `T504-IFR-003`: T504 row, P5 state, and current-position tracking synchronization.
- Exact-HEAD focused tests and CI evidence.

The `origin/main` integration was checked only for preservation of these three fixes and their tracking state. Mainline changes outside those collision points were not broadly reviewed. No new review coverage or finding search was performed.

## 3. Finding dispositions

| Finding | Preserved severity | Disposition | Closure evidence |
| --- | --- | --- | --- |
| `T504-IFR-001` | high | **PASS** | The recalculator copies repository identity, revision, included path/count, open-file order, file identity/hash, and reviewed intervals into a frozen snapshot before the first cooperative source await. Source load, evidence-key construction, cache lookup/publication, and progress calculation consume that snapshot. Direct interval mutation and revision/included-count mutation regressions pass. |
| `T504-IFR-002` | medium | **PASS** | T503 now uses fatal UTF-8 decoding and classifies malformed non-NUL content as `invalid-encoding`; T504 source loading also uses fatal decoding and rejects invalid included content. Boundary regressions and synchronized design text pass inspection and focused validation. |
| `T504-IFR-003` | medium | **PASS** | Current-position tracking identifies PR `#39` / T504 and the remaining verification lifecycle; the T504 row records the fixes and remaining gates; P5 records the same state and malformed UTF-8 checkpoint. Main integration preserves these entries. |

All three source findings are closed without severity reclassification.

## 4. Detailed verification

### `T504-IFR-001` — PASS

- `src/application/global-understanding/global-understanding-background-recalculator.ts:76` defines the calculation snapshot contract.
- `src/application/global-understanding/global-understanding-background-recalculator.ts:198` deep-copies and freezes Global file identity, hash, and reviewed intervals.
- `src/application/global-understanding/global-understanding-background-recalculator.ts:213` snapshots repository ID, current revision, included path/count, and open-file priority.
- `src/application/global-understanding/global-understanding-background-recalculator.ts:309` creates that snapshot before source loading or another cooperative await.
- `src/application/global-understanding/global-understanding-background-recalculator.ts:333` through `src/application/global-understanding/global-understanding-background-recalculator.ts:371` use the snapshotted revision, included entry, Global file, and repository identity for load validation, evidence, cache behavior, calculation, and publication.
- `test/unit/t504-review-followup-r2.test.ts:107` proves interval mutation during a cooperative yield cannot poison later exact-evidence cache reuse.
- `test/unit/t504-review-followup-r2.test.ts:148` proves revision and included-count mutations during a source yield do not alter the in-flight request.

This closes the source finding and its explicitly required cache-hit/cache-miss and interval/revision/included mutation siblings.

### `T504-IFR-002` — PASS

- `src/adapters/repository-files/node-repository-file-enumerator.ts:19` defines the stable `invalid-encoding` exclusion reason.
- `src/adapters/repository-files/node-repository-file-enumerator.ts:132` uses a fatal UTF-8 decoder; decode failure is recorded in `excluded` rather than `included`.
- `src/adapters/repository-files/node-global-understanding-file-source.ts:67` uses fatal UTF-8 decoding and rejects invalid content before publishing line/hash evidence.
- `test/unit/repository-file-enumerator.test.ts:142` covers malformed non-NUL UTF-8 at the T503 included boundary.
- `test/unit/t504-review-followup.test.ts:203` covers the T504 source and recalculation boundary.
- `doc/design/vscode-review-range-tracker-design.md:556` and the existing invalid-UTF-8 eligibility rules describe `invalid-encoding` exclusion consistently.
- The follow-up records that this implements the existing invalid-UTF-8 exclusion contract, so no T504 breaking-change entry was required.

### `T504-IFR-003` — PASS

- `tasks/tasks-status.md:11` through `tasks/tasks-status.md:27` identify PR `#39` / T504, the fixed findings, remaining verification lifecycle, and the source/follow-up report references.
- `tasks/tasks-status.md:286` records T504 as in progress, the three fixes, their acceptance behavior, and remaining normal/current-HEAD/fresh-independent gates.
- `tasks/phases-status.md:33` records the matching P5 state.
- `tasks/phases-status.md:147` records malformed UTF-8 exclusion as a P5 checkpoint.
- The merge commit at the verified fix HEAD retains T304/T502 mainline state while preserving the T504 current-position, row, and P5 evidence.

## 5. Validation evidence

### Local exact-HEAD verification

| Command | Result |
| --- | --- |
| `npm run compile:test` | success |
| `node --test test-dist/test/unit/repository-file-enumerator.test.js` | T503: 8 passed / 0 failed |
| `node --test test-dist/test/unit/global-understanding-progress.test.js test-dist/test/unit/t504-review-followup.test.js test-dist/test/unit/t504-review-followup-r2.test.js` | T504: 15 passed / 0 failed |
| `git diff --check 3de50b0f768da1d24fb2e87d07e58420482967e0..HEAD` | success |
| `git diff --check origin/main...HEAD` | success |

### Exact-HEAD CI

- Push run `30769845926`: `headSha` `f5a758843facd6b7b00c4324c04b3cb7d819af55`, conclusion `success`.
- Pull-request run `30769847207`: `headSha` `f5a758843facd6b7b00c4324c04b3cb7d819af55`, conclusion `success`.
- Both runs completed build, contract typecheck, architecture positive/negative, lint, unit, T304, T502, T503, T504, Git, GitHub, and VS Code checks successfully.

No CI run from another SHA was substituted for the fix HEAD.

## 6. Closure coverage dispositions

| Closure criterion | Disposition | Evidence |
| --- | --- | --- |
| Source finding requirements | `checked_no_finding` | all required actions for `T504-IFR-001` through `003` are represented by the fix and verification evidence |
| Direct mutation siblings authorized for `T504-IFR-001` | `checked_no_finding` | interval, revision, and included-count regressions pass |
| T503/T504 encoding boundary | `checked_no_finding` | fatal-decode implementation and both boundary regressions pass |
| Design and tracking synchronization | `checked_no_finding` | encoding design, current position, T504 row, and P5 state are synchronized |
| Main integration collision points | `checked_no_finding` | merge parents and resulting T504 tracking/fix state were checked |
| Exact-HEAD validation | `checked_no_finding` | local focused suites and both exact-head CI runs pass |

No criterion in the authorized closure scope is unexplored. Areas outside that scope were intentionally not reopened.

## 7. Held items and remaining risks

The source review's held dispositions remain unchanged:

- Whole-buffer memory ceiling remains owned by `T607`.
- Repository-wide quantitative scale optimization remains owned by `T607`.
- Adversarial restoration of all compared filesystem metadata remains later hardening work under T606/T607.
- The existing high-severity dependency audit result remains inherited because T504 changes neither dependency manifest nor lockfile.

These held items do not prevent closure of `T504-IFR-001` through `003`.

Markdown wording lint remains `unsupported`: the repository has no `tools/lint/`, `lint:md`, targets, whitelist, `prh`, or equivalent focused/full wiring. The report was checked manually for backtick or quote evasion; inline code is used for identifiers, paths, commands, values, and verdict terms.

## 8. Verdict and next action

- Closure verdict: **pass_with_held**
- `T504-IFR-001`: **PASS** (high severity preserved)
- `T504-IFR-002`: **PASS** (medium severity preserved)
- `T504-IFR-003`: **PASS** (medium severity preserved)
- New findings: none; creation of new perspectives or finding identities was outside this closure-only verification.
- Unexplored within the authorized closure scope: none.
- Held items: preserved exactly as listed above.

This same-reviewer fix verification closes the three failed findings, but it is not a fresh independent final-review attestation. The next lifecycle action remains a fresh independent final review of the new frozen implementation HEAD after the normal verification gate is recorded. This reviewer did not commit, push, mutate PR `#39`, or merge.

## 9. Persistence and attestation

- Report path: `reports/issue-1-t504-independent-fix-verification-20260803090000.md`
- Persistence mode: repository fix-verification evidence; currently an uncommitted report artifact.
- `report_attestation_allowed`: `false`
- `report_attestation_head`: `null`

Only a future fresh independent final review can authorize a passing administrative report attestation for the new frozen implementation HEAD.

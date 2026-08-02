# T504 Independent Final Review

## 1. Metadata and target identity

- Repository: `ssaattww/RevMem`
- Issue / task: Issue `#1` / `T504`
- Pull request: `#39` (`draft`)
- Review mode: `independent_final_review`
- Reviewer: Codex independent review worker `/root/pr39_independent`
- Independence: this reviewer did not implement T504, did not implement review fixes, and did not serve as the normal reviewer. The review was performed independently before consulting historical closure conclusions.
- Branch: `task/t504-global-understanding-progress`
- Base ref: `origin/main`
- Base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Reviewed implementation HEAD: `3de50b0f768da1d24fb2e87d07e58420482967e0`
- Commit range: `76b49e99453ebcf7ebecb2c141ed24d750736abc...3de50b0f768da1d24fb2e87d07e58420482967e0`
- Remote identity check: `refs/heads/main` and `refs/heads/task/t504-global-understanding-progress` resolved to the two SHAs above.
- PR head check: GitHub PR `#39` `headRefOid` matched the reviewed implementation HEAD.
- Merge base: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- PR range size: 32 commits, 22 changed paths, 5,842 insertions, 0 deletions.
- Merge: not performed.

The technical verdict in this report applies only to reviewed implementation HEAD `3de50b0f768da1d24fb2e87d07e58420482967e0`.

## 2. Work context

```yaml
repository: ssaattww/RevMem
issue_or_pr: PR #39 / Issue #1
task_id: T504
mode: review
branch: task/t504-global-understanding-progress
base_ref: origin/main
current_head: 3de50b0f768da1d24fb2e87d07e58420482967e0
reviewed_head: 3de50b0f768da1d24fb2e87d07e58420482967e0
scope:
  - complete PR diff
  - T504 requirements and design
  - every changed production, test, workflow, report, and handoff path
  - T501 and T503 direct contracts and repository validation evidence
non_goals:
  - T505/T506 UI and activation implementation
  - T607 quantitative scale optimization
  - implementation, commit, push, PR mutation, or merge by this reviewer
write_boundary:
  allowed:
    - reports/issue-1-t504-independent-final-review-20260803062200.md
  forbidden:
    - all implementation, test, workflow, design, tracking, and other report paths
    - commit, push, PR mutation, and merge
development_policy:
  method: TDD
  testing_order: test-only Red, production Green, exact-head CI
ci:
  matching_run: 30750980436
  conclusion: success
unknown: []
blocked: []
remaining_risks:
  - T607 whole-buffer and repository-scale work
  - adversarial restoration of all compared filesystem metadata
```

## 3. Authoritative requirements and design

- Current user instruction: perform one complete independent final review of immutable HEAD `3de50b0f768da1d24fb2e87d07e58420482967e0`, write the reserved report, and make no implementation or Git/PR changes.
- `AGENTS.md`: use repository Skills, record breaking changes, and preserve the Skill-first workflow.
- `tasks/tasks-status.md` T504: implement repository/file Global-understanding calculators, exact progress cache, chunked work, open-file priority, configuration-driven recalculation, and avoid long event-loop occupation.
- `doc/design/vscode-review-range-tracker-design.md` 11.3 and 12: count only current valid reviewed non-empty lines from T503 `included`; exclude `excluded` and `excludedDirectories`; invalid UTF-8 text is always outside line review; keep path order deterministic.
- `doc/design/vscode-review-range-tracker-design.md` architecture and acceptance sections: retain certainty-first behavior, layer dependencies, CI gates, Global/PR separation, and failure behavior that does not present uncertain ranges as reviewed.
- T501 direct contract: `RepositoryGlobalState` and `GlobalFileReviewState` are mutable data structures whose content hash is optional.
- T503 direct contract: `RepositoryFileEnumerationResult.included` is the sole denominator input to T504; excluded files and pruned directories must not contribute.
- `review-enforcer` pre-freeze gate: all implementation, reports, handoffs, task/phase tracking, feedback, validation, and current-HEAD CI must be repository-stable before freezing an independent-final target.

## 4. Inspected changed files

Every path in `git diff --name-status origin/main...HEAD` was inspected.

### Product, workflow, and tests

- `.github/workflows/ci.yml`
- `src/adapters/repository-files/node-global-understanding-file-source.ts`
- `src/application/global-understanding/cooperative-global-understanding-calculation.ts`
- `src/application/global-understanding/global-understanding-background-recalculator.ts`
- `src/application/global-understanding/index.ts`
- `src/core/global-understanding/global-understanding-progress.ts`
- `src/core/global-understanding/index.ts`
- `test/unit/global-understanding-progress.test.ts`
- `test/unit/t504-review-followup.test.ts`
- `test/unit/t504-review-followup-r2.test.ts`

### Reports and handoffs

- `reports/issue-1-t504-implementation-20260802211500.md`
- `reports/issue-1-t504-handoff-20260802211500.yaml`
- `reports/issue-1-t504-review-20260802214103.md`
- `reports/issue-1-t504-review-handoff-20260802214103.yaml`
- `reports/issue-1-t504-review-followup-20260802220352.md`
- `reports/issue-1-t504-review-followup-handoff-20260802220352.yaml`
- `reports/issue-1-t504-fix-verification-20260802221600.md`
- `reports/issue-1-t504-fix-verification-handoff-20260802221600.yaml`
- `reports/issue-1-t504-review-followup-r2-20260802224000.md`
- `reports/issue-1-t504-review-followup-r2-handoff-20260802224000.yaml`
- `reports/issue-1-t504-fix-verification-r2-20260802224600.md`
- `reports/issue-1-t504-fix-verification-r2-handoff-20260802224600.yaml`

### Direct dependencies and governing files

- `src/core/contracts/review-state.ts`
- `src/core/file-exclusion/review-file-exclusion-policy.ts`
- `src/adapters/repository-files/node-repository-file-enumerator.ts`
- `src/application/repository-path/repository-relative-path.ts`
- `src/application/repository-global-state/repository-global-state-repository.ts`
- `src/core/review-state/review-state-service.ts`
- `src/application/review-commands/normal-editor-review-command-service.ts`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`
- `doc/design/vscode-review-range-tracker-design.md`
- `package.json`, `tsconfig.json`, and `tsconfig.test.json`

## 5. Findings

### T504-IFR-001 — high — exact-evidence cache can store a result calculated from different Global state

- Origin: `introduced_by_change`
- Location:
  - `src/application/global-understanding/cooperative-global-understanding-calculation.ts:72`
  - `src/application/global-understanding/cooperative-global-understanding-calculation.ts:94`
  - `src/application/global-understanding/global-understanding-background-recalculator.ts:267`
  - `src/application/global-understanding/global-understanding-background-recalculator.ts:300`
  - `src/application/global-understanding/global-understanding-background-recalculator.ts:302`
  - `src/application/global-understanding/global-understanding-background-recalculator.ts:323`
- Description: the recalculator retains references to mutable `RepositoryGlobalState` / `GlobalFileReviewState` objects. Evidence-key construction iterates `globalFile.reviewed` and awaits the injected scheduler. After that await, calculation reads `globalFile.reviewed` again. An allowed event-loop update can therefore make the cache key represent the old intervals while the cached progress represents new intervals. The same problem class applies to repeatedly read mutable `currentRevisionId` and included-file objects across cooperative boundaries.
- Impact: a later request whose Global state matches the old evidence can receive a cache hit containing the new state's reviewed count. This overstates reviewed lines and violates the exact-evidence and certainty-first requirements.
- Direct evidence: an inline reproduction against compiled reviewed-HEAD code used one two-line file and `calculationWorkChunkItems: 1`. The first scheduler yield replaced `[0,1)` with `[0,2)`. The first result calculated 2 lines, then the state was restored to `[0,1)`. The second request reported a cache hit and returned 2 although the expected reviewed count was 1.

```json
{
  "firstReviewed": 2,
  "firstCacheHits": 0,
  "secondReviewed": 2,
  "secondCacheHits": 1,
  "expectedSecondReviewed": 1
}
```

- Test gap: existing cache tests modify Global state only between completed recalculations. R2 tests exercise source-file mutation and post-load yields, but not mutation of the calculation input during those yields.
- Required action:
  1. Add a Red regression that mutates Global interval evidence at an injected cooperative yield and proves no result can be reused under a different evidence key.
  2. At the start of a pass, create a validated immutable snapshot of repository ID, revision, included entries, file identity/hash/interval evidence, and other values used after an await.
  3. Build the evidence key and calculate progress from the same immutable snapshot. If runtime state can supersede a pass, add generation/cancellation validation before cache/result publication.
  4. Verify both cache-hit and cache-miss paths and the sibling current-revision/included mutation cases.

### T504-IFR-002 — medium — invalid UTF-8 files enter the Global denominator and current-file source

- Origin: `direct_dependency_and_change_contract_gap`
- Location:
  - `src/adapters/repository-files/node-repository-file-enumerator.ts:126`
  - `src/adapters/repository-files/node-repository-file-enumerator.ts:149`
  - `src/adapters/repository-files/node-repository-file-enumerator.ts:157`
  - `src/adapters/repository-files/node-global-understanding-file-source.ts:67`
  - `src/adapters/repository-files/node-global-understanding-file-source.ts:102`
- Description: the T503 enumerator classifies binary content only by a NUL-byte sample and decodes with `Buffer.toString("utf8")`; the T504 source uses non-fatal `TextDecoder("utf-8")`. Both replace malformed byte sequences rather than reject them. Consequently, a malformed non-NUL file is returned in `included`, and T504 returns line/hash evidence for it.
- Impact: design section 12 states that text not decodable as valid UTF-8 is always outside line review. Such files currently contribute to the Global denominator and may be treated as a reviewable snapshot, making Global progress incompatible with the repository's encoding eligibility policy.
- Direct evidence: an inline reproduction created bytes `63 33 c3 28 0a`. `NodeRepositoryFileEnumerator` returned `invalid.ts` in `included` with one non-empty line and no exclusion; `NodeGlobalUnderstandingFileSource` returned non-empty line `[0]` and a content hash.
- Test gap: T503/T504 focused tests cover valid multibyte UTF-8, EOL variants, and NUL binary content, but no malformed non-NUL UTF-8 input.
- Required action:
  1. Add a malformed non-NUL UTF-8 Red fixture at the T503 enumeration boundary and T504 source/recalculation boundary.
  2. Use fatal UTF-8 validation and preserve a stable encoding exclusion/error disposition so invalid content cannot enter `included` or be published as a Global snapshot.
  3. Synchronize any public exclusion-reason/API or data-format change with design and, if it is breaking, the repository breaking-changes record required by `AGENTS.md`.
  4. Run T503 and T504 focused suites plus full current-HEAD CI.

### T504-IFR-003 — medium — required progress tracking was not synchronized before the final-review freeze

- Origin: `pre_freeze_process_state`
- Location:
  - `tasks/tasks-status.md:280`
  - `tasks/tasks-status.md:317`
  - `tasks/phases-status.md:33`
  - `reports/issue-1-t504-fix-verification-r2-20260802224600.md:227`
- Description: the final normal fix-verification report explicitly makes authorized task/phase progress synchronization the next action before committing all non-final changes and starting independent final review. At reviewed HEAD, T504 is still recorded as `未着手`, the current-position text still identifies T503 as the next pending closure, and P5 contains no T504 lifecycle evidence.
- Impact: repository tracking contradicts the implementation, review, CI, and PR state. More importantly, the independent-final target was frozen before the `review-enforcer` pre-freeze gate was complete. A passing administrative attestation is therefore not permitted for this HEAD.
- Evidence: the PR diff contains no `tasks/tasks-status.md` or `tasks/phases-status.md` change, while every T504 implementation/normal-review report intentionally defers those manager-only writes. The required manager sync never appears before `3de50b0f768da1d24fb2e87d07e58420482967e0`.
- Required action:
  1. Invalidate this frozen target.
  2. Use the authorized manager Skill to synchronize T504 task/phase/current-position state and report references.
  3. Commit and push that non-final change, run applicable validation, and include it in normal review or fix verification together with the technical fixes.
  4. Freeze a new implementation HEAD only after every pre-freeze item is stable, then dispatch a fresh independent reviewer.

## 6. Previous finding continuity

No historical finding identity or severity was reclassified.

| Finding | Source severity | Current disposition |
| --- | --- | --- |
| `T504-R1-P1` | high | closure evidence preserved; no regression observed in missing-hash behavior |
| `T504-R1-P2` | medium | closure evidence preserved; zero-byte one-logical-line behavior remains covered |
| `T504-R1-P3` | medium | original source-byte work and R2 post-load work closure evidence preserved |
| `T504-R1-P4` | low | closure evidence preserved; schema-v3 follow-up handoffs exist and preserve severity |
| `T504-R2-P1` | high | closure evidence preserved for observable source-file mutation validation |
| `T504-R2-P2` | medium | closure evidence preserved for bounded post-load line/interval work |

The new findings above have new independent-review identities and do not silently alter the historical severities.

## 7. Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirement and design conformance | `checked_finding` | `T504-IFR-001`, `T504-IFR-002`, `T504-IFR-003` |
| Correctness and edge cases | `checked_finding` | cache corruption and malformed UTF-8 were reproduced |
| Scope discipline and unrelated changes | `checked_no_finding` | PR changes remain limited to T504 product/test/workflow/evidence paths |
| Changed files and direct dependency impact | `checked_finding` | all 22 changed paths and T501/T503/path/tracking dependencies inspected |
| API, data, configuration, workflow, compatibility | `checked_finding` | mutable async input/cache identity and encoding eligibility contract gaps |
| Error handling and failure diagnostics | `checked_finding` | malformed encoding is silently replacement-decoded rather than rejected/classified |
| Security and secret handling | `checked_no_finding` | no credential, permission, token, or source-content logging change; symlinks remain rejected |
| Tests and validation adequacy | `checked_finding` | current tests pass but omit both reproduced cases |
| Current-HEAD CI evidence | `checked_no_finding` | exact-head push and pull-request CI runs succeeded |
| Report, tracking, and documentation accuracy | `checked_finding` | finding continuity is accurate, but mandatory manager tracking is stale |
| Regression and maintainability risk | `checked_finding` | async reuse of mutable contracts can create further mixed-generation results |

No required criterion is `unexplored`.

## 8. Validation and CI assessment

### Exact-head CI

- Pull-request run `30750980436`, job `91504858255`
  - `headSha`: `3de50b0f768da1d24fb2e87d07e58420482967e0`
  - conclusion: `success`
  - build, contract typecheck, architecture positive/negative, lint, unit, T503 focused, T504 focused, Git integration, GitHub mock, and VS Code Extension Host all succeeded.
- Push run `30750978447`, job `91504853240`
  - `headSha`: `3de50b0f768da1d24fb2e87d07e58420482967e0`
  - conclusion: `success`
  - the same complete job sequence succeeded.

No run from another SHA was substituted for current-HEAD evidence.

### Independent local evidence

| Command or check | Result |
| --- | --- |
| `git diff --check origin/main...HEAD` | pass |
| `npm ci` | pass; existing audit output reports one high-severity dependency vulnerability |
| `npm run compile:test` | pass |
| T504 focused Node test command for all three changed test files | 12 passed / 0 failed |
| Inline mutable-Global cache reproduction | reproduced `T504-IFR-001` |
| Inline malformed UTF-8 enumeration/source reproduction | reproduced `T504-IFR-002` |
| Markdown focused/full wording lint | `unsupported`: no repository `tools/lint/`, `lint:md`, `cspell.config.jsonc`, targets, whitelist, or `prh` wiring |

The successful focused and full CI evidence is valid, but those suites do not cover the two reproduced defect cases and therefore do not negate the findings.

The report was also checked manually for prose hidden in backticks or quotes; inline code is limited to identifiers, paths, commands, SHAs, field values, and verdict terms. The unsupported Markdown lint state is retained as evidence and is not converted to a pass.

## 9. Held, not-applicable, unexplored, and remaining risks

### Held

- Whole-buffer memory ceiling
  - Owner: `T607`
  - Evidence: `NodeGlobalUnderstandingFileSource` uses `readFile()` and holds the full Buffer even though decode/scan/hash CPU work is chunked.
  - Verdict impact: not an additional required finding for T504.
- Repository-wide quantitative scale optimization
  - Owner: `T607`
  - Evidence: setup maps, ordering, and repeated partial aggregate sorting are not quantitatively bounded.
  - Verdict impact: not an additional required finding because the accepted task assigns quantitative scale work to T607.
- Adversarial filesystem metadata restoration
  - Owner: later hardening under T606/T607.
  - Evidence: source validation compares device, inode, size, and mtime; an actor restoring all compared metadata is outside the observable-race guarantee recorded by normal review.
  - Verdict impact: documented remaining risk, not an additional finding in the current local threat model.
- Existing dependency audit result
  - Evidence: `npm ci` reports one high-severity vulnerability; the PR changes neither dependency manifest nor lockfile.
  - Verdict impact: inherited and not attributed to T504, but remains for dependency maintenance.

### Not applicable

- T505/T506 UI, Status Bar, activation wiring, and multi-context Extension Host integration.
- Merge authorization or execution.
- Review of a report-attestation commit; none exists.

### Unexplored

- None.

### Blocked

- None. The review completed, and the verdict is based on reproduced evidence.

## 10. Verdict and next action

- Verdict: **fail**
- Required findings:
  - `T504-IFR-001` high
  - `T504-IFR-002` medium
  - `T504-IFR-003` medium
- Held items: four, explicitly listed above.
- Unexplored areas: none.
- Remaining technical risks: mutable input generations, encoding eligibility, full-buffer memory, repository-scale setup/aggregate work, adversarial metadata restoration, and the inherited dependency audit result.

Next action:

1. Treat `3de50b0f768da1d24fb2e87d07e58420482967e0` as a failed frozen target and return to implementation/pre-freeze finalization.
2. Address `T504-IFR-001` and `T504-IFR-002` with test-first regression evidence.
3. Synchronize task/phase/current-position tracking through the authorized manager Skill.
4. Run focused and full validation, obtain exact-head CI, persist reports/handoffs, and have the normal reviewer verify all three finding identities without changing severity unless an explicit reclassification record is authorized.
5. Commit and push every non-final change, reserve a new independent-final report path, freeze a new implementation HEAD, and dispatch a fresh independent reviewer.
6. Do not merge.

## 11. Persistence and attestation conditions

- Reserved report path: `reports/issue-1-t504-independent-final-review-20260803062200.md`
- Persistence mode for this failed review: repository review evidence, not a passing report-attestation commit.
- `report_attestation_allowed`: `false`
- `report_attestation_head`: `null`

Because the verdict is `fail`, this report must not be used as the one administrative attestation commit for completion. If a future fresh independent review passes a new frozen implementation HEAD, the caller must validate all of the following before accepting an attestation head:

1. the report path was reserved before that review;
2. exactly one commit follows the reviewed implementation HEAD;
3. its first parent is the reviewed implementation HEAD;
4. only the reserved independent-final report path or paths changed;
5. the report names the reviewed implementation HEAD and identifies the commit as administrative attestation;
6. no executable, Skill, design, workflow, configuration, tracking, feedback, handoff, product, or other report path changed;
7. no later commit exists; and
8. the attestation SHA is recorded externally after commit.

Any implementation, test, design, workflow, tracking, handoff, or other repository change after the failed target requires the normal lifecycle and a fresh independent final review. This report does not authorize merge.

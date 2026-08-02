# T304 Independent Final Review

## 1. Metadata and target identity

- Report type: `independent_final_review_report`
- Review mode: `independent final review`
- Repository: `ssaattww/RevMem`
- Pull Request: `#38`
- Task: `T304`
- Branch: `task/t304-pr-progress-tree`
- Base ref: `origin/main`
- Base SHA and merge base: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Reviewed implementation HEAD: `4217d3efd3267093de6a31a9cbaab1d364363e22`
- Reviewed range: `76b49e99453ebcf7ebecb2c141ed24d750736abc..4217d3efd3267093de6a31a9cbaab1d364363e22`
- Reserved report path supplied to this reviewer: `reports/issue-1-t304-independent-final-review-20260803062100.md`
- Reviewer: fresh Codex independent-final-review worker `/root/pr38_independent`
- Independence: this reviewer did not implement T304, did not implement any review fix, and did not serve as the normal reviewer. The independent pass was performed before using prior normal-review conclusions as supporting evidence.
- Write boundary: this report path only. Source, test, design, workflow, configuration, tracking, commit, push, PR mutation, and merge were forbidden.
- Review target stability: local `HEAD`, `origin/task/t304-pr-progress-tree`, and PR `headRefOid` were all `4217d3efd3267093de6a31a9cbaab1d364363e22` at review start and final verification.

The technical verdict in this report applies only to reviewed implementation HEAD `4217d3efd3267093de6a31a9cbaab1d364363e22`.

## 2. Purpose, scope, and authoritative requirements

This review independently evaluated the complete PR diff, every changed file, direct dependencies, current-HEAD CI, reports, handoffs, tracking, compatibility, and regression surface.

Authoritative sources, in precedence order:

1. Current review instruction: review PR #38/T304 at immutable HEAD `4217d3e...`, use `origin/main` as base, write this report only, and do not implement or mutate the PR.
2. Root `AGENTS.md`: use project Skills and record every breaking change in `Design/BreakingChanges.md`.
3. `tasks/tasks-status.md:250-260`, especially T304: provide five progress categories, display each file's reviewed/total/rate/additions/deletions, show user exclusions with reasons, sort by remaining count descending then path ascending, and open the selected diff.
4. `doc/design/vscode-review-range-tracker-design.md` sections 2.1, 7, 8, 11.1-11.2, 13, 16.3, 17, 20, and 21: certainty-first behavior, canonical paths, immutable identity-bound diff documents, raw/effective progress separation, unsupported selection behavior, public consumer contracts, tests, and AC-17 behavior.
5. PR #38 source, tests, workflow, reports, handoffs, PR body, and exact-HEAD GitHub Actions evidence.

Accepted non-goals for this task boundary:

- T305 concrete Activity Bar, VS Code `TreeItem`/event wiring, Current Context, Status Bar, and refresh/context selection UI.
- T306 Extension Host end-to-end PR Progress UI acceptance scenarios.
- T402 and later PR metadata/diff acquisition, encoding detection source, cache, and refresh implementation.
- Merge and release.

These non-goals do not waive T304's public provider invariants, repository tracking accuracy, breaking-change record, or final-review lifecycle requirements.

## 3. Inspected changed files and direct dependencies

The three-dot diff contains 38 changed paths. All were inspected at the reviewed HEAD.

| Changed path | Inspection disposition |
| --- | --- |
| `.github/workflows/ci.yml` | T304 focused step, package-owned command, pipefail logging, and broad CI order checked |
| `doc/design/vscode-review-range-tracker-design.md` | empty descriptor, effective progress, selection, test, and acceptance contracts checked |
| `package.json` | semantic JSON comparison against base showed only `test:t304` and two `test:unit` entries changed; remaining diff is formatting |
| `src/adapters/diff-document/local-git-revision-text-content-source.ts` | Git-only port narrowing and runtime empty rejection checked |
| `src/application/diff-document/contracts.ts` | public discriminated descriptor union and source port checked; finding `T304-IFR-P2` |
| `src/application/diff-document/index.ts` | public exports checked |
| `src/application/diff-document/review-diff-uri-codec.ts` | source discriminant, canonical URI, revision/path validation, and empty identity checked |
| `src/application/diff-document/revision-text-content-provider.ts` | empty short circuit and Git-only delegation checked |
| `src/ui/diff-editor/index.ts` | public side-input exports checked |
| `src/ui/diff-editor/review-diff-editor-controller.ts` | present/absent conversion and unknown-kind pre-side-effect rejection checked; public compatibility contributes to `T304-IFR-P2` |
| `src/ui/pr-progress/index.ts` | complete public provider/type barrel checked |
| `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts` | classification, validation, effective projection, sorting, stale selection, cloning, and host boundary checked; finding `T304-IFR-P1` |
| `test/unit/ci-workflow-contract.test.ts` | standard/focused/CI discovery assertions checked |
| `test/unit/pull-request-progress-tree.test.ts` | category, metrics, effective projection, sort, identity, empty side, stale node, and malformed input cases checked |
| `test/unit/t304-review-followup-r3.test.ts` | unsupported selection, public DTO, port separation, path semantics, and unknown side cases checked |
| `type-fixtures/contracts/t302-diff-document.fixture.ts` | Git/empty positive and negative public contracts checked |
| `type-fixtures/contracts/t304-pr-progress-tree.fixture.ts` | consumer-facing snapshot, target, host, effective/raw separation, and negative shapes checked |
| `type-fixtures/contracts/tsconfig.json` | both new fixtures are included in contract typecheck |
| `reports/issue-1-t304-implementation-20260802210612.md` | implementation scope, TDD, CI, non-goals, and held tracking statements checked |
| `reports/issue-1-t304-review-20260802213932.md` | initial R1 findings and severity continuity checked |
| `reports/issue-1-t304-review-followup-20260802220800.md` | corrected first follow-up disposition checked |
| `reports/issue-1-t304-fix-verification-20260802221700.md` | R1 partial closure and R2 finding checked |
| `reports/issue-1-t304-review-followup-r2-20260802224500.md` | R2 implementation claims and correction checked |
| `reports/issue-1-t304-fix-verification-r2-20260802225900.md` | R1/R2 closure and R3 findings checked |
| `reports/issue-1-t304-review-followup-r3-20260802233700.md` | R3 implementation/design claims checked |
| `reports/issue-1-t304-fix-verification-r3-20260803045900.md` | R3 closure and R4 findings checked |
| `reports/issue-1-t304-review-followup-r4-20260803055200.md` | R4 implementation and validation claims checked |
| `reports/issue-1-t304-fix-verification-r4-20260803061000.md` | R4 closure, coverage, held tracking, and final verdict checked |
| `handoffs/issue-1-t304-implementation-20260802210800.yaml` | implementation identity, scope, validation, and writes checked |
| `handoffs/issue-1-t304-review-20260802214201.yaml` | initial review identity, findings, and transport checked |
| `handoffs/issue-1-t304-review-followup-20260802221000.yaml` | corrected disposition and supersession checked |
| `handoffs/issue-1-t304-fix-verification-20260802221800.yaml` | first fix-verification identity and open findings checked |
| `handoffs/issue-1-t304-review-followup-r2-20260802224700.yaml` | R2 follow-up identity and evidence checked |
| `handoffs/issue-1-t304-fix-verification-r2-20260802230100.yaml` | R2 verification and R3 finding transport checked |
| `handoffs/issue-1-t304-review-followup-r3-20260802233900.yaml` | R3 follow-up identity and evidence checked |
| `handoffs/issue-1-t304-fix-verification-r3-20260803050000.yaml` | R3 verification and R4 finding transport checked |
| `handoffs/issue-1-t304-review-followup-r4-20260803055400.yaml` | R4 follow-up identity and evidence checked |
| `handoffs/issue-1-t304-fix-verification-r4-20260803061200.yaml` | normal-review closure, held tracking, target identity, and reserved-path metadata checked; finding `T304-IFR-P4` |

Direct dependencies inspected:

- `src/core/pr-progress/pr-diff-progress.ts` and its barrel: validated raw T301 progress, status/path matrix, exclusion behavior, state/revision identity, and count semantics.
- `src/core/file-exclusion/review-file-exclusion-policy.ts`: binary/default/user exclusion decisions and canonical normalized path output.
- `src/application/repository-path/repository-relative-path.ts`: POSIX and Windows canonical path rules used by T304.
- Existing T302/T303 URI, content, editor, and consumer tests affected by the widened descriptor/side contracts.
- `src/extension.ts` and `package.json` contributions: confirmed that concrete view composition remains deferred rather than silently partially wired.
- `tasks/tasks-status.md` and `tasks/phases-status.md`: authoritative progress state checked; finding `T304-IFR-P3`.
- Root `AGENTS.md` and the absent `Design/BreakingChanges.md`: compatibility governance checked; finding `T304-IFR-P2`.

All 44 full commit SHA references present in the changed reports and handoffs resolve to commits in the repository. `git diff --check origin/main...4217d3e...` succeeded.

## 4. Independent technical assessment

The core T304 behavior is otherwise coherent:

- Five categories are stable and ordered as specified.
- Reviewable files are sorted by remaining line count descending and code-unit path ascending.
- Raw T301 statistics remain available under `raw`; unsupported encoding projection uses separate effective counts and excludes those files from the effective denominator.
- Added/deleted missing sides are represented by immutable-comparison `empty` descriptors and never reach the external Git content source.
- Unknown line-reviewability and diff-side discriminants fail closed.
- Filesystem-aware path validation reuses the canonical repository path boundary.
- Stale node references from a previous replacement are rejected by reference membership.
- Tests are reachable from `test:unit`, `npm test`, `test:t304`, and the CI workflow.

However, the node and target objects returned for the current snapshot are not runtime immutable. This defeats the exact identity that the stale-reference check is intended to protect and is a required correctness finding.

## 5. Required findings

### T304-IFR-P1 — High — current Tree node can be mutated to open a different context/path/revision

- Identity: `T304-IFR-P1`
- Severity: `high`
- Origin: independently discovered in final review; `introduced_by_change` / `correctness` / `identity_integrity`
- Location: `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts:492-513`, `:624-655`, `:684-697`, `:703-725`
- Description: `toFileNode()` returns mutable nested objects, the sorted arrays are frozen but their file-node elements and `openTarget`/`file`/side objects are not, and `getChildren()` returns those internal node objects directly. `select()` checks only that the same node object remains in `currentFileNodes`, then passes `node.openTarget` directly to the host. A consumer can therefore mutate the current node after rendering and still pass the stale/current membership check.
- Impact: a node rendered for one exact PR comparison can open a different context, repository path, or revision while appearing current. This violates the certainty-first and identity-bound selection contracts and can show the user source different from the reviewed progress row.
- Direct evidence: an independent runtime probe at the reviewed HEAD reported `nodeFrozen=false`, `targetFrozen=false`, and `sideFrozen=false`. After changing `node.openTarget.contextId` to `context-tampered`, the original path to `src/other.ts`, and the modified revision to `cccc...`, `provider.select(node)` called the host with all three tampered values. No stale error occurred because the same node reference remained in `currentFileNodes`.
- Test gap: `selection carries immutable context and revision identity` verifies the initial values only. It does not mutate a returned current node, its source, its target, either side, or the target received by the host.
- Required action: keep selection identity in provider-owned state that callers cannot mutate, or deeply freeze every node/target/raw/reason/side object before exposure and pass a detached validated target to the host. Add regression tests that mutate every exposed nested identity field and that let the host attempt mutation, proving that later selections cannot change context, path, revision, source record, or category identity.

### T304-IFR-P2 — Medium — public breaking type changes have no required breaking-change record

- Identity: `T304-IFR-P2`
- Severity: `medium`
- Origin: independently discovered in final review; `repository_policy` / `api_compatibility` / `documentation`
- Location: root `AGENTS.md` Breaking Changes rule; `src/application/diff-document/contracts.ts:4-39`; `src/ui/diff-editor/review-diff-editor-controller.ts:15-38`; missing `Design/BreakingChanges.md`
- Description: the PR widens public `ReviewDiffRevisionSource` from only `"git-commit"` to include `"empty"`, changes public `ReviewDiffDocumentDescriptor` from an interface to a discriminated union type, and changes public `ReviewDiffEditorSideInput` from an interface to a union type. These are intentional design changes but are source-breaking for exhaustive consumers, interface extension, and declaration merging. The repository instruction requires every breaking change to be recorded in `Design/BreakingChanges.md`, but no such file or entry exists.
- Impact: downstream TypeScript consumers can fail to compile without a migration record, and repository review evidence incorrectly treats the compatibility criterion as having no unresolved obligation.
- Evidence: base `origin/main` declares both descriptors as single interfaces and `ReviewDiffRevisionSource = "git-commit"`; the reviewed HEAD exposes unions. `rg --files -g '*BreakingChanges*'` finds no record.
- Required action: record the public contract changes and migration guidance at the required path, or restore/version a compatible public surface. Add a consumer compatibility fixture for the selected compatibility policy. The documentation/API change must be included before a new freeze and normal verification.

### T304-IFR-P3 — Medium — authoritative task and phase tracking still says T304 is unstarted

- Identity: `T304-IFR-P3`
- Severity: `medium`
- Origin: independently discovered lifecycle/documentation defect
- Location: `tasks/tasks-status.md:258`; `tasks/phases-status.md:89-116`; T304 reports/handoffs that repeatedly hold tracking sync
- Description: the reviewed HEAD contains the implementation, four normal-review follow-up cycles, exact-head CI, and the normal-review pass, but T304 remains `未着手`. P3 current progress also contains no T304 result. There is no tracking diff relative to `origin/main`.
- Impact: authoritative repository tracking contradicts the implementation and review state, can misroute T305/T306 dependency decisions and restart work, and violates the pre-freeze requirement that tracking be synchronized before independent final review.
- Evidence: `git diff --exit-code origin/main...4217d3e -- tasks/tasks-status.md tasks/phases-status.md` returns no diff. The final normal-review handoff itself says the task table continues to show T304 as not started. In this runtime, the required `progress-sync-manager` Skill is available, so prior manager unavailability cannot be carried forward as terminal acceptance evidence.
- Required action: use the repository progress synchronization workflow to update T304/P3 and report references to the actual state. Commit/push the tracking change, rerun applicable validation and normal review, then freeze a new current-HEAD target for a fresh independent final review.

### T304-IFR-P4 — Medium — final-review reservation and current-head evidence are internally inconsistent

- Identity: `T304-IFR-P4`
- Severity: `medium`
- Origin: independently discovered final-review lifecycle/report defect
- Location: `handoffs/issue-1-t304-fix-verification-r4-20260803061200.yaml:190-197` and `:291-306`; PR #38 body; supplied report placeholder
- Description: the committed normal-review handoff instructs the next reviewer to reserve and use `reports/issue-1-t304-independent-final-review-20260803063000.md`, while the actual supplied/pre-created path is `reports/issue-1-t304-independent-final-review-20260803062100.md`. The PR body calls `7f11181...` the final submission HEAD and cites run `30766637445`, although the frozen PR HEAD is `4217d3e...` and its matching runs are `30767064848`/`30767065140`.
- Impact: the report-attestation allowlist has two competing paths and the external current-head evidence is stale. A caller cannot validate a terminal attestation pair from the committed handoff and PR metadata without guessing which reservation is authoritative.
- Evidence: repository search finds `...063000.md` only in the final handoff, while the only working-tree placeholder and current explicit instruction use `...062100.md`. GitHub reports PR `headRefOid=4217d3e...`; the PR body still names `7f11181...` as final.
- Required action: choose one exact report path before the next freeze, make handoff and external PR metadata agree with it and with the new current HEAD, and then perform the normal-review/current-head CI/fresh-independent-review sequence required after findings P1-P3 are fixed. PR body correction itself may be external, but any repository-backed handoff/tracking correction must precede the new freeze.

## 6. Prior finding continuity and severity records

The independent review did not reuse the normal-review verdict. It checked the historical chain only after the independent pass to confirm that finding identities and severities were not silently rewritten.

- `T304-R1-P1` High, `T304-R1-P2` High, and `T304-R1-P3` Medium: historical severities preserved; later reports record closure.
- `T304-R2-P1` Medium: historical severity preserved; later reports record closure.
- `T304-R3-P1` through `T304-R3-P3` Medium: historical severities preserved; later reports record closure.
- `T304-R4-P1` through `T304-R4-P3` Medium: historical severities preserved; R4 normal verification records closure.
- Severity reclassification records: none.
- Severity errata needed: none discovered.

The four findings in this report are new independent-final-review findings and do not reopen or renumber the historical normal-review findings.

## 7. Validation and CI assessment

### Current-HEAD GitHub Actions

Two completed CI runs match the reviewed HEAD exactly:

- Push run `30767064848`: `headSha=4217d3efd3267093de6a31a9cbaab1d364363e22`, conclusion `success`.
- Pull request run `30767065140`, job `91547561813`: same `headSha`, conclusion `success`.

The pull request job succeeded at Install dependencies, Build, Contract typecheck, Architecture validation, Architecture negative contract, Lint, Unit tests, T304 PR progress tree tests, T503 tests, Git integration, GitHub mock integration, and VS Code Extension Host tests. No other SHA was substituted.

### Local commands at the reviewed HEAD

| Command/check | Result |
| --- | --- |
| `npm ci` | success; 392 packages installed; audit reported one transitive dev-dependency High advisory |
| `npm run build` | success |
| `npm run typecheck:contracts` | success |
| `npm run validate:architecture` | success |
| `npm run validate:architecture:negative` | success; expected 11 violations |
| `npm run lint` | success |
| `npm run test:t304` | success; 18/18 |
| `npm run test:git` | success; 33 passed, 3 platform skips |
| `npm run test:github` | success; 13/13 |
| `npm test` | failed in `test:unit`: 381 passed, 19 failed, 2 skipped; all 19 failures are unchanged Windows Git-ownership/reconciliation tests reporting `document path is outside the resolved Git working tree`; later suites did not run through this aggregate command |
| `npm run test:vscode` | local process produced no result before the 120-second command timeout and was terminated; exact-HEAD Linux CI Extension Host step succeeded |
| Independent node-mutation probe | reproduced `T304-IFR-P1` at the reviewed compiled output |
| `git diff --check origin/main...4217d3e...` | success |
| Changed report/handoff SHA reference resolution | 44/44 commit SHAs resolve |
| Markdown wording check | focused and full checks are `unsupported`: repository has no `tools/lint/` configuration and no `lint:md` script; manual inspection found no quote/backtick lint evasion |

The local broad-suite Windows failures are outside the PR changed paths and reproduce a known platform-specific test limitation; they are not converted into success. Exact-HEAD Linux CI provides the configured broad-gate evidence, but neither CI nor the existing T304 tests cover the mutation scenario in P1.

### Security assessment

No credential, network, persistence, shell construction, or secret-handling product path changed in T304. URI and repository path inputs fail closed, and synthetic empty descriptors do not reach Git.

`npm audit --json` reports one High advisory for transitive development dependency `brace-expansion` (`GHSA-mh99-v99m-4gvg`). `package-lock.json` and dependencies are unchanged by this PR, and the package command uses `--no-dependencies`; therefore this is a pre-existing development-toolchain risk rather than a T304-introduced product finding. It remains explicit below as held.

## 8. Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirement and design conformance | `checked_finding` | P1 violates immutable identity-bound selection; P3 violates pre-freeze tracking obligations |
| Correctness and edge cases | `checked_finding` | P1 reproduced by mutating current node nested identity |
| Scope discipline and unrelated changes | `checked_no_finding` | Product changes and review-fix expansion remain connected to T304/T302/T303 contracts; package semantic diff is limited to test discovery |
| Every changed file and direct dependencies | `checked_finding` | all 38 paths inspected; P1-P4 found across provider/API/tracking/handoff boundaries |
| API compatibility | `checked_finding` | P2 public union/interface changes lack required breaking-change record |
| Data compatibility | `checked_no_finding` | no persisted data schema or migration changed; empty URI source is version-preserving and canonical |
| Configuration and workflow compatibility | `checked_no_finding` | only T304 test discovery added; exact-head CI confirms all configured steps |
| Error handling and failure diagnostics | `checked_no_finding` | unknown discriminants and invalid paths reject; CI preserves failure logs/artifacts |
| Security and secret handling | `checked_no_finding` | no new secret path; empty source isolation and input validation checked; baseline audit risk held |
| Tests and validation adequacy | `checked_finding` | P1 mutation/host-boundary cases absent; focused tests otherwise pass |
| Current-HEAD CI evidence | `checked_no_finding` | two successful runs exactly match `4217d3e...` |
| Reports, tracking, and documentation accuracy | `checked_finding` | P2 breaking log, P3 tracking, and P4 head/path metadata |
| Regression and maintainability risks | `checked_finding` | P1 exposes provider-owned mutable identity; P2 lacks migration record |

No required criterion is `unexplored`.

## 9. Held, unexplored, intentionally untouched, and remaining risks

### Held

- Local Windows broad unit gate: 19 unchanged ownership/reconciliation tests fail on path ownership while exact-HEAD Linux CI passes. Owner: existing Windows portability work. Verdict impact: non-blocking for T304, but local `npm test` is not reported as success.
- Local Extension Host command timeout: no local result after 120 seconds; matching-head CI Extension Host passed. Owner: local test-harness/environment investigation. Verdict impact: non-blocking because configured exact-head evidence exists and concrete T305/T306 UI is outside T304.
- Baseline `brace-expansion` High dev advisory: dependency files are unchanged by this PR. Owner: dependency maintenance. Verdict impact: non-blocking for the T304 change review.

### Unexplored

None. Every required review criterion has a disposition. The deferred T305/T306/T402 areas are accepted non-goals, not unexplored T304 defect surfaces.

### Intentionally untouched

- All source, tests, design, workflow, configuration, tracking, handoff, and PR metadata were left unchanged by this reviewer.
- No finding was implemented or partially fixed.
- No commit, push, PR review/comment, merge, or release operation was performed.

### Remaining risks after required findings

- Concrete VS Code view lifecycle and user-facing selection presentation remain for T305/T306.
- Encoding reviewability acquisition and PR diff refresh/cache remain for T402 and later.
- Runtime contracts continue to rely on T301 as the trusted producer for status/exclusion union validity; future external producers should preserve that boundary or add equivalent runtime validation.

## 10. Verdict and next action

- Verdict: `fail`
- Required findings: `T304-IFR-P1` High; `T304-IFR-P2`, `T304-IFR-P3`, and `T304-IFR-P4` Medium.
- Verdict-blocking unexplored areas: none.
- Technical verdict target: `4217d3efd3267093de6a31a9cbaab1d364363e22` only.
- `report_attestation_allowed: false`

Required next action:

1. Do not create a terminal report-attestation commit for this failed review.
2. Return P1-P4 through implementation, design/documentation, progress synchronization, and finalization as applicable.
3. Add regression and compatibility evidence, update reports/tracking/handoff, commit and push all non-final changes, run current-HEAD validation and matching CI, and have the normal reviewer verify the fixes while preserving finding identities and severities.
4. Reserve one exact independent-final-review path before freezing the new HEAD.
5. Dispatch a different fresh independent reviewer against that immutable new HEAD.
6. Do not merge in this lifecycle step.

## 11. Persistence and attestation conditions

- Persistence mode for this result: repository report file as non-terminal failed-review evidence. It is not an administrative terminal attestation.
- Reserved path used for this report: `reports/issue-1-t304-independent-final-review-20260803062100.md`.
- Report-attestation HEAD: absent.
- Attestation diff validation: not applicable because verdict is `fail`.

If a future fresh independent review passes, its caller must validate all of the following before accepting an attestation pair:

- the future report path was uniquely reserved before the reviewed implementation HEAD was frozen;
- exactly one commit follows that reviewed implementation HEAD;
- the commit's first parent is the reviewed implementation HEAD;
- only the pre-reserved independent-final-review report path changes;
- the report names the reviewed implementation HEAD and identifies the later commit as administrative attestation only;
- no executable, Skill, design, workflow, configuration, tracking, feedback, handoff, or product path changes;
- the attestation SHA is recorded externally after commit, not invented in the report body;
- no later Git commit exists;
- any violation restarts normal verification and a fresh independent final review.

No merge is authorized or performed by this report.

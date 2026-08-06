# T602 Implementation Report

## Metadata

| Item | Value |
| --- | --- |
| Report type | Implementation report |
| Repository | `ssaattww/RevMem` |
| Task | `T602` — rebase・force-push時に旧Git object直接diff、snapshot diff、一意mapping、未確認化の順で回復する |
| Related issue | `#1` |
| Pull request | `#49` |
| Branch | `agent/t602-rebase-force-push-recovery` |
| Base branch | `main` |
| Base SHA | `112198c33823a5fc6681399a19e0c5361614143f` |
| Implementation code HEAD | `424fdd54e059500d7c9e1b78793bb75f281b6fa3` |
| Implementation CI run | `31094706729` |
| Implementation CI job | `92593797186` |
| Generated at | `2026-08-06T19:50:00+09:00` |
| Merge performed | No |

This report records implementation and validation facts. It is not an independent review verdict and does not approve or merge the pull request.

## Purpose

T602 implements conservative recovery of reviewed ranges after Git history is rewritten by rebase or force-push. The recovery order is fixed as follows:

1. Use a direct diff between the persisted old Git object and the current immutable revision when the old object still exists.
2. Only when the old object is proven missing, use the saved T601 snapshot as fallback evidence.
3. Follow a renamed/current file only when the destination is uniquely proven by snapshot evidence or exact content identity.
4. When evidence is missing, invalid, corrupt, expired, or ambiguous, leave the affected ranges unreviewed.

The implementation preserves stable file identity only when the evidence is unique. It does not substitute another file, another revision, or a non-matching snapshot.

## Scope

Implemented:

- Ordered recovery service and fail-closed result model.
- Local Git and T601 snapshot adapters.
- Complete Git context and repository-global recovery coordinator.
- Integration with the existing Git revision mapper.
- Automatic immutable current-tree path enumeration for rename candidates.
- Production document-session wiring that publishes and invalidates Git snapshots.
- Context and Global snapshot generations using the same T601 storage and retention policy.
- Focused CI execution and regression tests.

Not implemented or changed:

- Pull-request review context behavior outside the existing Git context path.
- T601 retention limits or compression format.
- Existing whitespace/EOL equivalence defaults.
- User-triggered merge or auto-merge.
- Manual edits to `tasks/tasks-status.md`.

## Design and safety rules

### Direct Git evidence remains authoritative

The wrapper around the existing revision mapper always executes the normal immutable Git mapping path first. Snapshot recovery is eligible only for the persisted context or Global side whose old full object ID is proven absent by `objectExists`.

A Git failure, malformed diff, contradictory old/new text, missing destination, or duplicate mapping is not treated as an absent object and therefore does not enable snapshot fallback.

### Snapshot recovery is conservative

The recovery coordinator builds a catalog from the current immutable revision. For each persisted file it evaluates all available candidates rather than accepting the first same-path match. A same-path mapping is rejected when another candidate also preserves reviewed evidence. An empty mapped range remains authoritative and is not overwritten by a later content-hash fallback.

### Rename handling is unique-only

The current revision tree is enumerated with:

```text
git ls-tree --full-tree -r --name-only -z <revision> --
```

NUL framing preserves whitespace and embedded newlines. Missing commits, malformed framing, empty paths, and duplicate paths are distinguished and handled conservatively. A rename is followed only when snapshot or exact-content evidence identifies one destination.

### Snapshot generation safety

Production Git sessions reuse the same `NonGitSnapshotTracker` instance used by T601. Separate latest-generation pointers are maintained for:

- Context-local evidence: the current Git context ID.
- Repository-global evidence: `git-global:<repositoryId>`.

Before replacing state or publishing a new generation, prior latest pointers are invalidated. If snapshot publication partially fails, both pointers are invalidated and the error is propagated. Decoration reads remain non-mutating.

Snapshot content is read from the exact immutable revision/path and accepted only when its SHA-256 content hash and line count match the active review-state target.

## Changed files

### Workflow

- `.github/workflows/ci.yml`
  - Added a focused T602 step.
  - The existing failure diagnostics remain active and include command logs, test output, generated files, source, tests, tools, type fixtures, and relevant configuration.

### Application recovery

- `src/application/history-rewrite-recovery/index.ts`
  - Added ordered history-rewrite recovery service.
  - Added evidence/result contracts and strict validation.
  - Added direct-diff mapping, snapshot fallback, unique exact-content fallback, and unreviewed fallback.

- `src/application/history-rewrite-recovery/adapters.ts`
  - Added Git revision source adapter.
  - Added T601 snapshot tracker adapter.

- `src/application/history-rewrite-recovery/git-context-recovery.ts`
  - Added complete context/Global recovery coordinator.
  - Added Global snapshot scope derivation.
  - Added cross-file destination conflict detection.

### Git context integration

- `src/application/review-context/contracts.ts`
  - Added recovery port contracts and optional current candidate paths.

- `src/application/review-context/history-rewrite-git-context-revision-mapper.ts`
  - Added history-aware wrapper around the existing direct mapper.
  - Added source-specific recovery registration.
  - Added automatic current-tree enumeration when explicit candidates are absent.

- `src/application/review-context/index.ts`
  - Exported the history-aware mapper, registration function, and recovery contracts.

### Local Git

- `src/adapters/local-git/history-rewrite-local-git-adapter.ts`
  - Added immutable tree path enumeration with NUL framing and strict validation.

- `src/adapters/local-git/index.ts`
  - Exported the history-aware Local Git adapter.

- `src/adapters/local-git/node-local-git-adapter.ts`
  - Connected immutable tree enumeration to the production Node Git runtime.

### Production session wiring

- `src/adapters/workspace-review-state/snapshot-tracking-workspace-review-state-session-provider.ts`
  - Exposed the existing T601 tracker instance for Git recovery composition.

- `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`
  - Registered the recovery coordinator before the Git revision mapper is constructed.
  - Published verified context and Global snapshots for Git sessions.
  - Invalidated snapshot generations around state commits.
  - Kept decoration loading read-only.

### Tests

- `test/unit/history-rewrite-recovery.test.ts`
- `test/unit/history-rewrite-recovery-conservative.test.ts`
- `test/unit/history-rewrite-git-context-integration.test.ts`
- `test/unit/history-rewrite-tree-enumeration.test.ts`
- `test/unit/local-git-tree-list.test.ts`
- `test/unit/document-git-history-rewrite-runtime.test.ts`

The tests cover SHA-only rewrites, direct modified-line mapping, missing old objects, snapshot fallback, unique rename recovery, duplicate candidates, malformed diffs, Git failures, complete mapper integration, immutable tree enumeration, and production snapshot publication/recovery.

## TDD evidence

The following runs are tied to the listed commit SHAs. No run from another SHA was substituted.

| Stage | HEAD SHA | Run | Result | Diagnostic artifact | Evidence |
| --- | --- | --- | --- | --- | --- |
| Core recovery test added before implementation | `ef3e669814c9c3f8036bcf1c27cca7c33d704c54` | `31090848838` | Failed | `8963364201` | Recovery module did not exist. |
| Git/snapshot adapter tests added | `812b0f294a9c5083c192c229780e9af8baeff0a4` | `31091485735` | Failed | `8963629179` | Adapter exports were not implemented. |
| Conservative ambiguity/text checks added | `cee3b393984323c3b4bdb25fb62dbb730b372223` | `31091967984` | Failed | `8963826320` | Same-path early acceptance and old-text line-count contradiction were reproduced. |
| Git mapper integration tests added | `0f979c2e9a67ea52a69eb204a42f9cd2533ecaf5` | `31092830042` | Failed | `8964182780` | Mapper recovery port/coordinator were absent. |
| Immutable Git tree tests added | `b416cde72f4965c669682d63f7df39fa90116d94` | `31093541191` | Failed | `8964473998` | Tree enumeration method was absent. |
| Automatic rename-candidate test added | `c0fd956ac914a1787e58b42c19a81e9b64f6bca9` | `31093735079` | Failed | `8964554714` | Mapper did not enumerate the current tree. |
| Runtime fixture compile correction stage | `276b9e036d04d525a4622fe6a35086e732f295d2` | `31093993447` | Failed | `8964658023` | Test fixture generic clone typing was invalid; this was corrected before runtime Red assessment. |
| Production runtime behavior test | `f6be6a37254043472149f4215bbd7a8dc297a66e` | `31094180135` | Failed | `8964732426` | Existing 448 tests passed; the new runtime test alone showed reviewed ranges becoming empty because production wiring was absent. |
| Production wiring compile correction | `73cd3133af2ba15f7fb827850713d16cace379e2` | `31094540912` | Failed | `8964865421` | Transaction snapshots required recursive readonly typing. |
| Lint correction | `c5f3db4d88ecc29dc4940d7b433325b9de1845c9` | `31094626163` | Failed | `8964902969` | One unused type import remained. |
| Implementation Green | `424fdd54e059500d7c9e1b78793bb75f281b6fa3` | `31094706729` | Passed | Not generated | Complete workflow passed. |

## Final implementation validation

The workflow run `31094706729` is associated with implementation HEAD `424fdd54e059500d7c9e1b78793bb75f281b6fa3`. Job `92593797186` completed successfully.

Successful steps:

- Dependency installation.
- TypeScript build.
- Public contract typecheck.
- Architecture validation.
- Architecture negative contract validation.
- ESLint.
- Complete unit suite.
- Focused T602 recovery suite.
- T403 GitHub cache suite.
- T304 progress tree suite.
- T502 mapping/display suite.
- T503 repository enumeration suite.
- T504 global understanding suite.
- Temporary Git integration tests.
- Mock GitHub integration tests.
- VS Code Extension Host tests.

Because the run succeeded, the failure-diagnostics upload step was correctly skipped.

## Findings and dispositions

| Finding | Disposition |
| --- | --- |
| Existing revision mapper cleared all ranges when the old object disappeared. | Added missing-object-only snapshot recovery. |
| Accepting the first same-path snapshot could hide a second valid candidate. | Evaluate all candidates and reject multiple surviving mappings. |
| Empty mapped ranges could be overwritten by exact-content fallback. | Treat an authoritative empty same-path snapshot mapping as recovered/unreviewed. |
| Complete old text could contradict persisted line-count metadata. | Reject contradictory direct Git evidence. |
| Rename candidates were unavailable in production. | Added immutable NUL-delimited Git tree enumeration and automatic mapper use. |
| Recovery service was not connected to the production document provider. | Registered a source-specific coordinator and added Git snapshot publication/invalidation. |
| Partial snapshot publication could leave one stale pointer. | Invalidate both context and Global pointers after any publication failure. |

No independent reviewer findings were available during this implementation pass.

## Untouched or blocked work

- `tasks/tasks-status.md` was not manually edited. The uploaded worker skill set did not include the required task progress-sync/task-planner capability, and manual status mutation would bypass the defined synchronization workflow.
- No merge was performed.
- No independent final review was performed by the implementation worker.
- No design document was changed because the implementation follows the existing recovery order and conservative mapping requirements already documented for T602.

## Remaining risks

- Enumerating and reading candidate files from a very large current Git tree can be expensive. Recovery remains bounded by existing snapshot availability but may perform multiple immutable file reads during a history rewrite.
- Files without a safely published snapshot, exact text proof, or unique content identity remain unreviewed by design.
- Binary, non-UTF-8, missing, corrupt, or expired evidence remains unreviewed.
- Snapshot publication occurs when a Git session is opened or committed. A file that was never opened after snapshot support was introduced has no recovery generation.
- This report and the handoff are administrative commits after the implementation Green SHA. The final pull-request HEAD requires its own matching CI run before handoff completion.

## Next action

1. Save the structured T602 handoff in `reports/`.
2. Confirm CI on the exact final PR HEAD after report and handoff commits.
3. Update PR #49 with the final implementation summary and exact-head validation.
4. Perform an independent review. The implementation worker must not merge the PR.

# PR #94 normal fix verification R2

## Scope

PR94-NR-001 / PR94-NR-002 の限定再確認。

- Review mode: same-reviewer bounded normal fix verification R2
- Previous reviewed HEAD: `716501b82e9346a4f50b0557f42d04636176662d`
- Reviewed immutable HEAD: `c2e5597447a2e408673944d5f900d25ea9f0066a`
- Reviewed delta: `716501b82e9346a4f50b0557f42d04636176662d..c2e5597447a2e408673944d5f900d25ea9f0066a`
- Coverage boundary: PR94-NR-001 High and PR94-NR-002 High closure only. PR94-NR-003 / PR94-NR-004 are closed-regression checks only; no fresh whole-PR or independent review was performed.

## Findings

No new findings.

### PR94-NR-001 — High — closed

- Required action: for a mixed immutable local-Git restore, preserve the exact hit layer, invoke mapping only for the miss layer, and publish the resulting Context/Global pair through one composite CAS/history operation; a CAS conflict must publish neither state nor history.
- Production path: `src/application/review-context/git-context-revision-mapper.ts:326-352` now resolves Context and Global independently and leaves the hit layer's mapper undefined. The result selects the exact hit and only the miss mapper output (`:357-383`). A source configured to throw on the second diff call therefore still completes both Context-hit/Global-miss and Context-miss/Global-hit cases with exactly one diff acquisition.
- Actual composition: `test/unit/document-git-context-lifecycle.test.ts:412-488` exercises both mixed directions through `DocumentReviewStateSessionProvider`; each transition records exactly one repository commit, one `exact-revision-snapshot-mixed` history event, one diff call, and the atomically captured Context/Global target snapshots. `:490-540` keeps the stale-CAS regression: all rejected retry attempts leave persisted state unchanged and publish no history event.
- Focused evidence: direct mapper assertions in `test/unit/git-context-revision-mapper-binary.test.ts:219-250` and actual-provider assertions above passed in the 34/34 focused run.
- Disposition: all required actions, production path, actual composition, focused evidence, success CAS/history ordering, and conflict no-publish behavior are complete. Identity and severity remain PR94-NR-001 High.

### PR94-NR-002 — High — closed

- Required action: the production PR evidence loader must supply authoritative target evidence for every Global target-snapshot candidate path, including an unchanged Global-only path absent from the diff; exact restoration must retain line bounds and fail closed when evidence is unavailable or inconsistent.
- Production path: `src/application/review-contexts/pull-request-revision-evidence-loader.ts:125-146` enumerates every file in the target Global revision snapshot that is not already represented by the diff, reads it at `targetHeadSha`, and supplies stable identity, target line count, content hash, and transient target text. Missing, binary, or unavailable candidate content throws at `:132-137`. The actual runtime constructs this loader and passes its result to the immutable PR mapper in `src/t405-review-contexts-runtime.ts:739-798`.
- Actual composition: `test/unit/t405-revision-evidence.test.ts:149-219` composes the real `PullRequestRevisionEvidenceLoader` with `createImmutablePullRequestRevisionMapper`, verifies the unchanged `src/global-only.ts` target read, and restores its reviewed range while the Context layer maps.
- Bounds/fail-closed evidence: `src/core/review-state/revision-snapshot-service.ts:184-212` requires non-negative safe target line counts, exact file identity/path/hash, and reviewed intervals within the target bound. `test/unit/immutable-revision-review-snapshot.test.ts:113-152` passed valid-path and missing/negative/out-of-bounds rejection coverage; corrupt identity/path/hash/line evidence also remained Green.
- Disposition: all required actions, every Global candidate production path, actual loader-to-mapper composition, focused evidence, authoritative line bounds, and fail-closed handling are complete. Identity and severity remain PR94-NR-002 High.

### Closed-regression dispositions

- PR94-NR-003 Medium remains closed: the R2 delta changes neither the typed composite transaction contract nor its production composition. The focused compile remained Green; no new criterion was added.
- PR94-NR-004 Medium remains closed: the R2 delta changes neither `package.json` nor CI/performance workflow wiring. No `test:t607`, performance, default, or Host execution was introduced.

## Validation

- `npm run compile:test` — PASS (run once at reviewed HEAD).
- `node --test test-dist/test/unit/git-context-revision-mapper-binary.test.js test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/t405-revision-evidence.test.js test-dist/test/unit/immutable-revision-review-snapshot.test.js` — PASS: 34 passed, 0 failed (run once).
- Focused coverage disposition:
  - NR-001: both mixed directions; hit-layer mapper bypass with a throwing second diff source; actual provider one successful CAS and mixed history; conflict no state/history publication.
  - NR-002: production loader enumeration of all target Global snapshot candidates; unchanged Global-only target read; actual loader-to-mapper restoration; valid/missing/negative/out-of-bounds line-count and corrupt evidence fail-closed coverage.
  - NR-003 / NR-004: closed-regression only; no related production/config change in this delta.
- Deliberately not run: full/default suite, Host suite, `test:t607`, performance, CI, or CI waiting.
- Exact-head CI for `c2e5597447a2e408673944d5f900d25ea9f0066a` remains held, non-blocking evidence. Markdown focused lint remains held because the repository has no supported `lint:md` script or Markdown terminology configuration.
- Repository identity/status after validation: HEAD remained `c2e5597447a2e408673944d5f900d25ea9f0066a`; the only working-tree delta was this reserved report.

## Verdict

`pass_with_held`

PR94-NR-001 High and PR94-NR-002 High are closed at exact reviewed HEAD `c2e5597447a2e408673944d5f900d25ea9f0066a`. PR94-NR-003 / PR94-NR-004 remain closed under regression-only inspection. There are no blockers, no user-confirmation-required gaps, no new findings, and no unexplored in-scope finding branch. Held items are limited to exact-head CI and unsupported Markdown lint; both are explicitly non-blocking for this bounded R2 verdict.

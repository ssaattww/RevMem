# PR #94 exact-head CI follow-up 2 normal verification

## Scope

CI run 33401731327 のT602 fixture修正。

- Review mode: same-reviewer bounded normal verification of exact-head CI follow-up 2
- Base: `7d92ab757c67dfe7adcbd3123d44add0dfbfb5be`
- Reviewed immutable HEAD: `a90e0ded8dad33a7a4dc1080e2674f4d9b73794c`
- Reviewed range: `7d92ab757c67dfe7adcbd3123d44add0dfbfb5be..a90e0ded8dad33a7a4dc1080e2674f4d9b73794c`
- Coverage boundary: the two stale-open fixtures, the direct-Context/recovered-Global disagreement bounds fixture, and the exact six-file T602 command only. No fresh whole-PR or independent review was performed.

## Findings

No required or new findings.

### Stale-open fixtures — checked_no_finding

- `test/unit/document-git-history-rewrite-runtime.test.ts:297-345` and `:347-386` now retain the `markReviewedRanges` transaction and construct the newer unreview from `marked.next.contextState` and `marked.next.globalState`. This is the state that the mark commit actually published, so the unreview's expected CAS pair is current rather than stale.
- The concurrency meaning is unchanged: one open is delayed after capturing reviewed state, a newer unreview commits, and the delayed open is then released. The first case covers delay during snapshot publication; the second covers delay before enqueue/read completion. Both still end with history-rewrite recovery asserting empty Context `modifiedReviewed` and empty Global `reviewed`, so an old open cannot republish ranges removed by the newer transaction.
- No behavioral assertion was removed or relaxed. The final Context/Global non-republication assertions are identical; the changed setup allows the intended newer transaction to pass CAS instead of failing before the race is exercised.

### Bounds/disagreement fixture — checked_no_finding

- `test/unit/history-rewrite-git-context-integration.test.ts:274-307` changes only the target Context text from one line to `"context\nbeta\ngamma"`, matching the persisted three-line `lineCount` and reviewed range.
- The intended disagreement remains: direct Context evidence resolves `src/context.ts` with Context content, while recovered Global evidence resolves `src/recovered.ts` with different Global content. The unchanged assertions still require both Context and Global files to clear and the file ID to remain unresolved. The fixture now reaches that disagreement branch instead of failing earlier on immutable bounds validation.

### Evidence-count correction — non-blocking

- The implementation follow-up report states that the six matching files registered 29 tests and could not account for the CI count of 31. Running the exact `.github/workflows/ci.yml` T602 command, including its `tools/run-ci-command.mjs test-t602` wrapper and all six files, registered and passed 31 tests. This verification supersedes the report's provisional 29-count statement; it does not indicate missing or weakened product coverage.

## Validation

- `npm run compile:test` — PASS (run once at reviewed HEAD).
- Exact CI T602 command — PASS: 31 passed, 0 failed (run once):
  - `node tools/run-ci-command.mjs test-t602 node --test test-dist/test/unit/history-rewrite-recovery.test.js test-dist/test/unit/history-rewrite-recovery-conservative.test.js test-dist/test/unit/history-rewrite-git-context-integration.test.js test-dist/test/unit/history-rewrite-tree-enumeration.test.js test-dist/test/unit/local-git-tree-list.test.js test-dist/test/unit/document-git-history-rewrite-runtime.test.js`
- Coverage dispositions:
  - newer unreview expected CAS state: `checked_no_finding`.
  - stale open non-republication in both arrival orders: `checked_no_finding`.
  - assertion strength: `checked_no_finding`.
  - line-count/target-text bounds consistency: `checked_no_finding`.
  - direct Context/recovered Global disagreement clearing: `checked_no_finding`.
  - six-file CI command and test count: `checked_no_finding`, 31 registered tests confirmed.
  - remote exact-head CI: `held`; CI execution/waiting was outside this bounded verification.
  - full/default, Host, performance, and `test:t607`: `not_applicable` and deliberately not run.
- No blocking or user-confirmation-required gap remains, and no in-scope branch is unexplored. HEAD remained `a90e0ded8dad33a7a4dc1080e2674f4d9b73794c`; the only working-tree delta after validation is this reserved report.

## Verdict

`pass_with_held`

The test-only follow-up preserves the stale-open CAS/non-republication contract and the bounds-aware disagreement-clear contract without weakening assertions. No new finding applies to reviewed HEAD `a90e0ded8dad33a7a4dc1080e2674f4d9b73794c`. Remote exact-head CI is the only held non-blocker.

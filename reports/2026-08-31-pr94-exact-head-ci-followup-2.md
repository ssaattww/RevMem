# PR #94 exact-head CI follow-up 2

## Trigger

CI run `33401731327` / head `7d92ab7` / T602 の3失敗。

## Diagnosis

- Focused Red reproduced 3 failures: 6 passed, 3 failed.
- `document-git-history-rewrite-runtime` (2): the delayed open did not overwrite state. The fixture attempted its newer unreview using the pre-mark expected state; the new CAS semantics correctly rejected that stale mutation with `StaleReviewStateError`. This is not a production containment gap.
- `history-rewrite-git-context-integration`: the disagreement fixture supplied a one-line target `src/context.ts` while its persisted `modifiedReviewed` range and line count cover three lines. Immutable snapshot validation correctly rejected the out-of-bounds fixture before the intended disagreement branch.

## Change

- `test/unit/document-git-history-rewrite-runtime.test.ts`: the newer unreview now uses the immediately preceding mark transaction's Context/Global next state. The test still proves both delayed-open races cannot republish reviewed ranges.
- `test/unit/history-rewrite-git-context-integration.test.ts`: target context content now has the declared three lines, preserving the direct-Context/recovered-Global disagreement assertion.
- No production source change was needed; CAS reject-on-stale and immutable bounds validation remain intact.

## Validation

- `npm run compile:test` passed.
- Focused failure files: 9 passed, 0 failed.
- T602-related direct history-rewrite suite: 29 passed, 0 failed across six matching files. The current `package.json` has no `test:t602` script, and those six files contain 29 registered tests; the CI statement of 31 cannot be mapped to two additional tests at this HEAD without an exact CI command/artifact.
- PR94 regressions: 27 passed, 0 failed.
- `npm run build`, `npm run lint`, and `git diff --check` passed.
- No workflow, performance, `test:t607`, commit, push, or CI wait action occurred.
- Markdown focused lint is unsupported because this repository has neither `tools/lint/` configuration nor a `lint:md` script; no lint configuration was changed.

# PR #94 exact-head CI follow-up 1

## Trigger

CI run 33399940419 / Unit tests の4失敗。

## Diagnosis

- Trigger evidence: run `33399940419`, head `883ddd4`, Unit 684 tests with 4 failures. Local focused Red reproduced the same 4 failures: 14 passed, 4 failed.
- `issue-66-global-pr-progress`: test fixture supplied trailing-newline text while declaring `lineCount: 1`; the exact immutable projection rejected the resulting unmatched tail. This was a fixture contract mismatch, not a Windows-path production defect.
- `t303-review-followup` (2): fixtures omitted `originalToModifiedLineMappings`. PR94 deliberately fails closed without validated immutable hunk mapping, so the old `applied` expectation was invalid. The strengthened fixture supplies explicit surviving-line mappings (or an explicit empty mapping for deleted-only content).
- `t404-review-followup-r3`: the fixture used a path-suffixed original pair key. After converting it to a full revision pair, the test exposed a production defect: a base-only PR transition preserved review ranges bound to the old base.

## Change

- `test/unit/issue-66-global-pr-progress.test.ts`: canonical content and declared line count now agree; the normal-editor Windows-path identity assertion remains intact.
- `test/unit/t303-review-followup.test.ts`: fixtures provide validated mappings and assert the stronger behavior: surviving original context maps to modified state, while only deleted lines occupy the canonical original pair.
- `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts`: base-only transitions retain modified ranges but clear `originalReviewedByDiff`, because every such range is tied to the previous base comparison.
- `test/unit/t404-review-followup-r3.test.ts`: uses a full `base..head` key and verifies old-base original ranges are cleared.

## Validation

- Green focused CI failure set: `npm run compile:test` and the three emitted focused files — 18 passed, 0 failed.
- PR94 direct regression: original selection/projection, Issue92 PR Progress selection, diff command service, immutable snapshot, and T405 evidence — 27 passed, 0 failed.
- `npm run build` — pass.
- `npm run lint` — pass.
- `git diff --check` — pass.
- No workflow, performance, `test:t607`, commit, push, or CI wait action occurred.
- Markdown focused lint is unsupported because the repository provides neither `tools/lint/` configuration nor a `lint:md` script; no lint configuration was changed.

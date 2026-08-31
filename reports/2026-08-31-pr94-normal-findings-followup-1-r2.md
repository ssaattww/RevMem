# PR94-NR-001 R2 実行レポート

## 対象

- finding: PR94-NR-001 High
- scope: local Git immutable mixed snapshot restore の hit-layer mapping bypass

## Red

- `npm run compile:test` succeeded, then the direct emitted mapper/provider run had 25 tests: 23 passed and 2 failed.
- The new two-direction mixed fixture made the second `diffRevisions` call unavailable. The old mapper still invoked Context and Global mapping, so both the direct mapper test and the actual provider composition failed with `The hit layer must not invoke diff mapping.`

## Green

- `npm run compile:test` passed.
- `node --test test-dist/test/unit/git-context-revision-mapper-binary.test.js test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/immutable-revision-review-snapshot.test.js` passed: 31 passed, 0 failed.
- `npm run lint` passed.
- `git diff --check` passed.
- In both mixed directions, exactly one diff mapping call occurs; target evidence remains separately read at the target revision before restore.

## 変更

- `src/application/review-context/git-context-revision-mapper.ts`: resolves each snapshot layer first and invokes `mapContextFiles` or `mapGlobalFiles` only when that layer is not an exact hit. The hit layer remains exact; the missing layer is conservatively mapped.
- `test/unit/git-context-revision-mapper-binary.test.ts`: direct Context-hit/Global-miss and reverse assertions make a second diff mapping call fail, proving the hit-layer mapper is not invoked.
- `test/unit/document-git-context-lifecycle.test.ts`: actual `GitContextDocumentReviewStateSessionProvider` composition uses the same source guard and proves one CAS, `exact-revision-snapshot-mixed` history, and both mixed directions. The existing conflict fixture proves rejected CAS attempts publish neither state nor history.

## リスク

- This slice intentionally leaves NR-002 through NR-004 and unrelated PR/T405 paths unchanged.
- The source-unavailable proof is a rejected second diff acquisition: target snapshot evidence is still read once at the immutable target revision, as required for exact-hit validation.
- No full/default, Host, performance, workflow, commit, push, or CI validation was run.
- Markdown focused lint is unsupported: this repository has neither `tools/lint/` configuration nor a `lint:md` package script. No terminology setting was added or bypassed.

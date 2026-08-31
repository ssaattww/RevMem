# PR94-NR-002 R2 実行レポート

## 対象

- finding: PR94-NR-002 High
- scope: PR immutable snapshot Global evidence completeness

## Red

- `npm run compile:test` passed, then the direct evidence-loader/mapper run had 9 tests: 8 passed and 1 failed.
- The new composition fixture expected the target `src/global-only.ts` read. Before the fix the loader read only diff paths, so it omitted that Global snapshot candidate and the assertion failed.

## Green

- `npm run compile:test` passed.
- `node --test test-dist/test/unit/t405-revision-evidence.test.js test-dist/test/unit/immutable-revision-review-snapshot.test.js test-dist/test/unit/github-pr-context-layer-store.test.js` passed: 17 passed, 0 failed.
- `npm run lint` passed.
- `git diff --check` passed.

## 変更

- `src/application/review-contexts/pull-request-revision-evidence-loader.ts`: after diff acquisition, reads every Global file in the candidate target revision snapshot that was absent from the diff. It supplies canonical file identity, path, target line count, content hash, and transient mapping text without logging content or credentials.
- `test/unit/t405-revision-evidence.test.ts`: actual `PullRequestRevisionEvidenceLoader` to immutable mapper composition proves Context miss/Global hit restores an unchanged Global-only file at the target revision.

## リスク

- Missing, binary, or otherwise unavailable candidate target content throws before restore; no unvalidated Global hit is adopted. Base-only transitions remain on their existing no-diff path.
- The loader retains target text only in the returned in-memory mapping evidence. This slice adds no logging, token handling, workflow, or performance wiring.
- No full/default, Host, performance, commit, push, or CI validation was run.
- Markdown focused lint is unsupported: this repository has neither `tools/lint/` configuration nor a `lint:md` package script. No terminology setting was changed.

bb\xbf# Missing repository resolution ENOENT recovery design

## Purpose

Define the design boundary for ENOENT handling during local Git repository resolution. Implementation and tests are deferred until review approval.

## Evidence from current code

- src/adapters/local-git/node-local-git-adapter.ts: stat(startPath) can observe a deleted document path while resolving a candidate.
- src/adapters/local-git/local-git-adapter.ts: inspectedPath is passed as Git command cwd.
- src/adapters/local-git/node-git-command-executor.ts: cwd is checked again before execution; ENOENT must remain visible.
- src/application/review-context/repository-resolution.ts: candidate resolution must isolate missing candidates instead of aborting remaining candidates.

## Responsibility boundary

Document-derived path normalization belongs to repository resolution. Git execution validation belongs to the executor. The executor does not suppress filesystem errors.

## Candidate recovery contract

A missing document, parent directory, or repository candidate is a recoverable discovery failure. Continue searching other valid candidates. EACCES is a separate access failure and must not be converted to ENOENT.

Nested repository ownership must be preserved. A deleted nested repository must not silently resolve to an outer repository without existing ownership rules proving that relationship.

## Exception classification

- ENOENT: candidate disappeared; continue candidate evaluation.
- EACCES: permission failure; retain diagnostics and do not treat as missing.
- Other errors: preserve original classification.

## TDD plan (not executed)

Use synthetic local Git fixtures: delete a document, delete intermediate directories, remove repository directories, provide multiple roots, restore paths and retry, and verify nested repository ownership boundaries. Existing executor ENOENT tests remain valid.

## Scope

No dependency changes. No private fixtures. No implementation before design review.

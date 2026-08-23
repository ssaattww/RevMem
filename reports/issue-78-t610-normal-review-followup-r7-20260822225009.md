# T610 normal review follow-up R7

## Scope

Fixed technical head: `d7dd8132d0233af58eacd0637847b41b205cd8bc`. Only T610-NR-004/005/006/007/008/010 were changed. No design-history, tracking, commit, push, CI, or GitHub writes were made.

## TDD and local validation

The combined Red command was `npm run test:t610`: 41/45 passed; partial repository percentage, real Host filesystem mutation, operation-wide deep-walk budget, and exactly-once documentation wiring failed as expected. The focused Green command later passed 47/47. `npm run test:t607` passed 81/81.

`npm run build`, `npm run typecheck:contracts`, `npm run lint`, `npm run validate:architecture`, `npm run validate:architecture:negative`, and `git diff --check` passed. Markdown wording lint is unsupported because this repository has neither `tools/lint/` nor `lint:md` wiring.

## Finding matrix

| Finding | Production | Test | Composition | Validation | Status |
| --- | --- | --- | --- | --- | --- |
| T610-NR-004 | Recursive aggregate projects partial repository semantics; summary/status omit a repository percentage. | Three-level aggregate and partial model/status assertions. | Hierarchical Tree provider retains parent/child rows. | T610/T607/static pass; Host timeout. | incomplete |
| T610-NR-005 | Commands reject stale rows and resolve no-argument input only for one current active/stopped scope. | Stale-node and public-command tests. | Three state-specific Tree context registrations; Host uses public stop/resume commands. | T610/static pass; Host timeout. | incomplete |
| T610-NR-006 | Startup documents use the production source and coalesced refresh. | T610 lifecycle static check. | Host uses `workspace.fs.writeFile`, not callback seam. | T610/static pass; Host timeout. | incomplete |
| T610-NR-007 | Atomic/lock storage remains fail-closed; folder commands use shared operation feedback. | Corruption, ENOSPC, cross-window, and redacted command tests. | Raw storage errors map to the Review Range Output boundary. | T610/static pass; Host timeout. | incomplete |
| T610-NR-008 | One recursive operation-wide 128-item budget includes final/pruned remainder. | Direct and deep 257-folder fixtures. | Source uses the enumerator scheduler. | T610/T607/static pass; Host timeout. | incomplete |
| T610-NR-010 | Exported API documentation contract added. | `t610-public-api-documentation.test.ts`. | Wired exactly once in `test:t610`. | T610/contracts/build/lint pass; Host timeout. | incomplete |

## One-shot Extension Host result

Exactly one command ran: `node test-dist/test/vscode/run-extension-host.js --t610` (960-second outer allowance). It failed after 321.9 seconds: `t610-initial` timed out at 300 seconds and runner cleanup timed out at 10 seconds. No retry was run. Diagnostics are `test-output/vscode-launch-diagnostics/t610-initial-1787408281936.json` and `test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787408292920.json`.

## Result and risk

Result: **incomplete**. Focused and local static evidence is Green, but the required one-shot Host lifecycle did not complete, so none of the six findings is ready for closure. Full local equivalence was intentionally not run.

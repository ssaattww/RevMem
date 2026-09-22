# Issue #124 / PR #125 Normal Fix Follow-up — Independent Findings

## Metadata

- report type: implementation follow-up report
- generated at: 2026-09-22T21:01:19+09:00
- repository: `ssaattww/RevMem`
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base SHA: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- normal review record HEAD: `c120c7e46f7ca732113598672df52c0ce63260db`
- technical implementation HEAD: `cd0f2a288e762d8d2406e78a6ca3bacea03bbdc8`
- execution: FA780 / Windows / PowerShell / Remote Desktop Commander
- completion gate: local validation; CI wait deferred by user
- merge: not performed

## Input findings

The same normal reviewer returned the following dispositions:

- I124-IFR-001 / High: not closed
- I124-IFR-002 / Low: not closed
- I124-IFR-003 / High: not closed; required actual source/runtime fixture incomplete
- I124-IFR-004 / Medium: not closed; required actual composition fixture incomplete
- I124-IFR-005 / Medium: not closed; required source-path stale-publication fixture incomplete

This implementation pass preserves those IDs and severities. It does not change the normal review verdict.

## I124-IFR-001 / High

### Defect A — stopped open-document body access

The production extension previously materialized every open document body before the source could apply its candidate set. The sequence was:

1. `document.getText()`
2. hash calculation
3. `document.lineAt(...)`
4. source-side candidate filtering

Therefore a stopped/non-candidate scope could still incur body access even though its evidence was discarded later.

### TDD Red

A regression cell was added for a stopped sibling and first attempted to express a candidate-aware open-document reader. The existing dependency signature accepted only the owner, so the test failed at compile time: the production API could not express pre-body candidate filtering.

### Fix

The source dependency now supplies a candidate predicate to the open-document reader. Production document materialization was moved into:

`src/composition/global-understanding/global-understanding-open-document-reader.ts`

The reader performs owner/root/scheme/path checks and the candidate predicate before any `getText()`, hashing, or `lineAt(...)` work. `src/composition/extension.ts` uses this production reader.

The committed actual-source fixture uses the same production reader with TextDocument-shaped objects and verifies after stopping `one`:

- stopped `one`: zero `getText()/lineAt()` body access
- active `two`: body is still materialized
- stopped lifecycle row remains

### Defect B — running to stopped during the current refresh

Final retention previously used the folder set captured at refresh start. A scope stopped while the generation was running therefore remained in that initial active set and its prior row/progress/open target was treated as replaced even though the generation never accepted a result.

### TDD Red

After fixing candidate-aware body materialization, the second regression reproduced:

- before: `["one/a.ts","two/a.ts"]`
- stop `one` from a current `running` publication
- after: `["two/a.ts"]`

### Fix

The source now tracks `acceptedFolders` for the current generation. Only folders whose current generation successfully passes `accept(...)` replace prior evidence.

If a running scope is stopped/cancelled and never accepts:

- previous discovered path is retained
- previous progress is retained
- previous open target is retained

The actual runtime regression also invokes the public STOP command on the current running folder row and verifies the final runtime model keeps `one/a.ts` and its prior open target while `one` is stopped and `two/a.ts` remains visible.

### Commit

- `7156ede7da38ea746eccacdb401cac8fe7bdc485` — `fix: close Global lifecycle composition gaps`

## I124-IFR-003 / High

Production behavior was already correct. This pass adds the missing committed actual source + actual VS Code runtime/provider regression.

Fixture:

`actual Global runtime shows a spinner only on the sibling that is still running`

It uses the real T305 Global source and the real Global runtime/provider. During a two-sibling refresh it requires an observed current-generation presentation with:

- `one=active`, icon `folder`
- `two=running`, icon `loading~spin`

This closes the missing regression cell returned by normal review; formal disposition remains the normal reviewer's responsibility.

## I124-IFR-004 / Medium

Production behavior was already correct. This pass adds the required single actual-composition regression.

Fixture:

`actual PR Global composition keeps an unchanged path-only row visible without an open command`

The test uses a real PR Global source and real runtime/provider with:

- `changed.ts`: immutable PR HEAD evidence exists
- `unchanged.ts`: repository path enumeration finds it, but it is absent from PR HEAD diff evidence

Assertions:

- both rows are visible
- `changed.ts` has a `pull-request-head` target
- `changed.ts` has the public Global file-open command
- `unchanged.ts` has no open target
- `unchanged.ts` has no open command

## I124-IFR-005 / Medium

Production bounded and cancellation behavior was already correct. This pass adds the required committed source-path stale-publication regression.

Fixture:

`actual Global source abort during path canonicalization never publishes a stale file projection`

The fixture:

- creates an actual 10,000-file repository
- runs the real T505 Global source
- aborts during `source-path-canonicalize`
- requires `AbortError`
- permits the initial current lifecycle publication
- rejects any publication containing discovered-file or progress-file projection after stale source-path work begins

The existing 10,000-path budget fixture remains Green.

### Commit

- `cd0f2a288e762d8d2406e78a6ca3bacea03bbdc8` — `test: fence stale Global source path publication`

## I124-IFR-002 / Low

This finding is deliberately **not** marked closed by the implementation worker.

The normal review required the final task/PR metadata sync only after the product findings pass normal fix verification. This implementation pass updates the intermediate state truthfully to:

- product fixes and required fixtures implemented
- technical HEAD `cd0f2a288e762d8d2406e78a6ca3bacea03bbdc8`
- same normal reviewer re-verification pending
- final IFR-002 sync pending until normal closure
- current-head CI success is not asserted unless checked against the then-current PR HEAD

After the same normal reviewer closes the product findings, task/PR metadata must be synchronized once more before independent closure.

## Focused validation

Technical HEAD: `cd0f2a288e762d8d2406e78a6ca3bacea03bbdc8`

- candidate-aware/open lifecycle actual regressions: 5/5 pass
- source-path stale-publication regression: 1/1 pass
- `npm run test:t505`: 26/26 pass
- `npm run test:t610`: 86/86 pass
- performance focused: 6/6 pass
- `npm run test:t607`: 89/92
  - exactly three known baseline failures remain
  - all new Issue #124 regression cells pass
- `npm run build`: pass
- `npm run lint`: pass
- `npm run typecheck:contracts`: pass
- `npm run validate:architecture`: pass
- `npm run validate:architecture:negative`: expected 11 findings matched

## Default local gate

`npm test`: exit code 0

- unit: 864 pass / 0 fail / 2 skip
- Git integration: 35 pass / 0 fail / 3 skip
- GitHub integration: 48/48
- T502: 11/11
- VS Code Extension Host:
  - t302: success
  - lifecycle-confirm: success
  - lifecycle-restore-unmarked: success
  - fixture cleanup: success

Per user instruction, CI completion is not the completion gate for this implementation pass. No workflow run from another SHA is substituted or reported as current-head success.

## Finding completeness matrix

| Finding | Required action | Production path | Actual committed fixture | Focused evidence | Implementation state |
| --- | --- | --- | --- | --- | --- |
| I124-IFR-001 / High | zero stopped-scope body access + running-to-stopped prior row/target retention | candidate-aware production reader + current-generation accepted-folder retention | stopped-body actual reader/source; running-stop actual source; public STOP runtime composition | T610 86/86 | addressed; normal re-verification pending |
| I124-IFR-002 / Low | final metadata sync after normal product closure | task ledger + GitHub PR body | state comparison | final sync intentionally pending | pending final sync after normal closure |
| I124-IFR-003 / High | actual source/runtime spinner regression | post-accept lifecycle publication + actual runtime/provider | active sibling no spinner / running sibling loading~spin | T610 86/86 | required fixture added; normal re-verification pending |
| I124-IFR-004 / Medium | actual composition non-diff PR row regression | sparse exact-HEAD target + conditional Tree command | changed/unchanged actual source + runtime/provider | T610 86/86 | required fixture added; normal re-verification pending |
| I124-IFR-005 / Medium | actual-source stale source-path non-publication regression | bounded source-path scheduler + abort/current fencing | 10k source abort during canonicalization | focused 6/6 | required fixture added; normal re-verification pending |

## Changed production files

- `src/composition/global-understanding/global-understanding-source.ts`
- `src/composition/global-understanding/global-understanding-open-document-reader.ts`
- `src/composition/extension.ts`

## Changed tests

- `test/unit/t610-folder-understanding.test.ts`
- `test/unit/t607-performance-incremental-ui.test.ts`

## Next action

Return this technical implementation to the **same normal reviewer** that produced the review record at `c120c7e46f7ca732113598672df52c0ce63260db`.

The normal reviewer should verify only I124-IFR-001 through I124-IFR-005 plus the implementation delta. The implementation worker does not change the review verdict.

If that normal verification closes the product findings:

1. synchronize IFR-002 final task/PR metadata to that exact state;
2. return IFR-001 / IFR-002 to their issuing independent reviewer for limited closure;
3. return IFR-003 through IFR-005 to their issuing independent reviewer for limited closure;
4. if CI is checked, use only a run whose `head_sha` exactly matches the then-current PR HEAD;
5. do not merge.

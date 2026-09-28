# PR Progress tracking revision normal fix verification

## Metadata

- Repository: ssaattww/RevMem
- Pull request: #130
- Issue: #123
- Review mode: normal fix verification
- Source finding: I123-NR-001 / High
- Original reviewed implementation HEAD: `eb52a6fe071c1b19ee42941863a5fb930ddd1809`
- Technical fix HEAD: `1231d64a70e50c7fa24e0bb184a0141a2671923b`
- Administrative HEAD reviewed before this final report: `39234de5bd8882e0edcf2392bfc739c48536f746`
- Merge: not performed

## Verdict

**pass**

I123-NR-001 is closed. No new required finding was identified in the fix diff or in the directly affected Current Context / Review Contexts behavior.

## Finding closure

The original defect was that local Current Context enumeration first produced a branch candidate carrying the verified `pullRequestSynchronizationRevision`, then the visible-editor pass recreated the same selection key without that revision and overwrote the richer candidate.

The fix in `src/composition/extension.ts` now computes the visible-editor candidate selection key and inserts it only when that key is not already present. The earlier repository candidate therefore retains the verified tracking revision. The branch/editor ownership revision remains local `HEAD`; the synchronization-only revision is preserved separately.

The added Extension Host regression exercises the actual production composition with a real visible Git editor. The implementation follow-up records the required Red on the unfixed implementation, followed by Green after the fix. The fixture was subsequently moved into `test/vscode/run-extension-host.ts`, keeping Git fixture ownership out of the Host suite and satisfying the T609 test boundary.

## Regression review

The technical fix range `79e5a6e..1231d64` changes only:

- `src/composition/extension.ts`
- `test/vscode/t609-suite/index.ts`
- `test/vscode/run-extension-host.ts`

The later commits through `39234de5` change only review/report/tracking/handoff material. No later product source change was present.

Sibling behavior checked during review:

- same repository revisited through a visible editor preserves the earlier richer branch candidate;
- a visible editor for a repository not already enumerated can still add its candidate because insertion is only suppressed for an existing selection key;
- workspace fallback behavior is unchanged;
- selection identity remains repository/root/branch based and is not changed by synchronization metadata;
- local ownership `headRevision` remains distinct from PR synchronization revision.

No regression was found in those paths.

## Validation rerun

Validation was rerun on the current product tree, with PR administrative HEAD `39234de5bd8882e0edcf2392bfc739c48536f746`:

- Issue #123 focused regression: 4 pass / 0 fail
- `npm run test:t609`: 81 pass / 0 fail
- `npm run test:t609:extension-host`: exit 0
- `npm run test:i116`: 20 pass / 0 fail
- `npm run test:t405`: 84 pass / 0 fail
- `npm run test:unit`: 869 pass / 0 fail / 2 skip
- `git diff --check 79e5a6e..39234de5`: clean

The full unit gate confirms the fix did not introduce a detected regression outside the focused Current Context path.

## CI assessment

At the last pre-report check, the PR current HEAD was `39234de5bd8882e0edcf2392bfc739c48536f746`. Matching runs existed and were still in progress:

- pull_request: `36357759007`
- push: `36357757041`

Older successful runs were not substituted for this HEAD. The technical fix HEAD `1231d64...` previously had exact-head successful pull_request and push runs, but those are historical evidence only after later administrative commits.

This normal fix-verification verdict is based on local review and rerun validation; it does not claim current-head CI success. The final report commit will advance the PR HEAD again, so only a workflow run whose `headSha` matches that new HEAD can be used afterward.

## Coverage disposition

| Area | Disposition | Evidence |
| --- | --- | --- |
| I123-NR-001 required action | closed | actual visible-editor regression + minimal preservation fix |
| Fix diff correctness | checked_no_finding | duplicate candidate can no longer erase synchronization metadata |
| Current Context repository resolution | checked_no_finding | focused 4/4, i116 20/20, t609 81/81 |
| Review Contexts / PR Progress direct impact | checked_no_finding | t405 84/84 |
| Actual Extension Host composition | checked_no_finding | extension-host command exit 0 |
| Broad unit regression | checked_no_finding | 869 pass / 0 fail / 2 skip |
| Administrative commits after technical HEAD | checked_no_finding | report/task/handoff only |
| Exact current-head CI | held | matching `39234de5...` runs were in progress; no older SHA substituted |

## Remaining lifecycle work

Normal review is complete. I123-FINAL remains pending: independent final review, repository-defined final publication/report-attestation handling, and exact-current-HEAD CI according to the project lifecycle. Merge remains user-owned.

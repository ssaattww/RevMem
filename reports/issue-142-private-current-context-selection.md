# Issue #142: private Current Context PR selection investigation

## Scope and privacy boundary

Investigate why a PR that appears in the PR list can fail when selected as Current Context in the reported `0.1.61-pre` extension. Keep the private repository's name, URL, branch, PR number, local path, credentials, and source data out of this public repository and its logs. Issue #136 and #137 remain related references; this work does not replace or close them.

## Source evidence read so far

- The affected report names release tag `0.1.61-pre` (`6ab5736d148fff0d403d250f2a262ab426dde714`). The current `main` checkout is `ca9e6eea138ccd11b061f069fafc48ad545f6470` (`0.1.63-pre`). Do not treat current-main behavior as proof of the installed release's behavior.
- Current Context selection calls explicit PR-candidate preparation, enumerates candidates, opens the existing selection UI, then enumerates again and revalidates the selected candidate. The two enumerations mean a failure can happen before the picker or during post-picker revalidation.
- Explicit preparation inspects the active local repository, checks persisted PR contexts, and runs PR detection when no current PR context matches. The PR detection path can request an interactive GitHub session; subsequent candidate enumeration uses the runtime's normal acquisition path.
- The coordinator starts the `repository-identity` and `pr-acquisition` diagnostic stages before invoking the selection flow. A thrown selection error ends pending stages in one shared catch handler. Equal stage durations therefore do not identify two independent failing operations.
- The generic `permanent` classification is not by itself evidence of authentication rejection. The user-supplied spellings `pr-aquisition` and `permament` are preserved in Issue #142 as transcription; their identity with canonical source events remains unverified.
- `test/unit/t407-private-pr-context.test.ts` already contains private API fixtures covering authenticated Current Context selection, saved candidates, wrong preferred accounts, background non-interaction, and cancellation. The test file exists at `0.1.61-pre`; its current-main version has additional cases. A passing fixture does not yet explain the reported real-host failure.

## Investigation required before a product fix

1. Compare the reported release's actual failure path with current main without recording private repository identity or credentials.
2. Determine whether the failure occurs during local repository identity inspection, interactive session acquisition, PR detection, candidate enumeration, or post-picker revalidation.
3. Add a regression case for the first failing boundary, preserving the existing private-repository privacy contract.
4. Make only the smallest evidence-supported product change; retain issue #136/#137 as related work.

## Acceptance evidence

- A regression test fails before the fix and passes after it for the identified boundary.
- The existing private Current Context, wrong-account retry, cancellation, and background non-interaction contracts remain covered.
- Build, focused tests, and lint pass on the implementation head.
- Any diagnostic evidence is safe to publish and does not include repository identifiers, paths, PR numbers, tokens, or arbitrary exception text.

## Current conclusion

The available report and source reading do not yet establish a root cause. The identical `4644ms` durations and the redacted `permanent` category are insufficient to conclude that the account/session was rejected. Preserve this as an open investigation until the failing boundary is reproduced or otherwise isolated.

Closes #142

# Issue #142: private Current Context PR selection

## Scope and version correction

Investigate why a PR that appears in the list can fail when selected as Current Context in a private GitHub repository. The original report named `0.1.61-pre`; the user corrected this to `0.1.63` on 2026-10-11. Treat `0.1.61-pre` only as the superseded transcription, not the reproduction target. Do not publish the private repository's name, URL, branch, PR number, local path, credentials, or source data.

The corresponding public release tag is `0.1.63-pre`, at `ca9e6eea138ccd11b061f069fafc48ad545f6470`. The official VSIX SHA-256 `2fb19a46207fe3b6f492790d41a185d3714f97304200b3165bab35d673f5402a` matches the GitHub release digest. Its bundle contains the reported canonical stage keys. The earlier `0.1.61-pre` artifact probe is superseded and is not a blocker.

## Confirmed Current Context path

- The selection coordinator starts `current-context`, `repository-identity`, and `pr-acquisition` before invoking the selection controller.
- Any thrown error from preparation, candidate enumeration, the picker, or revalidation reaches one coordinator catch. That catch finishes all still-pending stages as failed with `refresh-failed`. Their timers started together, so equal durations are expected from one exception boundary and do not prove independent identity and PR failures.
- Explicit selection inspects the active local repository and parses its GitHub remote. If no persisted PR context is already current, it invokes PR detection; that path requests a VS Code GitHub session interactively (`createIfNone: true`) and searches by the resolved repository/head identity. An authenticated PR-search 404 may clear the preferred account and retry once.
- Candidate enumeration then reads persisted PR contexts and refreshes their lifecycle metadata through `auth.getAccessToken(identity.host, signal)`, whose default is non-interactive. PR progress acquisition also reads auth non-interactively. This post-detection/readback path is distinct from the interactive PR search; a missing or wrong session could affect it, but the reported log does not establish that it did.
- The VS Code auth adapter maps `github.com` to provider `github` (other configured hosts to `github-enterprise`), uses the `repo` scope, and converts `getSession` exceptions to an absent token unless cancellation occurred.
- For lifecycle metadata, HTTP 401/403 is classified as authentication; other non-success responses, including 404, are `api`. `GITHUB_PR_DETECTION_UNAVAILABLE` with reason `api` maps to `validation`, not `permanent`.

## Meaning of `permanent`

`permanent` is a generic operation-failure category, not an authentication diagnosis. `classifyOperationFailure` maps status 401/403 or a GitHub PR detection diagnostic with authentication reason to `authentication`; status 429 and known network timeouts to `retryable`; `GITHUB_PR_DETECTION_UNAVAILABLE` with reason `api` to `validation`. For `PR_PROGRESS_UNAVAILABLE`, it classifies from the **last attempt reason**: a terminal `git-failure` / `git-unavailable` maps to `permanent`, while an otherwise untyped error without a recognized status, type, or retryable code also falls through to `permanent`. The user-provided spelling `permament` is preserved as a transcript spelling and is not the canonical source category `permanent`.

The classifier uses only the **last** `PR_PROGRESS_UNAVAILABLE` attempt. In the production Current Context path, `PullRequestDiffAcquisitionService` records local Git failure first, then tries GitHub patch/content; the production GitHub adapter returns API/auth/network/rate/timeout/data reasons, not `git-failure` or `git-unavailable`. Thus those local Git reasons can be present in attempts but are not the terminal category in the normal fallback path. By contrast, cache publication occurs synchronously during candidate progress acquisition and its filesystem write/cleanup errors bubble out of the Current Context operation; an untyped filesystem error (for example `EACCES`, `EPERM`, or `ENOSPC`) can plausibly classify as `permanent`. This is a reachable alternative, not evidence that it occurred.

**Conditional priority:** if the actual category is canonical `permanent`, a raw cache/persistence/invariant error is more consistent with the classifier than an ordinary private-API auth failure. The transcript's `permament` spelling is non-canonical, so do not rely on that category until the actual Output line is confirmed. The authentication/session handoff remains the strongest symptom-specific hypothesis to test because the successful PR search is interactive while later lifecycle/progress reads are non-interactive.

## Existing coverage and gap

`test/unit/t407-private-pr-context.test.ts` covers interactive private PR detection, normal authenticated Current Context selection, saved same-HEAD contexts, background non-interaction, one wrong-preferred-account retry, and cancellation. Its wrong-account scenario exercises the PR-search 404 reselect path. The fixture checks private authorization for `GET /pulls?state=all`, but its PR detail/compare responses do not enforce authorization. It therefore does not simulate a session becoming unavailable between a successful PR-list/search operation and the later non-interactive candidate enumeration/revalidation.

A focused red test can extend `runScenario` with a flag that flips the fake VS Code session after the Current Context picker returns its PR candidate. Keep the first interactive PR search and first candidate enumeration authorized; on the post-picker revalidation, make `getSession(createIfNone: false)` return no/wrong token and enforce private authorization on `GET /pulls/{number}`. The test should prove that the PR candidate was shown, then record which operation/stage fails and whether Current Context was accepted. A separate injected cache-storage `write` failure can verify the `permanent` diagnostic path without conflating it with authentication. Keep all fixture repository identifiers synthetic.

## Current conclusion

The source provides a plausible authentication/identity boundary to test, but the real failure stage and underlying cause remain unconfirmed. The matching two-stage durations follow from one shared catch. If `permanent` is canonical, normal private API failures do not map to it; a raw cache/persistence/invariant exception ranks higher. Do not change product behavior until a regression test reproduces the failing boundary.

Closes #142

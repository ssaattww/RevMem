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

`permanent` is a generic operation-failure category, not an authentication diagnosis. `classifyOperationFailure` maps status 401/403 or a GitHub PR detection diagnostic with authentication reason to `authentication`; status 429 and known network timeouts to `retryable`; `GITHUB_PR_DETECTION_UNAVAILABLE` with reason `api` to `validation`. It maps `PR_PROGRESS_UNAVAILABLE` attempts with `git-failure` / `git-unavailable` to `permanent`, and any otherwise untyped error without a recognized status, type, or retryable code falls through to `permanent`. The user-provided spelling `permament` is preserved as a transcript spelling and is not the canonical source category `permanent`.

## Existing coverage and gap

`test/unit/t407-private-pr-context.test.ts` covers interactive private PR detection, normal authenticated Current Context selection, saved same-HEAD contexts, background non-interaction, one wrong-preferred-account retry, and cancellation. Its wrong-account scenario exercises the PR-search 404 reselect path. It does not simulate an account/session becoming unavailable between a successful PR-list/search operation and the later non-interactive candidate enumeration/revalidation.

A focused regression should exercise that exact boundary before any product change. It should distinguish: interactive PR search/session; persisted context identity; non-interactive lifecycle refresh; and post-picker revalidation. Keep all fixture repository identifiers synthetic.

## Current conclusion

The source provides a plausible authentication/identity boundary to test, but the real failure stage and underlying cause remain unconfirmed. The matching two-stage durations follow from one shared catch; `permanent` does not prove auth failure. Do not change product behavior until a regression test reproduces the failing boundary.

Closes #142

# Source layout and CI VSIX version

## Scope and authority

PR #115 implements the user's two requirements: remove task-number filenames from production source and identify PR CI VSIX packages by the main version at the branch point plus seven PR HEAD digits. Both changes belong to the same PR. This document defines the target contracts; implementation/verification status is recorded separately under `reports/`.

The work does not change review-state schemas, command IDs, user settings, review/Global synchronization semantics, or the main/release publication version policy. Existing exported symbol names and task IDs in regression tests are retained; this is a file-layout refactor, not a public-symbol redesign.

## Responsibility boundaries

`src/core` retains domain contracts and algorithms. `src/adapters` retains external I/O implementations. Reusable lifecycle, repository-selection and projection policies live in `src/application`; presentation identity helpers live in `src/ui`. Modules that instantiate adapters and connect application services, UI, storage and VS Code belong in `src/composition`, grouped by runtime responsibility.

The production entry point is `src/composition/extension.ts`, emitted as `dist/composition/extension.js` and selected by `package.json.main`. The existing `src/extension.ts` remains the base activation module; it is not a second package entry. TypeScript imports, dynamic imports, fixture imports, source-reading tests and the path-scoped lint configuration must follow the moves. No task-named compatibility source files or runtime path aliases are retained.

All paths in the following table are relative to `src/`.

| Previous path | Owning path |
| --- | --- |
| `t305-extension.ts` | `composition/extension.ts` |
| `t305-current-context-git.ts` | `composition/current-context/git-context-inspection.ts` |
| `t305-global-understanding-composition.ts` | `composition/global-understanding/global-understanding-composition.ts` |
| `t305-global-understanding-lifecycle.ts` | `application/global-understanding/document-open-lifecycle.ts` |
| `t305-global-understanding-startup.ts` | `application/global-understanding/startup-document-observation.ts` |
| `t305-projection-refresh.ts` | `application/review-context/projection-refresh.ts` |
| `t305-repository-root-uri.ts` | `application/repository-path/repository-root-uri.ts` |
| `t306-local-base-head-runtime.ts` | `composition/local-git/local-base-head-runtime.ts` |
| `t405-new-pull-request-global-composition.ts` | `composition/pull-request/new-pull-request-global-composition.ts` |
| `t405-owner-pull-request-synchronization.ts` | `composition/pull-request/owner-pull-request-synchronization.ts` |
| `t405-pr-review-projection-notifier.ts` | `application/review-contexts/pull-request-review-projection-notifier.ts` |
| `t405-pr-review-projection-sync.ts` | `application/review-contexts/pull-request-review-projection-sync.ts` |
| `t405-pull-request-review-runtime-base.ts` | `composition/pull-request/pull-request-review-runtime-base.ts` |
| `t405-pull-request-review-runtime.ts` | `composition/pull-request/pull-request-review-runtime.ts` |
| `t405-review-contexts-runtime.ts` | `composition/review-contexts/review-contexts-runtime.ts` |
| `t405-root-scoped-candidate-identity.ts` | `ui/current-context/root-scoped-candidate-identity.ts` |
| `t505-global-understanding-source.ts` | `composition/global-understanding/global-understanding-source.ts` |
| `t609-repository-resolution.ts` | `application/review-context/repository-resolution.ts` |
| `t609-review-contexts-cancellation-boundary.ts` | `application/review-contexts/repository-selection-cancellation.ts` |
| `t609-review-contexts-repository.ts` | `application/review-contexts/repository-selection.ts` |

## PR CI version resolution

The resolver is `tools/resolve-ci-vsix-version.mjs` and the consumer is `.github/workflows/ci.yml`.

1. Check out `github.event.pull_request.head.sha`, not GitHub's synthetic PR merge commit. Fetch full history and tags. The CI push path still checks out `github.sha`.
2. Supply the event's PR HEAD SHA and main/base SHA as full lowercase 40-digit commit identities. Reject missing commits, malformed identities and a checkout that differs from the supplied HEAD.
3. Resolve exactly one `git merge-base --all` result between those identities. Here, "branch point" means the common ancestor represented by that CI event; incorporating or rebasing onto another main revision can change that ancestor. Later main commits that have not been incorporated do not replace the branch-point version.
4. Walk the branch point's first-parent ancestry. Use the nearest commit carrying a valid version tag, optionally prefixed with `v`. Ignore unversioned tags and tags on unrelated/merged side-branch ancestry. Reject different version tags attached to the same selected commit rather than choosing one arbitrarily.
5. When no such tag exists, read `package.json.version` from the branch-point commit, never from the PR checkout or the current main tip. Reject an invalid version.
6. Append `+` and the first seven PR HEAD digits. Preserve any prerelease suffix. When the base already contains build metadata, append `.` and the seven digits to that existing metadata. Do not convert the hash to a number or lose leading zeroes.

For this PR's initial main commit `dbaee5dc84b2a98f9da895616dddfda810dbb143`, the published base tag is `0.1.52-pre`. An illustrative HEAD beginning `abcdef0` therefore yields `0.1.52-pre+abcdef0`. `GITHUB_RUN_NUMBER`, commit counts, a synthetic merge SHA, unrelated tags and the PR manifest version are not version inputs.

## Packaging and artifact identity

After the existing CI gates succeed, pass the resolved version to `vsce package` through `npm run package` with `--no-git-tag-version` and `--no-update-package-json`. Package prerelease versions with `--pre-release`. This changes the packaged manifests, not the tracked repository manifests, tags or commits.

The artifact is `review-range-user-validation-<version>` and contains:

- `review-range-tracker-<version>.vsix`;
- `review-range-tracker-<version>-source.zip`, produced by `git archive HEAD`;
- `version.json`, containing the full HEAD/base/branch-point SHAs and the chosen base version/source.

Open the generated VSIX as a ZIP and require `extension/package.json.version` and the identity version in `extension.vsixmanifest` to equal the resolved version. Require the `package.json.main` entry file to exist in the VSIX. Require tracked `package.json` and `package-lock.json` to remain unchanged. Seven digits are a human-facing label; use the full SHA in the run metadata and `version.json` for validation identity.

The main/release workflow `.github/workflows/release-vsix.yml` keeps its existing version and release behavior. The new policy applies to PR user-validation artifacts.

## Verification and diagnostics

Add regression tests before changing implementation. `test/tooling/source-layout.test.mjs` rejects task-number filenames anywhere in `src`, requires every owning path above and checks the production package entry. `test/tooling/ci-vsix-version.test.mjs` exercises the resolver using temporary Git repositories. `test/tooling/ci-packaging-contract.test.mjs` checks the workflow wiring and requires the tooling suite in `test:unit`.

Run the existing build, contract typecheck, architecture/negative-architecture, lint, unit, focused integration, temporary Git, mock GitHub and VS Code Extension Host gates. Retain existing assertions while updating paths. A temporary transpile-only runtime run is not evidence of TypeScript typecheck success.

Keep `tools/run-ci-command.mjs` around version resolution, packaging and source archiving. Preserve command results, stdout, stderr, combined logs and existing failure context in the failure artifact. For CI acceptance, read PR current HEAD again and consider only workflow runs whose `head_sha` matches it. A new HEAD invalidates the previous HEAD's CI as completion evidence; absence of an exact-head run is unverified, not success.

# Source layout and CI VSIX version

## Scope

This change implements the two user-requested maintenance items in one PR:

1. Move task-number-prefixed production files out of `src/` into responsibility-based folders, use descriptive names, and update their imports, extension entry point, configuration and regression fixtures together.
2. Package PR validation VSIX files with the version of the main revision from which the PR branches, followed by `+` and the first seven hexadecimal characters of the PR HEAD SHA.

The starting main revision is `dbaee5dc84b2a98f9da895616dddfda810dbb143`, whose published version is `0.1.52-pre`. For example, a PR HEAD beginning with `abcdef1` produces `0.1.52-pre+abcdef1`.

## Boundaries

- Do not change review-state behavior, persisted schemas, command identifiers or user settings.
- Preserve historical task IDs, test scenario names and historical reports. Production module paths must describe responsibilities, not task numbers.
- Preserve release/main version numbering. This change concerns PR validation artifacts.
- Do not merge the PR.

## Source layout

Use existing application and UI folders for logic belonging to those layers. Use `src/composition/` for production wiring that combines adapters, application services and UI. Keep dependency directions explicit in the architecture validation. Update the VSIX entry point to the relocated production activation module.

## CI package identity

- Resolve the main-side common ancestor of the event's base SHA and PR HEAD, rather than reading the moving main tip or the PR's modified package manifest.
- Prefer the published version tag on that main revision. Do not substitute an unrelated/newer tag. Record the selected base revision and version in the artifact metadata.
- Use the PR HEAD SHA, not GitHub's synthetic merge SHA, for the seven-character suffix and source archive identity. Package the same source revision identified by that suffix.
- Set the actual VSIX manifest version as well as its filename; keep tracked `package.json` and `package-lock.json` unchanged by packaging.
- Retain stdout, stderr, combined logs, command result metadata and failure context through the existing CI diagnostic runner and artifact upload.

## Acceptance and validation

Add regression tests before implementation and record their expected failures. Cover task-prefixed production paths, relocated imports and activation, branch-side version edits, main advancing after the branch point, non-HEAD merge SHAs, seven-character hashes (including numeric/leading-zero hashes), missing/invalid version evidence and packaging metadata. Run focused tests, compile/type contracts, architecture checks, lint, relevant integration suites and packaging checks where the environment permits. CI evidence must belong to the PR's current HEAD.

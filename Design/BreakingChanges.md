# Breaking Changes

## 2026-08-03 — T304 review-diff descriptor unions

`ReviewDiffRevisionSource` now includes `"empty"`. `ReviewDiffDocumentDescriptor` and
`ReviewDiffEditorSideInput` are discriminated unions so a comparison side that has no
file at its revision can be represented without requesting a Git blob.

This is source-breaking for consumers that exhaustively switch over the old source
kind, implement the former interfaces, or extend them through declaration merging.
Consumers must switch on `revisionSource` and handle `"empty"`; they must also handle
an editor side whose `kind` is `"absent"`. External content sources continue to accept
only `GitCommitReviewDiffDocumentDescriptor`, so consumers must not pass an `"empty"`
descriptor to those sources.

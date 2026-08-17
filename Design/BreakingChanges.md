# Breaking Changes

## 2026-08-16 — Corrupt review history resets after quarantine

The owner explicitly selected a recovery policy that supersedes the existing JSONL
corruption sentence in `doc/design/vscode-review-range-tracker-design.md` rev4 §15.4.
When an active monthly review-history JSONL file is corrupt or internally inconsistent,
the implementation must copy the entire original file to deterministic quarantine
storage and retain that quarantined evidence. It must then remove the corrupt file from
the active history path. Valid records inside that corrupt file are not salvaged,
replayed, or merged into the replacement history.

If corruption is discovered while appending, the valid event being appended becomes
event/line 1 of a newly created active monthly history file. If corruption is discovered
during startup migration, the active history remains absent until the next valid event,
which starts the new history from event/line 1. The quarantined original is not deleted
by this recovery operation.

This changes the prior rev4 §15.4 behavior that rejected all later appends while the
corrupt file remained active. Unsupported future schema versions remain a compatibility
error rather than corruption: they are rejected without quarantine/reset. Current review
state remains authoritative and is not reconstructed from quarantined history.

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

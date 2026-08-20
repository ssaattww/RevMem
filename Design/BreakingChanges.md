# Breaking Changes

## 2026-08-20 — Non-Git workspace persistence is root-scoped

Non-Git workspace state, history, snapshots, locks, and cleanup now use
`ExtensionContext.storageUri/workspaces/<workspace-id-hash>` instead of the single
legacy `storageUri` root. The workspace ID is derived from the canonical workspace
URI, including its scheme and authority. This is intentionally a persistence-layout
breaking change: a legacy single-root state is not automatically reinterpreted for a
multi-root or remote workspace, because doing so could bind state to the wrong root.

Existing users must treat the old non-Git workspace state as unavailable after this
upgrade and create fresh reviewed evidence. Git and external-file storage remain in
their existing `globalStorageUri` routes. The change preserves T604 root-local lock
and cleanup boundaries by making every active workspace root an independent storage
root.

## 2026-08-20 — PR Progress unsupported-file selection opens an immutable present side

`PullRequestProgressTreeHost.openFile` is now required. Selecting a
`line-review-unsupported` PR Progress node now calls that host with the immutable
snapshot target and returns the `opened-file` selection result; it no longer returns
`line-review-unavailable` without opening a file. The selected file is the snapshot
present side: deleted files use BASE/original, while added, modified, and renamed files
use HEAD/modified. An absent side must never be substituted with a working-tree path or
the opposite side.

This is source-breaking for host implementers that only supplied `openDiff`, and for
exhaustive consumers of `PullRequestProgressTreeSelectionResult`. Host implementers
must accept and open the immutable target at its exact revision; consumers must handle
`opened-file`. The compatibility policy is intentionally breaking rather than retaining
an optional host or a silent fallback, because either compatibility path could discard
the snapshot's owner/revision identity. There is no persisted-schema compatibility
impact.

## 2026-08-18 — Global understanding uses opened evidence with an immutable PR exception

This policy supersedes `doc/design/vscode-review-range-tracker-design.md` rev4 §11.3
and §12 wherever those sections require repository-wide content classification or use
all target non-empty lines as the Global denominator.

通常コンテキストでは、一度でも開いたことがあるfileだけを、そのownerの現在revisionに
対する行数ベースのGlobal理解率へ含める。開いたfileは同じExtension Hostかつ同じrevisionの
間はeditorを閉じた後もretained evidenceとして扱う。未オープンfileはpath列挙による件数診断
には含めるが、Global理解率を求めるためだけに本文を読み込まず、binary/invalid UTF-8などの
content classificationも先行して行わない。content-based exclusionは本文を実際に取得した時点
で適用する。

active pull-request contextはこの通常規則の例外とする。validatedされたimmutableなPR snapshotを
PR file universeのauthoritative sourceとし、reviewableなmodified/added/renamed/copied fileは
exact HEAD側全文を取得する。deleted fileはBASE側全文を取得してPR全走査を完了する。
作業ツリーの存在有無をPR HEAD fileの採否条件にしない。dirty working treeでfileが削除・rename
されていても、immutable snapshotに存在するHEAD fileはexact revision sourceから取得する。
pathベースの共通除外policyはimmutable PR pathへ直接適用する。

PRの全文走査結果のうちGlobal分母にはHEAD側に現在存在するfileだけを「開いたことがある」
evidenceとして反映する。deleted fileのBASE側全文はPR全走査cacheには保持するが、HEADには
存在しないためGlobal分母へは加えない。PRのopened/unopened件数を算出するときはmutableな
working-tree path候補と、受理したimmutable PR HEAD pathの和集合を現在利用可能なfile universe
とする。

PR全文cacheはexact BASE/HEAD revisionとpathへ束縛し、Globalの解析済みline evidenceもexact
owner revisionへ束縛する。同一revisionでは再読込・再解析を避ける一方、stable ownerのrevisionが
更新された時点で旧revisionのopened evidenceとPR解析evidenceをevictする。後から古いrevisionへ
戻っても、再度本文を観測しない限り過去のevidenceを復活させない。

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

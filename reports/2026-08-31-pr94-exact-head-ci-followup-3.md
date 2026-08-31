# PR #94 exact-head CI follow-up 3

## Trigger

CI run 33402658804 / T405 の1失敗。

## Diagnosis

`npm run test:t405` は 55/57 pass、2 fail だった。CI報告の T406 は、recovered revision への `reviewRange.redetectPullRequest` で generic error 通知を出す。原因は `captureImmutableRevisionSnapshots` の `Current Global revision must match the snapshot revision.` である。transition 直前の durable state は Context `pullRequest.headSha` と Global `currentRevisionId` の両方が target HEAD で一致していたが、mapper 内 source capture では Global が target HEAD のまま snapshot revision が recovered HEAD になった。

従って、PR94 の強化済み snapshot/evidence 契約に対する fixture 不足ではなく、T405 lifecycle transition 中に Context-only revision advance が起きる production invariant regression である。Output は依存情報を伏せる既存 generic 表示、diagnostic cause は上記 invariant error だった。private PR reconnect の認証・再接続 UX は調査中に変更していない。

同じ exact run では Windows 上の `t405-selected-pr-session` も fail した。`fileSystemPathSemantics: "posix"` に対して `path.resolve("/repo/src/example.ts")` を渡す fixture が Windows canonical path へ変換され、selected PR ownership を fail closed で拒否する。これは T406 production seam とは別の fixture portability issue である。

## Change

変更なし。一時的な diagnostic instrumentation と transition 直前 assertion は原因確定後に撤去した。

安全な修正には、Context/Global pair を同一 CAS 内で advance する caller を特定して修正し、recovered transition の atomic pair invariant を直接回帰テスト化する必要がある。mapper 側で Global revision を推測・上書きする回避策は snapshot fail-closed 契約を弱めるため採用しない。

## Validation

Red: `npm run test:t405` 1回（55 pass / 2 fail）。T406 focused reproduction を複数回行い、Output相当診断と cause を確認した。temporary instrumentation 後の `npm run compile:test` は pass。

Green、PR94 regression、build、lint、diff-check は未実行。production fix が未確定のため再実行していない。Markdown focused lint は `tools/lint/` と `lint:md` が存在しないため unsupported。

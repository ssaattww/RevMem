# T605 normal finding closure report

## タスク

T605 / Issue #74 / draft PR #75 の通常レビューで確定した T605-R001〜R006 に対する finding-limited closure review。reviewer は同一 reviewer（sol / high）。original reviewed HEAD は `c8a24250fee63931e09886a2ff229a2c2c3b9586`、reviewed fix HEAD は `d0231f553e3ce5627f30eda224194721045530ed`、base は `origin/main` の `64e47c590960a810a2439bd33f250ecbda9c41bf`。照合 range は original reviewed HEAD...reviewed fix HEAD。通常レビュー報告 `reports/issue-74-t605-normal-review-20260820213218.md` と実装 follow-up 報告 `reports/issue-74-t605-normal-review-followup-20260820214104.md` を基準にした。

## sub-agentを使う理由

sub-agent は使用していない。指定された同一 reviewer が、凍結済みの 6 findings だけを一度の pass で照合した。

## 対象範囲

T605-R001〜R006 それぞれの required action と、fix delta および提供済み validation evidence の対応だけを対象とした。処分は次のとおり。

| Finding | Severity | Disposition |
| --- | --- | --- |
| T605-R001 | High | open |
| T605-R002 | High | closed |
| T605-R003 | High | closed |
| T605-R004 | Medium | closed |
| T605-R005 | Medium | closed |
| T605-R006 | Medium | open |

## 対象外

新規観点、新規 finding、severity の変更、sibling exploration、全 changed files の再レビュー、通常レビュー範囲の再展開は対象外。test/build/lint/CI の再実行、CI の起動または待機、GitHub・code・tracking・PR・Issue・branch の変更も行っていない。

## 実行コマンド

`git rev-parse HEAD`、`git status --short`、`git diff --name-only c8a24250fee63931e09886a2ff229a2c2c3b9586...d0231f553e3ce5627f30eda224194721045530ed`、および finding 関連箇所の read-only なファイル表示・検索だけを実行した。実装者提供 evidence として、`test:t605` の Red 1 回と Green 1 回（Green は 28 passing）、続く build、compile:test、typecheck:contracts、lint、architecture positive/negative、`git diff --check` の各 1 回成功を評価した。これらは再実行していない。Markdown wording check はリポジトリに `tools/lint/`、`lint:md`、`cspell.config.jsonc` がないため unsupported であり、実行していない。CI は起動も待機もしていない。

## 対象ファイル

通常レビュー報告、実装 follow-up 報告、handoff、original...fix delta のうち R001〜R006 に直接対応する `workspace-root-runtime-registry.ts`、`reconciled-document-review-state-session-provider.ts`、`extension.ts`、`t405-review-contexts-runtime.ts`、`persistence-startup-migration.ts`、`state-repository.test.ts`、`t605-multi-root-remote-boundaries.test.ts`、`package.json` と、必要な直接 consumer/composition だけを確認した。

## 指摘事項

1. **T605-R001 — High — open。** Registry に `commitWithSnapshot` は追加されたが、reconciled provider は provider を未定義の構造型へ `as unknown as` で変換し、`const commitWithSnapshot = snapshotWorkspaceProvider.commitWithSnapshot` として class method を receiver から切り離している。その後の呼び出しでは `WorkspaceRootRuntimeRegistry.commitWithSnapshot` 内の `this.runtimeFor(...)` に有効な `this` が渡らないため、production workspace commit は実行時に失敗する。また required action の typed capability port にもなっていない。T605 test は `typeof capability.commitWithSnapshot === "function"` だけを確認し、reconciled production chain から commit を呼び出していない。Required action は、typed port を通じて receiver を保持した snapshot-aware commit を production composition に接続し、mark/unmark、snapshot latest、decoration/reopen の Red/Green regression で実呼び出しを証明すること。
2. **T605-R002 — High — closed。** Registry constructor/getter が dedicated `historyRewriteSnapshotTracker` を保持し、`extension.ts` が root-scoped route 上の `gitHistoryRewriteSnapshotTracker` を生成して registry に渡している。既存 persisted provider consumer がこの capability を受け取り、T602 recovery composition が wrapper 越しに失われない構成へ戻った。追加された capability-shape assertion と提供済み Green evidence も required action に整合する。より広い production recovery regression の不足は既存 R006 の処分に含める。
3. **T605-R003 — High — closed。** T405 source は repository ID ごとの root を `Set` で保持し、root が一意でない場合は既知 root を返さず、active repository の repository ID 一致を要求して fail closed する。PR、branch、detached の candidate identity に repository root も含まれ、same-repository multi-root の action identity collapse は解消された。追加の end-to-end coverage 不足は既存 R006 の処分に含める。
4. **T605-R004 — Medium — closed。** Startup migration は `storageUri/workspaces/<64-hex>` を列挙し、各 child root を独立した root transaction で migrate する。workspace-state の repository ID hash と child directory 名を照合し、不一致を quarantine するため、trusted child enumeration、identity verification、root-scoped lock/migration という required action を満たす。追加の startup/restart coverage 不足は既存 R006 の処分に含める。
5. **T605-R005 — Medium — closed。** `state-repository.test.ts` は workspace route が `storageUri` そのものではなく `workspaces/<hash>` 配下である契約へ更新された。T605 route test の異なる workspace identity に対する root 非一致 assertion と合わせて separation も確認され、提供済み `test:t605` Green 28 passing で stale expectation の解消 evidence がある。fix HEAD exact-head PR CI は merge gate として held。
6. **T605-R006 — Medium — open。** Focused T605 suite は依然 3 tests だけで、longest-root/authority helper、URI/storage route、registry capability の shape を確認するに留まる。Registry test は dummy runtime と `as never` tracker を使い、getter equality と method の型だけを検査して実 commit を呼ばない。Production activation/composition、registry add/remove/dispose、concrete workspace commit/persistence/reopen、snapshot/history、startup migration/restart、same-repository multi-root Git/PR、lock/cleanup を通る required focused regression はない。`test:t605` の 28 passing は既存 state-repository、CI workflow、design structure suites を併合した件数であり、この required action の代替にはならない。Required action は、R006 で列挙済みの production/concrete wrapper chain と lifecycle/persistence/Git-PR/startup-restart scenarios を focused suite に追加し、Red/Green evidence を提示すること。

## 結果

**Verdict: fail。** R002、R003、R004、R005 は closed。R001 と R006 は open のため normal technical merge gate を通過しない。次の action は R001 と R006 の required action だけを実装し、同一 reviewer に finding-limited closure evidence を戻すこと。新規観点を追加する通常レビューの再実施はしない。

## リスク

Held は 2 件だけ。

- Markdown wording check: repository support がないため unsupported。
- Fix HEAD `d0231f553e3ce5627f30eda224194721045530ed` の exact-head PR CI: merge gate で held。起動・待機・再実行はしていない。

Unexplored: none。凍結された R001〜R006 の closure criteria はすべて closed/open に処分済み。

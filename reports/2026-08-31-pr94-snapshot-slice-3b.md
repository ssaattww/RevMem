# Sub-agent実行レポート

## タスク

- 目的: `PR94-CI-003C2`としてlocal Git revision transitionとmutationへsnapshot restore/write-throughを統合する。
- タスク種別: TDD implementation / snapshot slice 3b

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/highで、local Gitの残るsnapshot境界を0.5h以内に閉じるため。

## 対象範囲

- 対象: Git context revision mapper、document review-state session provider、direct lifecycle/binary/snapshot tests。

## 対象外

- 対象外: PR mapper/T405、design/workflow/package/tracking、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- 実装・Red/Green・lintは未実行。ユーザー指定のstop条件が、test追加またはsource編集前のread-only caller追跡で成立した。
- report変更前のrepository test/buildは実行していない。作業treeの既存変更を保存したまま、scope外のmutation routeを特定して停止した。

## 対象ファイル

- 変更: 本reportのみ。
- 読み取り確認: `src/application/review-context/git-context-revision-mapper.ts`、`src/adapters/document-review-state/git-context-document-review-state-session-provider.ts`、`src/adapters/document-review-state/reconciled-document-review-state-session-provider.ts`、`src/adapters/document-review-state/document-review-state-session-provider.ts`、direct lifecycle/binary tests、snapshot design §2/§4/§5/§9/§10。

## 指摘事項

- stop条件成立: `GitContextDocumentReviewStateSessionProvider.open()` はrevision map/initialization後、`createDelegate(inspection).open(descriptor)`をそのまま返す（git-context provider lines 167–188）。通常のlocal Git mark/unmarkのcommitterは指定scope外の `src/adapters/document-review-state/reconciled-document-review-state-session-provider.ts` lines 198–241 で最終的に `this.options.repository` としてsessionへ渡される。
- さらにbase sessionは `src/adapters/document-review-state/document-review-state-session-provider.ts` line 781 で同repositoryをcommitterとして公開する。reconciliation promotionのcomplete transactionもscope外reconciled provider lines 349–370からこのcommitterを呼ぶ。
- このため、通常mutationのsnapshot write-throughを確実にsingle CAS化するには少なくともreconciled provider（必要ならbase providerも）を含む明示的なwrite境界承認が必要である。指定2ファイルだけを編集してdelegate後のsessionを暗黙に差し替える案は、reconciliation/workspace routingの既存commit semanticsを再検証せずに変更することになり、本sliceのstop ruleに反する。
- `GitContextRevisionMapper.map()`自体は現状、target snapshot evidenceを検証・restoreせず常にdiff mappingする。これを先に実装してもnormal mutation write-throughが未接続のままなので、要求されたA→B→C→A atomic contractを安全に閉じられない。

## 結果

- ブロックして停止。repository source/test/design/workflow/package/trackingには変更を加えず、本reportだけを更新した。

## リスク

- 次sliceで明示承認を得る最小追加scopeは `src/adapters/document-review-state/reconciled-document-review-state-session-provider.ts`。ただしbase providerのline 781 direct committer、workspace snapshot committer、reconciliation promotionとの単一CAS互換を先にtest化する必要がある。
- 承認後の順序: (1) mapperにauthoritative target evidenceを用いたsnapshot restore-or-map/target capture、(2) Git providerとreconciled session committerのsingle-CAS snapshot wrapper、(3) lifecycle/binary/snapshot testsでhit/miss/no-op/stale/commit failure/history matrixをGreen化する。

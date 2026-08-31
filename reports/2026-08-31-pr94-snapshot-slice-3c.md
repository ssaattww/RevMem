# Sub-agent実行レポート

## タスク

- 目的: `PR94-CI-003C3`としてlocal Git transitionと両mutation publication boundaryへsnapshotを統合する。
- タスク種別: TDD implementation / snapshot slice 3c

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/highで、実committer境界を明示したlocal Git snapshot対応を0.5h以内に進めるため。

## 対象範囲

- 対象: Git revision mapper/session provider、reconciled/base document session providerの既存single-CAS committer、direct tests。

## 対象外

- 対象外: PR mapper/T405、design/workflow/package/tracking、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- Red 1: `npm run compile:test; node --test test-dist/test/unit/git-context-revision-mapper-binary.test.js`。compile成功、binary mapper testは8/9 pass / 1 fail。target `revisionSnapshots[newRevision]`があっても既存mapperがdiff mappingの`[0,1), [2,3)`を返し、保存済み`[0,3)`を復元しないことを確認した。
- Red 2: lifecycle testへcurrent revision snapshot assertionを追加。wrapper前はsuccessful local mark後の`revisionSnapshots[oldRevision]`が`undefined`となることを確認した。
- Green: `npm run compile:test; node --test test-dist/test/unit/git-context-revision-mapper-binary.test.js test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/immutable-revision-review-snapshot.test.js` を最終実行し、compile成功、focused 28/28 pass（binary mapper 9、Git lifecycle 14、immutable snapshot 5）。
- `npm run lint` 成功（warnings 0）。`git diff --check` 成功（whitespace error 0、既存worktreeのCRLF conversion warningのみ）。

## 対象ファイル

- 変更: `src/application/review-context/git-context-revision-mapper.ts`、`src/adapters/document-review-state/git-context-document-review-state-session-provider.ts`、`test/unit/git-context-revision-mapper-binary.test.ts`、`test/unit/document-git-context-lifecycle.test.ts`、本report。
- 確認のみ: `src/adapters/document-review-state/reconciled-document-review-state-session-provider.ts`、`src/adapters/document-review-state/document-review-state-session-provider.ts`。両者はGit outer providerが返すreconciled sessionの内側routeであり、非Git base routeにはimmutable revision evidenceが無いため変更しなかった。

## 指摘事項

- mapperはsource Context/Global revisionが一致する場合にlegacy/current source snapshotをcaptureする。遷移先に既存snapshotがある場合だけ、`GitRevisionMappingSource.readTextFileAtRevision`からtarget revisionのpath/content hash/line countを取得して照合する。Context/Global full hitはsaved file stateを復元してdiff mappingをbypassし、miss・読取不能・evidence mismatchは既存conservative mapperへfallbackする。corrupt persisted snapshotはcore validationが拒否してfail closedとなる。
- mapperのrestore/map結果はどちらも`captureImmutableRevisionSnapshots`でtarget revision entryを更新してから、Git providerの既存complete CAS transactionへ一回だけ渡る。snapshot専用writeは追加していない。
- Git outer providerはdelegate/reconciled sessionを返す前に、Git owner/current context/revisionを検証したsnapshot-aware committerで包む。このcommitterはcurrent HEAD snapshotをtransaction `next`へcaptureし、下位session committerを一回だけ呼ぶ。連続commandには前回published snapshotをCAS expectedとして保持し、snapshot fieldだけの差異で偽staleにならないようにする。外部CAS conflictは従来どおり下位repositoryがrejectし、historyはcommand側のcommit後順序のままである。
- no-op/cancelはcommitter前、stale identity/revisionはcapture前、commit failureはhistory前で止まる。base workspace/external routeはcurrent immutable Git revision/evidenceを持たないため明示的にsnapshot wrapperを適用していない。

## 結果

- local Git target exact hit/missと正常mutation write-throughをGreen化した。binary/missing/fatal mapping boundary、same-revision encoding refresh、concurrent owner-wide Global CASもfocused suiteで回帰なし。

## リスク

- local Git mixed Context-hit/Global-missはfull exact restoreを採用せずconservative mapへfallbackする。PR mapperでは既にper-layer mixed restoreが実装済みであり、local Gitで同じper-layer restoreを必要とするかはdesign上の明示確認が必要。
- `ReconciledDocumentReviewStateSessionProvider` を直接compositionする非標準callerはouter Git wrapperを通らない。production compositionがGitContext outer providerを必ず使用することを次のcomposition/integration確認で固定する。
- base non-Git routeはimmutable revision identity/evidenceがないため未変更。このrouteへsnapshotを導入する場合は別design/contractが必要。

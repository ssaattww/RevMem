# PR #94 exact-head CI follow-up 3 atomic fix

## Scope

T406 recovered PR transition のContext/Global atomicity。

## Red

既存actual T405/T406 composition の recovered transition を `npm run test:t405` で再現した。57件中55 pass / 2 failで、T406 は `reviewRange.redetectPullRequest` が generic error 通知を出した。Output相当の原因は `captureImmutableRevisionSnapshots` の `Current Global revision must match the snapshot revision.` だった。

transition直前には PR #52 の durable Context `pullRequest.headSha` と共有Global `currentRevisionId` はともに target HEAD で一致する。failure は `synchronizeRepository` が persisted PR context を逐次処理するため発生する。PR #52 の update が共有Globalをrecovered HEADへadvanceした後、PR #53のContextはtarget HEADのまま同じ共有Global(recovered HEAD)と組にされ、immutable mapper source capture が拒否する。これはfixture evidence不足ではない。

## Change

変更なし。直接callerは `src/t405-review-contexts-runtime.ts` の `synchronizeRepository` だが、修正には複数PR Contextと共有Globalを一つのCAS transactionとしてcommitするrepository/session APIが必要となる。現在の `GitHubPullRequestContextStateService.update` とrepository portはcontext単位のexpected/next pairだけを扱い、逐次updateを一つのatomic operationに合成できない。

mapperが不整合Globalを推測してadvanceする回避や、後続PR updateのskipはfail-closed snapshot契約およびPR lifecycle同期を弱めるため採用しない。新しいmulti-context CAS protocolと複数owner変更はこのsliceの許可範囲外である。

## Green

未実行。production fixなしのためGreen、PR94 regression、build、lintは実行しなかった。`git diff --check` はpass。Markdown focused lintは `tools/lint/` と `lint:md` がないためunsupported。

次sliceの最小案: shared Globalを持つ同一repositoryのPR lifecycle同期を集合としてロードし、全Context expected stateと一つのGlobal next stateを検証・CASする既存または新規のatomic repository boundaryを設計する。まずPR #52/#53 recovered transitionでContext/Global全組のrevision一致、partial state/historyなしをRedとして固定し、そのboundary承認後に実装する。

## Design comparison

| 案 | Atomicity / stale / cancellation / history | API・design影響 | 必要testと概算 |
| --- | --- | --- | --- |
| A: multi-context/shared-Global CAS | manifestは全context referenceとGlobal pointerをatomicにpublishできるため、同じtarget revisionへ移るPR群ではstateをall-or-nothingにできる。CAS conflictは全expected contextとGlobalを再読込して再判定し、stale/cancelはpublish/historyなし、historyは全state publish後に記録する。 | 現在の`ReviewStateTransactionLike`は1 context pairのみなので、contracts、filesystem repository、validated/debounced adapter、T405同期service、history batchが必要。異なるPR HEADを同じowner-wide Global pointerとpairにできないため、grouping規則またはGlobal ownershipの設計決定も必要。snapshot design §4.3/§9/§10の更新が必要。 | slice 1 (<=0.5h): multi-context Red contractとrepository transaction設計。slice 2: manifest-level CASとstale tests。slice 3: T405 group synchronization/history integration。 |
| B: 各PR map直前にreload/rebaseして既存per-context CAS | reload後、先行PRがGlobalをadvance済みなら後続ContextとGlobalは依然revision不一致である。Contextだけをrebase/advanceすればsource snapshot検証を破り、CASは後続partial publish/historyを防げない。 | API変更は小さく見えるが、fail-closed契約を破らない実装は存在しない。 | 不採用。RedをGreenにするには不整合を隠すtest weakeningまたはunsafe mappingが必要。 |
| C: sequential order変更、skip、retry | 処理順を替えても最後に更新するPR以外がshared Globalと不一致になる。skipは古いPR lifecycle/stateを残し、retryは同じ不変条件errorを繰り返す。historyは一部成功後に残る。 | API変更なしだが同期契約とprivate PR reconnect UXを劣化させる。 | 不採用。順序依存とpartial historyをdirect testで許すことになる。 |
| D: active/selected PRだけ同期 | このfixtureの2 context更新は避けられるが、inactive PRはshared Globalと不一致のまま残り、後のselectionで同じsource-capture拒否へ移る。 | T405 routingだけに見えるが、inactive PRの再activation semanticsを新設する必要がある。 | 不採用。遅延したfailureでありatomic fixではない。 |
| E: PRごとのGlobalへ変更 | 各PR pairは整合するが、owner-wide Global stateとmanifestのsingle Global referenceを破棄する大規模data-model変更である。 | contracts、persistence migration、all session providers、snapshot/history designへ波及する。 | 非最小。複数sliceを超えるため本件では不採用。 |

## Recommendation

案Aを条件付きで推奨する。ただし最初に「同一repositoryに異なるPR HEADが共存するとき、owner-wide Global current pointerをどのrevisionに置くか」をdesign decisionとして確定する必要がある。PR #52/#53のように同じtarget HEADへ同期する集合に限ればmanifest-level multi-context CASで直接解決できるが、任意の異なるHEADを同一Global current stateへ同時にpairすることは現行モデルとsnapshot design §4.3/§9に矛盾する。

承認後の最初の0.5h sliceはproductionを変更せず、`t405-composition-regression`へ同HEADのmulti-PR recovered Redを独立追加し、repository contracts/manifest transactionの最小interface案とstale・cancel・history-no-publication matrixを固定する。次sliceでのみmanifest-level CASを実装する。

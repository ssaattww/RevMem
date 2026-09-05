# Issue #106: repository-owner atomic PR synchronization

- 文書種別: 詳細設計
- 対象: 複数PR Contextとrepository owner-wide Globalの同期
- 関連: Issue #106 / PR #108 / PR #94 / T405

## 1. 問題

repository storage ownerには複数のbranch/PR Contextが存在できる一方、`RepositoryGlobalState`のcurrent pointerはowner-wideで1つだけである。複数PRを逐次`Context + Global` CASすると、先行PRだけがGlobalを進めた中間generationが公開され、後続PRが古いContextと新しいGlobalを組み合わせてrevision mappingを開始できてしまう。

Issue #106では、PR lifecycle同期のpublication boundaryをContext単位からrepository owner単位へ引き上げる。

## 2. Owner snapshot

owner transactionのexpected/next snapshotは次を1つのgenerationとして扱う。

- manifestが参照する全branch/PR Context
- repository owner-wideで1つのGlobal state
- schemaVersionとrepositoryId

manifestを唯一のpublication pointとする。Context/Globalのimmutable documentを先に書いても、manifestが切り替わるまでは新generationとして可視化しない。

CASはContextの一部ではなく、上記owner snapshot全体のexact expected valueを比較する。Context追加・削除を含む別generation、metadata競合、Global競合はstaleとして拒否する。

## 3. Global revision semantics

`RepositoryGlobalState.currentRevisionId`は、同期を実行しているrepository ownerの現在revisionを表す。全PR ContextのHEADがこの値と一致することは要求しない。

したがって、同一repository内で次の状態は正当である。

```text
owner Global.currentRevisionId = C
PR #52 HEAD = C
PR #53 HEAD = D
PR #54 HEAD = B
```

各PR Contextの`pullRequest.headSha`と各Context fileの`revisionId`は、そのPR自身のmodified-side revisionを表す。Global current pointerからPR HEADを推測してはならない。逆に、任意のPR HEADからowner Globalを推測してadvanceしてはならない。

Globalの過去revision状態は既存の`revisionSnapshots`で保持し、異なるHEADのPRのためにper-PR Globalへ分割するmigrationは行わない。

## 4. Synchronization planning

T405の明示的なPR同期は、最初にowner snapshotを1回だけcaptureする。その後、保存済み全PR ContextについてGitHub lifecycle metadataを取得する。

1件でもlifecycle取得が`unavailable`ならplanningを中止する。この時点ではContext、Global、manifest、historyを一切変更しない。取得成功したPRだけを先にcommitしてはならない。

全lifecycle取得後、各PRを同じcaptured owner snapshotに対してprepareする。

### 4.1 owner revisionへ進むPR

次の両方を満たすrevision transitionだけをowner revision mappingの対象にする。

- remote target HEADが同期対象ownerの`headRevision`と一致する
- source PR Context HEADがcaptured Global `currentRevisionId`と一致する

同じowner revisionへ進むPRが複数ある場合、各Contextを同じexpected Globalから副作用なしでprepareする。各mapperが生成するnext Globalは`updatedAt`以外の意味内容が一致しなければならない。不一致ならcommit前にfail closedする。

### 4.2 異なるHEADのPR

remote target HEADがowner revisionと異なるPRは、owner GlobalをそのPRのHEADへ切り替えない。そのPRのrevision transitionは次回そのHEADがowner synchronization revisionになった時までdeferする。

ただしPR自体を同期対象から除外するわけではない。`state`、`title`等のrevision非依存lifecycle metadataは、BASE/HEADとContext file revisionを維持したまま同一owner transactionへ含める。

これはIssue #106で禁止している「active PRだけ同期」「PRをskipして部分commit」「不整合Globalを推測してadvance」のfallbackではない。全保存済みPRを1 owner generationとして扱い、revision mappingのownershipだけをowner current revisionに限定する規則である。

## 5. Atomic publication

planning完了後、次を1回の`commitRepository`で公開する。

- metadata-only更新を含む全next Context
- owner revisionへmappingした結果の単一next Global

永続化は同じowner lock/serialization queue上で行い、通常のsave/commit/createとowner transactionを並行publicationさせない。

publication順序は次のとおり。

1. next Context immutable documents
2. next Global immutable document
3. manifest pointer

3が成功した時だけ新generationがauthoritativeになる。

## 6. Failure / stale / cancellation

次のいずれでもpartial current stateを公開しない。

- lifecycle取得失敗
- planning中のcancellation
- mapper evidence不整合
- 複数PRが異なるnext Globalを生成
- expected owner snapshotとのCAS conflict
- immutable document書込み失敗
- manifest publication失敗

manifest publication前の失敗では旧manifestがauthoritativeなままである。manifestから参照されないimmutable documentが書き込まれていてもcurrent Context/Globalとしては不可視であり、別generationの代用には使用しない。

## 7. History ordering

revision mapping historyはprepare中には書かない。owner `commitRepository`成功後に、revision mappingされたContextをcontextId順で記録する。

stale、cancellation、planning failure、owner persistence failureではhistoryを追加しない。append-only history store自体のpost-commit failureまでstateと同一filesystem transactionに含めることは既存architectureの範囲外であり、Issue #106ではstate publication前にhistoryを書かないことを保証する。

metadata-only lifecycle更新ではrevision mapping historyを追加しない。

## 8. Compatibility

- single-context PRでも同じowner transaction contractを使用できる。
- owner-level APIを持たないtest/legacy injected repositoryではrevision transitionを行わず、全lifecycle readが成功したmetadata-only caseだけ従来commitを許容する。
- private repositoryの認証・再接続・PR選択経路は変更しない。
- immutable snapshotの不整合を許容するPR #94の暫定compatibility fallbackは削除し、owner transaction側で整合を成立させる。
- performance suiteをrequired CIへ追加しない。

## 9. Verification contract

required CIでは少なくとも次を固定する。

- PR #52 / #53相当が同じtarget HEADへ進む時、1 owner CASで両ContextとGlobalが同時に進む
- different HEAD PRは自身のHEAD/file revisionを維持しつつlifecycle metadataだけ同期できる
- lifecycle unavailableでowner transactionを開始しない
- conflicting next Globalをpublication前に拒否する
- cancellation / stale / manifest failureでcurrent generationとhistoryを部分更新しない
- Context current revisionとfile revision、Global current revisionとfile revisionの混在を拒否する
- existing T405 composition regressionを同じrequired gateで実行する
- performance testはrequired gateに含めない

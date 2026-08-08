# T404 fix verification レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T404
- Pull Request: #48
- Review mode: fix verification
- Reviewer role: normal reviewer
- Reviewer continuity: 初回通常reviewと同じChatGPT chat / 同じ通常reviewer
- Source reviewed implementation HEAD: `3dec4352c2bd8ad1ddf0303eed698b49c0cfa5d3`
- Review evidence HEAD before fixes: `787e6796229813a8ee842f10833ec8457a0ddc37`
- Reviewed fix implementation HEAD: `228fd4082a462a51f2bc44ea5590423a485161a2`
- Fix commit range: `787e6796229813a8ee842f10833ec8457a0ddc37..228fd4082a462a51f2bc44ea5590423a485161a2`
- Generated at: `2026-08-06T19:48:58+09:00`
- Merge: 未実施

## 目的

初回通常reviewで提示した`T404-R001`〜`T404-R008`について、finding identityとseverityを保持したまま、修正差分、直接依存contract、同一defect classのsibling case、test、report、tracking、exact-head CIを確認する。

新規のreview passではなくfix verificationである。初回findingに含まれる欠陥classへ修正差分を照合し、新規変更領域で確認した同一原因の問題は元findingへ統合した。finding IDまたはseverityの再分類は行っていない。

## Authoritative requirements

1. ユーザー指示
   - T404を再reviewする。
   - uploaded worker Skillsに従う。
   - mergeしない。
   - 特例としてreviewerが`tasks/tasks-status.md`を更新する。
2. `tasks/tasks-status.md` T404
   - GitHub host / owner / repository / PR番号からstable context IDを生成する。
   - base/head revision、open/closed/merged、複数PR stateを`globalStorageUri`へ保存する。
   - 同じPRのcommit追加で状態を継続し、別PRを分離する。
   - closed PRは既定で装飾無効とし、restart後も復元する。
3. 設計rev4
   - T104 Review State repositoryをauthoritative current stateとして使用する。
   - contextとowner-wide Globalをcomplete snapshotとしてatomicに更新する。
   - revision mappingはimmutable evidenceを使用し、曖昧な範囲を確認済みにしない。
   - T202/T401 canonical GitHub identityを共有する。
   - closed PR layerは既定無効だが、明示的overrideを保存できる。
4. project instructions
   - review finding修正はTDD。
   - test failure diagnosticsをartifactへ保存する。
   - current PR HEADとrun head SHAが一致するCIだけを使用する。
   - 詳細report、簡易PR comment、lossless handoffを保存する。

## 確認対象

### Fix changed files

`787e6796229813a8ee842f10833ec8457a0ddc37..228fd4082a462a51f2bc44ea5590423a485161a2`:

- `src/application/github-pr-context/github-pull-request-context-layer-store.ts`
- `src/adapters/github/node-github-pull-request-context-layer-store.ts`
- `test/unit/github-pr-context-layer-store.test.ts`
- `test/unit/core-contracts.test.ts`
- `reports/issue-1-t404-review-followup-20260806194000.md`

### Direct dependencies inspected

- `src/core/contracts/review-state.ts`
- `src/application/review-context/contracts.ts`
- `src/application/review-context/git-context-revision-mapper.ts`
- `src/adapters/state-repository/coherent-file-system-review-state-repository.ts`
- `src/adapters/state-repository/file-system-review-state-repository.ts`
- `src/adapters/state-repository/atomic-text-file-store.ts`
- `src/adapters/github/git-remote.ts`
- `src/adapters/local-git/git-remote-normalization.ts`
- `src/application/review-history/**`
- `src/extension.ts`
- `package.json`
- `.github/workflows/ci.yml`
- `doc/design/vscode-review-range-tracker-design.md`
- `tasks/tasks-status.md`

## Exact-head validation

Reviewed fix implementation HEAD `228fd4082a462a51f2bc44ea5590423a485161a2`に一致するrunだけを使用した。

- Workflow: `CI`
- Run: `31094047777`
- Status: `completed`
- Conclusion: `success`
- Head SHA: `228fd4082a462a51f2bc44ea5590423a485161a2`

別SHAのrunは代用していない。

CI workflowは失敗時に`test-output/`、generated files、source、tests、fixtures、configuration、environment、Git statusをdiagnostic artifactへ保存する。T404専用test logも保存対象であり、failure diagnostics workflow自体は有効である。

Reviewer側ではrepository connectorによるimmutable source/patch/contract inspectionを行い、ローカルtestは実行していない。

## Finding dispositions

| Finding | Source severity | Disposition | Summary |
| --- | --- | --- | --- |
| T404-R001 | blocking | closed | parallel PR range/path storeを撤去し、既存Context/Global repositoryへ統合した |
| T404-R002 | high | closed | 1 service instance内の更新はT104 same-root serializationとfull-snapshot CASを使用する |
| T404-R003 | high | open | revision mapperがContextだけを返し、Globalとimmutable mapping evidenceを契約化していない |
| T404-R004 | high | open | canonical policyを再実装し、create境界でcanonical context IDを検証せず、malformed authority aliasも残る |
| T404-R005 | high | closed | stable file ID、path metadata、modified/original rangesを既存`FileReviewState`へ統合した |
| T404-R006 | medium | open | closed layerのdefault falseと明示的overrideを保存するcontractが存在しない |
| T404-R007 | high | closed | 独自writeを撤去し、T104のunique temp / sync / close / replaceへ移行した |
| T404-R008 | medium | open | `test:t404`、必要境界test、Red evidence、follow-up handoffとactual evidence訂正が不足する |

## Detailed verification

### T404-R001 — blocking — closed

#### 確認結果

- 旧`GitHubPullRequestContextLayer`、path-keyed range document、global storage root直下JSON storeは撤去された。
- `PullRequestReviewStateCommit`は既存`ReviewContextState`と`RepositoryGlobalState`を使用する。
- Node adapterは`FileSystemReviewStateRepository`へ接続し、T104 routing、manifest-last persistence、context/Global complete snapshotを再利用する。
- `FileReviewState`が保持するstable file ID、previous paths、modified ranges、original-side ranges、content hash、line countを失わないmodelへ戻った。

#### Closure evidence

- `src/application/github-pr-context/github-pull-request-context-layer-store.ts:1-39`
- `src/adapters/github/node-github-pull-request-context-layer-store.ts:1-21`
- metadata-only testでauthoritative file stateとGlobalの保持を確認する。

#### Remaining coverage

実filesystem、multiple PR、restart、historyの統合testは不足するが、parallel source of truthというR001の根本原因は除去された。coverage不足は`T404-R008`で継続する。

### T404-R002 — high — closed

#### 確認結果

- 旧storeの非同期read-modify-writeは削除された。
- 1つの`GitHubPullRequestContextStateService`が保持するrepository instanceでは、T104のstorage-root queueとpersisted complete-snapshot CASが使用される。
- concurrent updateで古いexpected snapshotは`StaleReviewStateError`相当として拒否され、silent last-write-winsにはならない。

#### Closure evidence

- `src/adapters/state-repository/coherent-file-system-review-state-repository.ts`の`commit` / `create` / `serializeWrite`。
- `src/adapters/github/node-github-pull-request-context-layer-store.ts`は独自publicationを行わない。

#### Remaining risk

別repository instance、別window、別processを跨ぐ排他はT604の責務である。T404 factoryと既存runtime repositoryの共有compositionはT405 wiring時に注意が必要だが、source findingの旧store read-modify-writeは解消した。

### T404-R003 — high — open

#### 残存問題1: mapper contractがContextだけを扱う

`PullRequestRevisionMapper`は次だけを受け取り、`ReviewContextState`だけを返す。

- current Context
- next PR descriptor

owner-wide `RepositoryGlobalState`、repository root、filesystem semantics、mapping options、immutable diff/blob sourceをcontractへ含めていない。対して既存`GitContextRevisionMapper`はContextとGlobalを同時に入力・出力し、immutable Git diff/blob evidenceで両snapshotを新revisionへ進める。

`GitHubPullRequestContextStateService.update`はrevision変更後も次を実行する。

```ts
const next = {
  contextState: nextContext,
  globalState: cloneValue(current.globalState)
};
```

このためPR headが変わっても`globalState.currentRevisionId`およびGlobal file revisionsは旧revisionのままcommitされる。

#### 残存問題2: mapped snapshot validationが不十分

`requireMappedContext`が確認するのは次だけである。

- context ID
- repository ID
- PR base SHA
- PR head SHA

次を検証しない。

- mapped PR host / owner / repository / number / lifecycle state
- file stateの`revisionId`がnew headと一致すること
- owner-wide Globalがnew revisionへmappingされたこと
- changed/rename/ambiguous evidenceに応じてreviewed rangesが保守的に更新されたこと
- complete snapshotであること

mapperがtop-level base/headだけを書き換え、file rangesとGlobalを旧revisionのまま返しても永続化される。

#### Test gap

現行testはfake mapperが1 fileの`modifiedReviewed`を空にするhappy pathと、top-level head SHA不一致だけを確認する。Global revision、file revision不一致、descriptor lifecycle/identity不一致、rename、ambiguous mapping、missing objectを確認しない。

#### Required action

- mapper contractをcomplete `PullRequestReviewStateCommit`のbefore/afterへ変更し、ContextとGlobalを同一evidenceからmapする。
- T203/T204/T205と同等のimmutable diff/blob evidence、filesystem semantics、mapping optionsを必要入力にするか、既存mapperをPR contextへ再利用可能にする。
- mapped Context/Globalのidentity、new revision、file revisions、PR descriptorをfail closedで検証する。
- metadata-only、changed lines、rename、binary/ambiguous、missing old object、Global mappingのRed testsを先に追加する。

### T404-R004 — high — open

#### 改善済み

- GitHub.com owner/repository caseをlowercaseする。
- repository末尾`.git`を除去する。
-一般的な`:443`を除去する。
- port 1〜65535の範囲を確認する。

#### 残存問題1: T202/T401 canonical policyを共有せず再実装している

`canonicalizeGitHubPullRequestIdentity`はURL parserと`canonicalGitHubAuthority`を使用せず、authority文字列を正規表現とsuffix切除で処理する。

例として`ghe.example:8443:443`は末尾`:443`を切除した後、validな`ghe.example:8443`として受理される。malformed authorityが別のvalid authorityへaliasされる。

`github.com:0443`のようなdefault port表現もT401のURL canonicalizationと同じidentityにならず、同一PRを分裂させる。

#### 残存問題2: create境界がcanonical context IDを検証しない

`GitHubPullRequestContextStateService.create`はcontext kindとSHAだけを検証し、次を確認しない。

- `contextState.contextId`がPR descriptorから生成したcanonical context IDであること
- descriptor identityとrepository IDが一致すること

非canonical context IDで保存すると、`load(identity)`が生成するcanonical IDでは再読込できない。再起動後の状態継続とsingle-PR identityを破る。

#### Test gap

現行testはcase、`.git`、通常の`:443`、nondefault port、70000だけを確認する。malformed multi-port authority、leading-zero default port、create時context ID mismatch、repository ID mismatchを確認しない。

#### Required action

- `canonicalGitHubAuthority`およびT202/T401のcanonical remote identityを共有し、authority parserを重複実装しない。
- create/update/loadの全境界でdescriptor、context ID、repository IDの整合を検証する。
- malformed authority alias、default port variant、create mismatchのRed testsを追加する。

### T404-R005 — high — closed

#### 確認結果

- pathをkeyにした独自range modelは削除された。
- existing `ReviewContextState.files` / `FileReviewState`を使用する。
- stable file ID、current/previous paths、modified/original ranges、content hash、line countを保持する。
- path semanticsとinterval normalizationは既存mapping/state contractへ委譲される。

#### Closure evidence

metadata-only testはstable file ID、rename履歴、modified range、original-side rangeを保持する。revision mapping contractの不足は`T404-R003`へ分離して継続する。

### T404-R006 — medium — open

#### 残存問題

旧storeの`state === "open"`強制false処理は撤去されたが、代わりとなるlayer enablement contractが追加されていない。

現在の`PullRequestReviewContext`と`ReviewContextState`はPR lifecycleを保持するだけで、次を表すfieldがない。

- 初回closed/merged contextのdefault layer state `false`
- ユーザーが明示的に選択したclosed layer override `true`
- overrideのrestart後復元

したがって「store側で強制無効化しない」ことは、設計要求のdefault falseと明示的再有効化を実現したことにはならない。T405でtoggle UIを追加しても、永続化するcore contractがない。

#### Test gap

closed metadata保存を確認するtestはあるが、default disabled、explicit enable、restart restore、reopen時policyを確認しない。

#### Required action

- lifecycleとuser-selected visibility/decoration enablementを分離したpersisted contractを追加する。
- context作成時のdefault falseと、明示的overrideの保存・復元をT404 core testで固定する。
- T405はこのcontractを操作するUIとして実装し、policy自体をT405へ先送りしない。

### T404-R007 — high — closed

#### 確認結果

- `writeFile` + `Date.now()` temp + direct renameの独自実装は削除された。
- T104 `NodeAtomicTextFileStore`経路がunique temp、write、file sync、close、rename、failure cleanupを提供する。
- T404 adapterはfilesystem publicationを再実装しない。

#### Remaining risk

cross-process directory durabilityとlockはT604の範囲であり、R007のfile flush/temp collision原因は解消した。

### T404-R008 — medium — open

#### 改善済み

- T404 testは`core-contracts.test.ts`からimportされ、`npm run test:unit`および`npm test`で実行される。
- test名とfixtureはauthoritative state保持、canonical identity、mapper mismatchへ更新された。
- follow-up reportを追加した。

#### 残存問題1: required focused entrypointがない

初回findingとhandoffは`npm run test:t404`を要求しているが、`package.json`に`test:t404` scriptが存在しない。CIもpackage-owned commandではなく直接`node --test ...github-pr-context-layer-store.test.js`を実行する。

#### 残存問題2:主要境界をtestしていない

- actual `FileSystemReviewStateRepository`でのcreate/update/restart
- multiple PR分離とmanifest復元
- concurrent update / stale CAS
- ContextとGlobalのrevision mapping
- file revision mismatch
- canonical create mismatch
- malformed authority sibling cases
- closed default / explicit override / restart
- history context-created / revision-changed connection
- persistence failure propagation

#### 残存問題3: TDD evidenceが不足する

follow-up reportは「test変更をproduction統合より先に設計」とだけ記載し、次を記録していない。

- Red test commit SHA
- Red CI run / local command結果
- failing assertions
- production fix commit SHA
- final implementation HEAD
- exact-head CI run

reviewerが取得できるfix rangeは5 commitsだが、reportからtest-first順序を再現できない。

#### 残存問題4: evidence訂正とhandoff不足

- initial implementation report/handoffの古いcoverage/current HEADを訂正するlossless follow-up handoffがない。
- follow-up report自体にもfinal HEAD `228fd4082a462a51f2bc44ea5590423a485161a2`とrun `31094047777`が記載されていない。
- `tasks/tasks-status.md`はfix前の「8件対応待ち」のままである。

trackingはこのfix verificationで更新するが、implementation-side Red/Green evidenceとhandoff不足は残る。

#### Required action

- `test:t404`をpackage scriptとして定義し、CIは同commandを実行する。
- R003/R004/R006のRed testsに加え、actual T104 adapter、restart、multiple PR、CAS、historyを検証する。
- test-first commitとRed resultを明示してからproduction fixを行う。
- implementation follow-up reportとschema v3 handoffへcommit順序、failure evidence、final implementation HEAD、exact-head CIを記録する。

## Required coverage disposition

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement and design conformance | checked_finding | R003、R004、R006が残存 |
| correctness and edge cases | checked_finding | revision/Global mapping、mapped snapshot validation、canonical create、closed override |
| scope discipline and unrelated changes | checked_no_finding | fix差分はT404とreview evidenceへ限定 |
| changed files and direct dependency impact | checked_finding | existing mapper、T104 repository、core state、history、runtime compositionを照合 |
| API/data/config/workflow/compatibility | checked_finding | mapper API、identity API、layer persistence、test entrypoint |
| error handling and failure diagnostics | checked_finding | workflow diagnosticsは有効だがmapper fail-closed boundaryが不十分 |
| security and secret handling | checked_no_finding | token/source本文を保存する新fieldはない |
| tests and validation adequacy | checked_finding | R008 |
| current-HEAD CI evidence | checked_no_finding | run `31094047777`はreviewed fix HEADと一致しsuccess |
| report/tracking/documentation accuracy | checked_finding | follow-up evidenceとhandoff不足、tracking未同期 |
| regression and maintainability risks | checked_finding | duplicate canonical policyとincomplete mapper contract |

## Held / unexplored / unknown

### Held

- なし。

### Unexplored

- なし。fix diff、全changed files、source findings、直接依存contract、task/design、PR comments、exact-head CIを確認した。
- reviewerローカルtestは実行していないが、exact-head CIとsource contractから判定可能である。

### Unknown

- fix commitsの正確なtest-first順序とRed failure evidence。follow-up report/handoffに記録されておらず、connectorのPR summaryもcommit sequenceを提供しない。

## Verdict

`fail`

- closed: `T404-R001`, `T404-R002`, `T404-R005`, `T404-R007`
- open: `T404-R003`, `T404-R004`, `T404-R006`, `T404-R008`
- open high: 2件
- open medium: 2件

CI successは確認したが、required findingが4件残るためpassにはできない。

## Required next action

1. `T404-R003/R004/R006/R008`をfinding identityとseverityを保持して実装chatへ返す。
2. 先にRed testsを追加し、failを確認してからproduction fixを行う。
3. Context/Global complete revision mappingとcanonical create boundaryを最優先で修正する。
4. closed layer enablement contractとfocused/actual-persistence testsを追加する。
5. implementation follow-up report、schema v3 handoff、`tasks/tasks-status.md`、PR body/commentを同期する。
6. 新しいcurrent HEADに一致するCI runだけを確認する。
7. 同じ通常reviewerが残存4 findingだけを再fix verificationする。
8. 全finding closure後に別chatの独立最終reviewへ進む。

## Merge boundary

mergeは利用者が行う。reviewerはmergeしない。

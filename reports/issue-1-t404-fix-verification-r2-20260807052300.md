# T404 fix verification R2 レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T404
- Pull Request: #48
- Review mode: fix verification R2
- Reviewer role: normal reviewer
- Reviewer continuity: 初回通常reviewおよび前回fix verificationと同じChatGPT chat / 同じ通常reviewer
- Previous review evidence HEAD: `f80ce30f9c56a2084c96c719f253f04ab42a1e8e`
- Reviewed fix implementation HEAD: `6d5d23ac736b019ec8e7dc8c8be9a9d1edfa063a`
- Fix range: `f80ce30f9c56a2084c96c719f253f04ab42a1e8e..6d5d23ac736b019ec8e7dc8c8be9a9d1edfa063a`
- Generated at: `2026-08-07T05:23:00+09:00`
- Merge: 未実施

## 目的と範囲

前回fix verificationでopenとした次の4 findingだけを、finding IDとseverityを維持してclosure確認した。

- `T404-R003` high
- `T404-R004` high
- `T404-R006` medium
- `T404-R008` medium

前回closedとした`T404-R001`、`R002`、`R005`、`R007`は再オープンしていない。新規観点・新規findingは追加していない。

## 変更と検証

前回review evidence HEADから5 commit進み、次が変更された。

- `src/application/github-pr-context/github-pull-request-context-layer-store.ts`
- `test/unit/github-pr-context-layer-store.test.ts`
- `reports/issue-1-t404-review-followup-r2-20260806204500.md`
- `reports/issue-1-t404-review-followup-r2-handoff-20260806204500.yaml`

Reviewed fix implementation HEAD `6d5d23ac736b019ec8e7dc8c8be9a9d1edfa063a`に一致するworkflow runだけを判定対象とした。

- Workflow: CI
- Run: `31097954937`
- Status: completed
- Conclusion: success
- Head SHA: `6d5d23ac736b019ec8e7dc8c8be9a9d1edfa063a`

別SHAのrunは代用していない。

CIのfailure diagnostics workflowは、test output、標準出力・標準エラー、generated files、source、tests、configuration、environment、Git statusをartifactへ保存する。Red run `31097599124`にはartifact `8966095298`が存在する。

## Finding dispositions

| Finding | Severity | Disposition | Summary |
| --- | --- | --- | --- |
| T404-R003 | high | open | Context/Global top-level revisionは揃ったが、mapped descriptorと各file revisionをfail closedで検証せず、immutable mapping evidenceもcontract化されていない |
| T404-R004 | high | open | canonical repository IDを入力にしただけで、T202/T401 canonicalizerを共有せず、独自authority normalizationと弱いrepositoryId検証が残る |
| T404-R006 | medium | open | explicit overrideは保存できるが、後続metadata refreshでoverride省略時に消失し、restart round-tripも検証されていない |
| T404-R008 | medium | open | production変更がRed testより先行し、focused script・主要境界test・正確なfollow-up evidenceも不足する |

## 詳細

### T404-R003 — high — open

#### 改善済み

- `PullRequestRevisionMapper`はContext単体ではなく、`PullRequestReviewStateCommit`としてContextとowner-wide Globalを同時に返すようになった。
- `requireMappedCommit`はContext/Global repository ID、PR base/head、Global `currentRevisionId`を確認する。
- 旧revisionのGlobalを返すmapperをrejectするtestが追加された。

#### 残存問題

`requireMappedCommit`が検証するのはtop-level identity/revisionだけであり、次を検証しない。

- mapped PR descriptorのhost / owner / repository / number / state
- Context内各`FileReviewState.revisionId`がnew headに進んだこと
- Global内各fileの`revisionId`がnew headに進んだこと
- changed / renamed / ambiguous fileのreviewed rangeがimmutable evidenceに従って保守的に更新されたこと

T104 repositoryのvalidationもcontext/global top-level identityとschemaを中心とし、各file revisionをnew headと照合しない。このためmapperがtop-level SHAだけ更新し、file stateを旧revisionのまま返してもcommitできる。

また`PullRequestRevisionMappingInput`はcurrent complete commitとnext PR descriptorだけで、immutable diff/blob source、filesystem semantics、mapping optionまたはmapping evidenceを要求しない。closureから捕捉できるとしても、public contract上は証拠なしmapperを排除していない。

#### Required action

- mapped PR descriptor全体、Context/Global全file revision、complete snapshot identityをfail closedで検証する。
- T203/T204/T205相当のimmutable evidenceをmapper contractまたは明示的なevidence-bearing resultへ含める。
- stale Context file、stale Global file、wrong PR number/state/identity、rename/ambiguous mappingを先行Red testで固定する。

### T404-R004 — high — open

#### 改善済み

- `repositoryId`とPR番号からcontext IDを構築するAPIが追加された。
- create/load/update境界でidentity、repositoryId、contextIdの不一致をrejectする。

#### 残存問題

`createGitHubPullRequestContextIdFromRepositoryId`は、空文字、前後空白、`#`だけを拒否し、入力がT202/T401 canonical repository identityであることを検証しない。

さらに`canonicalizeGitHubPullRequestIdentity`は引き続き独自実装で、T401の`canonicalGitHubAuthority`またはT202の`normalizeGitRemoteUrl`を共有していない。独自実装は末尾`:443`を文字列切除するため、例えばmalformedな`ghe.example:8443:443`を`ghe.example:8443`へaliasできる。leading-zero default port等もURL parserを使うT202/T401 policyと一致する保証がない。

create境界の照合も同じ独自normalizerを両側に使うため、独自policyで同じ値になれば通過し、authoritative canonical policyとの一致を証明しない。

#### Required action

- `canonicalGitHubAuthority`とT202/T401のcanonical remote identityを直接共有する。
- `repositoryId`をopaque stringとして受けず、canonical `GitHubRepositoryIdentity`またはvalidated repository ID型からだけ生成する。
- malformed multi-port、leading-zero/default-port variant、noncanonical repositoryIdの先行Red testを追加する。

### T404-R006 — medium — open

#### 改善済み

- optional `decorationEnabled` overrideと、未指定時にopen=true、closed/merged=falseとするhelperが追加された。
- explicit trueをmetadataとともに保存するtestが追加された。

#### 残存問題

metadata-only updateは入力されたPR descriptorでpersisted descriptorを全置換する。

```ts
pullRequest: cloneValue(input.pullRequest)
```

そのため、closed PRで`decorationEnabled: true`を保存した後、通常のGitHub metadata refreshがoverrideを含めずに同じclosed descriptorを渡すと、保存済みoverrideが消え、既定falseへ戻る。UI preferenceとGitHub lifecycle metadataが同じ入力objectで上書きされている。

またoverrideのtestはin-memory repositoryで1回保存した直後だけを確認し、次を検証しない。

- override省略metadata refresh後の保持
- actual filesystem repository再生成後のoverride復元
- revision transition後のoverride保持
- explicit falseとabsenceの区別

`ReviewContextState.pullRequest`のcore型自体にもfieldが追加されておらず、T404 moduleの派生型とcastに依存する。

#### Required action

- lifecycle metadata updateでoverride省略時はpersisted user preferenceを保持する。
- user preferenceをGitHub metadataと独立したpersisted contractとしてcore stateへ定義するか、少なくとも全consumerがcastなしで利用できる型へ統合する。
- metadata refresh、revision transition、filesystem restartの先行Red testを追加する。

### T404-R008 — medium — open

#### TDD順序が要件を満たさない

Red run `31097599124`のhead SHAは`e101d2add0756c8804c6ba5e0a3c91f8ce8dc45e`である。

- `f80ce30...e101d2a`は2 commit aheadで、累積差分にproduction sourceとtestの両方を含む。
- `e101d2a` commit自体は`test/unit/github-pr-context-layer-store.test.ts`だけを変更するtest-only commitである。
- したがってproduction source変更は`e101d2a`より前のcommitに既に存在した。
- Red failure理由も未実装APIではなく、実filesystem testのpersisted commit envelope期待値誤りである。

これは「先にtestを追加して失敗を確認してからproduction実装」というRevMemのTDD方針を満たさない。報告書の「Red実装・テスト追加後」という記述もtest-first証跡ではない。

#### Coverage/evidence不足

- `package.json`に`test:t404` focused scriptは追加されていない。
- actual filesystem testは1 PRのcreate/restartだけで、別PR分離を検証しない。
- explicit closed overrideのrestart/refresh保持を検証しない。
- mapped descriptor/file revision、canonical malformed authority、noncanonical repositoryIdを検証しない。
- historyは既存別testが動くことを述べるだけで、T404 create/revision commitとのrecording integrationを検証しない。
- implementation follow-up report/handoffは4件をaddressedと記録しているが、上記残存問題とTDD順序を反映していない。

#### Required action

- 残存R003/R004/R006のtestをproduction修正より先に独立commitし、そのHEADで意図したfailureを確認する。
- `test:t404`を追加し、standard unit/full suiteとCI dedicated stepが同じowned commandを呼ぶようにする。
- multiple PR、override restart/refresh、mapped complete snapshot、canonical malformed cases、T404 history integrationを追加する。
- implementation follow-up report/handoffをactual evidenceに訂正する。

## Verdict

`fail`

- Previous closed: `T404-R001`、`R002`、`R005`、`R007`
- Open: `T404-R003`、`R004`、`R006`、`R008`
- Newly added findings: なし

Exact-head CIはsuccessだが、4 required findingがclosureしていないためT404は完了扱いにできない。

## 次のアクション

1. 実装chatへ`T404-R003`、`R004`、`R006`、`R008`を同じID/severityで返す。
2. 今回はtest-only commitと意図したRed runをproduction修正より先に作る。
3. 修正後、同じ通常reviewerが残存4 findingだけを再fix verificationする。
4. 全finding closure後に別chatの独立最終reviewへ進む。
5. mergeは利用者が行う。
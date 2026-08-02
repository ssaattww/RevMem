# T502 修正確認レポート

## Metadata / target identity

- Repository: `ssaattww/RevMem`
- Issue / task: Issue #1 / T502 Global mapping・表示優先順位
- Pull Request: #37 `T502: Global mappingと表示優先順位を実装`
- Review mode: fix verification
- Reviewer: 前回通常reviewを実施した同一review chat
- Reviewer continuity: 継続。同一chatはT502実装およびreview fixを実装していない
- Branch: `task/t502-global-mapping-display-priority`
- Base: `main`
- Source reviewed implementation HEAD: `ff2a138a4c21b864aec0da2a8bb96d5a7a960e37`
- Source review report commit: `6d1b9705a6969092dfcb2c34128ef37a8ea8a36b`
- Fix-verification reviewed implementation HEAD: `5d938ada02de96a822968a1c467ad23df2c2ec4a`
- Fix range: `6d1b9705a6969092dfcb2c34128ef37a8ea8a36b..5d938ada02de96a822968a1c467ad23df2c2ec4a`
- Exact-head workflow run: `30748956980`
- Exact-head workflow conclusion: `success`
- Verification date: 2026-08-02 JST
- Technical verdict: `fail`

このverdictはfix-verification reviewed implementation HEAD `5d938ada02de96a822968a1c467ad23df2c2ec4a`に適用する。本確認では実装・test・workflowを変更せず、verification report、handoff、PR commentだけを追加する。

## Verification scope

前回通常reviewで記録した次のfindingだけを、identityとseverityを維持して確認した。

- `T502-REV-001 high`: 通常modified Git fileがT203 mappingを通らない
- `T502-REV-002 high`: snapshot revision更新により無関係なGlobal fileまで表示不能になる
- `T502-REV-003 high`: current PR diffがmissing、stale、不完全な場合に下位layerがfail-openする
- `T502-REV-004 medium`: other-contextとGlobalの部分重複を分割せずhoverを誤表示する

新規の広域reviewは実施せず、fix diff、直接影響、同じ欠陥classのsibling case、current-HEAD evidenceを確認した。

## Inspected files and evidence

Fix rangeで変更された5 pathを確認した。

1. `src/application/global-review-mapping/global-review-mapping.ts`
2. `src/application/editor-decoration/normal-editor-decoration-model.ts`
3. `test/unit/global-review-mapping-display-priority.test.ts`
4. `reports/issue-1-t502-review-followup-20260802220000.md`
5. `reports/issue-1-t502-review-followup-handoff-20260802220000.yaml`

直接依存として次も確認した。

- `src/core/git-diff/git-diff-interval-mapping.ts`
- `src/core/pr-progress/pr-diff-progress.ts`
- 前回report `reports/issue-1-t502-review-20260802213000.md`
- PR #37のreview、follow-up comment、current HEAD、workflow run

## Validation evidence

### TDD evidence

- Red HEAD: `6c7576ef6ba9f8af7999c8a164dcbe5a4ecbff6d`
- Red run: `30748755739` — failure
- Diagnostic artifact: `8833738404` / `ci-failure-diagnostics-30748755739-1`
- Intermediate failure HEAD: `1de180f2a0d6f782a2cd6712074827f0378f95a0`
- Intermediate run: `30748798525` — failure
- Diagnostic artifact: `8833753460` / `ci-failure-diagnostics-30748798525-1`
- Green implementation HEAD: `baa116755f28b2f22dc84fd6fdc30dd57635f975`
- Green run: `30748862936` — success

### Current reviewed-head CI

Fix-verification reviewed implementation HEAD `5d938ada02de96a822968a1c467ad23df2c2ec4a`に一致するrunだけを使用した。

- Workflow: `CI`
- Run: `30748956980`
- Status: `completed`
- Conclusion: `success`
- Head SHA: `5d938ada02de96a822968a1c467ad23df2c2ec4a`

別SHAのrunは代用していない。

## Finding dispositions

### T502-REV-001 — high — closed

通常のsame-path modified sectionは`parseZeroContextGitDiff`で識別され、pre-transition Global intervalが`mapReviewedIntervalsAcrossDiff`へ渡されるようになった。変更旧行は無効化され、未変更rangeは新revision座標へmappingされる。

確認事項:

- T204 file transition後に通常modified fileへT203 mapperを適用している
- exact old/new path pairでcomplete diff内の対象sectionを選択している
- mapped interval、new revision、new content hashをtransition resultへ反映している
- 置換を含む通常modified regression testが追加されている
- 既存T203 mapperが挿入、削除、複数hunk、空白・EOL設定の契約を保持している

前回findingの原因であった「通常modified sectionを一切mappingしない」経路は解消している。

### T502-REV-002 — high — closed

editor change後は`advanceRetainedFileRevisions`により全保持Global fileのfile-level revisionがnew revisionへ同期される。Git mapping後も返却snapshotの全保持fileへ`newRevisionId`が設定される。

確認事項:

- 対象外fileのreviewed range、path、content hash、updatedAtを保持する
- document editの2 file fixtureで無関係fileのrevisionとrangeを確認する
- ordinary modified Git diffの2 file fixtureでも無関係fileのrevisionとrangeを確認する
- deleteされたfileはtransition resultから除外されるため、保持fileとして誤って復活しない

前回findingの原因であったtop-level revisionと保持file revisionの不整合は解消している。

### T502-REV-003 — high — open

missing、context/base/head mismatch、target path mismatchを不確実な証拠として扱い、current context以外のlayerを隠す修正は確認した。しかし、前回required actionに含めた「completeかつvalidatedなcurrent PR diff」の条件は満たしていない。

`currentPullRequestChangedIntervals`が検証するのは次だけである。

- PR context descriptorの存在
- diffの`contextId`
- diffの`baseSha`
- diffの`headSha`
- target `fileId`の存在
- target `newPath`

次は検証していない。

- `originalDiffId === ${baseSha}..${headSha}`
- file statusとold/new pathのmatrix
- additions/deletions統計とhunk bodyの一致
- positive one-based line coordinate
- hunk header/body/count、cursor、delta、順序、gapの整合
- duplicate coordinate、duplicate file ID/path
- modified/added/deleted fileのcomplete diff条件
- `additions > 0`なのにhunkが欠落したincomplete patch

具体的には、identityとtarget pathが一致したmodified fileが`additions: 1`かつ`hunks: []`であっても、現在実装は`certain: true, intervals: []`を返す。その結果、実際には取得できていない追加行を「当該fileにPR変更なし」と同じ扱いにし、other-contextまたはGlobalだけでグレー表示できる。

追加testはmissing diffとstale headだけであり、前回required actionに明記したmalformed/incomplete snapshotを再現していない。既存`calculatePullRequestDiffProgress`はこれらの構造を厳密に検証するが、decoration modelはそのvalidated evidenceを受け取る契約にもvalidator再利用にも接続されていない。

Required action:

- current PRの下位layer表示前に、T301と同等のcomplete snapshot validationを通した証拠だけを受理する
- validatorを共有するか、validated snapshotを表す明示的なapplication boundaryを導入する
- 少なくとも`originalDiffId`不一致、統計不一致、hunk欠落、座標不整合、file/path重複をfail-closedにする回帰testを追加する
- 不完全patchではcurrent context以外のdecorationが出ないことを固定する

severityはsource findingの`high`を維持する。reclassificationは行っていない。

### T502-REV-004 — medium — closed

other-contextのvisible intervalをGlobal overlapと非overlapへ分割し、各区間へ正確な`globalActive`を設定する実装を確認した。

確認事項:

- Global非重複部分は`globalActive: false`
- Global重複部分は`globalActive: true`
- `occupied`には分割前のvisible全体を追加し、後続other-contextとの優先順位を維持する
- partial overlap regression testが3区間のmetadataを検証する

前回findingのhover metadata誤表示は解消している。

## Follow-up report accuracy

`reports/issue-1-t502-review-followup-20260802220000.md`とhandoffは4 findingすべてをaddressedとしているが、`T502-REV-003`はcomplete/validated snapshot条件を満たしていないため、fix-verification上の正しいdispositionは`open`である。過去reportは変更せず、本reportを現時点の訂正証跡とする。

## Review coverage disposition

| Review area | Disposition | Result |
|---|---|---|
| Source finding identity / severity continuity | checked_no_finding | 4 findingのIDとseverityを維持 |
| T502-REV-001 direct fix and sibling cases | checked_no_finding | closed |
| T502-REV-002 direct fix and sibling cases | checked_no_finding | closed |
| T502-REV-003 direct fix and sibling cases | checked_finding | incomplete snapshot fail-openが残存 |
| T502-REV-004 direct fix and sibling cases | checked_no_finding | closed |
| Fix scope discipline | checked_no_finding | product変更は対象source/testに限定 |
| API/data compatibility | checked_finding | raw `PullRequestDiffSnapshot`をvalidated evidenceとして扱う境界が未解決 |
| Error handling / fail-closed behavior | checked_finding | malformed/incomplete snapshotがfail-open |
| Security / secret handling | not_applicable | 認証・secret変更なし |
| Test adequacy | checked_finding | malformed/incomplete snapshot regressionが不足 |
| Current-HEAD CI | checked_no_finding | run `30748956980` success、HEAD一致 |
| Report / handoff accuracy | checked_finding | REV-003のaddressed主張を本reportで訂正 |
| New findings | checked_no_finding | 新規findingなし |

## Verdict

`fail`

- `T502-REV-001 high`: closed
- `T502-REV-002 high`: closed
- `T502-REV-003 high`: open
- `T502-REV-004 medium`: closed

required findingが1件残るためpassにはできない。CI successは有効だが、現行testがincomplete snapshot caseを含まないためclosure証拠にはならない。

## Next action

実装chatで`T502-REV-003`のcomplete/validated PR diff evidence境界をTDDで修正し、current HEAD一致CIを成功させる。その後、この通常review chatで`T502-REV-003`だけを再度fix verificationする。

mergeは利用者が行うため実施しない。

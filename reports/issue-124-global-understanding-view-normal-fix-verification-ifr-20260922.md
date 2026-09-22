# Issue #124 / PR #125 Normal Fix Verification — Independent Findings

## メタデータ

- report type: normal fix verification report
- review mode: fix verification
- generated at: 2026-09-22T17:49:36+09:00
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base SHA: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- independent-review record before fixes: `da5f97ee02b8f2179a3fe894c5cf58aed7aac2b8`
- technical fix HEAD: `67c73c4ddd34fb1fb26720c16a840fa1b5bc8c6c`
- reviewed current HEAD: `64b7f060e02926495cb3f98a06df886638640430`
- execution: FA780 / Windows / PowerShell / Remote Desktop Commander
- worktree: `C:\Users\donabe\Project\RevMem-issue124`
- source state at review start: clean, local HEAD = origin branch = PR current HEAD
- verification capability: local_execution_available

## Reviewer continuity

Issue #124のinitial normal reviewとnormal fix-verification roundsを担当した同じnormal reviewerで、
独立reviewから返された I124-IFR-001〜005 をfix verificationした。

finding IDとseverityは独立reviewから変更していない。
normal reviewerはimplementation変更を行っていない。
## 対象

独立review required findings:

- I124-IFR-001 / High
- I124-IFR-002 / Low
- I124-IFR-003 / High
- I124-IFR-004 / Medium
- I124-IFR-005 / Medium

technical fix range `da5f97e..67c73c4` は8 executable/test filesを変更する。
`67c73c4..64b7f06` はreport / handoff / trackingのみで、
production source・test・design・workflowの追加変更はない。

## Finding completeness matrix

| Finding | Required action | Production path | Actual fixture / state check | Focused evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| I124-IFR-001 / High | stopped/non-active row/targetを保持し、stopped scope bodyを読まない | retained snapshot merge | committed sibling fixture + reviewer negative probes | T610 81/81だがbody read / mid-refresh stop defect再現 | **not closed** |
| I124-IFR-002 / Low | product fixesのnormal verification後にledger/PR metadataを最終同期 | task status + PR body | committed metadata comparison | current body still normal verification待ち / current CI未確認表記 | **not closed** |
| I124-IFR-003 / High | accept直後にlifecycle publishし、actual source/runtime fixtureでspinnerを固定 | post-accept lifecycle publish | committed source-only fixture; reviewer actual runtime probe | production behavior Green | **not closed: required regression fixture incomplete** |
| I124-IFR-004 / Medium | unchanged PR path-only rowをvalid-openまたはnon-openableにしactual composition test追加 | sparse exact-HEAD target + conditional command | source/UI別fixture; reviewer actual runtime probe | production behavior Green | **not closed: required regression fixture incomplete** |
| I124-IFR-005 / Medium | source path workをbounded化し10k actual sourceでbudget+stale non-publicationを固定 | repository/source cooperative schedulers | committed 10k budget fixture; reviewer source-path cancellation probe | budget Green / stale production behavior Green | **not closed: required regression fixture incomplete** |
## I124-IFR-001 / High — not closed

### 修正で改善した点

refresh開始時点ですでにnon-active/stoppedなscopeについて、
previous accepted snapshotから次をretained projectionへ戻す処理が追加された。

- discovered path
- prior progress
- prior open target

committed fixture
`I124-IFR-001 retains stopped sibling file rows and targets without recalculating that scope`
では、refresh開始前に `one` をstopし、`two` のrefresh後も
`one/a.ts` row/progress/targetが残る。

### 未解消 1: production open-document body read

独立review required actionは **zero stopped-scope body reads** を要求している。

production extensionの `readOpenDocuments` はrepository配下の全open documentに対して
candidate filterより前に以下を実行する。

- `document.getText()`
- content hash計算
- 全lineの `document.lineAt(...)`

その後、source側 `captureOpenedDocuments()` が初めて
`candidatePaths.has(canonicalPath)` でfilterする。

したがって、stopped scopeのopen documentはGlobal line evidenceへcopyされなくても、
body自体は既に読まれている。
review-side probe:
`C:\Users\donabe\Project\RevMem-pr125-normal-fixverify-ifr-20260922\ifr001-stopped-body-read-probe.log`

current compiled sourceで、`one` stop後のsibling refresh結果:

```json
{
  "stoppedState": "stopped",
  "discovered": ["one/a.ts", "two/a.ts"],
  "bodyReadDeltaAfterStop": {
    "one": 1,
    "two": 1
  }
}
```

committed fixtureが数えている `copied-loaded-non-empty-line` はcandidate filter後のcopy workであり、
production adapterの `getText()/lineAt()` body accessを検出できない。

### 未解消 2: running中にstopしたscopeのrowが再び消える

final retention判定はrecalculation開始時の
`const activeFolderSet = new Set(activeFolders)`
を使う。

refresh開始後、running publicationを見て `one` をstopしても、
`one` はinitial active setに残るためprevious row/target retention対象から除外される。

review-side probe:
`C:\Users\donabe\Project\RevMem-pr125-normal-fixverify-ifr-20260922\ifr001-mid-refresh-stop-probe.log`

結果:

```json
{
  "before": ["one/a.ts", "two/a.ts"],
  "stoppedDuringRefresh": true,
  "after": ["two/a.ts"],
  "afterStates": [["", "inactive"], ["one", "stopped"], ["two", "active"]]
}
```

これはIssue #124の `running -> stopped` current-generation契約にも直接反する。
### Required action

1. open-document evidence APIをcandidate/scope-awareにし、
   stopped/non-candidate documentは `getText()/lineAt()` 前に除外する。
2. final retentionをrecalculation開始時のactive setだけで決めず、
   current lifecycle / accepted-current resultを使って、
   generation中にstopped/cancelledになったscopeのprior row/progress/targetも保持する。
3. actual composition regressionで以下を固定する。
   - stopped scope open document body access = 0
   - initial success -> next refresh running -> running rowからstop -> sibling完了後もstopped row/file/target保持

severity: Highを維持する。

## I124-IFR-002 / Low — not closed

trackingとPR bodyは旧4e6ddb/75-of-75状態からは更新されている。
ただし独立reviewのrequired actionは
**product findingsを修正しnormal fix verification完了後に最終同期**
することだった。

現時点:
- `tasks/tasks-status.md`: IFR-001〜005 normal fix verification待ち
- PR body: normal fix verification待ち
- PR body current HEAD CI欄: matching run未確認
- 実際のcurrent HEAD `64b7f06...` exact-head CIは既にsuccess

さらにIFR-001が今回not closedなので、terminal metadataへ移行する前提自体が未成立。

したがってIFR-002はnormal verification後の最終sync待ちとしてnot closedを維持する。
## I124-IFR-003 / High — production behavior fixed, required fixture incomplete

production sourceはscope `accept(...)` 成功直後に
`lifecycleSnapshot(...)` をpublishし、その後current owner/generationを再確認する。

committed fixture:
`I124-IFR-003 publishes an accepted sibling as active while another sibling remains running`

これはactual sourceで `one=active, two=running` publicationを確認するが、
独立review required actionに明記された
**actual-source/runtime fixtureでspinnerまで確認**
は含まない。

reviewerはproduction source + actual VS Code runtime/providerを外部fixtureで確認した。

evidence:
`C:\Users\donabe\Project\RevMem-pr125-normal-fixverify-ifr-20260922\ifr003-runtime-spinner-probe.log`

結果:

```json
{
  "oneState": "active",
  "twoState": "running",
  "oneIcon": "folder",
  "twoIcon": "loading~spin"
}
```

production behaviorは修正済みと判断する。
しかしrequired actionはregression fixtureの追加まで含むため、fix completenessは部分的。
repositoryにactual source+runtime fixtureを追加してからclosureする。

severity: Highを維持する。

## I124-IFR-004 / Medium — production behavior fixed, required fixture incomplete

sourceはPR contextで `pullRequestHeadPaths` に存在するpathだけに
`pull-request-head` targetを作る。
UI modelはsparse targetを許可し、runtimeは `openTarget` があるfileだけにcommandを付ける。

committed coverageは:
- actual source fixture
- UI model sparse-target fixture

に分かれており、独立review required actionの
**unchanged direct fileを含むactual composition test**
は未追加。
reviewer actual source + actual runtime/provider probe:
`C:\Users\donabe\Project\RevMem-pr125-normal-fixverify-ifr-20260922\ifr004-pr-nondiff-runtime-probe.log`

production結果:
- displayed rows: `changed.ts`, `unchanged.ts`
- `changed.ts`: pull-request-head target + open commandあり
- `unchanged.ts`: targetなし、open commandなし

production behaviorは修正済み。
ただしrequired regression fixtureをrepositoryへ追加するまでfinding completenessは満たさない。

severity: Mediumを維持する。

## I124-IFR-005 / Medium — production behavior fixed, required fixture incomplete

repository enumeratorとGlobal sourceのcandidate/canonicalization/union/sort/open-target projectionに
cooperative schedulerが追加されている。
currentness / abort / exact owner evidenceはscheduler checkpointで再確認される。

committed actual-source 10,000-path fixture
`I124-IFR-005 bounds actual source path enumeration, canonicalization, sorting, and target projection`
は:
- repository work accounting
- source-path work accounting
- adjacent yield interval <=128
を確認する。

reviewer focused rerun:
- R003/R004/IFR005 + existing bounded tests: **5/5 pass**

ただし独立review required actionは同じactual-source workloadで
**stale work cannot publish** まで固定することを要求した。
committed IFR005 fixtureにはcancellation/supersession assertionがない。
既存T610-R11はenumerator段階でcancelするため、
新規source-path scheduler段階のstale fenceを直接固定していない。
reviewer source-path cancellation probe:
`C:\Users\donabe\Project\RevMem-pr125-normal-fixverify-ifr-20260922\ifr005-source-cancel-probe.log`

source-path canonicalize checkpointでabortした結果:

```json
{
  "outcome": "AbortError",
  "abortedAtKind": "source-path-canonicalize",
  "publications": [
    { "discovered": 0, "files": 0 }
  ]
}
```

initial lifecycle publication以外のstale file projectionは発生していない。
production behaviorは修正済み。

しかしrequired actionに含まれるsource-path-stage stale-publication regression fixtureが
repositoryに未追加なので、formal closureは行わない。

severity: Mediumを維持する。

## Validation assessment

current reviewed HEAD `64b7f060e02926495cb3f98a06df886638640430`:

- `npm run compile:test`: pass
- `npm run test:t505`: **26/26 pass**
- `npm run test:t610`: **81/81 pass**
- R003/R004/IFR005 + existing bounded focused: **5/5 pass**
- implementation report evidence:
  - repository enumeration 8/8
  - `npm run test:t607`: 88/91, known baseline 3 only
  - build / lint / contracts / architecture positive+negative: Green
  - default `npm test`: exit 0
- independent negative/closure probes:
  - IFR001 stopped body read: **failed closure**
  - IFR001 mid-refresh stop row retention: **failed closure**
  - IFR003 runtime spinner: production pass
  - IFR004 PR non-diff runtime open command: production pass
  - IFR005 source-path cancellation: production pass
## Exact-head CI

PR current HEAD:
`64b7f060e02926495cb3f98a06df886638640430`

Matching pull_request run only:
- workflow: CI
- run id: `35703038775`
- run number: #4646
- status: completed
- conclusion: **success**
- artifact: `review-range-user-validation-0.1.55-pre+64b7f06`
- artifact id: `10683970529`
- artifact workflow head SHA: `64b7f060e02926495cb3f98a06df886638640430`

別SHAのrunは代用していない。

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_finding | IFR001 running->stopped row retention/body-read contract |
| correctness / edge cases | checked_finding | stop during running generation reproduces row loss |
| scope discipline | checked_no_finding | technical delta is independent finding fixes + focused tests |
| changed files / direct dependencies | checked_finding | source retention plus extension open-document adapter dependency |
| API/data/config/workflow/compatibility | checked_finding | IFR003-005 behavior fixed but required committed composition coverage incomplete |
| error handling / failure diagnostics | checked_no_finding | source-path cancellation correctly aborts in reviewer probe |
| security / secret handling | checked_no_finding | no credential change or repository-wide filesystem body scan added |
| tests / validation adequacy | checked_finding | IFR001 misses actual body read/mid-refresh stop; IFR003-005 required regression cells incomplete |
| current-head CI evidence | checked_no_finding | exact-head #4646 success |
| report / tracking / documentation accuracy | checked_finding | IFR002 terminal sync cannot complete before normal closure; CI line now stale |
| regression / maintainability risk | checked_finding | untested production composition paths can regress despite focused Green |
## Held

- T607既知baseline failure 3件。
  - PR baseでも同じdefect classesを再現済み。
  - 今回findingの原因として使用しない。

## Unexplored

- installed VSIXの手動視覚smoke test。
- independent reviewer固有のformal closure。
  - normal verification後、findingを発行した同じindependent reviewerが実施する工程。

## Verdict

**fail**

Finding dispositions:

- I124-IFR-001 / High: **not closed**
- I124-IFR-002 / Low: **not closed**
- I124-IFR-003 / High: **not closed — production fixed, required regression fixture incomplete**
- I124-IFR-004 / Medium: **not closed — production fixed, required regression fixture incomplete**
- I124-IFR-005 / Medium: **not closed — production fixed, required stale-publication fixture incomplete**

focused suitesとexact-head CIがGreenでも、required action / actual-composition completenessを満たしていないためnormal closureしない。

## 次のアクション

implementation routeへ以下を返す。

### IFR-001
- candidate/scope filterをopen-document body readより前へ移す
- running generation中にstopしたscopeでもprevious row/progress/targetを保持
- 上記2ケースのactual composition Red→Greenを追加

### IFR-002
- product normal verificationが完了した最終HEADでtracking/PR body/CI metadataを再同期

### IFR-003
- actual source + actual VS Code runtime/provider fixtureをrepositoryへ追加し、
  active siblingにspinnerなし / running siblingだけ `loading~spin` を固定

### IFR-004
- PR unchanged path-only rowをactual source + runtime/providerまで通し、
  row visible / targetなし / commandなしを1つのregression fixtureで固定

### IFR-005
- source-path scheduler中のabort/supersessionをactual-source fixtureへ追加し、
  stale file projectionがpublishされないことを10k/bounded workloadと同じdefect classで固定

各findingは required action / production path / actual composition fixture / focused evidence を揃え、
同じnormal reviewerへ戻す。
mergeは行わない。

# T601 独立最終レビューレポート

## Metadata

- Repository: `ssaattww/RevMem`
- Pull Request: `#33`
- Task: `T601`
- Review mode: `independent_final_review`
- Reviewer: reviewer 2/2（T601の実装、review fix、通常reviewを担当していない独立reviewer）
- Branch: `task/t601-non-git-snapshots`
- Base ref: `origin/main`
- Base HEAD: `05a5350575c6a7c1e7b6b2534b78d2c273317044`
- Merge base: `ec1ce78ab35867397c33d711095424e3eedd6e2c`
- Reviewed implementation HEAD: `52850f596387ed8ac80ea157fc997ee22ad8fd16`
- Commit range: `05a5350575c6a7c1e7b6b2534b78d2c273317044..52850f596387ed8ac80ea157fc997ee22ad8fd16`
- Reserved report path: `reports/issue-1-t601-independent-final-review-20260802093000.md`
- Technical verdict: `fail`
- Merge: 実施していない

本technical verdictは上記reviewed implementation HEADだけに適用する。required findingがあるため、本reportをadministrative report-attestation commitとして扱うことはできない。

## Purpose, scope, and non-goals

T601 / AC-13について、PR本文・review/comment、task・design、`origin/main..reviewed HEAD`の全差分、直接依存、通常finding `T601-R001`のclosure、snapshot integrity、LCS ambiguity、retention、restart、merge conflict、current-HEAD CIを独立評価した。

対象:

- Git未導入・非Git workspaceの圧縮snapshot保存と復元
- 行単位mappingと曖昧時の未確認化
- snapshot欠落・破損・期限切れ・件数・圧縮byte上限
- workspace provider、document routing、composition root、永続化route
- test wiring、通常review証跡、tracking、current baseとの統合可能性

非対象:

- findingの実装修正
- commit、push、PR更新、comment、merge
- Issue #28の修正
- T607で予定される大規模性能最適化

## Authoritative requirements and design

- `tasks/tasks-status.md` T601: 圧縮snapshot、Myers相当の行差分、非Git workspace context追従、期限・上限を実装し、編集・再起動追従を動作させ、欠落・破損・曖昧時は未確認にする。
- `doc/design/vscode-review-range-tracker-design.md` 6.3: Gitなしworkspaceは保存snapshotと現在内容の行差分を使う。
- 同10.4・17.1: 証拠が曖昧または障害時は不確実な範囲を確認済みにしない。
- 同10.5: CRLF/LF、末尾改行を既定で変更として扱う。
- 同13.1〜13.2: application層はruntime技術を知らず、composition rootがsnapshot/storage runtime adapterを生成する。
- 同18: snapshotはlocal extension storageへ保存し、source本文を外部serviceへ送らない。
- `review-enforcer`: tracking、通常review・fix-verification、current-base validationを含む全non-final変更を完了してから実装HEADをfreezeする。

設計文書自体の変更はなかった。今回の追加は既存APIの破壊的変更ではないため、`Design/BreakingChanges.md`記録はnot applicableと判断した。

## Work context and changed-file coverage

```yaml
repository: ssaattww/RevMem
issue_or_pr: PR #33
task_id: T601
mode: review
branch: task/t601-non-git-snapshots
base_ref: origin/main@05a5350575c6a7c1e7b6b2534b78d2c273317044
current_head: 52850f596387ed8ac80ea157fc997ee22ad8fd16
reviewed_head: 52850f596387ed8ac80ea157fc997ee22ad8fd16
write_boundary:
  allowed:
    - reports/issue-1-t601-independent-final-review-20260802093000.md
  forbidden:
    - implementation, test, task, phase, design, workflow, handoff, other report
    - commit, push, PR mutation, merge
ci:
  matching_run: 30719523252 / job 91420844514
  conclusion: success
blocked: []
```

`origin/main..reviewed HEAD`は33 paths、2,203 insertions / 1,414 deletions。全pathを確認し、merge-baseで由来を分離した。

### T601 branch-native paths（merge-base..reviewed HEAD、15 paths）

- Handoffs: `handoffs/issue-1-t601-implementation-20260802002000.yaml`、`handoffs/issue-1-t601-review-20260802062300.yaml`、`handoffs/issue-1-t601-review-followup-20260802063200.yaml`、`handoffs/issue-1-t601-review-r2-20260802063500.yaml`
- Reports: `reports/issue-1-t601-implementation-20260802001800.md`、`reports/issue-1-t601-review-20260802062300.md`、`reports/issue-1-t601-review-followup-20260802063000.md`、`reports/issue-1-t601-review-r2-20260802063500.md`
- Product/config: `package.json`、`src/application/non-git-snapshots/index.ts`、`src/adapters/workspace-review-state/index.ts`、`src/adapters/workspace-review-state/snapshot-tracking-workspace-review-state-session-provider.ts`、`src/core/line-intervals/index.ts`
- Tests: `test/unit/non-git-snapshot-tracker.test.ts`、`test/unit/workspace-non-git-snapshot-tracking.test.ts`

### Current-base-only endpoint differences（merge-base..origin/main、19 paths）

- `package.json`
- T207 reports 8件: implementation、review、review-followup、fix-verification、independent-final-review、independent-review-followup、independent-finding-normal-verification、independent-fix-verification
- `src/adapters/document-review-state/document-review-state-session-provider.ts`
- `src/application/review-context/git-context-revision-mapper.ts`
- `src/core/git-diff/git-file-state-transition.ts`
- `src/core/git-diff/validated-git-file-state-transition.ts`
- `tasks/tasks-status.md`
- `test/integration/t207-git-history.integration.test.ts`
- `test/support/temporary-directory.ts`
- `test/unit/ci-workflow-contract.test.ts`
- `test/unit/git-file-state-transition-r3.test.ts`
- `test/unit/git-file-state-transition.test.ts`

これらはT601 branchがT207 merge前のmerge-baseから分岐したためendpoint diff上では削除・巻き戻しに見える。通常mergeならmain-only変更は保持されるが、`package.json`は両branchが同じtest script領域を変更しており実際に競合する。競合解消ではT207とT601の両方のunit/focused wiringを保持しなければならない。

### Direct dependencies inspected

- `src/extension.ts`
- `src/adapters/workspace-review-state/workspace-review-state-session-provider.ts`
- document provider chain under `src/adapters/document-review-state/`
- `src/adapters/state-repository/storage-router.ts` and contracts
- `src/core/intervals/index.ts` and review-state transaction logic
- `.github/workflows/ci.yml`
- `tools/validate-architecture.mjs`
- `tasks/phases-status.md`、`tasks/tasks-status.md`
- `doc/design/vscode-review-range-tracker-design.md`
- PR #33 body、issue comments、reviews、inline comments（0件）
- Issue #1、held Issue #28

## Normal finding closure

### `T601-R001` (High) — closed

- Source reviewed HEAD: `0e3440fa0a4e015463adb56d338488c53291a4c1`
- Fix implementation HEAD: `8ea9c993e871d1268377c10e5441e2a76e34ea66`
- Current reviewed HEAD: `52850f596387ed8ac80ea157fc997ee22ad8fd16`
- Fix: prefix/suffix LCS長から全最長mapping参加候補を列挙し、候補数と単調性が一意性を証明する場合だけmappingする。
- Regression cases: `A/X/A -> A/A/X`、`A/A/B/B -> A/B/B/A`はいずれも`ambiguous`かつ空range。
- Sibling-case probe: 同じ一意性ロジックを二値alphabet、両side長0〜6の16,129組で全最長index mappingの列挙結果と比較し、false unique 0、wrong mapping 0。
- Current reviewed HEAD一致CIにも上記testが含まれ、全gate success。

finding identityとseverityは変更していない。技術的closureは確認したが、後述のpre-freeze evidence gapは別findingである。

## Findings

### `T601-IFR-001` — High — Product runtimeがsnapshot追従を使用しておらず、再起動を跨ぐstorageも存在しない

- Origin: introduced_by_change / incomplete integration
- Location: `src/extension.ts:18,225-235`; `src/application/non-git-snapshots/index.ts:50-93`; `src/adapters/workspace-review-state/snapshot-tracking-workspace-review-state-session-provider.ts`
- Required: yes

#### Description

`src/extension.ts`は引き続きplain `WorkspaceReviewStateSessionProvider`を生成してdocument routerへ渡す。repository内で`SnapshotTrackingWorkspaceReviewStateSessionProvider`を参照するproduction codeはbarrel export以外になく、`NonGitSnapshotStorage`実装もprocess内だけの`InMemoryNonGitSnapshotStorage`しかない。既存storage routerは`storageUri/snapshots`を予約するが、読み書きするadapterは追加されていない。

さらにsnapshot providerの`loadForDecoration()`はbase実装をそのまま返し、snapshot mappingを行わない。testはprovider objectを再生成して同じin-memory storageを共有し、直接`open()`を呼ぶだけで、extension再起動・初回decoration load・filesystem永続化を通していない。

#### Impact

配布される拡張ではGitなしfileの編集後mappingも、process再起動後のsnapshot復元も実行されない。T601の中心要件とAC-13を満たさず、PR本文の「workspace provider再生成後のsnapshot mapping」もproduct behaviorを証明しない。

#### Evidence

- `git grep SnapshotTrackingWorkspaceReviewStateSessionProvider -- src`はclass定義とbarrel exportだけ。
- `git grep implements NonGitSnapshotStorage -- src`はin-memory実装だけ。
- `src/extension.ts:225`はplain providerをconstructする。
- focused testは共有memory objectを保持し、Extension Host restartを行わない。

#### Required action

local extension storageを使うpersistent snapshot adapterを実装し、composition rootへsnapshot provider、本文取得、limitsを接続する。restart後の通常decoration/read pathでmappingされることをintegrationまたはExtension Host testで証明し、focused・broader・新HEAD一致CIと通常reviewを行う。

### `T601-IFR-002` — High — EOL情報を破棄するため、改行変更を確認済みとして継承する

- Origin: introduced_by_change
- Location: `src/application/non-git-snapshots/index.ts:316-318`
- Required: yes

#### Description

`splitLines()`は`/\r\n|\n|\r/`で分割し、separatorを捨てる。このため`alpha\r\nbeta`と`alpha\nbeta`は同一line列となり全rangeをmappingする。また`alpha\n`から`alpha`では先頭`alpha`をunchangedとして保持し、末尾改行の有無によるその行のEOL変更を表現できない。

#### Impact

design 10.5が既定で変更として扱うCRLF/LF・末尾改行差分を無視し、変更された行を確認済み表示できる。確実性優先のAC-24にも反する。

#### Evidence

- mapperの比較単位にline terminatorまたはEOL signatureがない。
- T601 testsはLF本文だけで、CRLF/LF・CR・terminal newline sibling casesを含まない。
- design unit coverageはedit mappingでCRLF/LFを要求している。

#### Required action

line terminatorを含むdocument evidenceまたは明示的EOL signatureをmappingへ組み込み、既定ではEOL変更を未確認化する。CRLF↔LF、CR、末尾改行追加・削除、空fileをtestし、新HEADで通常reviewへ戻す。

### `T601-IFR-003` — High — 最新snapshotの破損または保存失敗後に古いsnapshotを採用し、解除済みrangeを復活できる

- Origin: introduced_by_change
- Location: `src/adapters/workspace-review-state/snapshot-tracking-workspace-review-state-session-provider.ts:53-56,75-89,118-133`
- Required: yes

#### Description

`findLatestSnapshot()`は全snapshotを新しい順に走査し、`restore()`が`undefined`を返したentryを理由の区別なくskipして、次の古い同一workspace/file snapshotを返す。最新世代がcorruptなら、task要件の「破損時は未確認」ではなく古いreview evidenceへfallbackする。

同じ問題はwrapped committerでも起きる。review-state commitを先に確定し、その後のsnapshot saveが失敗しても古いsnapshotをinvalidateしない。たとえば全rangeを解除したstate commit後にsnapshot保存が失敗すると、次回openが以前のfull-reviewed snapshotを選び、`markReviewedRanges()`で解除済みrangeを再追加できる。

#### Impact

corrupt I/O、容量超過、将来のfilesystem write failureで、利用者が解除したrangeまたは古い内容のrangeを確認済みとして復活させる。snapshot integrity failureを安全側に倒す要件へ直接違反する。

#### Evidence

- providerは`restore()`のmissing/corrupt/expiredを受け取れず、validな古いentryを探索し続ける。
- tracker単体testは指定IDのcorrupt結果だけを確認し、providerの世代選択を検証しない。
- committerは`delegate.commit()`の後にsnapshot saveを行い、失敗時のgeneration markerまたは古い世代invalid化がない。

#### Required action

workspace/fileごとのauthoritative latest generationまたはsnapshot pointerを整合性保護して保持し、その世代がmissing/corrupt/expiredなら古いreview evidenceへfallbackせず未確認化する。state commitとsnapshot generationの失敗順序を設計し、corrupt latest、missing latest、save failure after unmark、retention cleanupのsibling testsを追加する。

### `T601-IFR-004` — High — Frozen HEADはcurrent mainへ統合不能で、統合結果のCI証拠がない

- Origin: branch/base integration state
- Location: PR #33 merge state; `package.json` test scripts
- Required: yes

#### Description

PR APIは`mergeable=CONFLICTING`、`mergeStateStatus=DIRTY`を返す。reviewed HEADのmerge-baseは`ec1ce78a...`で、current base `05a5350...`のT207 mergeを含まない。`package.json`ではmain側の`test:t207`・T207 `test:git` wiringとbranch側の`test:t601`・T601 unit wiringが同一箇所で競合する。

#### Impact

現在のPRはmergeできず、競合解消でどちらかのsuite wiringを落とす危険がある。CI run `30719523252`はreviewed HEAD単体には一致するがcurrent main統合結果ではないため、T207とT601を同時に保持したbuild/test状態は未検証である。

#### Evidence

- `git merge-base origin/main HEAD` = `ec1ce78ab35867397c33d711095424e3eedd6e2c`。
- `HEAD..origin/main`に`05a5350 T207: Git履歴ライフサイクル統合試験 (#35)`がある。
- three-way merge previewは`package.json`の`test:unit`、`test:git`、`test:t207` / `test:t601`でconflict markerを生成する。

#### Required action

current mainを統合し、T207とT601双方のscripts/tests/reports/trackingを保持して競合解消する。統合後の新HEADでfocused、必要なbroader gate、全CIを実行し、normal review後に新しいindependent-final-review targetをfreezeする。

### `T601-IFR-005` — Medium — Independent-review pre-freeze gateのtrackingと通常review evidenceが収束していない

- Origin: workflow/pre-freeze state
- Location: `tasks/tasks-status.md:7-14,260`; `tasks/phases-status.md:34`; `reports/issue-1-t601-review-r2-20260802063500.md:13-20,63-84`; corresponding handoff
- Required: yes

#### Description

reviewed HEADのtrackingはT601を`未着手`、P6を`未着手`のままとし、現在位置はT206、次taskはT207、PRは#29と記録している。current baseではT207完了へ進むが、いずれにもT601の実態、report参照、PR #33が同期されていない。

通常fix-verificationの詳細reportとhandoffもreviewed PR HEAD `8c89545...`に対して`incomplete`を記録したままである。後続PR commentは`52850f5...`一致CI成功と`pass`を述べるが、`report-writer`契約上、concise PR commentは詳細reportを置換できない。

#### Impact

trackingとnormal review evidenceをfreeze前に確定する`review-enforcer` gateを満たさず、独立review後の唯一許可されるreport-attestation commitへ進めない。今からtrackingや通常reportを更新すればfrozen HEADが変わるため、新しいnormal verificationと独立最終reviewが必要になる。

#### Evidence

- `tasks/tasks-status.md`のT601 rowは`未着手`。
- detailed normal reportのverdictは`incomplete`で、対象HEADはcurrent frozen HEADではない。
- current-HEAD passはPR commentだけに存在する。

#### Required action

`progress-sync-manager`等の専用Skillでtasks/phases/report referencesを実態へ同期し、current HEAD用の詳細normal fix-verification report/handoffをpersistする。すべてcommit・push・CI・normal review後に再freezeする。

### `T601-IFR-006` — Medium — application層がNode runtime実装を直接所有し、layer contractに違反する

- Origin: introduced_by_change
- Location: `src/application/non-git-snapshots/index.ts:1-3,43-48`
- Required: yes

#### Description

application moduleが`node:crypto`、`node:util`、`node:zlib`と`Buffer`を直接使用し、gzip・SHA-256実装を所有する。design 13.1はapplication層がruntime技術を知らずport/use caseだけを定義し、runtime adapterをadapters層で実装すると定める。

#### Impact

snapshot compression/hash/storageのruntime境界が逆転し、別runtime・test adapterへの差し替えとcomposition root責務が崩れる。現architecture validatorはapplicationのNode builtin importを検査しないためCI successでもこの違反を検出しない。

#### Evidence

- source冒頭がNode runtime moduleを直接importする。
- `tools/validate-architecture.mjs`のplatform import禁止はcoreの`vscode`/filesystem等だけで、application runtime importを検出しない。
- design 13.2はcomposition rootがsnapshot/storage runtime adapterを生成すると明記する。

#### Required action

applicationにはcompression/hash/storage portとuse caseを残し、gzip、SHA-256、Buffer/filesystem処理をadaptersへ移す。architecture contract test/validatorへapplication runtime dependencyのnegative caseを追加し、新HEADで検証する。

## Required coverage dispositions

| Criterion | Disposition | Evidence |
|---|---|---|
| Requirement and design conformance | `checked_finding` | runtime未接続、EOL契約、layer contract、pre-freeze gateにfinding |
| Correctness and edge cases | `checked_finding` | corrupt/latest-generation fallbackとEOL mappingにfinding |
| Snapshot integrity | `checked_finding` | payload SHA-256検証は確認したがprovider世代選択がcorruptを古い証拠へfallback |
| LCS ambiguity | `checked_no_finding` | `T601-R001` closure、16,129組probeでfalse unique 0 |
| Retention and limits | `checked_finding` | in-memory oldest-first/count/byte/expiryは確認、persistent path未実装とsave-failure generationにfinding |
| Restart behavior | `checked_finding` | object再生成unit testは成功証拠あり、product restart/storage/decoration pathは未実装 |
| Scope discipline/unrelated changes | `checked_finding` | T601 native diffは限定的だがcurrent base未統合・tracking不整合 |
| Changed files/direct dependencies | `checked_finding` | endpoint 33 paths、merge-base由来15、base-only19、直接依存を全確認 |
| API/data/config/workflow/compatibility | `checked_finding` | Node-bound public port、package conflict、integrated result未検証 |
| Error handling/failure diagnostics | `checked_finding` | tracker単体はmissing/corrupt/expiredを安全化するがproviderが古い世代を再利用 |
| Security/secret handling | `checked_no_finding` | token/外部送信なし、snapshot本文はlocal想定。integrity findingは別記 |
| Tests and validation adequacy | `checked_finding` | exact-head CI successだがproduct wiring、EOL、corrupt latest、integrated main testが欠落 |
| Current-HEAD CI | `checked_no_finding` | run `30719523252`のhead SHAはreviewed HEADと完全一致し全job success |
| Report/tracking/documentation accuracy | `checked_finding` | T601未着手tracking、詳細normal reportが`incomplete`のまま |
| Regression and maintainability | `checked_finding` | T207/T601 script conflict、runtime layer違反、世代整合性risk |

Unexplored: なし。required coverageはすべて上記いずれかへ分類した。

## Validation assessment

### Reused current-HEAD CI

- Run: `30719523252`
- Job: `91420844514` (`build-and-lint`)
- Event: `push`
- Head SHA: `52850f596387ed8ac80ea157fc997ee22ad8fd16`
- Conclusion: `success`
- Successful gates: install、build、contract typecheck、architecture positive/negative、lint、unit、temporary Git、mock GitHub、VS Code Extension Host
- PR comment reports 354 unit tests passed / 0 failed。

これはfrozen branch HEADの有効な直接証拠として再利用した。ただしcurrent mainを含むmerge resultの証拠ではない。

### Focused checks

- `git diff --check origin/main..reviewed HEAD`: success。
- LCS sibling exhaustive probe: 16,129 pairs、false unique 0、wrong mapping 0。
- `npm run test:t601`: local dependencyが存在せず`tsc is not recognized`で実行不能。これはtest failureではなくlocal validation unavailableであり、matching exact-head CI successを代用せず別証拠として記録する。
- Full local suite: 実行していない。exact-head CIを再利用し、current-base統合前の重複実行は行わなかった。
- Markdown wording: repositoryに`tools/lint/`と`lint:md` wiringがなくfocused/fullとも`unsupported`。`tasks/tasks-status.md`もMarkdown lintを完了条件外と明記するため、このreview verdictの追加blockerにはしない。

## Held items

- Issue #28: WindowsでPOSIX path fixtureがhost pathへ変換される既存test portability問題。OPEN、T601外、non-blocking heldを維持する。
- 大規模文書のLCS resource上限: 現実装はprefix/suffixの2つの`O(n*m)` matrixを確保する。T607が性能計測・最適化ownerであり本reviewではheld。ただしT601 taskの「Myers相当」との性能差は統合修正時に再評価する。

## Unknowns and remaining risks

- Persistent adapter未実装のため、実filesystemでのatomicity、partial write、容量不足、cleanup failureはまだ証明できない。これは`T601-IFR-001`/`003`のrequired actionに含む。
- current main統合後の最終changed-file setとCI SHAは未確定。`T601-IFR-004`修正後に新しいtarget identityが必要。
- No verdict-blocking unexplored areaはない。上記はfindingまたは明示的heldとして分類済み。

## Verdict and attestation

- Verdict: `fail`
- Required findings: 6件（High 4、Medium 2）
- Existing normal finding `T601-R001`: closed、severity Highを保持
- Held: Issue #28、T607-owned LCS performance
- Report attestation allowed: `false`
- Report attestation head: `null`

required repository changes、current-base integration、tracking/report synchronizationが必要であり、reviewed implementation HEAD `52850f596387ed8ac80ea157fc997ee22ad8fd16`はterminal implementation HEADとして受理できない。このreportを唯一のadministrative attestation commitとしてcommitしてはならない。

## Next action

1. `T601-IFR-001`〜`006`を通常implementation lifecycleへ戻す。
2. current mainを統合し、T207/T601双方を保持する。
3. focused・broader・current-HEAD CI、同じnormal reviewerによるfinding closureを完了する。
4. tracking、normal report、handoffをcommit/pushしてpre-freeze gateを再確認する。
5. 新しいreviewed implementation HEADをfreezeし、fresh independent final reviewを行う。

mergeは利用者が行う。

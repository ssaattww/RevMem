# T603 fix verification R4 レポート

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: `#53` — T603 schema migration・破損隔離・回復
- Task: `T603`
- Review mode: `fix_verification`（同一normal-review lineage）
- Branch: `task/t603-schema-migration-recovery`
- Base ref: `main`
- Base SHA: `146aec15783294da1795f268315c85d1a0dffa56`
- Source verification artifact HEAD: `3b3fc007159fba3120f47c1b06ef7060281ed9ed`
- Reviewed implementation HEAD: `80f96d523614cea4eb6d0213450a7a456b0d47bf`
- Fix range: `3b3fc007159fba3120f47c1b06ef7060281ed9ed..80f96d523614cea4eb6d0213450a7a456b0d47bf`
- Fix-range commits: 9
- Reviewer: ChatGPT T603 normal reviewer（前回verificationと同一chat）
- Generated at: `2026-08-17T06:17:00+09:00`
- Merge: 未実施。mergeは利用者が行う。
- Verdict: **fail**

前回verificationでopenだった `T603-R006`、`T603-R013`、`T603-R015`、`T603-R016` をidentity/severityを維持して再検証した。実装fix、直接依存、同defect classのsibling、TDD Red、diagnostic artifact、technical Green、PR current HEAD exact CI、implementation report/handoffを確認した。

## 2. Fix range / changed files

前回review artifact `3b3fc007...` からcurrent HEAD `80f96d52...` までの9 commitで変更された9 pathを全て確認した。

1. `.github/workflows/ci.yml`
2. `handoffs/issue-1-t603-fix-followup-r3-20260816230716.yaml`
3. `reports/issue-1-t603-fix-followup-r3-20260816230518.md`
4. `src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts`
5. `src/adapters/persistence-startup-migration.ts`
6. `src/adapters/state-repository/jsonl-review-history-store.ts`
7. `src/adapters/state-repository/validated-file-system-review-state-repository.ts`
8. `test/unit/t603-fix-verification-r3.test.ts`
9. `test/unit/t603-r013-startup-owner-regression.test.ts`

直接依存・consumerとして、`persistence-schema-recovery.ts`、coherent/low-level state repository、snapshot tracker、history storage route/codec、T207 multi-context history contract、startup activation、task/design/BreakingChanges、前回verification report/handoff、PR evidenceを再確認した。

`unexplored`: **なし**。

## 3. TDD / diagnostics / exact-head CI

### 3.1 Remaining-finding Red

- HEAD: `fb542331d6097c3774dc3b06a90557feba44efbe`
- Exact-head run: `31951104968`
- Job: `95174574695`
- Result: **failure**
- Failure step: T603 schema migration and corruption recovery tests
- Earlier Build / typecheck / architecture / lint / unit / T602: success
- Diagnostic artifact: `9264663918` (`ci-failure-diagnostics-31951104968-1`)

artifactを実取得して確認した。T603 logは23 tests / 19 pass / 4 failで、実装前に次をRed化している。

- R006 direct wrapper corruption後もlatest pointerが残る。
- R006 startup metadata migration後もlatest pointerが残る。
- R013 new eventIdがexisting eventIdと衝突してもappend成功する。
- R015 repair後read-only reloadが`undefined`のままになる。

artifactにはT603結果、Build/typecheck/architecture/lint/unit/T602 logs、stdout/stderr統合log、environment、Git status、generated-file inventory、source/test/dist/test-dist/config/workflow contextが含まれ、failure diagnostic policyを満たす。

### 3.2 Explicit startup-owner Red

- HEAD: `a564f429354d598ed31774997064f60498f1c021`
- Exact-head run: `31951294886`
- Job: `95175039741`
- Result: **failure**
- Diagnostic artifact: `9264713590` (`ci-failure-diagnostics-31951294886-1`)

artifactを実取得した。T603 logは24 tests / 19 pass / 5 failで、上記4件に加え、`migratePersistedReviewHistoryFile(..., expectedRepositoryId)`へ別owner eventを与えたdirect boundary testが `ready` を返してRedになっている。

### 3.3 Transient compile failure

- HEAD: `dd066e50827303f365f0e35cc4035a777110095e`
- Exact-head run: `31951451283`
- Job: `95175411973`
- Result: Build **failure**
- Diagnostic artifact: `9264749076`
- Cause: string unionの`PersistedReviewStatePreparation`を一時的に`.state` objectとして扱ったtype error。
- Correction: `cea2dba75aa13593de2723e9269f324fe7498ebf`

### 3.4 Technical Green

- HEAD: `cea2dba75aa13593de2723e9269f324fe7498ebf`
- Exact-head run: `31951520110`
- Job: `95175572515`
- Conclusion: **success**

Build、contract typecheck、architecture +/-、lint、unit、T602、T603、全focused suites、Temporary Git、Mock GitHub、VS Code Extension Hostが成功。

### 3.5 Current reviewed implementation HEAD

- Reviewed implementation/current HEAD: `80f96d523614cea4eb6d0213450a7a456b0d47bf`
- Exact-head run: `31952470126`
- Job: `95177960715`
- Conclusion: **success**

current job logを確認し、T603 focusedは新R3 suitesを含め24/24 pass、historical non-superseded review regressionsも16/16 pass。BuildからExtension Hostまで全step success。別SHAのrunはcurrent判定へ代用していない。

## 4. Finding verification

### T603-R006 — medium — **closed**

#### Source finding

malformed wrapper / invalid base64のsnapshot entryを隔離しても、そのsnapshot IDを指すvalid latest pointerがactiveに残る。

#### Fix verification

`NodeNonGitSnapshotStorage.get()`のnon-future corruption catchが、entry pathだけの`quarantinePersistedText`から`this.quarantine(snapshotId)`へ変更された。これによりentryをquarantineした後、同snapshot rootのvalid latest pointerを走査し、一致するpointerもquarantine/removeする。

R3 regressionはdirect readとstartup metadata migrationの両方で、malformed/current-schema wrapper + valid latest pointerがentry/pointerともactive pathから除去され、quarantine sidecarが残ることを確認する。既存gzip/hash/envelope + latest invalidation regressionもcurrent CIでGreen。

**Disposition: closed. Severity historyはmediumのまま保持。**

### T603-R013 — medium — **open / partial**

#### Addressed portion

- existing valid historyの`eventIds`を返し、新event IDとの衝突をappend前にrejectする修正は有効。
- `migratePersistedReviewHistoryFile`へ`expectedRepositoryId`を渡したdirect boundary testもGreen。
- same repository/monthの複数contextを許容するT207/R013 erratumは維持されている。

#### Remaining defect: startup owner identity is discarded for a valid owner root when preparation is `absent`

`migrateRepositoryStateRoot()`はmanifestの`repositoryId`を読み、`hashIdentifier(repositoryId) === rootName`まで検証している。この時点でrepository-style storage rootのowner identityは確立している。

しかしその後、synthetic targetで`preparePersistedReviewState()`を呼び、**戻り値が`"ready"`の時だけ**`repositoryId`を返している。`preparePersistedReviewState()`はmanifest/global/all referenced contextを検証した後、selected target contextが存在しなければ正しく`"absent"`を返す。

したがって例えば次の有効state rootで問題が残る。

1. hashed rootと一致する有効`repositoryId`のmanifestがある。
2. Global documentは有効。
3. `contexts: []`、またはstartup用synthetic targetに該当contextが無く、state preparationは`absent`。
4. 同rootのhistoryに別repository ownerのcanonical JSONLがある。

この場合`migrateRepositoryStateRoot()`は既にownerを検証済みなのに`undefined`を返す。後段`migrateHistoryRoot(rootPath, store, expectedRepositoryId)`はownerなしで履歴を検証し、内部的に一貫したwrong-owner historyをstartup時に隔離/resetできない。

現在のR3 integration fixtureは実contextをsaveしたrootなので`preparation === "ready"`しか通らず、このsiblingを検証していない。

#### Impact

T603のstartup corruption isolationとR013のstorage-owner integrityが、ownerは確定しているがselected contextがabsentなrepository rootで未完了。owner decisionの「内部不整合historyは隔離して1から再開」に反する。

#### Required action

- repository root hash/manifestでowner identityが確定した後は、selected contextの`ready/absent`とは分離して、その確定ownerをhistory migrationへ渡す。
- 少なくとも valid manifest + valid Global + absent/empty contexts + wrong-owner history fixtureをtest-firstで追加する。
- same-repository multi-contextは引き続き合法とする。

**Disposition: open. Severityはsource findingのmediumを維持。**

### T603-R015 — medium — **open / partial**

#### Addressed portion

前実装の「owner-wide uncertaintyが永続的にstickyでread-only reloadしても復元できない」問題自体は改善された。逐次testの valid → corrupt → hidden → repair → reload → getCurrent はGreen。

#### Remaining defect: uncertainty guard is cleared before cache refresh completes

`prepareTarget()`は`preparePersistedReviewState()`が`ready/absent`を返すと、`uncertainTargets`だけでなく`uncertainStorageRoots`もその場で削除する。

`load()`はその**後**に`await super.load(target)`を実行してlow-level/coherent cacheを更新する。

したがって、以前のcache Aを持つinstanceがcorruptionでroot uncertainになり、diskが新しいvalid state Bへ修復された場合、次のread-only `load()`では次の窓が生じる。

1. preflightがBをvalidと判定する。
2. `prepareTarget()`がroot uncertaintyをclearしてreturnする。
3. `super.load()`がBをcacheへ反映する前に別callerが`getCurrent()`を呼ぶ。
4. guardは既に消えているため、古いcached Aを返せる。

前回R015のrequired actionは「stale cacheを一瞬も露出せずroot uncertaintyを安全に解除する」ことを明示していた。現在の逐次regressionはこのconcurrent observation windowを検証していない。

#### Impact

R001で防いだ「不確実な期間の古いreviewed cache再露出」を、recoveryの短いwindowで再導入する。確認済み行がcurrent persisted stateより古い状態で一時的に見える可能性がある。

#### Required action

- owner-root uncertaintyは、new persisted snapshotがcacheへ反映されdownstream validationまで完了した後にのみ外部`getCurrent()`から解除する。
- coherent repository内のloadがoverride `getCurrent()`へ戻る事情を考慮し、内部load用snapshot取得と外部guardを分離する等、two-phase recovery boundaryにする。
- custom/gated store等で `prepare success` と `cache refresh` の間を停止し、その間の`getCurrent()`が`undefined`を維持するconcurrency regressionをtest-firstで追加する。
- sibling contextのowner-wide guardも同じ境界で確認する。

**Disposition: open. Severityはmediumを維持。**

### T603-R016 — medium — **open**

実装reportはreplacement handoffがuploaded `chat-handoff-manager` schema v3をliteral/losslessに満たすと記載している。しかしrepository上の実ファイル `handoffs/issue-1-t603-fix-followup-r3-20260816230716.yaml` はその条件を満たさない。

#### Concrete evidence

- 冒頭の`producer.generated_at`やfull SHA targetは改善されている。
- しかし`files.changed`の途中からschema外の`path_or_operation` / `reason` entryが混入する。schema v3の`files.changed`は`path` / `purpose`のみ。
- `files`配下にschema外の`forbidden`が出現する。
- top-level `scope` / `non_goals` / `files` blockとanchors `&id001` / `&id002` / `&id003`が何度も重複している。
- fileは1344行目で`write_boundary.allowed`の途中のまま終了しており、packet末尾に必要な`commands`、`tests`、`ci`、`implementation`、`review`、`report`、`findings`、`held`、`unexplored`、`unknown`、`not_applicable`、`remaining_risks`、`source_payloads`、`next_action`、`transport`を保持していない。
- uploaded Skillはtyped projectionだけでなく、producing core Skillのcomplete outputを`source_payloads`へ保持することを必須としている。

したがってR016の「replacement lossless schema-v3 handoffを生成する」は未達。implementation reportの「literalにfollow」「all present」「complete source payloads preserved」という記述も実fileと一致しない。

#### Impact

次workerはpacket単体からexact target、CI、findings、permissions、failure diagnostics、held/unexplored、next actionを安全に再構築できず、exact-head/review continuityを誤る可能性がある。

#### Required action

- handoffを**一度だけ存在するtop-level typed fields**から再生成する。
- `files.changed`は全entryを`path/purpose`、write boundariesは`write_boundary`だけへ置く。
- complete core Skill outputsを`source_payloads`へ入れる。
- strict YAML duplicate-key/duplicate-anchor checkとschema-v3 shape validationをcommit前に実行し、その検証自体をreportへ記録する。
- current implementation HEADとmatching CIをpacket targetへ記録し、handoff commit後のadministrative current HEAD/CIはPR comment等で別途記録する。

**Disposition: open. Severityはmediumを維持。**

## 5. Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement and design conformance | `checked_finding` | R013 startup owner gap、R015 fail-closed recovery window、R016 transport requirement。R006はclosed。 |
| correctness and edge cases | `checked_finding` | R013 absent-target owner root、R015 concurrent `getCurrent()` window。 |
| scope discipline / unrelated changes | `checked_no_finding` | 9-commit fix rangeは4 finding対応、tests/CI/report/handoffに限定。 |
| changed files and direct dependency impact | `checked_finding` | 9 changed pathsとstate/history/snapshot direct dependenciesを確認。R013/R015/R016。 |
| API/data/configuration/workflow/compatibility | `checked_finding` | startup history owner contractとhandoff schemaにR013/R016。workflow自体はnew suitesを実行。 |
| error handling and failure diagnostics | `checked_no_finding` | Red artifactsを実取得し、required diagnosticsを確認。compile failure artifactも存在。 |
| security / secret handling | `checked_no_finding` | 新規secret/source-body loggingなし。GitHub Actions tokenは通常のmask表示。 |
| tests and validation adequacy | `checked_finding` | R013 absent/empty-context owner case、R015 concurrent recovery、R016 strict packet validationが未coverage。 |
| current-HEAD CI evidence | `checked_no_finding` | `80f96d52...` exact run `31952470126` / job `95177960715` success。別SHA代用なし。 |
| report/tracking/documentation accuracy | `checked_finding` | R016。implementation reportのhandoff成功記述と実fileが不一致。tracking direct editなしはrepository rule準拠。 |
| regression / maintainability risks | `checked_finding` | R013 owner propagation、R015 two-phase recovery、R016 packet generator/validation。 |

## 6. Held / not applicable

### Held — T604 concurrency / cleanup

cross-process/window file lock、atomic history append、stale lock、backup/quarantine/snapshot retention/cleanupはT604 owner。R015は**同一instanceの外部observerへstale cacheを露出するrecovery lifecycle**なのでT604へ延期しない。

### Held — T606 generalized startup errors

I/O failure、retry、partial availability等の一般policyはT606 owner。R013はowner identityが既に確定したrootのhistory validation correctnessなのでT603 required findingのまま。

### Held — future schema v2 semantics

具体的v1→v2 transformはfuture task。現adjacent migration chain基盤はclosed済み。

### Not applicable

- independent-final-review attestation: required findingsが残るnormal fix verificationのためN/A。
- merge: user-owned。
- task/status direct edit: reviewer write boundary外。

## 7. Validation assessment / verdict

- Previous open findings reviewed: 4/4
- Closed in this round: **R006**
- Still open: **R013, R015, R016**
- New required findings: **0**
- Open severity: **medium 3件**
- Current exact-head CI: **success**
- Required coverage unexplored: **0**

### Verdict

**fail**

current CIはGreenだが、R013/R015/R016がrequired findingとして残るためpassできない。

## 8. Next action

1. implementation workerがR013/R015/R016を全て修正する。
2. R013はvalid owner manifest + absent/empty context + wrong-owner historyをtest-first Red化する。
3. R015はpreflight成功後〜cache refresh完了前に外部`getCurrent()`を呼ぶconcurrent regressionをtest-first Red化する。
4. R016はbehavior TDDではなく、uploaded schema-v3に対するstrict serialization/validationを行い、重複key/anchor・shape・source_payloads completenessをcommit前に検査する。
5. 新technical implementation HEADと完全一致するCIのみをGreen判定に使う。
6. implementation report + valid lossless handoffを保存し、final administrative current HEAD exact CIをPRへ記録する。
7. 同じnormal review chatで再度fix verificationする。
8. 全required finding closure後にのみfresh independent final reviewへ進む。
9. Mergeは実施しない。

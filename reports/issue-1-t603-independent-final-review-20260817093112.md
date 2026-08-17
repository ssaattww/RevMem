# Independent Final Review Report

## Review identity

- Review mode: `independent_final_review`（一度限りの full-scope pass）
- Reviewer: Codex sub-agent `/root/pr53_independent_review`、`gpt-5.6-sol` high。T603 の実装、通常レビュー、finding 修正、main integration のいずれにも参加していない。
- Reviewed implementation HEAD: `2cacd5ed8270c961ffb7271fab20365ed8095cff`
- Base / merge base: `8dd8aacbce3c0afb7a2d15091f970e96ec141561`
- Review range: `origin/main...2cacd5ed8270c961ffb7271fab20365ed8095cff`
- Branch / PR: `task/t603-schema-migration-recovery` / PR #53
- Reserved report path: `reports/issue-1-t603-independent-final-review-20260817093112.md`
- Review中のHEAD再確認: `2cacd5ed8270c961ffb7271fab20365ed8095cff` のまま不変。

本 technical verdict は上記 reviewed implementation HEAD にだけ適用する。本 report は finding を返す通常の repository file であり、passing report-attestation commit を許可するものではない。

## Scope and evidence

- Requirements/design: `tasks/tasks-status.md` T603 と AC-22〜24、`tasks/phases-status.md` P6、`doc/design/vscode-review-range-tracker-design.md` rev4（特に §5.5、§6.3、§7、§10.3.1、§13、§15.1〜15.4、§17〜21）、および `Design/BreakingChanges.md` の corrupt-history reset owner decision を確認した。
- Changed files/direct dependencies: 42 changed filesを全件読み、production 10 files、CI/BreakingChanges、9 test files、11 reports、10 handoffsを確認した。主要 direct dependencies として storage router、low-level/coherent repository、owner Global loader、repository context catalog、owner reconciliation validator、history codec/recorder、core state contracts、non-Git tracker、T405/T506 runtime composition/consumersを確認した。
- Prior review disposition: normal review `T603-R001`〜`R016` と owner decision `T603-B001` の履歴、修正report/handoff、R5 `pass_with_held` を独立に再照合した。既存findingの記録上のclosureは維持するが、本passで新規 `T603-IFR-001`〜`005` を検出した。
- Validation evidence: 新規test/CI実行はしていない。main integration reportのlocal evidence（build、compile:test、T603 focused Green）を確認した。current HEADと完全一致する GitHub Actions pull-request run `31982260546` / job `95251037412` は **failure**。Build、contract typecheck、architecture positive/negative、lint、unit、T602、T603、T403、T404はsuccess後、T405 stepで1件失敗し、T304以降（T506を含む）はskipped。duplicate push run `31982258386` は最終判定へ重複採用していない。
- Data/security/failure/concurrency/compatibility: schema chain、legacy forms、backup/rollback、quarantine/reset、manifest reference containment、symlink、atomic replace、Context/Global/history整合、monthly JSONL owner/month/event-ID、startup ordering、non-Git snapshot/latest pointer、same-process/cross-process境界、privacy、API/config/workflow、T405/T506 main integrationを確認した。

## Detailed coverage

- Schema versions / idempotency: adjacent migration chain、future-version rejection、malformed-version quarantine、manifest参照全件migrationは確認済み。repository contextのmissing nested schema compatibilityに `T603-IFR-003`。
- Quarantine / path safety: corrupt historyのwhole-file quarantine/reset、future historyのnon-reset、manifest exact subtree/hash形式、active removal via injected storeは確認済み。filesystem symlink containmentに `T603-IFR-002`、state semantic validationに `T603-IFR-004`。
- Atomic write / crash recovery: temp write、file sync、atomic rename、migration backup-first、publish failure rollbackは確認済み。同一processのmigration/write競合に `T603-IFR-001`。directory-entry durability、cross-window/process lock、stale lockはT604 held。
- Context / Global / history: owner-wide Global uncertainty、multi-context history、repository/month identity、existing/new event-ID重複、corrupt-history restartを確認した。current T405 integration fixtureはnew uniqueness contractと不整合で `T603-IFR-005`。
- Non-Git snapshots: wrapper/base64、gzip/hash/envelope、latest-pointer invalidation、startup metadata sweepを確認した。cross-process cleanup/retentionはT604 held。
- Startup: `t305-extension.activate()` がruntime composition前にmigrationをawaitする。repository owner validationとempty-context owner propagationも確認した。generalized retry/partial availability/user-facing diagnosticsはT606 held。
- Security/privacy/API/config/workflow: tokenやsource本文をdiagnostic logへ追加する変更はなく、snapshot/quarantineはlocal storageのまま。symlink境界のみrequired finding。CI diagnostic collection自体は成功したが、current-head required checkはfail。

## Criterion disposition

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirement and design conformance | `checked_finding` | IFR-001〜004。既存B001はBreakingChangesによりresolved。 |
| Correctness and edge cases | `checked_finding` | migration/write race、symlink traversal、legacy nested schema、semantic corruption。 |
| Scope discipline / unrelated changes | `checked_no_finding` | net diffはT603 persistence/recovery、required tests/CI、review artifacts、main integrationに限定。履歴上のplaceholder/no-opはnet treeに残らない。 |
| Changed files / direct dependencies | `checked_finding` | 42 changed filesと主要direct imports/consumersを確認しIFR-001〜005を検出。 |
| API / data / configuration / workflow / compatibility | `checked_finding` | IFR-003、IFR-004、IFR-005。async activationとBreakingChanges記録自体に追加findingなし。 |
| Error handling / failure diagnostics | `checked_finding` | IFR-004、IFR-005。current failure artifact collection/uploadはsuccess。 |
| Security / secret handling | `checked_finding` | IFR-002。secret追加なし。 |
| Tests / validation adequacy | `checked_finding` | IFR-001〜005の不足とcurrent-head T405 failure。 |
| Current-HEAD CI evidence | `checked_finding` | `2cacd5e...` pull-request run `31982260546` はfailure。 |
| Reports / tracking / documentation | `held` | reports/handoffs/BreakingChangesはchronologyを保持。`tasks-status`/`phases-status`のT603未着手表記はcallerが全PR統合後に行うadministrative progress-syncへownedされ、本reviewerは変更しない。 |
| Regression / maintainability risk | `checked_finding` | IFR-001、IFR-004、IFR-005。T604/T606/future-v2はheld。 |

## Findings

### T603-IFR-001 — high — migration-capable loadがsame-process write serializationを迂回し、newer stateを旧schemaへ巻き戻せる

- Origin: `introduced_by_change`
- Location: `src/adapters/state-repository/validated-file-system-review-state-repository.ts:70-93,131-180,246-325`、`src/adapters/state-repository/persistence-schema-recovery.ts:626-767`、`src/adapters/state-repository/persistence-schema-recovery.ts:545-577`
- Description: `load()` / `loadGlobal()` は `preparePersistedReviewState()` を shared storage-root write tailの外で実行する。一方 `preparePersistedReviewState()` はread-onlyではなく、backup作成、legacy document publish、quarantine/deleteを行う。`save`/`commit`/`create`だけが `sharedOuterWriteTailByStorageRoot` を通るため、同じExtension Host内のloadとwriteは直列化されない。
- Impact: gated loadがlegacy `workspace-state.json` またはrepository documentsを読み取った後に別instanceのsaveがnewer reviewed stateをcommitし、その後load側がstale migration結果またはrollback originalをpublishすると、newer Context/Global stateを失う。T604のcross-window/process lockではなく、現在実装が約束するsame-process owner consistencyの欠陥である。
- Evidence: `load()` line 78は直接`prepareTarget()`をawaitし、shared tailはline 142/206/237のmutating methodsだけで使用される。`publishSchemaMigration()`は再読/CASなしにline 558でactive pathを置換し、failure時もline 562〜565でoriginalを再publishする。current testsはwrite/write競合を扱うがmigration-load/write競合を固定していない。
- Required action: migration/quarantineを伴うpreparationとstate writeを同じprocess-wide storage-root ownerへ統合するか、publish直前のgeneration/CASでstale sourceを拒否する。workspaceおよびrepository-styleで、loadをmigration publish直前に停止→別instance save→load再開としてnewer Context/Global/manifestが失われない決定的regressionを追加する。

### T603-IFR-002 — high — scanned storage subtreeのsymlinkでquarantine/deleteがconfigured storage外へ到達する

- Origin: `introduced_by_change`
- Location: `src/adapters/persistence-startup-migration.ts:34-43,78-125,142-168`、`src/adapters/state-repository/persistence-schema-recovery.ts:493-516,527-542`、`src/adapters/state-repository/atomic-text-file-store.ts:45-51`
- Description: startup scanとmanifest reference検査は`path.resolve()`によるlexical containmentだけで、repository hash root、`history`、`snapshots`、referenced documentのsymlink/junctionを`lstat`/`realpath`で拒否しない。`repositories/<64hex>`自体が外部directoryへのsymlinkの場合、`manifest.json`、history、snapshotのread/write/deleteは外部target内で実行される。
- Impact: crafted persistence treeにより、corruption recoveryがVS Code extension storage外の同名fileをquarantine先へcopyし、`deleteText()`でactive external fileを削除できる。これは単なるinvalid stateのfail-closedではなく、configured storage ownership boundary外のdata loss/privacy leakである。
- Evidence: root namesはregexだけで採用され、`readdir()`結果のfile typeを確認しない。`resolveReferencedFile()`はreal pathを検証せず、`quarantinePersistedText()`はdestination write後に受け取ったpathをそのままdeleteする。directory symlink配下のchild pathでは`rm(child)`がexternal childへ作用する。
- Required action: scanned roots/subdirectories/filesをno-follow policyで検証し、trusted configured rootのreal path配下であることを各mutation直前にも保証する。root/history/snapshot/reference symlinkまたはjunction fixturesで、outside sentinelがread-copy・rewrite・deleteされず、safe failureになるregressionを追加する。

### T603-IFR-003 — medium — repository-style v0 contextだけmissing nested file schemaをlegacyとして受理できない

- Origin: `introduced_by_change`
- Location: `src/adapters/state-repository/persistence-schema-recovery.ts:172-196,205-229,273-287`
- Description: v0 workspace wrapperはroot sourceVersion 0を`legacyNestedVersion = 0`としてcontext/global nested documentへ渡すが、manifestから独立に読んだv0 `Context state` は `migrateContextRecord(parsed, documentName)` と呼ばれ、同じabsent nested versionを渡さない。そのためrootが明示v0でnested fileに`schemaVersion`がないlegacy formはworkspaceなら0→1 migrationされる一方、repository contextではcorruption扱いでquarantineされる。
- Impact: storage routeだけで同一legacy state shapeのcompatibilityが変わり、Git/PR repositoryの有効なreviewed evidenceを段階移行せず失う。T603の旧schema fixture段階移行条件をroute-consistentに満たさない。
- Evidence: workspace pathはline 209〜219でabsent nested v0を明示するが、standalone context branchはline 284〜285で省略する。repository legacy testsはnested versionをすべて明示0にしており、このformを検査しない。
- Required action: context rootのsource versionからnested absence policyを一貫して決め、workspace/repository双方のaccepted v0 formsを同じfixture matrixでmigration・backup・idempotency検証する。missingがacceptedでないならworkspaceだけ補完する既存behaviorを廃止し、format contractを明記する。

### T603-IFR-004 — medium — preparation validatorがpersisted stateの全semantic invariantsを所有せず、corrupt active documentを隔離できない

- Origin: `introduced_by_change`
- Location: `src/adapters/state-repository/persistence-schema-recovery.ts:317-448,626-767`、`src/adapters/state-repository/validated-file-system-review-state-repository.ts:70-92`、`src/adapters/state-repository/owner-reconciliation-validation.ts:1-118`
- Description: `validateContextDocument()`はoptional `ownerReconciliation`を検証せず、current/previous pathのcanonical性・previous path uniqueness/current exclusion・context内current-path uniquenessも検証しない。`validateGlobalDocument()`もcurrent-path uniquenessを検証しない。owner reconciliationはpreparation完了後の`validated load()`で別途検証されるため、invalid documentはuncertainになるだけでactive pathに残り、次回も同じfailureを繰り返す。duplicate/path corruptionはさらに下流consumerまで到達する。
- Impact: T603の「JSON破損検出・隔離・回復」が一部のcurrent-schema semantic corruptionで働かない。reviewed evidenceはfail-closedになる経路もあるが、permanent activation/runtime failureやdownstream identity conflictを繰り返し、migration済みactive corrupt fileを残す。
- Evidence: preparation validatorのcontext loopはfile basic fieldsだけを確認し、`ownerReconciliation`へ触れない。`load()` line 85のdownstream validation failure catchはrootをuncertainにするだけでquarantineしない。既存R001 testもこのcaseでは`getCurrent() === undefined`だけを確認し、active document removal/quarantine/recoveryを確認していない。
- Required action: persisted stateのauthoritative semantic validatorを一箇所に統合し、migration publish前かつload exposure前に全schema-v1 invariantsを検証する。invalid owner reconciliation、duplicate current path、non-canonical/dot-parent path、previousPaths invariantのfixturesでactive corrupt evidenceが保持付きquarantineされ、reviewed rangesが露出せず、repair後にrecoverできることを固定する。

### T603-IFR-005 — medium — current main integration後の必須CIがT405 history fixtureで失敗する

- Origin: `introduced_by_integration`
- Location: `test/unit/t405-composition-regression.test.ts:303-307`、`src/adapters/state-repository/jsonl-review-history-store.ts:175-211`、`.github/workflows/ci.yml:37-49`
- Description: T603はmonthly owner history内のevent ID一意性を正しく強制するが、mainから統合したT405 production-composition regressionは`createEventId: () => "t405-composition-event"`を複数eventへ再利用する。current-head pull-request CIはredetect command中の2件目appendを`Review history eventId must be unique`でrejectして失敗した。
- Impact: PR #53のrequired checkはfailureでmerge gateを満たさず、その地点より後のT304/T502/T503/T504/T505/T506/integration/Extension Host stepsもcurrent HEADでは未完了。T405/T506 current-main integrationのGreenを主張できない。
- Evidence: exact-head run `31982260546` / job `95251037412`。30/31 T405 tests pass、`R405-1/R405-2/R405-3/R405-7 execute the T405 production composition seam`だけがduplicate event IDでfail。T603 focused step自体は先にsuccess。
- Required action: T405 fixtureのevent ID factoryを決定的かつ呼出ごとにuniqueにし、current HEADのpull-request CIを再実行して全後続stepを含むsuccessを確認する。productionのuniqueness checkを弱めてはならない。

## Held and unexplored

- Held:
  - T604: cross-window/process lock、stale lock、directory-entry durability、atomic history appendのprocess境界、backup/quarantine/snapshot cleanup・retention。
  - T606: generalized startup/storage I/O retry、partial availability、user-facing privacy-safe diagnostics。
  - Future schema task: concrete v1→v2 semantic transform。adjacent chain foundationだけを現在確認した。
  - Administrative tracking sync: T603/T506等の実態を全PR merge後に`progress-sync-manager`で同期するcaller-owned作業。
- Unexplored: なし。全required criterion、42 changed files、主要direct dependenciesを本一巡でdispositionした。current-head CIでskippedされた後続suiteは未探索扱いではなく、IFR-005の未完了validation evidenceとしてfail判定へ含めた。
- Intentionally untouched: implementation、tests、design、workflow、tracking、handoffs、PR metadata、Git history。予約report以外は変更していない。

## Verdict

- Technical verdict: `fail`
- Required findings: 5件（high 2、medium 3）
- Report attestation allowed: `false`
- Remaining risks: T604/T606/future schemaのheld項目に加え、current-head CIはT405で停止したため後続T506/Extension Hostまでの統合Greenがない。
- Next action: implementation workerがIFR-001〜005を一括修正し、focused regressionをローカルで一度実行する。その後、同じindependent reviewer continuityでfinding-limited closureだけを行い、passing時にのみ新しいreviewed implementation HEADをfreezeする。
- Merge boundary: 本reviewerはcommit/push/mergeを行っていない。現HEADのmergeは不可。

Passing report-attestationの条件（将来のclosureがpassした場合のみ）: 新たにfreezeしたreviewed implementation HEAD直後の1 commitで事前予約reportだけを追加し、first parent一致・他pathなし・後続commitなしをcallerが確認すること。technical verdictはreviewed implementation HEADにのみ属し、attestation SHAは外部へ記録すること。

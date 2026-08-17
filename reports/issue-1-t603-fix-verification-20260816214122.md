# T603 fix verification レポート

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: #53 `T603 schema migration・破損隔離・回復`
- Review mode: `fix_verification`（同一normal review lineage）
- Branch: `task/t603-schema-migration-recovery`
- Base: `main` (`146aec15783294da1795f268315c85d1a0dffa56`)
- Source review artifact HEAD: `8a4f79eaa46f3fc98bf71bc3ee6ea588ae21e6e7`
- Reviewed implementation HEAD: `56b7b7de4eb4377eca501549268a7d15a7caf127`
- Fix range: `8a4f79eaa46f3fc98bf71bc3ee6ea588ae21e6e7..56b7b7de4eb4377eca501549268a7d15a7caf127`
- Fix-range commits: 21
- Reviewer: ChatGPT T603 normal reviewer（前回R2と同一chat）
- Verdict: **fail**
- Generated at: `2026-08-16T21:41:22+09:00`

このverificationでは、R2で確定した `T603-R001`〜`T603-R014` のidentity/severityを維持し、各findingの修正をcurrent HEADで個別確認した。修正差分と同defect classのsiblingを再走査し、新規finding `T603-R015`、`T603-R016` を追加した。

本reviewerはT603実装、R2 finding修正、owner-decision実装のいずれも行っていない。実装・test・design・workflow・task trackingは変更していない。mergeも行っていない。

## 2. Authority / scope

### 2.1 T603終了条件

`tasks/tasks-status.md` のT603は、schema migration chain、migration前backup、JSON/JSONL/snapshot破損検出・隔離・回復、migration失敗時rollback、不確実な範囲の未確認化を要求する。設計rev4 §15.3は全保存modelの段階migrationと破損data隔離を要求する。

### 2.2 T603-B001 owner decision

R2時点の `T603-B001` は、taskの「回復」とrev4 §15.4の「corrupt JSONLではappendせずreject」のauthority conflictだった。

利用者はその後、次の方針を明示した。

> 壊れたら、履歴は1からで良いよ。ただし、壊れたやつは隔離して捨てないこと

このuser instructionはrepository designより上位のauthorityである。current implementationは、corrupt monthly JSONL全体をquarantineへ保持し、active pathから除去し、salvageせず次のvalid eventを1件目として履歴を再開する。startupで検出した場合は次eventまでactive historyを持たない。future unsupported schemaはresetしない。

`Design/BreakingChanges.md` にこのowner decisionがrev4 §15.4をsupersedeすることも記録されている。したがって **T603-B001はresolved by owner**、R008の旧design conflictもこの新authorityに対してclosure判定する。

## 3. Fix diff / inspected impact

R2 review artifact HEADからcurrent implementation HEADまでの21 commitで変更された20 pathを全て確認した。

- `.github/workflows/ci.yml`
- `Design/BreakingChanges.md`
- `handoffs/issue-1-t603-history-reset-followup-20260816.yaml`
- `handoffs/issue-1-t603-review-followup-20260816.yaml`
- `reports/issue-1-t603-history-reset-followup-20260816.md`
- `reports/issue-1-t603-review-followup-20260816.md`
- `src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts`
- `src/adapters/persistence-startup-migration.ts`
- `src/adapters/state-repository/atomic-text-file-store.ts`
- `src/adapters/state-repository/contracts.ts`
- `src/adapters/state-repository/jsonl-review-history-store.ts`
- `src/adapters/state-repository/persistence-schema-recovery.ts`
- `src/adapters/state-repository/validated-file-system-review-state-repository.ts`
- `src/application/non-git-snapshots/index.ts`
- `src/t305-extension.ts`
- `test/unit/review-history-jsonl-store.test.ts`
- `test/unit/t603-history-multi-context-regression.test.ts`
- `test/unit/t603-history-reset-decision.test.ts`
- `test/unit/t603-review-findings.test.ts`
- `test/unit/t603-schema-migration-recovery.test.ts`

直接依存・consumerとして、coherent/low-level state repository、owner-global loader、owner reconciliation validator、storage router、history codec/recorder、snapshot tracker/workspace consumer、runtime activation、task/design/AGENTS/BreakingChanges、CI/package wiring、previous reports/handoffs/PR commentsも再確認した。

`unexplored`: **なし**。

## 4. TDD / diagnostics / exact-head CI

### 4.1 Comprehensive review-fix Red

- HEAD: `1803fd389971230a582c6ef2c555611798cf387f`
- Exact-head run: `31933261892`
- Job: `95131183615`
- Result: **failure**
- T603 focused: 29 tests / 12 pass / 17 fail
- Artifact: `9259902656` (`ci-failure-diagnostics-31933261892-1`)

artifactを実取得して確認した。`test-output/ci/test-t603.log`、build/typecheck/architecture/lint/unit logs、environment、Git status、generated-file inventory、`src/`、`test/`、`dist/`、`test-dist/`等が含まれる。R001〜R006、R008〜R010、R013、R014の新regressionが実装前にfailureしている。

### 4.2 R013 sibling Red

最初のR013修正がrepository-scoped monthly historyをsingle-contextへ過剰制限し、既存T207 integrationを壊した。その後test-first sibling regressionを追加している。

- HEAD: `b55c18098734d09a1ad3762cf11d77343365281c`
- Exact-head run: `31940277506`
- Job: `95148328727`
- Result: **failure**
- Artifact: `9261824947` (`ci-failure-diagnostics-31940277506-1`)

この証拠により、同一repository/month内の複数contextは合法であることをR013 continuityへerratumとして反映する。finding identity/severityは変更しない。

### 4.3 Owner-decision Red

- HEAD: `d1dbe39c574fbe2bda683b466950c8777ff411a3`
- Exact-head run: `31941969296`
- Job: `95152361908`
- Result: **failure**
- Artifact: `9262264629` (`ci-failure-diagnostics-31941969296-1`)

artifactを実取得した。T603 logは32 tests / 29 pass / 3 failで、新しい「quarantine後に履歴を1から再開」「startup corruption reset」の期待だけがRedになっている。Build / contract typecheck / architecture / lint / unit / T602は先にsuccessし、failure context/uploadもsuccessした。stdout/stderr統合logと調査用source/test/generated/config contextも保持されている。

### 4.4 Current reviewed implementation HEAD

Reviewed implementation HEAD `56b7b7de4eb4377eca501549268a7d15a7caf127` と**完全一致**するrunだけをcurrent CIとして採用した。

- Run: `31942897772`
- Job: `95154522013`
- `head_sha`: `56b7b7de4eb4377eca501549268a7d15a7caf127`
- Conclusion: **success**
- Build: success
- Contract typecheck: success
- Architecture positive / negative: success
- Lint: success
- Unit: success
- T602: success
- T603: success
- T403/T404/T304/T502/T503/T504/T505: success
- Temporary Git（T207含む）: success
- Mock GitHub: success
- VS Code Extension Host: success

別SHAのrunは代用していない。

## 5. Source finding verification

| Finding | Severity | Verification | Evidence summary |
| --- | --- | --- | --- |
| T603-R001 | high | **closed** | deep current-schema validation、downstream failure時のfail-closed、owner-wide root uncertaintyによるstale reviewed cache遮断を確認。ただし修正由来のread-only recovery defectをR015として分離。 |
| T603-R002 | high | **closed** | historical migration stepはliteral target versionを出し、adjacent targetをinjectした0→1→2 regressionがRed→Green。 |
| T603-R003 | medium | **closed** | repository preparationはmanifest参照context全件をmigration/validateしてからadvanced manifestをpublish。target absent fixtureも存在。 |
| T603-R004 | medium | **closed** | nested modelのversionを個別migrationし、future nested schemaをdowngradeせずunsupportedとして保持/reject。 |
| T603-R005 | medium | **closed** | malformed schema metadataはcorruption、valid future integerだけunsupported。snapshot explicit nullもlegacy missing扱いしない。 |
| T603-R006 | medium | **open** | gzip/hash/envelope corruptionは修正されたが、wrapper/invalid-base64 corruptionがlatest pointerを残す経路が残存。詳細は§6.1。 |
| T603-R007 | medium | **closed** | historical誤IDはfollow-up reportのauthoritative erratumで訂正し、PR current body/commentも実GitHub値へ同期。latest handoffのschema/losslessness欠陥は別のR016。 |
| T603-R008 | medium | **closed by authoritative requirement change** | owner decisionで旧rev4 §15.4をsupersedeし、BreakingChangesへ明記。current behaviorは新owner policyに一致。severity historyは変更しない。 |
| T603-R009 | high | **closed** | canonical subtree/reference validationとmanifest-side quarantineによりvalid sibling/global childを破壊しないtestを確認。 |
| T603-R010 | medium | **closed** | startup migrationがstate、historical history、snapshot entries/latestをeager sweepし、activation前に実行。 |
| T603-R011 | medium | **closed** | current T603 CIがJSONL store、schema recovery、multi-context、owner-decision suiteと非superseded review regressionsを実行。 |
| T603-R012 | medium | **closed** | comprehensive review-fix Red、R013 sibling Red、owner-decision Redをexact-headで確認し、failure diagnosticsも存在。 |
| T603-R013 | medium | **open** | repository/month/duplicate-existing検査は追加されたが、新eventとのeventId衝突とstartup owner検査が残存。詳細は§6.2。 |
| T603-R014 | low | **closed** | `AtomicTextFileStore.deleteText`境界を追加しquarantine removalを同一storeへ統一。virtual-store regressionあり。 |

### R013 continuity erratum

R2 reportはR013 required actionに「wrong-context」を含めたが、repository storageのmonthly historyは同一repository内の複数branch/context eventを共有する既存contractであり、T207 integrationもその前提を持つ。これはseverity reclassificationではなく**requirement transcription erratum**である。

R013の正しいowner identity boundaryはrepository scopeであり、context IDは複数を許容する。一方、eventId uniqueness、filename month、repository owner consistency、新規append eventのtarget identityは引き続き必要である。

## 6. Open required findings

### T603-R006 — medium — wrapper/base64 snapshot corruptionでauthoritative latest pointerが残る

- Origin: `introduced_by_change`（source finding継続）
- Location:
  - `src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts`: `get`, `quarantine`
  - `src/application/non-git-snapshots/index.ts`: `NonGitSnapshotTracker.read`
- Description:
  - `NodeNonGitSnapshotStorage.get()` はmalformed wrapper、invalid `createdAt`/`bytes`、invalid base64を検出するとsnapshot entry自体を`quarantinePersistedText`で隔離・削除し、`undefined`を返す。
  - `NonGitSnapshotTracker.read()` は`storage.get()`が`undefined`なら単に`missing`を返し、`storage.quarantine(snapshotId)`を呼ばない。
  - latest pointerを走査して同snapshot IDをquarantineする処理は`NodeNonGitSnapshotStorage.quarantine()`にしか無く、decompress/hash/envelope corruption時だけtrackerから呼ばれる。
  - startup `migratePersistedMetadata()`もentryを`get()`で隔離した後、latest pointer自体のshapeは読むが、そのsnapshot IDのentry存在性を検証しない。
- Impact: wrapper/base64 corruptionを隔離した後もauthoritative latest pointerがactiveに残り、再起動・再読込ごとに同じ消失snapshot IDを指す。reviewed range自体はfail-closedだが、T603のsnapshot corruption isolation/recoveryとlatest-pointer consistencyが未完了。
- Evidence: current R006 testsはgzip/hash/envelope corruption + latest invalidationを固定するが、invalid wrapper/base64 + valid latest pointerを固定していない。
- Required action:
  - snapshot entryのwrapper/base64 corruptionでも、そのentryを指すlatest pointerを必ずquarantine/invalidateする。
  - direct readとstartup migrationの双方について、valid latest pointer + malformed wrapper / invalid base64 fixtureを追加する。

### T603-R013 — medium — history integrity validationがnew event衝突とstartup ownerを取り切れていない

- Origin: `introduced_by_change`（source finding継続）
- Location:
  - `src/adapters/state-repository/jsonl-review-history-store.ts`: `prepareExistingHistory`, `append`, `migratePersistedReviewHistoryFile`
  - `src/adapters/persistence-startup-migration.ts`: `migrateHistoryRoot`
- Description:
  - `prepareExistingHistory`の`eventIds`は**existing lines同士**のduplicateしか検出しない。`append()`はnew eventをserializeした後、new `event.eventId`がexisting setと衝突するか比較せず、そのままappendする。
  - そのためvalid active historyに`eventId="same"`が1件あり、新eventも`eventId="same"`ならduplicate IDを生成できる。
  - owner-decisionによりwrong-owner existing historyはcorruptionとしてresetすべきだが、startup `migratePersistedReviewHistoryFile(store, filePath)` はexpected repository ownerを受け取らない。`migrateHistoryRoot`もrootのrepository identityを渡さない。
  - よってrepository Aのhistory directoryに、内部的にはrepository Bで一貫したlegacy/current JSONLが置かれた場合、startup sweepではwrong-ownerを検出せず`ready`/migration publishできる。後のappend時には検出できるが「起動時の破損隔離」は未達。
- Impact: eventId uniquenessとstartup corruption recoveryのaudit integrityが不完全。owner decision後の「内部不整合historyを隔離して1から再開」にも反する。
- Evidence: owner-decision suiteはwrong owner/wrong month/duplicate **existing history** をappend時にresetするが、existing-vs-new ID collisionとstartup wrong-ownerを検証しない。
- Required action:
  - prepared historyのevent IDsとnew event IDを比較してduplicate appendをcorruption/rejection policyに従って処理する。
  - startup history migrationへexpected repository ownerを渡し、wrong-owner fileをowner policyに従いquarantine/resetする。
  - same-repository multi-contextは引き続き許容する。

### T603-R015 — medium — owner-wide uncertaintyがread-only recovery後もstickyになり状態を復元できない

- Origin: `introduced_by_fix`
- Location:
  - `src/adapters/state-repository/validated-file-system-review-state-repository.ts`: `load`, `loadGlobal`, `prepareTarget`, `markUncertain`
  - direct dependency `coherent-file-system-review-state-repository.ts`: `load` → virtual `getCurrent`
- Description:
  - R001修正で`uncertainStorageRoots`が追加され、downstream validation failure時にstorage root全体をuncertain化する。これはstale reviewed Globalを隠す点では正しい。
  - しかし`prepareTarget()`が後のretryで`ready`/`absent`になっても削除するのは`uncertainTargets`だけで、`uncertainStorageRoots`は残る。
  - `load()`はその後`super.load(target)`を呼ぶ。coherent repositoryの`load()`はdisk load成功後に`this.getCurrent(target)`を呼ぶため、dynamic dispatchでoverrideされた`getCurrent()`へ戻り、まだrootがuncertainなので`undefined`になる。
  - 結果、disk dataを正常に修復してread-only `load()`を再試行してもroot flagを解除できない。`loadGlobal()`も成功後にroot flagをclearしない。現在root uncertaintyをclearするのは`save`/`commit`/`create`成功時だけ。
- Impact: false-reviewed exposureは防げるが、T603の「回復」がread-only pathで成立せず、修復済みreview stateがExtension Host lifetime中ずっと未確認に見える可能性がある。
- Required action:
  - complete persisted stateとdownstream validationの成功を確認した時点で、stale cacheを一瞬も露出せずroot uncertaintyを安全に解除できるload boundaryへ整理する。
  - valid load → downstream-only corruption → failure/hidden → persisted data repair → read-only reload成功 → `getCurrent()`復元、ならびにsibling contextのowner-wide recovery testを追加する。

### T603-R016 — medium — implementation follow-up handoffがschema-v3/lossless contractを満たさない

- Origin: `introduced_by_fix`
- Location:
  - `handoffs/issue-1-t603-review-followup-20260816.yaml`
  - `handoffs/issue-1-t603-history-reset-followup-20260816.yaml`
- Description:
  - uploaded `chat-handoff-manager` schema v3は`producer.generated_at`、full-SHA `target.current_head/reviewed_head/commit_range`、typed `validation_plan`/`blocked`/`authorized_actions`/write boundary/scope/files/commands/tests/ci/implementation/review/report/findings/held/unexplored/unknown/not-applicable/next_action/transportを要求する。
  - producing core Skillの**complete versioned output**を`source_payloads`へlosslessに保存することも必須。
  - latest owner-decision handoffは`generated_date`を使い、`target.current_head: post_report_commit_recorded_in_pr`という非schema値を持つ。多くのtyped required fieldsを独自shapeへ置き換え、`source_payloads`も存在しない。
  - earlier review-followup handoffも同じくtyped projection/source payloadを満たさない。
- Impact: next workerがhandoff単体からexact target HEAD、matching CI、finding continuity、write permissions、blocked/held/unknown、failure diagnostics、complete implementation/report evidenceを再構築できず、exact-head CIやreview lifecycleを誤る可能性がある。
- Required action:
  - uploaded `chat-handoff-manager`をliteralに適用したschema-version 3 packetを再生成する。
  - final implementation HEADとmatching CIをtyped projectionへ記録し、`work-context-manager`、`implementation-worker`、`report-writer`、`chat-implementation-worker`のcomplete outputsを`source_payloads`へ保持する。
  - R006/R013/R015/R016修正後のreport/PR comment referenceも含め、handoff commit後に新current HEADのexact-head CIを再確認する。

## 7. Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement and design conformance | `checked_finding` | R006、R013、R015。B001はowner decisionでresolved、R008は新authorityに適合。 |
| correctness and edge cases | `checked_finding` | R006、R013、R015。 |
| scope discipline / unrelated changes | `checked_no_finding` | 21-commit fix rangeはT603 persistence/history/snapshot、regression/CI、owner decision、required reports/handoffsに限定。placeholder no-opはnet treeに残らない。 |
| changed files and direct dependency impact | `checked_finding` | fix-range20 pathとstate/history/snapshot/runtime direct dependenciesを確認。R006/R013/R015。 |
| API / data / configuration / workflow / compatibility | `checked_finding` | history/snapshot persistence contractとhandoff transportにR006/R013/R016。CI wiring自体は適合。 |
| error handling and failure diagnostics | `checked_finding` | R006/R015。Red artifactsは必要log/contextを保持。 |
| security / secret handling | `checked_no_finding` | token/source本文を新規診断logへ追加する変更なし。quarantine removalはinjected storeへ統一済み。 |
| tests and validation adequacy | `checked_finding` | current exact-head CIはgreenだがR006/R013/R015/R016の残存caseが未試験。TDD Red/diagnostics policy自体は確認済み。 |
| current-HEAD CI evidence | `checked_no_finding` | `56b7b7de...` = run `31942897772` / job `95154522013`, success。別SHA代用なし。 |
| report / tracking / documentation accuracy | `checked_finding` | R016。R007 erratumとBreakingChanges owner decision記録は正確。tracking direct editなしはrepository rule準拠。 |
| regression / maintainability risks | `checked_finding` | R015 sticky root state、R013 startup/identity validation、R016 transport contract。 |

`unexplored`: **なし**。

## 8. Held / not applicable

### Held — T604 concurrency and cleanup

cross-window/process lock、stale lock、atomic history append、backup/quarantine/snapshot cleanup・retentionはT604 owner。T603のsingle-process correctness findingsとは分離する。

### Held — T606 generalized error policy

startup migration中に1 ownerがI/O/future-schema failureした場合のextension-wide retry/partial availability policy、容量不足等はT606 owner。今回のR006/R013/R015のspecific corruption/recovery correctnessはT603でclosureが必要。

### Held — future schema v2 semantic transform

具体的v1→v2 field semanticsはfuture schema task。R002のadjacent-chain基盤はclosed済み。

### Not applicable

- independent-final attestation: 本roundはnormal fix verification。
- merge: user-owned action。
- task tracking direct edit: repository update ruleによりreviewer write boundary外。

## 9. Validation assessment / verdict

- Source findings closed: **12 / 14**
- Source findings open: **2 / 14** — R006 medium、R013 medium
- New findings: **2** — R015 medium、R016 medium
- B001: **resolved by owner**
- Current exact-head CI: **success**
- Required coverage unexplored: **0**

### Verdict

**fail**

open required findingsが4件あるためpassできない。現在のopen severityは**medium 4件**で、high findingは全てclosureを確認した。

## 10. 次の作業

1. implementation workerが `T603-R006`、`T603-R013`、`T603-R015`、`T603-R016` を全て修正する。
2. behavior findings R006/R013/R015はregression testを先に追加し、exact-head Redを確認してから実装する。
3. R016はuploaded `chat-handoff-manager` schema v3に従い、fix implementation/report後のlossless packetを生成する。
4. 新implementation HEADに一致するworkflow runのみでCIを判定する。
5. 同じnormal review chatで次のfix verificationを行う。全required finding closure後にのみ独立最終reviewへ進む。
6. Mergeは利用者が行うためworkerはmergeしない。

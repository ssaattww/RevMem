# T604 normal finding closure R2 report

## タスク

T604 / Issue #72 / PR #73 の同一normal reviewerによるfinding-limited closure R2。source normal review、R1 closure、R2 follow-upをauthorityとし、既存T604-R001〜R009だけをfix HEADで各`closed/open`判定した。

- branch: `task/t604-storage-lock-cleanup`
- technical fix: `f1cb025e3008bb861ac6c673831a3c7b2d8e30e8`
- reviewed HEAD: `fbc8216de1ed00e37bd7d03efc91f0b0797a62e3`
- source report: `reports/issue-72-t604-normal-review-20260820105630.md`
- R1 closure: `reports/issue-72-t604-normal-finding-closure-20260820111448.md`
- R2 follow-up: `reports/issue-72-t604-normal-review-followup-r2-20260820111829.md`
- verdict: `fail`

技術判定はfix sourceと提供済みlocal evidenceへ適用する。実装、tracking、test、CI、commit、push、PR操作は行っていない。

## sub-agentを使う理由

source normal reviewer自身が同じfinding lineageのR2 closureを担当した。利用者の指示に従い、追加sub-agentは使用していない。

## 対象範囲

T604-R001〜R009のsource description、evidence、required actionとR1 remaining closure conditionだけを各`closed/open`で判定した。`a256b49..f1cb025`のtechnical fix、`f1cb025..fbc8216`のadministrative handoff、変更された直接箇所、同じdefect class用に追加・配線されたtest、R2 follow-upのlocal evidenceを確認した。

新規観点、新規finding、source scope外のsibling探索、severity reclassificationは行っていない。open判定では同じfindingの未達条件だけを具体化した。exact-head CIは利用者方針どおりmerge直前の外部gateとして技術closureから分離した。

## 対象外

T604-R001〜R009以外の実装品質探索、T605以降、独立final review、実装・test・workflow・design・tracking・handoff修正、test / CIの起動・再実行・待機、commit、push、PR / Issue / review操作、mergeである。

## 実行コマンド

reviewerは`git rev-parse`、`git status`、`git log / show / diff / --stat / --check`、`rg`、`Get-Content`だけを用いたread-only inspectionを実施した。test、build、lint、CIは起動・再実行・待機していない。

R2 follow-up由来のlocal evidenceは`npm run test:t604`のT604 13件とT506 custom-store 2件、計15 / 15 pass、`npm run build`、`npm run compile:test`、`npm run typecheck:contracts`、`npm run lint`、architecture正負、`git diff --check`成功である。本reviewerは再実行していない。

Markdown wording checkは`tools/lint/`、focused wiring、`lint:md`不在のためfocused / full / aggregateとも`unsupported`。passへ変換せずheldを維持する。

## 対象ファイル

finding closureへ直接対応する次のfix filesとevidenceを確認した。

- R001 / R002 / R006: `src/adapters/state-repository/storage-root-lock.ts`、contracts、index、state / history composition、T604 child-process / fault fixtures、T506 custom-store regression。
- R003: `src/adapters/state-repository/atomic-text-file-store.ts`、history、snapshot、cache mutation path、symlink / junction sentinel fixture。
- R004: `src/adapters/persistence-startup-migration.ts`、snapshot metadata migration、production activation。
- R005: `src/application/non-git-snapshots/index.ts`、`src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts`、active pointer / byte cleanup fixture。
- R007: `test/unit/t604-storage-lock-cleanup.test.ts`、`package.json`、`.github/workflows/ci.yml`、T506 integration test。
- R008: operation feedback、startup / state / history / cache / snapshot options、extension / T405 composition。
- R009: design §15.4、handoff、tasks、phases、R2 follow-up report。

## 指摘事項

### T604-R001 — High — `open`

- source severity: `High`（preserved）
- verified progress: acquire boundはmonotonic sourceへ移り、renew / releaseは取得済みdescriptorへ作用し、successor pathを直接truncate / deleteしない。operation前後と一部publication直前に`assertOwned`が追加され、detached ownerをfail closedにする型も導入された。
- remaining closure condition: `assertOwned`はlock pathのtoken readとdescriptor statを順次確認するだけで、後続のstate / history / snapshot / cache mutationとはatomicではない。確認直後にrecoveryがowner inodeをdetachすると、旧ownerはその後のpublicationを完了できる。追加fixtureもfirst ownerを明示releaseした後にsuccessorを取得して`assertOwned`する逐次caseであり、release-vs-reacquire、renew-vs-recovery、複数recoverer、renew failure、publicationとのdeterministic interleavingを固定していない。
- required for closure: source required actionどおり、ownership generationの確認とpublicationの間にsuccessor acquisitionを許さないfence、またはsuccessorが旧publicationを受理しない同等protocolを実装し、列挙済みinterleavingでlost lease後のpublicationが起きないことを固定する。

### T604-R002 — High — `open`

- source severity: `High`（preserved）
- verified progress: write / sync / close fault seam、古いmalformed lock、完全取得後にkillしたchild processのexpiry前拒否とexpiry後回復が追加され、local 15 / 15 evidenceに含まれる。
- remaining closure condition: lockは引き続き`wx`でvisible pathを作成して同じfileへ直接writeする。acquire failure cleanupは`created`だけを条件に現在の`lockPath`を無条件`rm`するため、fault処理がleaseをまたぎrecovery / successor取得と競合した場合のowner-safe cleanupになっていない。process kill fixtureは完全取得後のkillで、zero-byte / truncated publication中kill、fresh malformed / future-invalid、遅延したwrite / sync / close failureとsuccessorの競合を固定しない。
- required for closure: partial publisherのcleanupをsuccessor-safeにし、sourceに列挙したzero / truncated / malformed / future-invalidとpublication途中kill、write / sync / close failureをdeterministicに作り、live ownerを奪わずrootをboundedに再利用できることを固定する。

### T604-R003 — High — `open`

- source severity: `High`（preserved）
- verified progress: default Node atomic storeへroot指定を追加し、history / snapshot / cache / startupのmutation guardを拡大した。静的symlinkまたはWindows junctionを通すsnapshot putが失敗し、外部sentinelが不変なfixtureも追加された。
- remaining closure condition: `physicalPath`はancestorの`lstat`とdirectoryの`realpath`を終えた後、別operationで`open` / `rename` / `rm`するため、source findingの検査後swap TOCTOUが残る。directory handleまたは同等のroot-fenced primitiveでmutationを結び付けておらず、追加fixtureも既存link 1 caseだけでswap raceとその他reparse種別を固定しない。
- required for closure: source required actionどおり、検査対象directoryをmutationまでowner-boundに保持するroot-fenced primitiveへ全Node write / delete / renameを通し、Windows reparse / junction、POSIX symlink、検査後swapでroot外sentinelが不変であることを固定する。

### T604-R004 — High — `open`

- source severity: `High`（preserved）
- verified progress: rootごとのstate migration、history migration、snapshot metadata migrationは一つの`withStorageRootLock`へ統合され、phase間にowner assertionが追加された。直接のnested acquireは追加されていない。
- remaining closure condition: startup各phase内部の複数publicationはleaseを受け取らず、phase前のassertion後にleaseを失ってもmutationを続行できる。通常state / history / snapshot writerとの別process race、newer publication保護、partial failure後のlast coherent readを固定するfixtureもない。
- required for closure: startup read-plan-write内の各publicationを同じowner generationへfenceし、sourceに列挙した通常writerとの別process競合とpartial failure recoveryをRed / Greenで固定する。

### T604-R005 — High — `open`

- source severity: `High`（preserved）
- verified progress: production Node pathは`putAndCleanup`でsnapshot write、latest pointer scan、protected generation、retention / count / byte plan、delete前pointer再確認を一つのroot leaseへ統合した。複数active pointerとbyte上限の逐次fixtureがlocal Greenである。
- remaining closure condition: source required actionに含まれるpointer更新とのdeterministic interleaving、delete failure時のpartial-success contract、restart convergenceが固定されていない。countとbyteを同時に満たせないactive generation、cleanup途中failure、lost leaseとdeleteのraceに対するevidenceもない。
- required for closure: sourceに列挙したgeneration race、count / byte overflow、delete failure、restartをproduction tracker + Node adapterで固定し、publication成功後のcleanup失敗contractとactive pointer不変を証明する。

### T604-R006 — High — `closed`

- source severity: `High`（preserved）
- closure evidence: public `StorageRootLockCoordinator`によりcustom `AtomicTextFileStore`のowner namespaceを注入でき、既定custom-store pathはhost rootを作らないin-process coordinatorを使う。既存T506 custom-store 2件は`test:t604`に含まれlocal Green。default Node filesystemは実child processによるlive refusal、owner release後acquire、kill後bounded recoveryを固定した。
- external gate: exact-head CIは利用者方針によりmerge直前のheld gateへ分離する。CI未実行だけを理由に本findingをopenにしていない。

### T604-R007 — Medium — `open`

- source severity: `Medium`（preserved）
- verified progress: `test:t604`はCI専用stepへ配線され、owner lock child process、partial fault seams、static symlink / junction sentinel、active pointer / byte cleanup、T506 custom-store regressionを含む15 / 15 local Greenへ拡張された。
- remaining closure condition: real child process fixtureはlock primitiveだけで、source required actionのproduction state full-snapshot CAS / history append / startup migration / snapshot pointerを別OS processで競合させない。same-process queueを除いたstate / history race、publication中kill、reparse swap、startup race、cleanup failure / restartのmatrixもない。
- required for closure: source findingに列挙したproduction compositionのreal multi-processとfailure / security / race matrixを追加し、同じ`test:t604` CI stepで固定する。exact-head CIそのものは別held gateである。

### T604-R008 — Medium — `open`

- source severity: `Medium`（preserved）
- verified progress: startup、state、history、cache、snapshotのkind-only callbackは共通`reportActiveStorageLockDiagnostic`へ接続され、Output host開始前eventをpending queueから`Review Range` lifecycleへflushする。
- remaining closure condition: sinkは同じkindの重複を抑止せず、renew failureはtimer tickごとに通知できるため、source required actionのoperation lifecycleへ一度だけ記録するcontractを満たさない。timeout / failure / stale recoveryの全production composition、pending flush、path / repository ID / source / token非出力を固定するtestも追加されていない。
- required for closure: operation単位のdeduplicationを共通Output sinkへ実装し、startupを含む全operation種別で各diagnosticが一度だけprivacy-safeに記録されることを固定する。

### T604-R009 — Low — `closed`

- source severity: `Low`（preserved）
- closure evidence: design §15.4はmonotonic owner fencing、successor-safe recovery、root-confined mutation、snapshot transaction、Output lifecycleへ同期された。handoffはtechnical fix `f1cb025e3008bb861ac6c673831a3c7b2d8e30e8`、local 15 / 15、CI `not run; merge-gate held`、同一reviewer R2 closure待ちを記録し、tasks / phases / follow-upも同じ実態へ同期された。BreakingChangesへ新規entryを追加しない判断はsource reviewどおり維持された。

## 結果

### Finding dispositions

| Finding | Severity | Disposition |
| --- | --- | --- |
| T604-R001 | High | `open` |
| T604-R002 | High | `open` |
| T604-R003 | High | `open` |
| T604-R004 | High | `open` |
| T604-R005 | High | `open` |
| T604-R006 | High | `closed` |
| T604-R007 | Medium | `open` |
| T604-R008 | Medium | `open` |
| T604-R009 | Low | `closed` |

severity reclassification / errataはない。

### Coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| R001 successor-safe lease ownership / fencing | `checked_finding` | descriptor化とmonotonic boundは確認、assertion-publication gapとinterleaving evidenceが残る |
| R002 crash / partial / corrupt acquire recovery | `checked_finding` | fault seam / completed-child killは確認、successor-safe failure cleanupとpartial-kill matrixが残る |
| R003 root / reparse / TOCTOU boundary | `checked_finding` | static link拒否は確認、検査後swap不能なprimitiveがない |
| R004 startup / recovery lock ownership | `checked_finding` | root lease統合は確認、phase内fenceと別process / partial evidenceが残る |
| R005 active snapshot / bounded cleanup transaction | `checked_finding` | Node transactionとactive / byte caseは確認、race / failure / restart evidenceが残る |
| R006 custom store / Node process / current-head CI | `closed` | custom T506 2件とNode child-process local Green、CIは外部held |
| R007 focused / CI failure-security-race coverage | `checked_finding` | 15 / 15とCI wiringは確認、production real-process matrixが残る |
| R008 privacy-safe production diagnostics | `checked_finding` |共通Output wiringは確認、once contractとtestが残る |
| R009 design / docs / handoff identity | `closed` | technical fix HEAD、local evidence、merge-gate-heldへ同期済み |

### Held / unexplored / unknown

- held: `H604-001` Markdown wording lint `unsupported`、`H604-002` T605〜T608の別task scope、`H604-003` reviewed HEAD一致CIのmerge直前外部gate。これらはopen findingと混同しない。
- unexplored: なし。R001〜R009のclosure conditionは全件判定済み。新規観点とscope外siblingは利用者指示により探索していない。
- unknown: exact-head CIの結論。起動・待機禁止に従い、local / sourceの技術判定へ混入していない。
- not applicable: independent-final-review freeze / attestation、merge。

### Verdict

`fail`

T604-R006とT604-R009は`closed`。T604-R001〜R005、R007、R008は同じsource findingのclosure conditionが残るため`open`である。提供済みlocal evidence 15 / 15は評価したが、未固定のowner-fencing / partial-crash / TOCTOU / production multi-process / failure conditionsをsuccessへ推測していない。

## リスク

R001〜R004の残条件はlease喪失後publication、partial owner cleanup、root外mutation、startup writer競合というsource High findingの安全境界である。R005はactive generationとcleanup partial success、R007はproduction process境界の回帰固定、R008はprivacy-safe diagnosticのonce contractが未完了である。

exact-head CI未実行はR006 / R007の技術不足とは分離し、merge前held gateとしてのみ扱った。scope外探索を行っていないため、本reportはR001〜R009以外の品質を保証しない。

# T604 independent finding closure report

## タスク

- Issue: `#72`
- PR: `#73`
- task: `T604`
- mode: same independent reviewerによるfinding-limited closure verification
- source finding report: `reports/issue-72-t604-independent-final-review-20260820195834.md`
- implementation follow-up: `reports/issue-72-t604-independent-review-followup-20260820201341.md`
- source finding HEAD: `6f779a95da44a2c72cbeae49fa4c0083b472e4aa`
- technical fix HEAD: `fc5aadc08807bd98779be992521b8d8cfcf0221b`
- current/admin HEAD: `9c718ecf56eb9502c3bd0893dec981098ad6fa35`

同一independent reviewerとして、source finding `T604-IFR001`〜`T604-IFR007`のidentity・severity・required actionを維持し、各findingを`closed`または`open`へ一度にdispositionした。technical fix以外の観点を追加していない。

## sub-agentを使う理由

依頼でsub-agentが禁止され、finding continuityを持つ同一reviewerが7件を一括照合する必要があるため使用していない。

## 対象範囲

- `T604-IFR001`〜`T604-IFR007`のsource findingに記録されたrequired actionのみ。
- technical fix `207b0cf...fc5aadc`と、そのfinding evidence metadataを確定したadmin commit `fc5aadc...9c718ec`。
- supplied local evidence: `test:t604` 22/22（T604 19、design structure 1、T506 integration 2）、build、compile:test、typecheck:contracts、ESLint、architecture positive/negative、diff-checkのGreen記録。
- approved threat model: trusted VS Code storage root、cooperative RevMem process/window、crash、partial I/O、operation開始時に存在するlink/reparse。
- exact-head CIとMarkdown lintのheld状態。

## 対象外

- IFR001〜IFR007以外の新規観点、finding、severity変更、全範囲再review、sibling defect探索。
- hostile ancestor/root syscall間swap、native `openat`、Windows handle-relative primitive。承認済みthreat model外のまま維持した。
- test/CIの実行・待機、実装、tracking変更、commit、push、PR変更、merge。
- source independent reportの`checked_no_finding`領域の再判定。

## 実行コマンド

read-only inspectionだけを行い、testまたはCIは起動していない。

- `git rev-parse HEAD/fc5aadc`、`git log --oneline`、`git status --short`
- `git diff --name-status/--check 207b0cf...fc5aadc`、`git diff fc5aadc...9c718ec`
- `Get-Content` / `Select-String`によるsource report、follow-up report、7件に直接対応するsource/test/design/package/handoff/trackingの照合
- report記入後のHEAD、status、未記入トークン、見出し、whitespace/diff-check確認

repositoryに`tools/lint/`と`lint:md`がないためMarkdown wording checkerは`unsupported`。存在しないlint commandは実行していない。

## 対象ファイル

finding-limited fix rangeの変更19件をrequired actionとの対応範囲で確認した。

- `README.md`
- `doc/design/vscode-review-range-tracker-design.md`
- `handoffs/issue-72-t604-implementation-20260820103944.yaml`
- `package.json`
- `reports/issue-72-t604-independent-review-followup-20260820201341.md`
- `src/adapters/github/node-github-pull-request-cache-storage.ts`
- `src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts`
- `src/adapters/persistence-startup-migration.ts`
- `src/adapters/state-repository/coherent-file-system-review-state-repository.ts`
- `src/adapters/state-repository/file-system-review-state-repository.ts`
- `src/adapters/state-repository/storage-root-lock.ts`
- `src/adapters/state-repository/validated-file-system-review-state-repository.ts`
- `src/application/non-git-snapshots/index.ts`
- `src/application/operation-feedback/operation-feedback.ts`
- `src/t305-extension.ts`
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`
- `tasks/phases-status.md`
- `tasks/tasks-status.md`
- `test/unit/t604-storage-lock-cleanup.test.ts`

admin rangeの`handoffs/issue-72-t604-implementation-20260820103944.yaml`、follow-up report、`tasks/tasks-status.md`もIFR007のidentity/evidence同期として確認した。

## 指摘事項

finding identityとseverityはsource reportから変更していない。新規findingは追加していない。

**T604-IFR001 — High — `open`**

- source required action: 各不可逆publication直前へ同一lease/fencing tokenを伝播し、lease loss中にsuccessor publicationを挟むdeterministic testでold writerがpublishしないことを証明する。
- verified implementation: `StorageRootLease`がstateのContext/Global/manifest、cache、snapshot、startup migration/quarantineへ伝播し、各mutation直前に`assertOwned()`する。valid descriptorはprocessがliveである限りclock expiryだけではrecoverしない。
- remaining required condition: `test/unit/t604-storage-lock-cleanup.test.ts:218-228`はfirst ownerをreleaseしてからsuccessorを取得し、old writerのpublication callbackを実行しない。追加されたlive-expired testもacquire拒否だけである。required actionの「successor publicationを挟んだold writerのpublication拒否」は未実証。
- closure requirement: state/cache/snapshot/startupの少なくとも不可逆publication seamで、owner detachまたはlease loss、successor publication、old callback再開を決定的に並べ、old publicationが発生せずnewer valueが残ることをfocused evidenceへ含める。

**T604-IFR002 — High — `open`**

- source required action: generation write、save-in-flight保護、latest pointer publish、count/byte/retention cleanupを単一root transactionへ統合し、競合save/cleanupでもcurrent generationが常にpublish・保持されるtestを追加する。
- verified implementation: production Node adapterの`putLatestAndCleanup()`はgeneration、pointer、cleanupを一つの`withRootTransaction()`内で実行し、trackerの`saveLatest()`が優先使用する。
- remaining required condition: supplied19件のT604 testには新transactionを競合cleanupと決定的にinterleaveして、`saveLatest()`成功・current pointer・generation保持を無条件にassertするcaseがない。既存`Promise.allSettled` caseは`save()`と別`setLatest()`を競合させ、pointer publication成功時だけgenerationを検査する旧条件のままである。
- closure requirement: `putLatestAndCleanup`/`saveLatest`と別instance cleanupを競合させ、current pointerとgenerationが必ず一致して保持されるdeterministic testをfocused evidenceへ含める。

**T604-IFR003 — High — `open`**

- source required action: startup leaseをmigration/quarantineへ渡してnested acquireを除き、corrupt snapshot wrapperをseedしたproduction startup testでquarantine・収束を証明する。
- verified implementation: startupは取得済みleaseとfenced storeをsnapshot migrationへ渡し、corrupt wrapperは`quarantineWithinLease()`を使ってroot lockを再取得しない。
- remaining required condition: production child startup fixtureは引き続きcorrupt latest pointerをseedしており、corrupt snapshot wrapperから`get(..., lease)`→internal quarantineへ入る経路を実行しない。
- closure requirement: `entries/<snapshotId>.json`へcorrupt wrapperをseedし、production startupがtimeoutせずquarantineし、restart後に収束するfocused test evidenceを追加する。

**T604-IFR004 — High — `open`**

- source required action: cache、snapshot、startupへ同一coordinator契約を伝播し、custom storeで全persistence familyのsame-root serializationとmigration/cleanupを実証する。
- verified implementation: 3 consumerすべてが`storageLockCoordinator`を受け、custom store時はprocess-global tail mapを使う`InProcessStorageRootLockCoordinator`へfallbackする。cache/snapshot mutationとstartup fenced storeもlease assertionを使用する。
- remaining required condition: supplied22件のfocused evidenceにはcustom `AtomicTextFileStore`を共有するstate/history/cache/snapshot/startupを同じrootで競合させるcaseがなく、cache cleanup、snapshot transaction、startup migrationのcoordinator propagationを実行で証明していない。
- closure requirement: 同一custom store/root/coordinatorを使う全persistence familyの競合serializationとstartup migration/cache・snapshot cleanupをfocused integration evidenceへ含める。

**T604-IFR005 — Medium — `open`**

- source required action: startup前にactivation-safe Output hostを構成し、terminal startup failureがproduction compositionで一度だけ表示されることをtestする。
- verified implementation: `src/t305-extension.ts:77-89`は`VscodeOperationFeedbackHost`とactive feedbackをstartup migrationより前に構成する。operation feedbackはoperationId/kindをdeduplicateし、failureでOutputをrevealする。
- remaining required condition: 新test (`t604-storage-lock-cleanup.test.ts:496-501`) はsource文字列の順序だけを確認する。既存dedup unit testと分離されており、production activationでterminal startup failureを発生させてappend/reveal exactly-onceをassertしない。
- closure requirement: production composition seamへterminal startup lock failureを注入し、`Review Range` Outputへのprivacy-safe appendとrevealが各1回であることをfocused test evidenceへ含める。

**T604-IFR006 — Medium — `closed`**

- source required action: permanent designからtask IDを除き、design structure validationをGreenにする。exact-head CIは別のmerge gateとしてheld可能。
- evidence: design §15の該当文はfeature/contract terminologyへ置換され、`T604`を含まない。`package.json`の`test:t604`は`design-document-structure.test.js`を含む。supplied local evidenceはdesign structure 1/1を含む22/22 Green。
- held separation: current HEADのexact-head CIは未取得だが、明示されたpolicyどおりtechnical closureをopenへ戻す理由にしていない。

**T604-IFR007 — Low — `open`**

- source required action: test definition・actual result・PR・handoff・tasks/reportのcountとexact commit identityを一致させる。
- verified implementation: focused scriptとfollow-up/handoff/task tableはT604 19 + design 1 + T506 2 = 22へ揃い、technical fix SHA `fc5aadc08807bd98779be992521b8d8cfcf0221b`を記録する。
- remaining required condition: current HEADは既に`9c718ecf56eb9502c3bd0893dec981098ad6fa35`だが、README、tasks top/current row、phasesはなお「pending fix commit後」と記録する。handoffの`current_head`は`fc5aadc...`のまま、follow-upはPR本文更新を親の未完了actionとして明記しており、PR metadata同期の完了evidenceがない。
- closure requirement: reviewed technical fix SHAとcurrent administrative HEADを役割別に正確に記録し、pending-fix表現を解消し、PR本文をactual focused count 22・正確なfix/current identity・CI held状態へ同期したread-only evidenceを提示する。

## 結果

**Finding disposition**

| finding | source severity | disposition |
| --- | --- | --- |
| `T604-IFR001` | High | open |
| `T604-IFR002` | High | open |
| `T604-IFR003` | High | open |
| `T604-IFR004` | High | open |
| `T604-IFR005` | Medium | open |
| `T604-IFR006` | Medium | closed |
| `T604-IFR007` | Low | open |

- severity reclassification: なし。
- new findings: なし。
- `held`: current/admin HEADのmatching exact-head CI。merge gateとして親ownerのまま。IFR006のlocal/source technical closureをopenへ戻していない。
- `held`: Markdown focused/full lintはrepository wiring不在のため`unsupported`。passとは扱わない。
- `unexplored`: なし（finding-limited scope内0）。IFR001〜IFR007以外は明示的に対象外であり、unexploredへ変換しない。
- validation assessment: supplied local evidenceの22/22とbuild/compile/typecheck/lint/architecture/diff-check Greenはfix HEADのbaselineとして受領した。ただしIFR001〜IFR005のsource required actionに明記されたfailure/interleaving/custom-store/production-composition evidenceを代替しない。reviewerはtest/CIを実行または待機していない。

**Technical verdict**: `fail`

IFR006はclosed。IFR001〜IFR005とIFR007は実装の主要部分がaddressedされているが、source required actionの明示的なtest/evidenceまたはidentity/PR同期条件が未完了のためopenを維持する。

**Report attestation**

- `report_attestation_allowed: false`
- 現在の禁止理由: required findingが6件openでtechnical verdictが`fail`。
- 将来の許可条件: IFR001〜IFR005の上記限定test evidenceとIFR007 metadata同期を同じfinding identity/severityでclosureし、matching exact-head required CIがGreen、Markdown lintはwiring不在なら`unsupported/held`を明示し、reviewed implementation HEADを再freezeする。その後のattestationは事前予約reportだけを変更する単一administrative commitで、first parentがreviewed implementation HEAD、他path変更なし、後続commitなしでなければならない。

## リスク

- source実装だけでは、lease-loss後publication、atomic snapshot interleaving、corrupt-wrapper startup、custom-store全family、terminal startup Outputの元findingが要求したfailure pathを回帰testとして固定できていない。
- tracking/handoff/PR identityの同期が未完了なため、次のevidence consumerがtechnical fix HEAD、admin HEAD、focused count、CI stateを取り違える可能性がある。
- exact-head CIはheldであり、local evidenceをmerge gateのGreenとして扱えない。
- 本reportはfinding-limited closureであり、IFR001〜IFR007以外の品質を再保証しない。

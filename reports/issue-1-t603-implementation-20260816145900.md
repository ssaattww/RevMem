# T603 永続schema migration / 破損data回復 実装レポート

## 1. メタデータと対象識別子

- Repository: `ssaattww/RevMem`
- Task: `T603`
- Pull Request: `#53`
- Branch: `task/t603-schema-migration-recovery`
- Base ref: `main`
- Base SHA: `146aec15783294da1795f268315c85d1a0dffa56`
- 技術実装HEAD: `95650f72632fa482a08f32a6bf3f6cefeaa7340f`
- 実装モード: initial implementation
- 開発方針: TDD
- Merge: 実施しない。利用者が実施する。

このreport自身を保存するcommitは技術実装HEADの後段になるため、その保存後のPR current HEADと完全一致する最終CI runはPR完了コメントへ記録する。

## 2. 目的

T603の完了条件に従い、永続review state、review history JSONL、non-Git snapshotに対して段階的schema migrationを実装する。migration前には復元可能なbackupを残し、JSON/JSONL/snapshotが破損している場合は元dataを隔離して、確認済み状態を推測して復元しない保守的な回復経路を提供する。

## 3. 権威ある要件

- `tasks/tasks-status.md` T603
  - 起動時に段階schema migrationを行う。
  - 移行前にbackupを作成する。
  - JSON/JSONL/snapshot破損時は検出・隔離・回復する。
  - 旧schema fixtureを段階移行できる。
  - migration失敗時はbackupから戻す。
  - 不確実な範囲を未確認として扱う。
- `docs/design/review-range-tracker-design.md`
  - 永続schemaVersion、migration、backup、破損時の回復・隔離に関する既存設計を実装根拠とした。
- Project instruction / uploaded worker skills
  - repository操作、PR操作、PR commentはGitHub connectorを利用する。
  - 作業開始時にfailure diagnostics artifact workflowを確認する。
  - RevMemの実装はTDDで、先にtestを追加してRedを確認する。
  - review可能な小さな論理単位でcommit/pushする。
  - 完了時にrepositoryへ詳細report、PRへ簡易reportを残す。
  - current PR HEADとrunの`head_sha`が一致するCIだけを採用する。
  - mergeしない。

## 4. Scope

### 実装対象

- 1 versionずつ適用するschema migration chain
- legacy schema v0から現行schema v1へのmigration
- migration前backup sidecar
- migration publish失敗時のrollback
- 永続review stateの破損検出、quarantine、uncertain扱い
- repository stateでmanifest/context/global documentを扱うmigration/recovery
- review history JSONLのlegacy event migration、破損log隔離、確実なeventのみsalvage
- non-Git snapshot / latest pointerのlegacy migrationと破損隔離
- future/unsupported schemaをcorruptionと混同せずrejectする境界
- T603 focused CI test

### Non-goals

- schema v2以降の将来migration内容を先取りして定義すること
- quarantine/backup retention policyの一般化
- 独立review verdictの発行
- task tracking fileの直接更新
- PR merge

## 5. 作業開始時のdiagnostics workflow確認

`.github/workflows/ci.yml`には開始時点ですでに、failure時の原因調査に必要な仕組みが存在したため、新しいdiagnostic artifact workflowは作成していない。

既存workflowには以下が含まれていた。

- build/test commandの標準出力・標準エラーを`2>&1 | tee test-output/ci/*.log`で保持
- failure時のenvironment / git status / generated filesの収集
- `test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、tools/config/workflow等のartifact upload
- `npm-debug.log*`を含む既存failure diagnostics pattern

T603ではfocused test log `test-output/ci/test-t603.log`を同じ診断体系へ追加した。途中で既存`npm-debug.log*`行が意図せず差分化されたことを自己点検で発見し、`95650f72632fa482a08f32a6bf3f6cefeaa7340f`で復元した。最終workflow差分はT603 focused test step追加のみである。

## 6. TDD evidence

### Red: test-only HEAD

- Commit: `3c88a86bd0e1a47a43a259b53db431cc8724d40e`
- Commit message: `test: add T603 migration and recovery coverage`
- 変更:
  - `test/unit/t603-schema-migration-recovery.test.ts`を先行追加
  - T603 focused CI stepを追加
- Exact-head CI run: `31929190714`
- Job: `95120961967`
- Result: failure
- 直接結果: 既存Unit/T602は成功し、新規T603 stepだけが未実装機能により失敗した。
- Failure artifact:
  - ID: `5717201218`
  - Name: `ci-failure-diagnostics-31929190714-1`

このrunはRed HEAD `3c88a86bd0e1a47a43a259b53db431cc8724d40e`に紐づくrunだけを確認しており、別SHAのrunを代用していない。

### 実装途中のfailureと修正

#### Lint failure

- HEAD: `ac2f13c0fcaf0a7ac32988d636e640b64aef4a0f`
- Run: `31929450198`
- Job: `95121963562`
- Artifact: `5717346948` / `ci-failure-diagnostics-31929450198-1`
- 原因: `persistence-schema-recovery.ts`のrollback error生成時に元causeを保持しておらず、`preserve-caught-error` lint ruleに違反した。
- 修正commit: `4e9a09be675bdd3c83312a2717db5f75d4691a8c`
- 修正: `AggregateError`へ元errorを`cause`として保持した。

#### Existing unit contract failure

- HEAD: `4e9a09be675bdd3c83312a2717db5f75d4691a8c`
- Run: `31929675591`
- Job: `95122672378`
- Artifact: `5717460644` / `ci-failure-diagnostics-31929675591-1`
- Result: lintは成功し、既存unit `schema mismatch is rejected and reported during load` 1件が失敗した。
- 原因: migration preflightがfuture schemaを既存repository notification boundaryより先にrejectしたため、`notifyPersistenceFailure`へ通知されなかった。
- 修正commit: `f9dd96383cb17400210e95d8e21ac6e378baf531`
- 修正: preflight failureをuncertainとして記録し、既存operation/target/route/filePath/error情報でnotifierへ通知した後、元errorを再throwするようにした。notifier側failureは元errorを隠さない。

### Green

#### Contract fix後

- HEAD: `f9dd96383cb17400210e95d8e21ac6e378baf531`
- Exact-head CI run: `31929798612`
- Job: `95123012762`
- Result: success

#### 技術実装最終HEAD

- HEAD: `95650f72632fa482a08f32a6bf3f6cefeaa7340f`
- Exact-head CI run: `31929935759`
- Job: `95123412884`
- Result: success
- 確認済みstep:
  - Build
  - Contract typecheck
  - Architecture validation / negative contract
  - Lint
  - Unit tests
  - T602 tests
  - T603 schema migration and corruption recovery tests
  - 他task focused tests
  - Temporary Git integration tests
  - Mock GitHub integration tests
  - VS Code Extension Host tests

このGreen runもHEAD `95650f72632fa482a08f32a6bf3f6cefeaa7340f`を指定して取得したrunであり、別SHAのrunを代用していない。

## 7. 実装内容

### 7.1 共通migration / recovery helper

`src/adapters/state-repository/persistence-schema-recovery.ts`を追加した。

- migrationを1 versionずつ適用するchainとして扱い、version gap、cycle、future/unsupported schemaをrejectする。
- 現行`REVIEW_RANGE_SCHEMA_VERSION`は1のため、production migrationはlegacy v0からv1を定義する。
- migration対象documentは書換え前に`<path>.pre-migration.bak`へraw dataをbackupする。
- 複数documentをmigrationする場合、対象backupを先に作成してからpublishする。
- migrated documentのpublish途中で失敗した場合、変更済みdocumentを元raw contentへrollbackする。
- unsupported schemaは`UnsupportedPersistedSchemaVersionError`として扱い、corrupt dataとして破棄・隔離しない。
- JSON/shape corruptionはraw contentのSHA-256 prefixを使う決定的な`*.corrupt-<digest>.quarantine`へ隔離し、active pointerから除く。

### 7.2 永続review state

`src/adapters/state-repository/validated-file-system-review-state-repository.ts`へpreflight recoveryを統合した。

- workspace stateはlegacy v0をv1へmigrationしてbackupを残す。
- repository stateではmanifest、owner-global document、target context documentをmigration対象として準備する。
- manifestは他documentより後でpublishし、途中failure時にrollbackする。
- corrupt/missing referenceなど、確認済み範囲を確実に復元できないtargetを`uncertain`として扱う。
- `getCurrent`はuncertain targetに対して`undefined`を返し、破損前のstaleな確認済みmemoryを露出しない。
- `load` / `loadGlobal`はuncertain evidenceを確認済みstateとして返さない。
- `commit` / `create`はuncertain状態で`StaleReviewStateError`としてfail closedする。
- `save`は新しいvalid snapshotを書いて回復できるが、不確実なcurrent contextを入力として使わない。
- preflight errorも既存`notifyPersistenceFailure`契約へ通知する。

### 7.3 Review history JSONL

`src/adapters/state-repository/jsonl-review-history-store.ts`を更新した。

- valid legacy v0 eventを1 versionずつcurrent v1へmigrationする。
- migration rewrite前に元JSONLをbackupする。
- corrupt/noncanonical/torn lineを検出した場合、元log全体をquarantineし、完全に検証できたeventだけをsalvageして新eventをappendする。
- unsupported/future schemaはcorruptionとして破棄せずrejectする。
- 既存unit testのcorruption期待値を新しい保守的回復仕様へ更新した。

### 7.4 Non-Git snapshot

`src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts`を更新した。

- persisted snapshotとlatest pointerへ`schemaVersion`を保存する。
- T601時代のschemaVersionなしpayloadをlegacy v0として扱い、v1へmigrationしてbackupする。
- corrupt JSON / invalid field shapeをquarantineし、snapshotを利用可能とはみなさない。
- enumerationは利用不能なcorrupt entryを確認済みsnapshotとして返さない。
- unsupported/future schemaはrejectする。

## 8. T603 test coverage

`test/unit/t603-schema-migration-recovery.test.ts`で少なくとも以下を固定した。

1. legacy workspace schema v0をcurrent schemaへmigrationし、reviewed rangesを保持し、pre-migration backupを作る。
2. migration publish failure時にlegacy raw stateをbackupから復元し、`getCurrent`で確認済みstateを露出しない。
3. corrupt workspace JSONをquarantineしてactive pointerから除き、load/getCurrentで確認済みstateを返さない。
4. history JSONLにlegacy v0 eventとcorrupt lineが混在する場合、valid recordをmigrationし、元logを隔離・backupし、新eventをappendする。
5. schemaVersionを持たないlegacy non-Git snapshotをv0としてcurrentへmigrationし、backupを作る。
6. corrupt snapshot JSONをquarantineし、snapshotを利用可能として返さない。

## 9. Changed files

- `.github/workflows/ci.yml`
  - T603 focused testを既存diagnostic log体系へ追加。
- `src/adapters/state-repository/persistence-schema-recovery.ts`
  - 共通migration chain、backup、rollback、quarantine、state migration/recovery helper。
- `src/adapters/state-repository/validated-file-system-review-state-repository.ts`
  - persisted review state preflight、uncertain fail-closed、failure notification統合。
- `src/adapters/state-repository/jsonl-review-history-store.ts`
  - JSONL migration、backup、quarantine、salvage/recovery。
- `src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts`
  - snapshot schemaVersion、legacy migration、corruption quarantine。
- `test/unit/review-history-jsonl-store.test.ts`
  - 新しい破損回復contractへ既存期待値を更新。
- `test/unit/t603-schema-migration-recovery.test.ts`
  - T603 Red/Green regression coverage。

## 10. Commit history

- `3c88a86bd0e1a47a43a259b53db431cc8724d40e` — test: add T603 migration and recovery coverage
- `8e5851ab81c9b16f9cb1320e6c4fcdaaf853fa96` — feat: migrate and recover persisted review state
- `9dda6c74c8b55432c9b26418d303f6582b82f0cd` — feat: recover migrated and corrupt review history
- `ac2f13c0fcaf0a7ac32988d636e640b64aef4a0f` — feat: migrate and quarantine non-git snapshots
- `4e9a09be675bdd3c83312a2717db5f75d4691a8c` — fix: preserve migration restoration cause
- `f9dd96383cb17400210e95d8e21ac6e378baf531` — fix: notify migration preflight failures
- `95650f72632fa482a08f32a6bf3f6cefeaa7340f` — chore: preserve existing CI failure diagnostics

## 11. Intentionally untouched

- `tasks/tasks-status.md` / `tasks/phases-status.md`
  - repositoryの既存運用ではtask trackingは指定されたprogress management workerの責務であり、implementation workerから直接変更しない。
- 設計document
  - T603に必要なmigration/backup/recovery方針が既存設計に存在し、仕様変更を必要としなかった。
- Merge operation
  - 利用者の責務であり実施しない。

## 12. Blocked・unknown・remaining risks

- Blocking item: なし。
- Local clone: worker containerから`github.com`のDNS解決に失敗しlocal cloneは利用できなかった。ただしrepository read/write、PR操作、artifact取得は指定どおりGitHub connectorで実行し、validationはGitHub Actionsのfull CIで完了したため、検証を代替SHAや未確認結果で補ってはいない。
- Future migration: 現行schemaがv1であるためproduction chainはv0→v1のみ。将来schema versionを上げる際は、各隣接versionのmigration stepを明示的に追加する必要がある。
- Independent review: implementation worker自身による独立review verdictは出していない。別review workerによるcurrent HEAD reviewが必要。
- Final administrative HEAD: report/handoffを保存するcommitのSHAをそのcommit自身へ埋め込むことはできないため、保存後のPR current HEADと一致するCI runはPR完了コメントに記録する。

## 13. 次のアクション

1. このreportとschema v3 handoffをrepositoryへ保存する。
2. 保存後のPR current HEADに完全一致するworkflow runだけを確認する。
3. Exact-head CI成功後、PR #53へ簡易完了reportを投稿しDraftを解除する。
4. 別workerが通常reviewを実施する。
5. mergeは利用者が実施する。

# PR #108 独立最終レビュー — 2026-09-05

## 1. 判定とレビュー対象

**判定: fail（修正必須7件: High 4件、Medium 3件）。** 技術的指摘6件と、実装・検証・通常レビューの記録不足1件を今回の一括指摘とする。実装修正、テストのリポジトリ追加、mergeは実施していない。

| 項目 | 値 |
| --- | --- |
| Repository / PR / Issue | `ssaattww/RevMem` / #108 / #106 |
| Mode | `independent_final_review` |
| Reviewer | `chatgpt-pr108-independent-20260905` |
| Branch | `codex/pr94-ci-006-global-three-way` |
| Base | `main` / `669805326849a9d749b2ddb8bc85cba717e4e629` |
| Reviewed implementation HEAD / technical head | `0e15ac16809af71bba09694453e7a665c7c452a1` |
| Reviewed tree | `76fb4d88787aef4d621d3792cc3ffb7ec1ba49eb` |
| Initial independent reviewed HEAD | 上記reviewed implementation HEADと同一 |
| Closure reviewed HEADs | なし。今回が最初の独立・網羅レビュー |
| Reviewed range | baseからreviewed implementation HEADまでのPR差分14ファイル、および関連依存先 |
| Verification capability | `local_execution_available`。ローカルの完全CI同等gateは未実施 |
| Reserved report path | `reports/2026-09-05-pr108-independent-final-review.md` |
| Persistence | `repository_file`。本報告書のみの記録commitを作成する |
| Administrative parent | `0e15ac16809af71bba09694453e7a665c7c452a1` |
| Report commit / push at generation | `commit_pending` / `push_pending`。生成後のSHAはPRコメント・外部handoffで記録する |
| Passing report attestation | **許可しない**。`report_attestation_head = null` |
| Merge | 実施しない。利用者の操作境界 |

このチャットは本変更の実装者、指摘修正者、通常レビュワーではない。既存のレビュー結論に依存せず対象を確認した。自分の技術調査後に取得したPRの既存コメントとreview submissionsは、いずれも空だった。

本報告書は不合格の調査記録であり、passing attestationではない。記録commitでHEADが変わっても、上記実装HEADに対する判定を新HEADの合格判定へ読み替えない。記録後は新しいcurrent HEADに一致するCIだけを別途確認する。

## 2. 根拠、範囲、非目標

根拠は、利用者の「独立レビュー・指摘を一度に出し切る」という依頼、プロジェクト指示、root `AGENTS.md`、アップロード済みSkillsの `chat-review-worker → work-context-manager → review-worker → report-writer → chat-handoff-manager`、Issue #106、PR #108、`tasks/tasks-status.md`、および追加設計書である。`development-orchestrator`も参照した。リモートの参照・更新にはGitHub connectorを使用した。

Issue #106では、単一repository ownerに属する全ContextとGlobalのsnapshot/CAS、異なるPR HEADの共存、cancellation/stale/failure時の非部分更新、実際のT405 composition、既存single-context/private repository/選択経路の維持が必要である。追加設計書の§4はlifecycle unavailable時の無変更、§4.2は異なるHEADの遅延と後続同期、§6は失敗時の非公開、§7はpublication成功後のhistoryを定義している。

このレビューではproductionコードを修正せず、ローカルの追跡対象外テストで反例を検証した。CodexSkill、task status、設計、workflow、製品コードは変更しない。performance suiteのrequired CI追加、別Issueの修正、PRのmergeも対象外である。

## 3. ソースとCIの同一性

GitHub connectorで取得したCI run **33687437781** / job **100438140718** は、`head_sha = 0e15ac16809af71bba09694453e7a665c7c452a1` と一致し、`success`だった。build、契約型検査、architecture/negative検査、lint、unit、T403〜T406、Issue106、T304、T502〜T506、T602〜T606、T609/T610、Git、Mock GitHub、VS Code Extension Host、package等のjob stepが成功していた。別SHAのrunは代用していない。

取得artifactは **9868877063**、名前は `review-range-user-validation-d9bc08b0d79f6c7f72d43ee2fd719d36335564e5`。artifact名はpull_request merge commitに由来するが、そのmerge commitとreviewed HEADのGit treeは双方とも `76fb4d88787aef4d621d3792cc3ffb7ec1ba49eb` で一致する。取得したsource archiveのローカルtreeも一致したため、実装HEADと同一内容のソースとして使用した。

Source ZIP SHA-256: `7050b519b35ee4d00c61eac3b4dff72bdc097af88b4e3f63665e9de649a165c0`。検証後もarchive由来1355ファイルの変更は0件。生成したtest-dist、診断出力、追加probeは原本の変更として数えていない。

作業開始時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。既存workflowは結果JSON、標準出力、標準エラー、統合ログ、環境情報、生成物・ソース等を失敗診断artifactへ保存するため、workflowの追加変更は不要だった。

根拠参照:

- PR: https://github.com/ssaattww/RevMem/pull/108
- Issue: https://github.com/ssaattww/RevMem/issues/106
- Reviewed CI: https://github.com/ssaattww/RevMem/actions/runs/33687437781
- Reviewed source: https://github.com/ssaattww/RevMem/tree/0e15ac16809af71bba09694453e7a665c7c452a1

## 4. 検証結果と限界

| 検証 | 結果 | 証拠・制約 |
| --- | --- | --- |
| Reviewed HEADのCI | success | run 33687437781、job 100438140718、HEAD一致 |
| 既存Issue106＋T405 composition | 16/16 pass | `pr108-owner-tests.console.log` |
| 関連34ファイルの既存回帰 | 279/279 pass | `pr108-broad-regressions.log`、対象一覧 `pr108-broad-files.json` |
| 独立追加probe | 13件中6 pass、7 fail | `pr108-independent-final-reproductions.log`。6 passはpositive control、7 failは技術的指摘6件を検出 |
| ローカルnpm ci | 完了を確認できず | 制限時間で終了。依存取得失敗の原因は断定しない |
| ローカル型検査・完全CI同等gate | 未実施 | TypeScriptのtranspile-onlyで実行。型・build成功の証拠は上記CIに限定 |
| 実機VS Code / live private GitHub | 追加probeでは未実施 | 実Git・実永続化・production compositionにVS Code/GitHubのmockを組み合わせた |

ローカル環境はNode 22.16.0、TypeScript 5.8.3。CIはNode 24である。375個のsrc/test TypeScriptをtranspile-onlyで生成した。これを`npm run build`や型検査の代用とは扱わない。16件と279件にはcomposition等の重複があるため合計を独立テスト件数と表示しない。

既存対象テスト:

```sh
node tools/run-ci-command.mjs independent-owner-tests node --test \
  test-dist/test/unit/issue-106-global-three-way-synchronization.test.js \
  test-dist/test/unit/issue-106-t405-owner-synchronization.test.js \
  test-dist/test/unit/t405-composition-regression.test.js
```

独立probe:

```sh
node tools/run-ci-command.mjs independent-final-reproductions node --test \
  test-dist/test/unit/pr108-independent-owner-probes.test.js \
  test-dist/test/unit/pr108-independent-distinct-heads.test.js \
  test-dist/test/unit/pr108-independent-unavailable.test.js \
  test-dist/test/unit/pr108-independent-other-head-review.test.js
```

実測はexit code 1、spawn errorなし、cancelled/skippedとも0。標準出力・標準エラー・統合ログ・結果JSONを `test-output/ci/independent-final-reproductions.*` に保存した。probeは不具合を期待値にせず、要求上の正しい挙動をassertして失敗を確認している。

owner probeは実FS repository・debounce・context serviceを使用し、mappingは単純なstubで境界を分離している。production probe 3ファイルは既存T405 compositionの実Git・永続化・mapper・コマンド配線を再利用する。挿入したシナリオで終了するため元の長いtestの残りを追加probeで実行したとは扱わない。元のcomposition test自体は別途成功している。

## 5. 一括指摘

以下の行番号はすべてreviewed implementation HEADのもの。優先度の再分類はなく、全件openである。

### PR108-IFR-001 — High / P1 — 遅延PRがowner revisionになっても追いつけない

- Origin: `introduced_by_change`
- Location: `src/t405-owner-pull-request-synchronization.ts:158–166`、特に161–162
- Evidence: `deferred-catchup` probe

初期状態をPR52=B、PR53=B、Global=Bとする。remote52=C、remote53=D、owner=Cで同期すると、52とGlobalはC、53はBのままとなる。その後ownerをDにして同期しても、`context.pullRequest.headSha === expected.globalState.currentRevisionId` がB対Cで成立しないため53は再度skipされる。実測の2回目は `committed:false`、`mappedContextIds:[]`、53がskip、Global=C、53=Bだった。

これは単なる一時的deferではない。設計§4.2の「そのHEADがowner synchronization revisionになった時までdeferする」を満たさず、通常の再試行で解消しない。owner側の別経路が先にGlobalを進めた場合にも同じsource一致条件が障害になる。

**修正条件:** 各PRのsourceとowner-current Globalを区別し、exact evidence / immutable snapshotに基づいて安全に追いつかせる。単に一致checkを削除したりGlobalのrevisionを付け替えたりしない。B/B/B → C/B/C → C/D/Dの連続同期、Global先行更新、base-only更新、owner外PR、historyと全Contextの一括CASをテストする。

### PR108-IFR-002 — High / P1 — 同期失敗後に新規PR作成がGlobalを部分更新する

- Origin: `coverage_miss`（新しいowner境界と既存作成経路の統合漏れ）
- Location: `src/t405-review-contexts-runtime.ts:1132–1144,1179–1188,1210–1239`
- Evidence: `production-unavailable-new-pr` probe

保存済みPR52=B / Global=Bに対し、52のlifecycleをunavailableにする一方、検索では新しいPR53=Cを返して選択する。owner同期はfalseを返すが、`synchronizationCompleted`の確認がexisting PR側に限られ、新規PR側は `currentGlobalForNewPullRequest` と `contextStateService.create` を続行する。

実際のT405コマンド経路で、Context数1→2、Global B→C、52=B、53=Cが永続化された。画面はエラーを返しても状態は更新済みである。設計§4の「1件でもunavailableならContext、Global、manifest、historyを変更しない」というcommand全体の境界から漏れている。

**修正条件:** owner lifecycle取得が未完了の状態で、新規作成・Global advance・履歴更新へ進まない。interactive認証・再接続を必要とする場合は、認証後に全ownerの取得を成功させてから継続する。単純な早期returnでprivate repositoryの再接続経路を壊さない。既存PR選択と新規PR選択の両方で、取得失敗時のmanifest/state/history不変をactual compositionで検証する。

### PR108-IFR-003 — High / P1 — 遅延した別HEADのPRがReview Contexts全体を表示不能にする

- Origin: `coverage_miss`（defer状態とread projectionの統合漏れ）
- Location: `src/t405-owner-pull-request-synchronization.ts:164–166`
- Dependencies: `src/t405-review-contexts-runtime.ts:930–938,1086–1096`、`src/t405-pull-request-review-runtime-base.ts:1134–1141`
- Evidence: `production-different-heads` probe

両PRの保存済みHEAD=Cから、remote53=D、active52とowner=Eへ進める。owner commitは52=E / Global=Eを公開し、53=Cを意図的に保持する。しかしread-only側は53のmetadataをremote HEAD=Dで投影するため、Dのdiff登録とCの保存済みContextが組み合わされる。

実際のproduction compositionでは `Persisted pull-request context does not match the registered diff revision` となり、再検出操作が失敗し、projection数は0だった。PR53だけの古い表示ではなく、Review Contexts全体の取得を妨げる。001の「次回も追いつけない」とは別に、最初の同期直後から発生する。

**修正条件:** owner同期のdeferralをtree、cache、progress、immutable diff登録まで伝え、保存済みfilesと整合したrevisionを使う。PRを黙って一覧から除外して回避しない。異なるremote HEADが混在しても表示・再検出・refresh・再起動が成立するactual T405 compositionを追加する。

### PR108-IFR-004 — High / P1 — 設計上正当な別HEADのPRで確認済み操作が失敗する

- Origin: `coverage_miss`（既存review-state契約と新しいGlobal semanticsの不整合）
- Location: `doc/design/issue-106-owner-atomic-global-synchronization.md:25–40`
- Dependencies: `src/core/review-state/review-state-service.ts:155–168`、`src/t405-pull-request-review-runtime-base.ts:770–785`
- Evidence: `production-mark-other-head` probe

設計はGlobal=current owner DとPR53 HEAD=Cの共存を正当とする。この条件自体で確認操作が成立するかを、003とは分離して調べた。PR53のremote BASE/HEADをCのまま保持し、52とownerだけDへ進めると、再検出とprojectionは成功する（projection数3）。PR53の保存済みrevisionとdiff登録もともにCで一致する。

その状態でPR53のdiffのoriginal側1行目をcanonical commandから確認済みにすると、`Global current revision must match the target revision.` で失敗する。既存core serviceはtarget revisionとGlobal currentの一致を要求する。modified側だけでなくoriginal側でも操作が止まり、新設計の正当状態を既存操作へ接続できていない。

coreの一致検証そのものはこのPRで新しく追加されたものではないため、導入バグとは分類しない。しかし「異なるHEAD共存」を成立させる本Issueのin-scopeな統合不足である。

**修正条件:** non-owner HEADのPRに対するmark/unmarkとGlobalへの反映契約を定義・実装し、owner Globalを任意PR HEADへ付け替えず安全に操作できるようにする。original/modified両側、mark/unmark、sibling isolation、history、再起動をactual compositionで検証する。安全checkを外すだけの修正は不可。

### PR108-IFR-005 — Medium / P2 — manifest公開前の取消がcommitとhistoryを止めない

- Origin: `introduced_by_change`
- Location: `src/t405-owner-pull-request-synchronization.ts:227–236`
- Dependencies: `src/adapters/state-repository/owner-atomic-review-state-repository.ts:336–340`
- Evidence: `cancel-before-manifest` probe

callerは `commitRepository` の直前にしかsignalを確認せず、queue待機・lock待機・immutable書込み・manifest publicationまでsignal/current-generation fenceを渡していない。

実FS storeの `beforeAtomicPublication` hookでmanifest.jsonの公開直前にAbortControllerをabortすると、`aborted:true`にもかかわらず `committed:true`、全Context/Global=C、historyCount=2になった。取消の発生はauthoritativeなmanifest公開より前であり、「公開後はhistoryを完遂する」というコードコメントのケースではない。

**修正条件:** cancellationまたはsupersessionをpublication pointまで渡し、owner lock下のmanifest公開直前でもcurrent性を確認する。queue待機中、document書込み中、公開直前では旧generation/historyを維持し、公開後だけ履歴完遂を継続する。失敗・取消の境界を設計と実装で一致させる。

### PR108-IFR-006 — Medium / P2 — owner APIが既存current cacheとuncertain状態を更新しない

- Origin: `introduced_by_change`
- Location: `src/adapters/state-repository/owner-atomic-review-state-repository.ts:195–205,217–225`
- Dependencies: 継承したcoherent/validated repositoryのcurrent cache・uncertain管理
- Evidence: `getCurrent-after-owner` と `uncertain-owner-cache` probes

新しいowner APIは直接ownerFileStoreを読み書きするが、継承したrepositoryのin-memory current/cache/uncertainty状態を更新していない。

1. 同一instanceで52=Bをload後、owner commitでContext群とGlobalをCへ進める。diskのowner snapshotはCだが、`getCurrent(52)`はContext=B / Global=Bを返し続けた。
2. Bをload後、参照先Global JSONを破損させ、owner loadでquarantine/uncertainを検出させる。`loadRepositorySnapshot`はundefinedを返すのに、`getCurrent(52)`は旧Bを依然として返した。

これは公開API間のcurrentの不一致とfail-closed漏れである。これを原因とする実利用者データの上書きまでは再現しておらず、そこは断定しない。

**修正条件:** owner publication成功時に全Context/Global cacheを整合更新するか、明示的に無効化する。ownerのquarantine/uncertainは継承APIにも伝播させる。未公開のwrite失敗で新cacheを捏造せず、通常load/save/commit/createとの相互利用と再起動を検証する。

### PR108-IFR-007 — Medium / P2 — 実装・検証・通常レビューの記録が実態に追随していない

- Origin: `coverage_miss`
- Location: PR #108本文、`tasks/tasks-status.md:28`、`reports/`・`handoffs/`のPR108関連記録
- Evidence: reviewed source内の記録確認、取得したPR metadata、空の既存comments/reviews

PR本文は「TDDのRed段階」「contract testのみ」「実装・設計・検証reportは後続」と説明しているが、実際の差分には実装と設計があり、対象HEADのCIも成功済みである。taskのISSUE-106は「後続Issue登録済み」のまま。PR108自身の実装・検証・通常レビューreportを確認できず、PRの既存コメント・review submissionsも空だった。

過去にTDDを実施しなかったとは断定しない。確認できないのは、この実装のRed→Greenおよび通常レビューを追跡する証跡である。過去PR94のreportを今回の証拠として読み替えない。

**修正条件:** 実装内容・検証コマンド/結果・exact HEAD CI・未検証事項・リスクを実態どおり記録し、taskとPR本文を更新する。Red→Green証跡は取得できたものだけを記載し、不明は不明とする。今回7件の修正と通常fix verificationの記録を残してから独立closureへ戻す。本レビュワーの報告書で実装者・通常レビュワーの記録を代替しない。

## 6. Coverage dispositions

### 6.1 変更14ファイルの確認

| ファイル | 確認内容・disposition |
| --- | --- |
| `.github/workflows/ci.yml` | Issue106 gate、診断artifact、performance非追加。checked_no_finding |
| `doc/design/issue-106-owner-atomic-global-synchronization.md` | owner semanticsと全失敗境界。checked_finding: 001–005 |
| `eslint.config.mjs` | runtimeのno-useless-assignment無効化を確認。具体的不具合は追加認定せず |
| `src/adapters/state-repository/debounced-review-state-repository.ts` | owner queue/flushと通常操作の直列化。checked_finding: publication取消は005 |
| `src/adapters/state-repository/index.ts` | export切替と既存public APIの互換。checked_finding: 006 |
| `src/adapters/state-repository/owner-atomic-review-state-repository.ts` | exact CAS、manifest-last、検証、lock、失敗、current cache。checked_finding: 005/006 |
| `src/adapters/state-repository/owner-aware-debounced-review-state-repository.ts` | delegate owner APIと既存queue境界。個別の追加指摘なし |
| `src/application/github-pr-context/github-pull-request-context-layer-store.ts` | prepareとhistory分離、metadata-only、不変性。個別の追加指摘なし |
| `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts` | compatibility fallback削除、snapshot/evidence検証。001/004の修正時も安全性維持が必要 |
| `src/t405-owner-pull-request-synchronization.ts` | 全owner planning、一致判定、遅延、取消、history。checked_finding: 001/003/005 |
| `src/t405-review-contexts-runtime.ts` | production同期・再検出・選択・read projection・作成。checked_finding: 002/003/004 |
| `test/unit/issue-106-global-three-way-synchronization.test.ts` | CAS/失敗fixtureと検証の射程。既存pass、新規境界不足001/005/006 |
| `test/unit/issue-106-t405-owner-synchronization.test.ts` | owner契約fixtureの射程。実操作境界を追加probeで補完 |
| `test/unit/t405-github-lifecycle.test.ts` | source文字列assert変更と実compositionの区別。単なる呼出名検査では002–004を検出できない |

### 6.2 横断観点

| Criterion | Disposition | Evidence / remaining gap |
| --- | --- | --- |
| 要求・設計との整合 | checked_finding | 001–005、007 |
| 同一HEADの複数Context一括publication | checked_no_finding | 既存owner testsとproduction composition pass |
| exact expected CAS / stale / immutable write・manifest failure | checked_no_finding | 既存tests pass。取消だけ005として分離 |
| 異なるHEADの連続状態遷移 | checked_finding | 001、003、004 |
| private認証・再接続・選択経路 | checked_finding | 002、関連mock regression pass。live private未実施 |
| current cache・schema recovery・restart | checked_finding | 006、関連schema/owner実装と回帰を確認 |
| history順序・副作用のprepare分離 | checked_no_finding | publication成功後記録。post-commit history failureは下記制約 |
| cancellation・queue・owner lock | checked_finding | 005。OS別の全scheduler interleavingを網羅したとは扱わない |
| security / owner境界 / path / repository identity | checked_no_finding | 変更箇所の検証・manifest参照・owner分離を確認。独立した新規security defectは確定せず |
| テスト・実composition・過度なmock | checked_finding | new probesで不足境界を確認。既存文字列assertだけで統合成功とはしない |
| build/type/architecture/lint / exact-HEAD CI | checked_no_finding | run 33687437781成功。ローカル型検査は未実施 |
| scope / docs / task / reports | checked_finding | 007。誤字は下記非blocking観察 |

依存先としてcoherent/validated/atomic FS repository、schema recovery、storage lock、catalog/Global、core review-state-service、immutable snapshots、mapper/evidence loader、context service、history recorder、T405 diff runtime/UI/provider/controller、new-PR Global準備、README/既存設計・tracking/reportを確認した。変更行だけではなく、実際の利用経路を検証対象に含めた。

## 7. 指摘対応完了条件のmatrix

独立closureには各行のrequired action、production path、actual fixture、focused evidenceの4列をすべて満たす証跡を必要とする。現時点は全行openである。

| ID | Required action | Production path | Actual composition fixture | Focused evidence |
| --- | --- | --- | --- | --- |
| 001 | 異なるsourceの遅延PRをowner時に安全にcatch-up | owner planner → immutable mapper → owner CAS | 二段階B/B/B→C/B/C→C/D/D、Global先行のT405同期 | `deferred-catchup`と実mapperを使った新規回帰のGreen |
| 002 | unavailable後のcreate/Global advanceを禁止 | detect → synchronize → auth/search → create | unavailable sibling＋新規/既存PR選択、再接続 | `production-unavailable-new-pr`、manifest/state/history不変 |
| 003 | deferred revisionとread projectionを整合 | source snapshot → tree/progress → diff登録 | 異なるremote HEADの再検出・refresh・再起動 | `production-different-heads`、全PRが表示可能 |
| 004 | non-owner HEADの確認操作契約を実装 | canonical mark/unmark → core transaction | PR53=C/Global=Dのoriginal/modified両側 | `production-mark-other-head`、sibling/history不変性 |
| 005 | manifest公開までcancel/current fence維持 | owner queue/lock → atomic publication | 実storeでqueue待ち・書込み・公開前後abort | `cancel-before-manifest`、公開前はstate/history不変 |
| 006 | cache/uncertainを全owner APIへ反映 | owner load/commit ↔ inherited getCurrent | 同一instanceのowner/通常API混在・quarantine・restart | `getCurrent-after-owner`、`uncertain-owner-cache` |
| 007 | 実装/検証/通常レビュー証跡とtracking更新 | reports、tasks、PR説明 | 実行HEAD・ログ・修正matrixに基づく通常fix verification | 記録と実態の一致、historical Red不明点の明記 |

001〜006に対してsource text regexの追加だけ、helperのstubだけ、安全checkの除去だけでclosureとしない。上表の実利用経路の証拠を維持する。重要度は今回のHigh/Mediumを保持し、変更する場合は理由・元の重要度・新しい重要度・承認を明示する。

## 8. Held / unexplored / unknown / intentionally untouched

正式に免除されたrequired findingはない。7件を保留してpassにする判断はしていない。

設計§7は、append-only history store自身のpost-commit failureをstateと同一filesystem transactionへ含めない制約を明記している。この制約を再び独立bugとして重複計上しない。ただしhistoryまで全面的atomicであると保証するものではなく、残存リスクとして維持する。

未検証はlive private GitHub、追加probeの実機VS Code GUI、全OS/remote filesystemのscheduler組合せ、ローカルの完全CI同等gateである。現時点の失敗判定は直接再現済みの指摘に基づき、未検証部分の成功は主張しない。

過去のTDD Red実行の有無、リポジトリ外での通常レビューの有無は不明。npm ciの完了を確認できなかった原因も不明。GitHubの過去greenを新report HEADのCI結果へ転用しない。

非blocking観察として、runtimeに`対象PR`→`対豈PR`、`cacheへ`→`cacheほ`という無関係の文言劣化がある。今回のrequired 7件には加えない。安全性の問題が立証できなかった既存path実装、既存post-commit history制約、別Issueの修正を本レビューで勝手に変更しない。

## 9. 次の工程と保存境界

本報告書だけを既存PR branchへ記録し、PRへ7件をまとめたreview commentを投稿する。production code/test/workflow/taskをレビュワーが修正することはない。記録commitのparent/diffを検証し、PRのcurrent HEADを再取得して同SHAのCIを確認する。runがなければCI未実施、実行中なら実行中とし、旧HEADの成功で代用しない。

修正は実装工程へ戻し、TDD・診断artifact・通常fix verification・実装/検証report・task/PR説明更新を行う。その後、この同じ独立レビュワーのチャットで7件とCI差分に限定したbounded closureを行う。独立網羅レビューを別チャットで最初から繰り返す手順にはしない。

ローカルの完全な再現資料、標準出力/標準エラー/結果JSON、coverageとfinding matrixを含むschema-version 3 handoffはPR branch外で渡す。handoffを追加commitしてreview対象HEADをさらに動かさない。今回の判定はfailのままであり、mergeは行わない。

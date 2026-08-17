# T506 通常レビュー指摘対応 R2 レポート

- 文書種別: implementation review-followup report
- 生成日時: 2026-08-16T22:02:32+09:00
- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T506
- Pull Request: #55
- Branch: `task/t506-global-integration`
- Base: `main` (`146aec15783294da1795f268315c85d1a0dffa56`)
- 今回のreview follow-up開始時HEAD: `4cd1f3540fe160865e4981baf8e924034f054dca`
- 技術実装/検証HEAD: `01bf055e15730b510894cc815cec789c61c72e3a`
- 対応finding: `T506-REV-001` / High、`T506-REV-002` / High / introduced_by_fix
- 保存先: `reports/issue-1-t506-review-followup-r2-20260816220232.md`

## 1. 対応対象

### T506-REV-001 / High

前回のproduction document-edit wiringはGit working treeには接続されたが、`DocumentReviewEditRuntime.persist()`がGit repository以外を`unsupported-owner`として終了していた。そのため、T506の対象である非Git workspaceでは実`TextDocumentContentChangeEvent`からContext/Global range mappingと永続化へ到達せず、編集後のGlobal Understandingがstale evidenceとして0行になる同一defect classが残っていた。

要求された終了条件は、非Git workspaceの実Extension Hostで通常editorを編集し、変更・挿入行だけを未確認化、不変行の確認状態を維持し、Global Understandingへ反映し、再起動後も同じ結果を復元することである。

### T506-REV-002 / High / introduced_by_fix

前回追加したedit runtimeがbase extensionとは別の`FileSystemReviewStateRepository`と`JsonlReviewHistoryStore`を生成したため、同一Extension Host内でもstate/historyのinstance-local直列化境界が分離された。review commandやGit state mappingとedit mappingが並行すると、同じ旧snapshotを起点とするread/compare/writeやJSONL read-modify-replaceが別instanceで進行し、片方のstateまたはhistory eventを失う可能性があった。

これはT604のcross-window/cross-process lockではなく、同一process内で前回fixが導入した競合である。

## 2. Scope / 非対象

今回のscopeは次に限定した。

- 非Git workspaceのlive document editを既存workspace identityとContext/Global mappingへ接続する。
- 同一process内のstate repository instance間でstorage root単位のwrite serializationを共有する。
- 同一process内のhistory store instance間で月別JSONL file単位のappend serializationを共有する。
- edit runtimeへrepository/history recorder注入境界を追加し、stale CAS reload/replanを決定的に試験する。
- 実Extension Hostで非Git workspace editとrestartを検証する。

非対象:

- T604のcross-window/cross-process locking。
- T605のmulti-root/Remote SSH/Dev Containers/Codespaces境界。
- T607のscale/performance最適化。
- external-file ownerのlive edit追加。
- independent review verdict、finding closure、merge。

## 3. Diagnostic workflow確認

作業開始時点で`.github/workflows/ci.yml`と`tools/run-ci-command.mjs`によるfailure diagnostic artifactが存在していたため、workflow追加は不要だった。失敗時には少なくとも次を保存する。

- command別stdout (`*.stdout.log`)
- command別stderr (`*.stderr.log`)
- combined log (`*.log`)
- result metadata (`*.result.json`)
- environment / Git status / generated files
- `src/`、`test/`、`dist/`、`test-dist/`、`tools/`、設定file

今回のREDでもartifactを実際に取得・確認した。

## 4. TDD証拠

production変更より先に、2つのdefect classを独立して再現するtestを追加した。

### 4.1 T506-REV-002 concurrency RED

新規`test/integration/t506-live-edit-concurrency.integration.test.ts`は、edit mappingと通常review commandを意図的に並行させる。command側が先にstateをcommitした後、edit側が旧expectedでcommitしようとし、shared persistence boundaryならstaleを検出してreload/replanし、最終的に両更新と両history eventが残ることを要求した。

- test-only HEAD: `18c3a3e3c6195919a30f03058183cd548e8f63d1`
- HEAD一致CI: `31947728345` / failure
- failure artifact: `9263778874`
- 既存unit 494件: 494 pass
- 意図した失敗: `DocumentReviewEditRuntime did not use the injected shared repository.`

これにより、前回runtimeにbase/shared persistence boundaryを注入する境界が存在しないことをproduction修正前に再現した。

### 4.2 T506-REV-001 non-Git workspace RED

新規`test/vscode/t506-workspace-suite/index.ts`は、Gitを初期化しないworkspaceで実`TextEditor.edit()`を発火する2-phase Extension Host acceptanceを追加した。

Phase 1:

1. 2行fileを通常editorで開く。
2. production commandで2行を確認済みにする。
3. 途中へ1行挿入する。
4. Global Understandingが2/3、decorationが`[0,1)`と`[2,3)`になることを要求する。
5. saveする。

Phase 2:

- 同じworkspace/user-data/storageでExtension Hostを再起動し、同じ2/3とmapped decorationを要求する。

- test-only HEAD: `6a945b2a536f7167c99b21b529505a4090f6c826`
- HEAD一致CI: `31947812044` / failure
- failure artifact: `9263810873`
- 既存Git T506 3 phases: success
- 意図した失敗: Global Understanding `reviewedNonEmptyLineCount` が期待2に対して0 (`0 !== 2`)

artifact内のExtension Host stderrまで確認し、非Git production live-edit経路が成立していないことを直接確認した。

### 4.3 preliminary test fixture failure

初回test wiring HEAD `514d018e10482f48cbecf389196a7ff7d45865f0`はGlobal fixtureに存在しないfieldを入れたtest側型誤りでcompile停止した。artifact `9263750312`を確認し、production REDとしては採用せずtest fixtureだけを修正した。

## 5. Production修正

### 5.1 同一process state/history serialization

Commit `1becda187aac89f718f69851032f6fb9a4c733f4` (`fix(t506): serialize same-process state and history writers`)

`src/adapters/state-repository/validated-file-system-review-state-repository.ts`:

- `outerWriteTailByStorageRoot`をinstance-localからmodule共有の`sharedOuterWriteTailByStorageRoot`へ変更。
- 同一Extension Host内の複数repository instanceが同じstorage rootへwriteする場合、既存のcomplete-snapshot CAS/read-modify-write境界を同一queueで直列化する。
- cross-process lockingは追加していない。

`src/adapters/state-repository/jsonl-review-history-store.ts`:

- history append queueをinstance-localからmodule共有の`sharedHistoryTailByFilePath`へ変更。
- 同一process内の別storeが同じ月別JSONLをappendしてもread-modify-replaceが重ならず、event lost updateを防ぐ。

### 5.2 edit runtimeのowner/service境界

Commit `06f06af512dded2fc17edb6651c30b25be66328e` (`fix(t506): map live edits through injected owner services`)

`src/document-review-edit-runtime.ts`:

- repositoryとhistory recorderを注入可能にした。
- 注入がないproduction pathでも既存filesystem adaptersを利用し、上記shared same-process serializationへ参加する。
- `WorkspaceIdentityService`を利用して非Gitworkspaceのrepository/context/file identityを既存workspace session providerと同じcontractで解決する。
- workspace revisionは既存contractと同じ`workspace-live:<workspaceId>`を使用する。
- Git / workspace双方でContextとGlobalのbefore/after evidenceを比較し、確実なbeforeだけをrange mappingする。
- complete expected/next Context+Global snapshotをCAS commitする。
- stale CASは最新snapshotをreloadして再計画する。
- state commit成功後に`ReviewHistoryRecorder.recordDocumentEditMapping()`から`invalidated-by-edit`をContext/Global両range付きでappendする。

`src/application/review-history/review-history-recorder.ts`:

- committed live edit用`recordDocumentEditMapping()`を追加し、既存history routing/canonical event boundaryへ統合した。

### 5.3 VS Code workspace ownership wiring

Commit `98d06a2683fda76184b4cde6bfa5f6bf6ea79bf8` (`fix(t506): bind live edits to workspace ownership`)

`src/t305-extension.ts`:

- edit snapshotへ`workspaceFolderUri`とworkspace-relative pathを追加。
- `vscode.workspace.getWorkspaceFolder()`と`asRelativePath(..., false)`から、実document eventをworkspace identityへ結びつける。
- 既存Git owner precedenceは維持し、Git repositoryならGit path、非Gitworkspaceならworkspace pathを使う。

## 6. Regression testとGREEN

### 6.1 concurrency regression

`test/integration/t506-live-edit-concurrency.integration.test.ts`は、shared/injected repositoryを使い次を固定する。

- file A edit mapping: `[0,2)` → `[0,1), [2,3)`。
- file B review command: `[]` → `[0,1)`。
- command commitを先に成立させ、edit commitのold expectedをstaleにする。
- edit runtimeはreload/replanして両stateを保持する。
- historyは`marked-reviewed`と`invalidated-by-edit`の2 eventを保持する。

T506 focusedがsuccessであるため、この回帰もsuccessしている。

### 6.2 non-Git Extension Host regression

production修正HEAD `98d06a...` の初回GREEN候補CI `31948291706`では、build/typecheck/architecture/lint/unitおよび既存Git T506 phasesはすべて成功したが、新しいworkspace testが固定150ms待機後に状態を読む競合で失敗した。artifact `9263937224`を確認し、失敗は引き続き`0 !== 2`だった。

この失敗をproduction defectと決めつけず、testを固定sleepから最大5秒の黒箱pollへ変更した。production Global Understandingが実際にmapped evidenceへ到達した時点でassertするため、処理時間に依存しない。

Commit `01bf055e15730b510894cc815cec789c61c72e3a` (`test(t506): await non-Git live edit persistence deterministically`)

最終技術HEAD一致CI:

- HEAD: `01bf055e15730b510894cc815cec789c61c72e3a`
- workflow run: `31948543156`
- conclusion: `success`
- exact `head_sha` match: yes

成功step:

- Build
- Contract typecheck
- Architecture validation / negative contract
- Lint
- Unit tests (494/494)
- T602 history rewrite recovery
- T403/T404/T304/T502/T503/T504/T505 focused suites
- **T506 Global multi-context integration**（既存Git3-phase、non-Git2-phase、concurrency regressionを含む）
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのrunは最終技術判定に代用していない。

## 7. Finding対応状況

### T506-REV-001 / High

implementation response: completed。

- Git working treeの既存live-edit受入を維持。
- 非Gitworkspaceの実`TextDocumentContentChangeEvent`をworkspace ownerへrouting。
- Context/Global mapping、CAS persistence、Global Understanding、decoration refreshをproduction wiringで通す。
- 実Extension Hostでedit後2/3とrestart後同一2/3を検証。

reviewer closure verdictは本workerの責務ではないため、threadは未解決のままfix verificationへ引き渡す。

### T506-REV-002 / High / introduced_by_fix

implementation response: completed。

- state writerをstorage root単位のsame-process shared queueへ統合。
- history writerをhistory file単位のsame-process shared queueへ統合。
- edit runtimeへrepository/history recorder注入境界を追加。
- command/edit競合でstale retry後も両stateと両history eventが残る決定的回帰を追加。

reviewer closure verdictは本workerの責務ではないため、threadは未解決のままfix verificationへ引き渡す。

## 8. Intentionally untouched / remaining boundary

- `tasks/tasks-status.md`: repository先頭規則により専用task-management Skillのみ更新可能。今回のworker setに存在しないため未変更。
- `Design/BreakingChanges.md`: breaking changeを導入していないため未変更。
- T604 cross-window/cross-process lock: 今回はsame-process競合だけを修正し、T604 scopeを侵食していない。
- external-file live edit: T506-REV-001の再レビュー要求は非Gitworkspaceであり、今回追加していない。
- merge: 実施しない。

## 9. 次の手順

このreport/handoffをPR branchへ保存した後はHEADが変わるため、`01bf...`のrunを最終PR HEAD判定へ代用しない。report/handoff commit後のcurrent HEADに完全一致するworkflow runを確認し、結果をPR簡易reportへ投稿する。

その後、`T506-REV-001`と`T506-REV-002`を通常reviewerのfix verificationへ引き渡す。threadはimplementation workerからresolveしない。

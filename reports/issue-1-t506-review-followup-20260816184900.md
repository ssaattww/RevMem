# T506 通常レビュー指摘対応レポート

- 文書種別: implementation review-followup report
- 生成日時: 2026-08-16T18:49:00+09:00
- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T506
- Pull Request: #55
- Branch: `task/t506-global-integration`
- Base: `main` (`146aec15783294da1795f268315c85d1a0dffa56`)
- 通常レビュー対象HEAD: `a6bd4d21477d4a32795acf3e762812971ca0216b`
- 対応対象finding: `T506-REV-001` / High
- 技術修正HEAD: `535f8e0cb67425899e3bf6852a91620eb5b3b5f5`
- 保存先: `reports/issue-1-t506-review-followup-20260816184900.md`

## 1. 対応対象

通常レビューで、T506の変更追従試験が`mapRepositoryGlobalStateThroughDocumentChanges`を直接呼び出しており、実productionの`TextDocumentContentChangeEvent`経路にGlobal range mappingとatomic persistenceが配線されていないため、製品実動作では編集後のGlobal確認範囲がstaleになる、という指摘を受けた。

要求された修正は次の4点である。

1. 実`TextDocumentContentChangeEvent`から編集前後snapshotとchange列を取得する。
2. Context/Globalの確認範囲を既存range mapping contractで追従させる。
3. 完全snapshot CASでContext/Globalをatomicに永続化する。
4. 永続化成功後に通常editor decorationとGlobal Understandingを再計算し、Extension Hostで編集後の不変Global範囲維持と再起動後の同一理解率を検証する。

このfollow-upでは`T506-REV-001`だけを対象とし、別taskに明示されているmulti-window locking、Remote/multi-root、scale最適化は扱っていない。

## 2. 着手時diagnostic workflow確認

`.github/workflows/ci.yml`にはT506初回実装で追加済みのfailure diagnosticsが存在し、各CI commandは`tools/run-ci-command.mjs`を経由して次を`test-output/ci/`へ保存する。

- `<label>.stdout.log`
- `<label>.stderr.log`
- `<label>.log`（stdout/stderr combined）
- `<label>.result.json`（command、args、開始/終了、exitCode、signal、spawn error）

CI failure時は加えてenvironment、Git status、生成物一覧、`dist/`、`test-dist/`、`src/`、`test/`、`tools/`、設定fileをartifactとしてuploadする。したがってfollow-up開始時点で追加workflow変更は不要だった。

## 3. TDD証拠

### 3.1 REDを先行追加

通常レビュー後、production修正より先にExtension Host回帰を段階的に追加した。

| Commit | 内容 |
| --- | --- |
| `8f9015278566a1eff60ae8ef1a16edbcc14f3e99` | 通常editorを実production経路で開き、確認済み化後に編集する回帰シナリオを追加 |
| `4d5f2df078a85f3f620a5e7ac85b1edf35614e5` | Test mode APIからproduction Global Understanding snapshotを観測できるようにした |
| `02a3aba262f90a2d918998c3eb5a39c7bb1cd106` | live edit後にGlobal Understandingが2/3を維持することを要求 |

最終test-only HEAD `02a3aba262f90a2d918998c3eb5a39c7bb1cd106`に完全一致するCI run `31933264222`は`failure`だった。job `95131189016`のうち、Build、typecheck、architecture、lint、unit、T505まで全て成功し、`T506 Global multi-context integration`だけが失敗した。

failure artifact `9259917030`（`ci-failure-diagnostics-31933264222-1`）を確認し、T506のintegration部分はpass、実Extension Host phase `t506-mark-context-a`が次で失敗していた。

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
0 !== 2
at assertMappedGlobalUnderstanding(.../t506-suite/index.js)
```

これはレビュー指摘どおり、通常editorで編集した後にproduction Global Understandingが確認済み2行を維持できず0行へ落ちるREDである。artifactには`test-t506.stdout.log`、`test-t506.stderr.log`、`test-t506.log`、`test-t506.result.json`、Extension Host launch diagnosticsが実在することも確認した。

### 3.2 GREEN実装

RED確認後に次のproduction修正を積んだ。

| Commit | 内容 |
| --- | --- |
| `f384a068da563afe08f57132c638e46771529528` | live editor review mappingを永続化するruntimeを追加 |
| `50835b683f85b195ec289bf8f7c3b1edf35614e5` | `t305-extension.ts`の実`onDidChangeTextDocument`をruntimeへ接続 |
| `535f8e0cb67425899e3bf6852a91620eb5b3b5f5` | 既存persistence contractに合わせて完全snapshot CASを使用する形へ整合 |

## 4. Production変更

### 4.1 `src/document-review-edit-runtime.ts`

`DocumentReviewEditRuntime`を追加した。

- filesystem-backed documentの直前snapshotを`observe()`で保持する。
- `apply()`でVS Code eventのchange coordinatesが参照する直前snapshotを同期的に確定し、after snapshotへ観測値を進める。
- 同一documentのmapping/persistenceをPromise tailで直列化する。
- Local Git inspectionからrepository owner、branch context、HEAD revision、repository-relative pathを解決する。
- persisted Context/Global stateがbefore snapshotに一致する場合だけmappingする。
- Contextは`mapReviewedRangesThroughDocumentChanges`、Globalは`mapRepositoryGlobalStateThroughDocumentChanges`を利用する。
- stale/曖昧なstateは確認済みとして継承せずfail closedに除去する。
- `FileSystemReviewStateRepository.commit()`へ完全なexpected/next Context/Global snapshotを渡し、stale CAS時は最新snapshotをreloadして再計画する。
- state commit後に`invalidated-by-edit` history eventをContext/Global双方のbefore/after range付きでappendする。
- deactivation時に`drain()`で未完了mappingを待つ。

既存public persistence repositoryの`commit()`はstorage root単位でwriteを直列化し、完全expected Context/Global snapshotを比較した後にmanifest-last transactionとしてnext snapshotを公開する。このcontractへ修正runtimeを接続した。

### 4.2 `src/t305-extension.ts`

実VS Code wiringを追加した。

- activation時に開いているfilesystem documentをedit runtimeへobserveする。
- `onDidOpenTextDocument`で新規document snapshotをobserveする。
- `onDidChangeTextDocument`で実`contentChanges`をrange/rangeOffset/rangeLength/textまで保持してruntimeへ渡す。
- mapping/persistenceが`applied`になった後にvisible editor decorationとGlobal Understandingをrefreshする。
- mapping/persistence failureはerror messageへ出し、誤った確認済み状態を成功扱いしない。
- close時にsnapshotをforgetする。
- deactivate時にpending edit mappingをdrainしてからbase extensionをdeactivateする。

## 5. Extension Host回帰

`test/vscode/t506-suite/index.ts`は、review findingで要求された製品経路を直接通すように拡張した。

Phase 1で通常editor `review.ts`を開き、production commandで2行を確認済みにした後、line 1へ未確認行を1行挿入する。期待値は次のとおり。

- 編集前Global Understanding: 2/2 = 1.0
- 編集後Global Understanding: 2/3
- decoration interval: `[0,1)`と`[2,3)`
- 挿入行は未確認
- 不変suffixは1行shiftして確認済みを維持

その後fileをsaveし、同一workspace/user-data/storageでExtension Hostを再起動する。Phase 2/3の冒頭でもGlobal Understanding 2/3と同じmapped intervalを再確認するため、永続化された結果がrestart後も同じ理解率と装飾へ復元されることを検証する。

既存のmulti-context検証も維持しており、Context A固有PR確認状態、Context BからのGlobal解除、Global状態のPR Progress非混入を引き続き同じsuiteで確認する。

## 6. GREEN検証

技術修正HEAD `535f8e0cb67425899e3bf6852a91620eb5b3b5f5`に完全一致するCI run `31933811618`、job `95132565212`を確認した。

結果は`success`で、以下を含む全stepが成功している。

- Install dependencies
- Build
- Contract typecheck
- Architecture validation / negative contract
- Lint
- Unit tests
- T502/T503/T504/T505 focused regressions
- **T506 Global multi-context integration**
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのrunは最終技術検証へ代用していない。

## 7. 指摘への対応結果

`T506-REV-001`が要求した実経路は、現在の技術修正HEADで次の順に成立する。

`TextDocumentContentChangeEvent` → before/after snapshot → Context/Global range mapping → complete-snapshot CAS persistence → history append → decoration refresh / Global Understanding refresh → restart restoration

また、回帰testはhelperだけを直接呼ぶ形ではなく、実`TextEditor.edit()`からVS Code eventを発生させてproduction activation wiringを通す。

この文書はimplementation workerとしての対応証拠であり、review findingの最終closure verdictそのものは出さない。通常review threadはreviewerによるfix verification対象として残す。

## 8. Repository tracking / 非対象

- `tasks/tasks-status.md`はrepository規則上、専用task-management Skillだけが更新可能である。このworker setに当該Skillがないため直接更新しない。
- breaking changeは導入していないため`Design/BreakingChanges.md`は更新しない。
- mergeは行わない。

## 9. 次の手順

1. このfollow-up report/handoff commit後のPR current HEADに一致するCIを再確認する。
2. PRへ変更内容と検証結果の簡易reportを投稿する。
3. `T506-REV-001`のreviewer fix verificationへ引き渡す。

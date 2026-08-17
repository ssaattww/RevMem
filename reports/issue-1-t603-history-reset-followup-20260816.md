# T603 履歴破損時リセット方針 follow-up 実装レポート

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: `#53`
- Task: `T603`
- Branch: `task/t603-schema-migration-recovery`
- Base: `main`
- 直前のreview-follow-up administrative HEAD: `1c8988dc93f2d5605895a09084623b5fb66bca1f`
- 本follow-upの仕様・実装・test・BreakingChanges HEAD: `c3e7d230e8a5f47d33933dea553e9f0b695ef904`
- Exact-head CI: run `31942719872`, job `95154110269`, conclusion `success`
- Merge: 実施しない。mergeは利用者が行う。

## 2. 今回確定した仕様

利用者から次の明示判断を受けた。

> 壊れたら、履歴は1からで良い。ただし、壊れたやつは隔離して捨てない。

この判断により、以前 `T603-B001` として残していた task wording と accepted design rev4 §15.4 のauthority conflictは解消した。

確定仕様は以下。

1. activeな月次review-history JSONLに破損または内部不整合を検出した場合、元ファイル全体をquarantineへコピーする。
2. quarantineした元ファイルはこの回復処理では削除しない。
3. quarantine元から正常に読めるeventをsalvage/replay/mergeしない。
4. append中に破損を検出した場合、元active履歴を除去した後、今回appendするvalid eventを新active履歴のevent/line 1として保存する。
5. startup migration中に破損を検出した場合、元active履歴をquarantineしてactive pathから除去し、次のvalid eventが来るまでactive履歴は存在しない状態とする。
6. unsupported future schemaは通常のcorruptionとは扱わず、従来どおりrejectする。quarantine/resetしない。
7. current review stateはhistoryから再構築せず、state repositoryのsnapshotをauthoritativeとする既存設計を維持する。

## 3. 作業開始時のdiagnostic workflow確認

`.github/workflows/ci.yml`には今回の作業開始時点ですでに必要なfailure diagnosticsが存在したため、新しいdiagnostic workflowは追加していない。

既存workflowで以下を保持している。

- 各commandのstdout/stderrを`2>&1 | tee test-output/ci/*.log`で保存
- failure時のenvironment、Git status、generated file一覧
- `test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、tools、type fixtures、config、workflow等をartifactへ保存
- `if: failure()`でfailure artifactをupload

今回のT603 testも同じdiagnostic artifact経路へ配線した。

## 4. TDD evidence

### 4.1 新仕様 Red

新仕様の実装前に以下のtestを追加した。

- corrupt JSONLをquarantine後、新eventだけでactive履歴を再開する
- corrupt JSONL内のvalid eventをsalvageしない
- startup migrationでcorrupt historyをquarantineしactive pathから除去する

Test-first commit:

- HEAD: `d1dbe39c574fbe2bda683b466950c8777ff411a3`
- Commit: `test: define corrupt history reset behavior`
- Exact-head CI run: `31941969296`
- Job: `95152361908`
- Result: `failure`
- Failure step: `T603 schema migration and corruption recovery tests`
- Build / contract typecheck / architecture / lint / unit / T602は成功
- Diagnostic artifact: `9262264629` (`ci-failure-diagnostics-31941969296-1`)

このrun以外のSHAはRed判定に代用していない。

### 4.2 実装

- HEAD: `83e7f614630c1ee37b924254f520e4aec55698d3`
- Commit: `fix: restart corrupt review history after quarantine`

`src/adapters/state-repository/jsonl-review-history-store.ts`を変更した。

- corruption検出時は`quarantinePersistedText`のactive removalを有効にし、元JSONL全体をquarantineへ保持する。
- append時はcorrupt history由来の`prepared.content`を一切再利用せず、新event 1件だけでactive JSONLを作る。
- startup migration helperはcorruption時に`reset`を返し、active historyを除去する。
- valid legacy historyのmigration/backupは従来どおり行う。
- `UnsupportedPersistedSchemaVersionError`は従来どおり伝播し、future schemaをresetしない。
- repository-scoped monthly historyに複数contextを許容する既存R013修正は維持する。

実装HEADのexact-head run `31942021770` / job `95152482005` では、新仕様test自体は成功した。failureは旧review時に固定された「R008/R013は破損時append reject」という2件のexpectationだけだった。

- Diagnostic artifact: `9262278625` (`ci-failure-diagnostics-31942021770-1`)

## 5. Superseded review expectationの扱い

`test/unit/t603-review-findings.test.ts`のR008/R013は、利用者判断前のaccepted design rev4 §15.4に基づくhistorical review evidenceであるため、履歴として残した。

T603 CIでは次の扱いに変更した。

- historical `t603-review-findings.test.js` は R001-R007 / R009-R011 / R014 を引き続き実行する。
- supersededされた旧R008/R013 expectationはname patternで実行対象外にする。
- 新規 `test/unit/t603-history-reset-decision.test.ts` で、今回確定したR008/R013相当の新仕様を直接検証する。

新decision suiteは少なくとも以下を固定する。

- corrupt JSONL全体がquarantineに正確に保存される。
- active履歴は次のvalid event 1件だけで再開する。
- corrupt file内のvalid eventをsalvageしない。
- wrong repository owner / wrong month / duplicate eventIdの不整合historyもquarantine後に新eventから再開する。
- unsupported future schemaはresetせずrejectし、元active fileを保持する。

CI配線の最初のnegative-lookahead patternはNode test runnerで意図どおり除外できず、HEAD `3b38953378fb7dbc54d03b617d648c721e1b854c` のexact-head run `31942510600` / job `95153613895` で旧R008/R013だけがfailureした。

- Diagnostic artifact: `9262401060` (`ci-failure-diagnostics-31942510600-1`)

そのため `12fb1c772eb2861e58e99875247ddf4884fb9745` で実行対象をpositive patternで明示し、旧R008/R013だけを除外した。

## 6. Breaking change記録

Repository `AGENTS.md` の規則に従い、`Design/BreakingChanges.md`へ2026-08-16の変更を記録した。

記録内容:

- ownerの明示判断がrev4 §15.4の「corrupt historyがactiveな間は後続appendをreject」の記述を上書きする。
- corrupt active JSONLは全体をquarantineへ保持し、active pathから除去する。
- salvage/replayはしない。
- 次のvalid eventから履歴を1件目として再開する。
- startup時は次eventまでactive historyなしとする。
- future unsupported schemaはresetしない。

これにより `T603-B001` はauthority decision resolvedとして扱える。

## 7. Green validation

### 7.1 技術Green

- HEAD: `12fb1c772eb2861e58e99875247ddf4884fb9745`
- Exact-head CI run: `31942578835`
- Job: `95153775014`
- Conclusion: `success`

成功した主なstep:

- Build
- Contract typecheck
- Architecture validation / negative contract
- Lint
- Unit tests
- T602 focused suite
- T603 migration / corruption recovery / owner-decision suite
- T403 / T404 / T304 / T502 / T503 / T504 / T505 focused suites
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

### 7.2 BreakingChanges反映後Green

- HEAD: `c3e7d230e8a5f47d33933dea553e9f0b695ef904`
- Exact-head CI run: `31942719872`
- Job: `95154110269`
- Conclusion: `success`

仕様記録後も全stepが成功した。別SHAのrunは判定に使用していない。

## 8. 変更ファイル

今回のowner-decision follow-upで変更・追加した主要file:

- `src/adapters/state-repository/jsonl-review-history-store.ts`
  - corrupt historyをquarantine後にactive resetする実装
- `test/unit/review-history-jsonl-store.test.ts`
  - corrupt history reset behaviorのtest-first expectation
- `test/unit/t603-schema-migration-recovery.test.ts`
  - reset/no-salvage/startup quarantine behavior
- `test/unit/t603-history-reset-decision.test.ts`
  - owner decisionを直接固定するR008/R013相当の専用suite
- `.github/workflows/ci.yml`
  - owner-decision suiteを実行し、superseded historical R008/R013 expectationのみ除外
- `Design/BreakingChanges.md`
  - rev4 §15.4を上書きするowner decisionを記録

`tasks/tasks-status.md`はrepository規則上、implementation workerが直接更新していない。

## 9. Commit / CI chronology

- `d1dbe39c574fbe2bda683b466950c8777ff411a3` — test-first: corrupt history reset behavior
  - run `31941969296` / job `95152361908` — expected Red
  - artifact `9262264629`
- `83e7f614630c1ee37b924254f520e4aec55698d3` — implement quarantine + active history reset
  - run `31942021770` / job `95152482005` — new behavior passed; obsolete R008/R013 expectations failed
  - artifact `9262278625`
- `ec296cf1f8a185eb956efbebbafbb008a7977b79` — add owner-decision focused suite
- `3b38953378fb7dbc54d03b617d648c721e1b854c` — first CI alignment attempt
  - run `31942510600` / job `95153613895` — pattern error; new behavior suite passed
  - artifact `9262401060`
- `12fb1c772eb2861e58e99875247ddf4884fb9745` — correct CI test-name selection
  - run `31942578835` / job `95153775014` — success
- `c3e7d230e8a5f47d33933dea553e9f0b695ef904` — record owner decision in BreakingChanges
  - run `31942719872` / job `95154110269` — success

作業中にconnector操作確認用のplaceholder fileが一度生成されたが、直後のcommitで削除しておりnet treeには残っていない。このno-op操作はT603機能差分に含まれない。

## 10. 結論

利用者が指定した「履歴が壊れたら履歴を1から開始する。ただし壊れた元履歴は隔離して捨てない」という仕様を実装した。

- 元のcorrupt historyは丸ごとquarantineへ残る。
- active historyにはcorrupt history由来のeventを引き継がない。
- 次のvalid eventが新履歴の1件目になる。
- startupで見つかった場合は次eventまでactive historyなし。
- future schemaはcorruption resetの対象外。
- T603-B001はowner decisionにより解決済み。
- exact-head full CIはsuccess。
- Mergeは実施していない。

このreport自身を保存するcommit後はPR HEADが変わるため、最終administrative HEADと完全一致するCIを再確認し、そのrunをPR description/commentへ記録する。

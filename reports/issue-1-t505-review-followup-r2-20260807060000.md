# T505 第2回レビュー指摘対応レポート

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T505`
- Pull Request: `#43`
- Branch: `feature/t505-global-understanding-ui`
- Base branch: `main`
- Base SHA: `d83d59a39de35e764bc025be661192847c2a1bcf`
- Source fix-verification HEAD: `571831f7ef687a0c4ecb9d65eb829fee50e590e2`
- Review evidence HEAD: `247aff511bbb1e4d4785c15c362b47d259aa46c9`
- Technical implementation HEAD: `bca430848b9627add973136734569c88c60cfbc4`
- 作業種別: review follow-up implementation
- Merge: 未実施

## 2. 対応対象

第2回fix verificationで残った次の4件を全て対象とした。

| Finding | Severity | 対応結果 |
| --- | --- | --- |
| T505-R002 | Medium | addressed |
| T505-R005 | Medium | addressed |
| T505-R006 | Low | addressed |
| T505-R007 | Low | addressed |

fix workerはreview verdictを変更していない。判定は元reviewerによる再検証対象である。

## 3. 開始時のdiagnostic workflow確認

`.github/workflows/ci.yml`には、失敗時に次をartifactへ保存する処理が既に存在する。

- test結果
- 各工程の標準出力・標準エラー
- build/test生成物
- source、test、tools、type fixture
- Node/npm/runner/SHA/ref等の環境情報
- Git状態と生成file一覧

新しいdiagnostic workflow変更は不要と判断した。

## 4. TDD証跡

### 4.1 RED tests

current review evidence HEADから、先に次の契約をtestへ追加した。

- split snapshot limitsでper-snapshotとaggregateの双方を必須にする型契約
- `maxTotalCompressedBytes >= maxSnapshotCompressedBytes`のruntime不変条件
- cleanup後も新規保存snapshotとlatest pointerが実在する契約
- stale generationの失敗をcancellationとして吸収する契約
- document change refreshのdebounce/coalesce契約
- debounce予約時点でin-flight generationをinvalidateする契約
- `test:t505`からreview-finding suiteを直接1回実行する契約
- schema v3 handoffのflat top-level fieldとsource payload保持契約

GitHub connectorでRED test HEAD、PR reopen、main同期後HEADを確認したが、いずれにも`pull_request` workflow runが生成されなかった。別SHAのrunは代用していない。

補助的なローカルRED probeでは次を確認した。

- `NonGitSnapshotLimits`の不完全split objectに対する`@ts-expect-error`が未使用となり、型契約が不足していた。
- `GlobalUnderstandingRefreshCoalescer`が未実装だった。
- `test:t505`が`test-dist/test/unit/t505-review-findings.test.js`を実行していなかった。

既存artifact環境での`npm ci`は、内部registryの`yocto-queue`取得404および外部DNS制約によりfull local suiteを再構築できなかった。この制約はGitHub CI成功を意味しない。

## 5. 実装内容

### 5.1 T505-R002 — snapshot limit contractと保存後不変条件

`NonGitSnapshotLimits`を次のrequired unionへ変更した。

- legacy contract: `maxCompressedBytes`を必須とし、split fieldsを禁止
- split contract: `maxSnapshotCompressedBytes`と`maxTotalCompressedBytes`を双方必須とし、legacy fieldを禁止

追加したruntime不変条件:

- aggregate limitがper-snapshot limit未満の場合はconstructorで拒否する。
- user-facing resolverはaggregate defaultとper-snapshot settingの最大値をaggregate limitに使用する。
- cleanupは今回保存したsnapshotを削除候補から除外する。
- cleanup後に保存snapshotの実在を確認してから成功を返す。
- `saveLatest`は実在確認済みsnapshotだけをlatest pointerへ公開する。

これにより、同一timestampでsnapshot ID順が逆転する場合や、count/byte cleanupが発生する場合も、成功した保存結果が欠落しない。

### 5.2 T505-R005 — stale cancellationとrefresh coalescing

`GlobalUnderstandingRefreshController`へ、表示をclearせずgenerationだけ進める`invalidate()`を追加した。

- stale generationが成功・失敗した場合は`undefined`で終了する。
- current generationの実障害だけが表示をclearして例外を上位へ返す。

`GlobalUnderstandingRefreshCoalescer`を追加した。

- document changeごとにin-flight generationを直ちにinvalidateする。
- pending timerをcancelして150ms後の1回へ集約する。
- timer発火時点の最新requestだけが再計算する。
- save/close時はpending timerをcancelして即時再計算する。
- dispose時はpending timerを解放する。

VS Code runtimeへclearを伴わない`invalidate()`を公開し、T305 compositionから利用した。

### 5.3 T505-R006 — focused validation discovery

`package.json`の`test:t505`を更新し、次を直接実行するようにした。

- `global-understanding-ui.test.js`
- `t505-review-findings.test.js`

full unit suite内のtransitive importには依存しない。contract testでreview-finding suiteがfocused commandにexactly once含まれることを固定した。

### 5.4 T505-R007 — schema v3 handoff

`handoffs/issue-1-t505-review-followup-20260806210039.yaml`をflat schema v3 packetとして再生成した。

- `producer`、`repository`、`target`、requirements、policy、scope、files、commands、tests、CI、implementation、review、report、findings、held、next action、transportをtop-levelへ配置
- 不正なtop-level `handoff:` wrapperを除去
- 元の非準拠packetを`source_payloads`へ保持
- fix workerがreview verdictを変更していないことを明示

## 6. main同期

作業中にmainが`d83d59a39de35e764bc025be661192847c2a1bcf`へ進んだ。変更はREADMEの制限説明とそのreportで、T505実装と競合しなかったためmainをbranchへmergeした。

- Merge commit: `316efab738703a9b318a94b8ae72585c3eb34f04`
- merge後、PRのmerge refが再生成されmergeableになった。

## 7. 検証結果

### 7.1 ローカル補助検証

| 検証 | 結果 |
| --- | --- |
| strict split limits type probe | passed after implementation |
| aggregate/per-snapshot constructor invariant | passed |
| cleanup後の保存snapshot/latest pointer実在 | passed |
| stale generation failure cancellation | passed |
| debounce timer cancel/coalesce | passed |
| focused test discovery static check | passed |

これらは補助検証であり、GitHub Actionsの代替ではない。

### 7.2 GitHub Actions

Technical implementation HEAD `bca430848b9627add973136734569c88c60cfbc4`に一致するworkflow runは、複数回のconnector確認と30秒待機後も存在しなかった。

- exact-head run: **未生成**
- CI conclusion: **incomplete / not run**
- 別SHA runの代用: **なし**

直近の成功run `31099795538`はHEAD `571831f7ef687a0c4ecb9d65eb829fee50e590e2`に対するものであり、今回の修正判定には使用していない。

## 8. 変更file

- `package.json`
- `src/application/non-git-snapshots/index.ts`
- `src/application/non-git-snapshots/non-git-snapshot-settings.ts`
- `src/t305-extension.ts`
- `src/ui/global-understanding/global-understanding-ui-model.ts`
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`
- `test/unit/global-understanding-ui.test.ts`
- `test/unit/t305-validation-wiring.test.ts`
- `test/unit/t505-refresh-invalidation.test.ts`
- `test/unit/t505-review-findings.test.ts`
- `handoffs/issue-1-t505-review-followup-20260806210039.yaml`
- `reports/issue-1-t505-review-followup-r2-20260807060000.md`

## 9. Held

- `tasks/tasks-status.md`
- `tasks/phases-status.md`

repository規約で専用progress-management Skill経由の更新が必要だが、現在のworker Skill setに該当Skillがないため直接変更していない。

## 10. 残余リスク・次工程

- current HEADのfull CIは未実施であり、build、lint、全unit、focused、Git/GitHub integration、Extension Hostの最終判定は未完了である。
- exact-head workflow runが生成された後、同じHEADで全stepを確認する必要がある。
- 元reviewerがT505-R002/R005/R006/R007を独立fix verificationする必要がある。
- mergeは利用者が行うため、本workerは実施していない。

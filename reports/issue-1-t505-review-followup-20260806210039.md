# T505 レビュー指摘対応レポート

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T505`
- Pull Request: `#43`
- Branch: `feature/t505-global-understanding-ui`
- Base branch: `main`
- Base SHA: `112198c33823a5fc6681399a19e0c5361614143f`
- 対応元review report: `reports/issue-1-t505-review-20260806195427.md`
- 対応元review submission: `PRR_kwDOTgwD488AAAABIoKnOg`
- Review follow-up mode: `review_followup`
- Technical implementation HEAD: `fdf324864a4227b3319cb50337fa880cdfe23267`
- Merge: 未実施

## 2. 対応対象

review reportで提示された4件をすべて対応対象とした。

| Finding ID | Severity | 指摘概要 | 対応結果 |
| --- | --- | --- | --- |
| `T505-R001` | High | Global理解率が未保存bufferではなくdisk内容を使用し、change/save/close後に再計算されない | addressed |
| `T505-R002` | Medium | `maxSnapshotFileSizeBytes`がsnapshot単体上限と総保存容量の両方へ流用される | addressed |
| `T505-R003` | Medium | Global集計だけがraw除外設定を再compileし、PR側のlast-valid policyと不一致になる | addressed |
| `T505-R004` | Medium | 不正なsnapshot設定値がactivation中に例外となり拡張全体を停止させる | addressed |

本workerはfindingの修正と検証を行った。review verdictの更新、独立fix verification、mergeは実施していない。

## 3. 開始時の診断artifact確認

`.github/workflows/ci.yml`には、失敗時に次を保存するdiagnostic artifact workflowが既に存在した。

- build、typecheck、lint、unit、focused、integration各stepの標準出力・標準エラー
- test結果
- `dist/`、`test-dist/`
- `src/`、`test/`、`tools/`、`type-fixtures/`
- package、TypeScript、ESLint、workflow定義
- Node/npm/runner/SHA/ref等のenvironment情報
- git statusと生成file一覧

このため、workflowの追加変更は不要だった。

## 4. TDD証跡

### 4.1 Red

- Test-first commits:
  - `7796eeefa70f2b3ad3ae1afb7fe4e6603a5f702b`
  - `b99c688a0aafa1927ac9a284c04e911d6e105208`
- RED HEAD: `b99c688a0aafa1927ac9a284c04e911d6e105208`
- HEAD一致workflow run: `31097985105`
- Job: `92604469123`
- 結果: failure
- 成功済みstep: build、contract typecheck、architecture positive/negative、lint
- 失敗step: unit compile
- 失敗原因:
  - snapshot単体上限と総容量を分離するcontractが未実装
  - shared exclusion policy injection contractが未実装
  - live open-document evidence contractが未実装
  - invalid setting fallback contractが未実装
- Failure diagnostic artifact:
  - ID: `8966248721`
  - Name: `ci-failure-diagnostics-31097985105-1`

別SHAのrunは代用せず、RED HEADに一致するrunだけで失敗を確認した。

### 4.2 Green途中経過

最初のproduction実装HEAD `d3c22296d8ea6e3e8571dc8803ef98110720ea26`では、次のrunを確認した。

- Workflow run: `31099257410`
- Job: `92608573470`
- build、contract typecheck、architecture positive/negative: success
- lint: failure
- 原因: shared policy service登録処理に対する`@typescript-eslint/no-this-alias`
- Failure diagnostic artifact: `8966755748`

静的品質指摘だけをcommit `fdf324864a4227b3319cb50337fa880cdfe23267`で修正した。

### 4.3 Green

- Technical implementation HEAD: `fdf324864a4227b3319cb50337fa880cdfe23267`
- HEAD一致workflow run: `31099364549`
- Job: `92608926179`
- 結果: success

別SHAのrunは使用していない。

## 5. Finding別対応

### 5.1 `T505-R001` High — 未保存bufferをGlobal理解率へ反映

#### 問題

T505 sourceはrepository file列挙とGlobal集計の双方でdisk内容だけを使用していた。VS Code上の未保存bufferが変化しても、Global Understanding ViewとStatus Barは保存前のdisk内容を分母・content hash・行証拠として使用し続けた。また、document change/save/closeイベントが再計算triggerへ接続されていなかった。

#### 対応

- `src/t305-extension.ts`でopen text documentからimmutable evidenceをcaptureするcompositionを追加
  - canonical repository-relative path
  - current owner revision
  - VS Code document line count
  - 非空行index
  - content hash
  - document versionを含むcache key
  - recalculation中のchange/closeを検知する`validateCurrent`
- `src/t505-global-understanding-source.ts`で、T503列挙済みfileのうちopen documentが存在するpathは次を同じsnapshotから置換
  - denominator用`nonEmptyLineCount`
  - T504 file source evidence
  - cache evidence
- open document snapshotとdisk snapshotを同じfile計算内で混在させない
- `openFilePaths`をT504へ渡し、open file優先処理を維持
- 次のeventをGlobal再計算へ接続
  - `onDidChangeTextDocument`
  - `onDidSaveTextDocument`
  - `onDidCloseTextDocument`
- document version/hashがrecalculation中に変化した場合はfail-closedでreject

#### 検証

- 未保存bufferがdiskと異なる状態で、Global分子・分母・stateがlive evidenceを使用すること
- save後にopen documentを閉じるとdisk evidenceへ切り替わること
- change/save/closeの3 eventがproduction compositionに接続されること
- stale live snapshotを受理しないこと

### 5.2 `T505-R002` Medium — snapshot単体上限と総容量を分離

#### 問題

`reviewRange.maxSnapshotFileSizeBytes`が`NonGitSnapshotTracker.maxCompressedBytes`へ渡され、その値がsnapshot単体rejectと全snapshot cleanupの両方へ利用されていた。このため、各snapshotが設定上限以内でも合計が上限を超えると古いsnapshotが削除された。

#### 対応

`NonGitSnapshotLimits`を次の2軸へ分離した。

- `maxSnapshotCompressedBytes`: 1 snapshotの圧縮後上限
- `maxTotalCompressedBytes`: 全snapshotのaggregate cleanup budget

互換性のため既存内部caller用のdeprecated `maxCompressedBytes`を一時的に受理し、未分離callerでは従来意味を維持する。

user-facing resolverは次を返す。

- `maxSnapshotCompressedBytes`: `reviewRange.maxSnapshotFileSizeBytes`
- `maxTotalCompressedBytes`: 独立default `128 * 5 MiB`
- `maxSnapshots`: 128
- `retentionMs`: 30日

#### 検証

- 2 snapshotがそれぞれ単体上限以内で、合計だけが単体上限を超えても両方保持されること
- aggregate budgetを明示的に超えた場合だけoldest-first cleanupする既存契約が維持されること
- count、expiration、corrupt/missing、mappingの既存T601回帰が通ること

### 5.3 `T505-R003` Medium — shared exclusion policyを再利用

#### 問題

PR側は`ReviewFileExclusionConfigurationController`と`ReviewFileExclusionPolicyService`がlast-valid policyを維持していたが、Global側はraw settingsを毎回読み、独立した`ReviewFileExclusionPolicy`を生成していた。不正設定時にPR側は旧policyを維持する一方、Global側は再計算失敗・表示消去となり、共通設定なのに挙動が分岐した。

#### 対応

- extension base compositionが生成したactive `ReviewFileExclusionPolicyService`をT505 compositionへ共有
- `NodeRepositoryFileEnumerator`のdependencyを構造的policy portへ変更し、serviceを直接注入
- serviceへdirectory pruning evaluationを追加
- Global sourceはraw設定を再compileせず、shared serviceだけを使用
- T504 cacheの`configurationKey`にはshared policyのmonotonic revisionを使用
- Global runtimeはshared policyの`onDidChange`を購読
- 不正設定でcontrollerのupdateが失敗した場合、service自体はlast-valid policyを維持し、Globalも同じpolicyを使用

#### 検証

- valid user glob適用後、不正negated globのupdateがrejectされてもGlobal denominatorとpruned directory countが変化しないこと
- 既存PR/Global共通policy testが通ること
- T503のfile/directory除外数分離が維持されること

### 5.4 `T505-R004` Medium — 不正snapshot設定でactivationを停止しない

#### 問題

manifestは`minimum: 1`だけで、workspace/user settingに`Number.MAX_SAFE_INTEGER`超過値、非整数、NaN相当、Infinity相当等が存在する場合、resolverが例外を投げ、extension activation全体を停止させる可能性があった。

#### 対応

- manifestへ`maximum: 9007199254740991`を追加
- runtime resolverは入力を`unknown`として検証
- 次の場合は例外を投げずdefault 5 MiBへfallback
  - 0以下
  - 非整数
  - NaN
  - Infinity
  - safe integer範囲外
- fallback後も独立aggregate budgetを維持

#### 検証

- invalid値集合すべてでresolverがthrowせずdefault limitsを返すこと
- manifest maximumが`Number.MAX_SAFE_INTEGER`と一致すること
- build、Extension Host lifecycleが成功すること

## 6. Commit構成

| Commit | 内容 |
| --- | --- |
| `7796eeefa70f2b3ad3ae1afb7fe4e6603a5f702b` | finding regression tests追加 |
| `b99c688a0aafa1927ac9a284c04e911d6e105208` | regression testsをdefault unitへ接続、RED確立 |
| `fb2e9d5937bb1bbdecf2a9f6b50a17bac4ce33b9` | R002/R004: snapshot limits分離と設定fallback |
| `6303a886d004552020b4fc75e12a2084d7130d42` | R003: shared exclusion policy再利用 |
| `d3c22296d8ea6e3e8571dc8803ef98110720ea26` | R001: live open-document evidenceとevent refresh |
| `fdf324864a4227b3319cb50337fa880cdfe23267` | lint contract修正 |

## 7. 変更file

- `package.json`
- `src/adapters/repository-files/node-repository-file-enumerator.ts`
- `src/application/file-exclusion/review-file-exclusion-policy-service.ts`
- `src/application/non-git-snapshots/index.ts`
- `src/application/non-git-snapshots/non-git-snapshot-settings.ts`
- `src/t305-extension.ts`
- `src/t505-global-understanding-source.ts`
- `test/unit/global-understanding-ui.test.ts`
- `test/unit/non-git-snapshot-tracker.test.ts`
- `test/unit/t305-validation-wiring.test.ts`
- `test/unit/t505-global-understanding-source.test.ts`
- `test/unit/t505-review-findings.test.ts`
- 本report
- review-followup handoff

## 8. 検証結果

Technical implementation HEAD `fdf324864a4227b3319cb50337fa880cdfe23267`に一致するrun `31099364549`で確認した。

| 検証 | 結果 |
| --- | --- |
| npm install | success |
| build | success |
| contract typecheck | success |
| architecture positive gate | success |
| architecture negative gate | expected 11 findings matched |
| lint | success |
| unit suite | 462 passed / 0 failed |
| T403 focused | 8 passed / 0 failed |
| T304 focused | 21 passed / 0 failed |
| T502 focused | 11 passed / 0 failed |
| T503 focused | 7 passed / 0 failed / 1 platform skip |
| T504 focused | 15 passed / 0 failed |
| Git integration | 36 passed / 0 failed |
| mock GitHub integration | 47 passed / 0 failed |
| VS Code Extension Host | all phases succeeded |

## 9. 設計・範囲

既存設計`doc/design/vscode-review-range-tracker-design.md`は、Global理解率がcurrent content evidenceを使用すること、共通除外policyをPR/Globalで再利用すること、snapshotのfile-size設定を定義済みである。今回の修正は実装を既存設計へ一致させるものであり、新しいproduct requirementは追加していないため、設計書本文は変更していない。

## 10. 意図的に変更していない領域

- `tasks/tasks-status.md`
- `tasks/phases-status.md`

両fileはrepository規約により`task-breakdown-planner`、`task-consistency-manager`、または`progress-sync-manager`経由の更新が必要である。現在利用可能なimplementation/review-followup Skillに該当manager Skillがないため、進捗同期はheldとした。

- review verdict: 変更していない
- PR draft状態: 維持
- merge: 実施していない

## 11. 既知事項

- open document evidenceはVS Code Extension Host上のdocument version、content hash、line snapshotへboundされる。recalculation中に変化した場合は結果を表示せず再計算対象とする。
- aggregate snapshot budgetは現在固定defaultで、user-facing設定はper-snapshot上限だけを変更する。
- deprecated `maxCompressedBytes`は既存内部caller互換のため残している。新規設定経路では使用していない。
- `npm ci`は既存依存関係についてhigh severity vulnerability 3件を報告した。本対応でdependencyは追加していない。

## 12. 次の工程

- 本report/handoffを含むPR current HEADに一致するCIを確認する
- 元reviewerによる独立fix verificationを実施する
- finding `T505-R001`〜`T505-R004`のreview dispositionを確認する
- authorized manager Skillでtask/phase進捗を同期する
- mergeは利用者が行う

本reportは修正証跡であり、review pass判定ではない。

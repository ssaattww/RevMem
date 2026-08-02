# T504 実装レポート

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T504`
- Pull Request: `#39`
- Branch: `task/t504-global-understanding-progress`
- Base branch: `main`
- Base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Technical implementation HEAD: `acb4ba7037029885a732535b71b24eb5eea7ae83`
- 作業種別: implementation
- Merge: 未実施

## 2. 受入範囲

T504として、T501のRepository Global StateとT503のrepository file列挙結果を入力に、次を実装した。

- repository別・file別Global理解率calculator
- current revisionで有効なGlobal確認済み範囲のうち、現在の非空行だけを分子へ算入
- T503の`included`だけを分母へ算入し、`excluded`と`excludedDirectories`を入力境界から排除
- file単位のexact-evidence進捗cache
- open file優先のbackground再計算
- chunk単位のprogress通知と、chunk間のcooperative yield
- 除外設定を表す`configurationKey`変更時の再計算
- current file内容を取得するNode filesystem adapter
- T504 focused testを通常CIへ接続

### 非対象

- T505のUI表示、除外件数表示、再計算状態表示
- T506の設定UX
- Extension activationへの最終wiring
- task/phase tracking更新
- 独立レビュー、レビュー判定、merge

## 3. 参照した要件・設計

- `tasks/tasks-status.md`のT504定義
- `doc/design/vscode-review-range-tracker-design.md` rev4
  - Global理解率は現在有効なGlobal確認済み非空行数を、現在対象の非空行数で除した値
  - PR進捗とGlobal理解率を分離
  - binary、gitignore、生成物、user glob等の除外対象を算入しない
  - 大規模集計で進捗cache、chunk分割、open file優先処理を使用
- T501 `RepositoryGlobalState`
- T503 `IncludedRepositoryFile` / `RepositoryFileEnumerationResult`

既存設計rev4が本実装契約を既に定義しており、新しい製品要件は追加していないため、設計書本文は変更していない。

## 4. 開始時の診断artifact確認

`.github/workflows/ci.yml`には、各test/build stepの標準出力・標準エラーを`tee`で`test-output/ci`へ保存し、失敗時に次をartifactへ収集する処理が存在した。

- test結果と各stepのstdout/stderr log
- `dist/`、`test-dist/`
- `src/`、`test/`、`tools/`、`type-fixtures/`
- package、TypeScript、ESLint、workflow定義
- Node/npm/runner/SHA/ref等のenvironment情報
- git statusと生成file一覧

このため、実装開始前に診断artifact workflowを新規追加する必要はなかった。

## 5. TDD証跡

### 5.1 Red

- Test-first commit: `3e28e60c23230d8c9b9ff68410ebc770b5ea9d04`
- Workflow run: `30746928013`
- Job: `91493989934`
- 結果: failure
- 失敗step: `compile:test`
- 原因: T504で先行定義した次のmoduleが未実装
  - `src/core/global-understanding/index.ts`
  - `src/application/global-understanding/index.ts`
  - `src/adapters/repository-files/node-global-understanding-file-source.ts`
- Failure diagnostic artifact:
  - ID: `8833176909`
  - Name: `ci-failure-diagnostics-30746928013-1`

別SHAのrunは使用せず、test-first commit SHAに紐づくrunでRedを確認した。

### 5.2 Green

- Technical implementation HEAD: `acb4ba7037029885a732535b71b24eb5eea7ae83`
- HEAD一致workflow run: `30747320793`
- Job: `91495013148`
- 結果: success

## 6. 実装内容

### 6.1 Core calculator

`src/core/global-understanding/global-understanding-progress.ts`へ純粋calculatorを追加した。

- file snapshotのpath、revision、line count、非空行indexを検証
- Global file stateのpath、revision、任意content hashがcurrent snapshotと一致する場合だけ`current`として扱う
- missing/stale stateは分子0としてfail-closedに扱う
- reviewed intervalを検証・正規化し、非空行indexとの交差だけを数える
- file別とrepository集約結果を提供
- repository pathをlocale非依存のcode-unit順で安定sort
- duplicate snapshot path、duplicate Global `currentPath`、repository/revision不一致を拒否
- 分母0のfile/repositoryは進捗1と定義

### 6.2 Application background recalculation

`src/application/global-understanding/global-understanding-background-recalculator.ts`へ再計算serviceとcache boundaryを追加した。

- `included`だけを受理し、除外file/directoryを集計入力に含めない
- open file pathをcaller順で先に処理し、重複を除去
- 指定chunk size、既定25 fileごとにprogressを通知
- 最終chunk以外では`yieldControl`を呼び、event loopへ制御を返す
- T503列挙時の非空行数と再読込snapshotの非空行数が異なる場合はraceとして拒否
- cache evidenceにrepository、revision、configuration、path、列挙count、source cache key、content hash、line count、Global range evidenceを含める
- configurationまたはGlobal evidenceが変わったfileだけを再計算
- in-process cacheとして`InMemoryGlobalUnderstandingProgressCache`を提供

### 6.3 Node filesystem adapter

`src/adapters/repository-files/node-global-understanding-file-source.ts`を追加した。

- canonical repository-relative pathだけを受理
- validation時にsymbolic link・非regular fileを拒否
- read前後のdevice、inode、size、mtimeを比較し、観測可能なread raceを拒否
- raw bytesのSHA-256をcontent hash/cache keyとして使用
- CRLF、LF、CRのlogical line区切りを同一規則で処理
- trimmed contentが空でない行indexを生成

### 6.4 CI

`.github/workflows/ci.yml`へT504 focused stepを追加した。

- `npm run compile:test`
- `node --test test-dist/test/unit/global-understanding-progress.test.js`
- stdout/stderrを`test-output/ci/t504-compile-test.log`と`test-output/ci/test-t504.log`へ保存

## 7. 変更file

- `.github/workflows/ci.yml`
- `src/adapters/repository-files/node-global-understanding-file-source.ts`
- `src/application/global-understanding/global-understanding-background-recalculator.ts`
- `src/application/global-understanding/index.ts`
- `src/core/global-understanding/global-understanding-progress.ts`
- `src/core/global-understanding/index.ts`
- `test/unit/global-understanding-progress.test.ts`
- `reports/issue-1-t504-implementation-20260802211500.md`
- `reports/issue-1-t504-handoff-20260802211500.yaml`

## 8. 検証結果

Technical implementation HEAD `acb4ba7037029885a732535b71b24eb5eea7ae83`に一致するrun `30747320793`で確認した。

| 検証 | 結果 |
| --- | --- |
| npm install | success |
| build | success |
| contract typecheck | success |
| architecture positive gate | success |
| architecture negative gate | expected 11 findings matched |
| lint | success |
| unit suite | 387 passed / 0 failed |
| T503 focused | 6 passed / 0 failed / 1 capability-based skipped |
| T504 focused | 6 passed / 0 failed |
| Git integration | 36 passed / 0 failed |
| mock GitHub integration | 13 passed / 0 failed |
| VS Code Extension Host | exit code 0 |

T504 focused testは次を確認した。

- reviewed non-empty included lineだけを分子・分母へ算入
- missing/stale Global stateのfail-closed処理
- empty fileのzero denominator
- corrupt coordinateとambiguous pathの拒否
- open file優先、chunk progress、yield
- excluded identityの非算入
- exact evidence cache、設定変更再計算、Global変更のfile単位再計算
- enumeration/file snapshot race拒否
- CRLF/LF/CRとcontent cache evidence
- repository外path拒否

## 9. 意図的に変更していない領域

- `tasks/tasks-status.md`
- `tasks/phases-status.md`

両fileはrepository内の更新規則により、`task-breakdown-planner`、`task-consistency-manager`、または`progress-sync-manager`経由でのみ更新する。今回利用可能なimplementation skillから直接編集せず、authorized progress syncへ引き渡す。

また、T505/T506、UI、activation wiring、既存PR進捗calculator、Global state永続化形式には変更を加えていない。

## 10. 既知事項・残余リスク

- `configurationKey`、open file一覧、再計算triggerはcallerがcanonicalに供給する契約であり、Extension UIへのwiringは後続範囲である。
- cacheはExtension Host process内のmemory cacheであり、process restart後は再計算する。
- exact cache判定のためcurrent source evidenceは再読込する。cacheはline intersection calculationの再利用であり、filesystem readを省略するcacheではない。
- filesystem race検知はread前後metadataで観測できる変更を対象とし、同一metadataへ復元される敵対的変更まで証明しない。
- CIの`npm ci`は既存依存関係についてhigh severity vulnerability 1件を報告した。T504変更による新規dependencyはなく、本タスク範囲では変更していない。

## 11. 次の作業

- PR #39の通常レビュー／独立レビュー
- authorized manager skillによるtask・phase進捗同期
- review findingがある場合のTDD修正
- 利用者によるmerge

本workerはレビュー判定とmergeを実施していない。

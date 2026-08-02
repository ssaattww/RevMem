# T502 実装レポート

## 1. 対象

- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T502
- Pull Request: #37
- Branch: `task/t502-global-mapping-display-priority`
- Base: `main`
- Base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- 実装検証HEAD: `12259261e45b57faeed7b9140f4514b1534efb53`

## 2. 受入範囲

T502の受入範囲として次を実装した。

- editor changeによるRepository Global Stateの行範囲追従
- Git diffによるRepository Global Stateの行範囲追従
- 100% renameを含む一意なrenameでstable file IDを維持
- 変更行、挿入行、曖昧なfile mappingから確認済み状態を推測しない
- 通常editor装飾で次の6段階の優先順位を適用
  1. 現在PRの未確認変更
  2. 追跡不能または変更済み
  3. 現在contextで確認済み
  4. 有効な別contextで確認済み
  5. Global確認済み
  6. 未確認
- 現在PRの変更行を、そのPR contextで確認済みの場合だけグレー表示

## 3. 対象外

- Global理解率calculatorとcache（T504）
- Global Understanding View、Status Bar、設定UI（T505）
- task/phase進捗同期
- merge

`tasks/tasks-status.md`と`tasks/phases-status.md`は専用managerの責務であるため変更していない。

## 4. 作業開始時確認

`.github/workflows/ci.yml`を確認した。既存workflowは次を失敗artifactへ保存する。

- 各検証commandのstdout/stderr統合log
- test output
- build/test生成物
- `src`、`test`、`tools`、type fixture
- package、TypeScript、ESLint、workflow設定
- Node/npm/runner情報
- Git statusと生成file一覧

必要な診断情報を既に保存するため、診断artifact機構そのものの追加は行っていない。T502 focused regressionを確実に実行する専用CI stepだけを追加した。

## 5. TDD

### 5.1 Red test

production implementationより先に次を追加した。

- `test/unit/global-review-mapping-display-priority.test.ts`

Red commit:

- `1a409a32c66f672f127d66116712c1c5937f7b3a`
- message: `test(T502): define Global mapping and display priority`

この時点では`src/application/global-review-mapping`が存在せず、追加testが要求するapplication APIは未実装だった。

### 5.2 実装後の診断1

- HEAD: `1d3a7e158d2330dfcadce4b4167714b311113003`
- exact-head workflow run: `30746718467`
- conclusion: failure
- failed step: Build
- diagnostic artifact ID: `8833114180`
- artifact name: `ci-failure-diagnostics-30746718467-1`
- 原因: `PullRequestDiffSnapshot`を`core/contracts`からimportしていたが、公開元は`core/pr-progress`だった
- 対応: product codeとtestのimport境界を正しいpublic barrelへ修正

### 5.3 実装後の診断2

- HEAD: `7a79917a6b23e7fdadcef8c760bd4ec3653a26a4`
- exact-head workflow run: `30746842546`
- conclusion: failure
- failed step: T502 Global mapping and display priority tests
- diagnostic artifact ID: `8833153721`
- artifact name: `ci-failure-diagnostics-30746842546-1`
- 原因: rename destination metadata fixtureがsource stable file IDと異なるIDを指定し、既存T204 contractが正しくrejectした
- 対応: fixtureをstable identity contractへ合わせた。production codeの安全検証は緩和していない

### 5.4 Green

- HEAD: `12259261e45b57faeed7b9140f4514b1534efb53`
- exact-head workflow run: `30746906205`
- conclusion: success
- 別SHAのrunは代用していない

成功工程:

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests: 387 passed
- T502 focused tests: 3 passed
- T503 repository enumeration tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

## 6. 実装内容

### 6.1 Global editor mapping

`mapRepositoryGlobalStateThroughDocumentChanges`を追加した。

- T201の`mapReviewedRangesThroughDocumentChanges`を再利用
- changed old linesを未確認化
- inserted linesを未確認のまま維持
- unchanged suffixをline delta分shift
- path/file/revision不一致を推測せずreject
- content hashと更新時刻を新snapshotへ反映
- inputを変更せずdetached snapshotを返却

### 6.2 Global Git mapping

`mapRepositoryGlobalStateThroughGitDiff`を追加した。

- Global fileをT204の`FileReviewState` contractへ適応
- `applyGitFileStateTransitions`を再利用
- content-changing diffでは変更行を無効化
- 100% renameではstable file IDと確認済み範囲を維持
- add/copy/ambiguous destinationで確認済み範囲を作らない
- deleteされたfileをGlobal snapshotから除去
- existing parser/validationを迂回しない

### 6.3 6段階表示優先順位

`createNormalEditorDecorationModel`を拡張した。

- current contextを最優先のreviewed layerとして維持
- current context以外のvalid contextをGlobalより先に投影
- current PR diffのmodified側additionをchanged intervalとして算出
- changed intervalのうちcurrent PR contextで未確認の部分をother contextとGlobalからsubtract
- revision、path、line count、content hashが一致しないlayerは表示しない
- current context/other context/Globalの重複を非重複intervalへ分解

通常editorにはmodified/current側だけが存在するため、PRのdeleted lineはこの装飾modelでは扱わない。deleted lineは既存diff editor/original-side stateとPR progressの責務である。

## 7. 変更file

- `.github/workflows/ci.yml`
  - T502 focused regression stepと専用logを追加
- `src/application/global-review-mapping/global-review-mapping.ts`
  - edit/GitによるGlobal mapping application service
- `src/application/global-review-mapping/index.ts`
  - public application API
- `src/application/editor-decoration/normal-editor-decoration-model.ts`
  - other contextとcurrent PR changed intervalを含む表示優先順位
- `test/unit/global-review-mapping-display-priority.test.ts`
  - edit mapping、rename mapping、current PR changed-line suppression

## 8. 意図的に変更していない領域

- `src/core/range-mapping/*`: T201の既存contractを再利用
- `src/core/git-diff/*`: T203/T204の既存parser、mapper、validationを再利用
- `src/core/pr-progress/*`: T301 snapshot contractを参照するだけで変更なし
- state persistence schema: T501の既存schemaを維持
- Global understanding計算/UI: T504/T505の範囲
- task/phase tracking: 専用managerの範囲
- release workflow: T502と無関係

## 9. Commit

- `1a409a32c66f672f127d66116712c1c5937f7b3a` test: Global mapping/display priority Red contract
- `87126bd6701581c89379427fac8a2350e8e6e9da` feat: Global edit/Git mapping service
- `889620762f6626f066afc1f41b09ea8634161a34` feat: Global mapping public barrel
- `1d3a7e158d2330dfcadce4b4167714b311113003` feat: six-stage decoration priority
- `37cd1346e2fe029e1afae3e4a1384fb13c31b0b4` fix: PR diff snapshot import boundary
- `6e0752f5a2783f8455c81d61696e32fbb6e2ef25` fix: test import boundary
- `7a79917a6b23e7fdadcef8c760bd4ec3653a26a4` ci: T502 focused regression execution
- `12259261e45b57faeed7b9140f4514b1534efb53` test: stable rename fixture correction

## 10. 残存事項

- normal reviewと独立最終reviewは未実施
- 文書/handoff追加後の最終PR HEADに一致するCIを再確認する必要がある
- T504/T505がGlobal mapping resultをconsumerとして統合する際、repository全体のline-count evidence供給境界を確認する必要がある

## 11. 次のaction

1. handoffを保存する
2. report/handoff commit後のPR current HEADを取得する
3. current HEADと一致するworkflow runのみでCIを確認する
4. PRへ簡易reportをコメントする
5. PRをreview可能状態へ更新する
6. normal reviewへ引き渡す

mergeは利用者が行うため実施しない。

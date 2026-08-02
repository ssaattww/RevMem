# T304 PR Progress Tree View 実装レポート

## 1. メタデータと対象識別子

- Repository: `ssaattww/RevMem`
- Task: `T304`
- Pull Request: `#38`
- Branch: `task/t304-pr-progress-tree`
- Base ref: `main`
- Base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- 技術実装HEAD: `814cf92027ab08b95c5b0bde2385eb42dd614876`
- 実装モード: initial implementation
- 開発方針: TDD
- Merge: 実施しない。利用者が実施する。

## 2. 目的

PR差分進捗calculatorの結果を、PR Progress Tree Viewで利用できる決定的な5分類へ変換するproviderを実装する。各fileの確認済み変更行数、全変更行数、進捗率、追加行数、削除行数、除外理由を保持し、未確認行数降順・path昇順で表示し、file選択をdiff open処理へ委譲する。

## 3. 権威ある要件

- `tasks/tasks-status.md` T304
  - 未確認、完了、除外、行以外の変更、行単位レビュー対象外を分類する。
  - 未確認数降順・path昇順で表示する。
  - fileごとの確認数、全変更数、率、追加、削除を一致させる。
  - ユーザー除外を理由付きで別表示する。
  - 選択でdiffを開く。
- `doc/design/vscode-review-range-tracker-design.md` 16.3
  - 5分類の表示名を固定する。
  - rename-onlyを「行以外の変更」、binaryを「行単位レビュー対象外」とする。
  - 次の未確認行への自動移動は行わない。
- Project instruction
  - GitHub connectorを利用する。
  - 診断artifact workflowを確認する。
  - TDDで失敗を確認してから実装する。
  - 小さな論理単位でcommit/pushする。
  - 詳細reportとPR簡易reportを残す。
  - mergeしない。

## 4. Scope

### 実装対象

- platform-neutralなPR Progress Tree provider
- 5つの固定root category
- progress fileからTree file nodeへのprojection
- 未確認行数降順、UTF-16 code-unit path昇順の決定的sort
- binary、user/default glob理由の表示文字列化
- file/aggregateのcount、ratio、除外理由、重複identityの保守的validation
- file選択時のdiff open host委譲
- focused CI test wiring

### Non-goals

- Activity Bar container登録
- Current Context View
- Status Bar
- VS Code固有の`TreeItem`・event wiring
- PR metadata/diff取得、cache、refresh source
- 次の未確認行への移動
- task trackingの直接更新

上記UI/runtime wiringはT305、PR差分取得はT402以降の責務とした。

## 5. 作業開始時の診断workflow確認

`.github/workflows/ci.yml`には作業開始時点で次が存在したため、診断artifact機構の新設は不要だった。

- 各build/test commandの`2>&1 | tee test-output/ci/*.log`
- failure時のenvironment、git status、生成物一覧収集
- `test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、設定・workflowを含むartifact upload

T304 focused testも同じ`test-output/ci`へcompile logとtest logを保存するよう接続した。

## 6. TDD evidence

### Red

- Commit: `89e2ee2de141ef9a4373f59e286dc9542500ef5c`
- 変更: `test/unit/pull-request-progress-tree.test.ts`を先行追加
- Exact-head CI run: `30746824422`
- Job: `91493724836`
- Result: failure
- 直接原因: `src/ui/pr-progress/index`が未実装で、`compile:test`が`TS2307 Cannot find module`により失敗
- Failure artifact:
  - ID: `8833148861`
  - Name: `ci-failure-diagnostics-30746824422-1`
  - 内容: unit log、標準出力・標準エラー統合log、environment、生成物、source/test/configuration

Red runはcommit `89e2ee2de141ef9a4373f59e286dc9542500ef5c`を指定して取得したrunであり、別SHAのrunを代用していない。

### Green

- Implementation commits:
  - `a7e0bf1203f06a8d618c0eaa6baef14dd30a3e04` — provider実装
  - `49a78c6b5bd4f65a2ce3a97beaf05997638079de` — public UI API export
  - `814cf92027ab08b95c5b0bde2385eb42dd614876` — focused CI test wiring
- Exact-head CI run: `30747049935`
- Job: `91494308700`
- Result: success
- 成功step:
  - Build
  - Contract typecheck
  - Architecture validation
  - Architecture negative contract
  - Lint
  - Unit tests
  - T304 PR progress tree tests
  - T503 repository enumeration tests
  - Temporary Git integration tests
  - Mock GitHub integration tests
  - VS Code Extension Host tests

Green runは技術実装HEAD `814cf92027ab08b95c5b0bde2385eb42dd614876`を指定して取得したrunであり、別SHAのrunを代用していない。

## 7. 実装内容

### `PullRequestProgressTreeDataProvider`

- root categoryを常に次の順で返す。
  1. `unreviewed` — 未確認変更が残るファイル
  2. `completed` — 確認完了したファイル
  3. `excluded` — 除外されたファイル
  4. `non-line-change` — 行以外の変更
  5. `line-review-unsupported` — 行単位レビュー対象外
- binary statusまたはbinary exclusion reasonを`line-review-unsupported`へ分類する。
- その他のexcluded fileを`excluded`へ分類する。
- includedかつ分母0を`non-line-change`へ分類する。
- 未確認行が残るfileを`unreviewed`、残らないfileを`completed`へ分類する。
- `totalLineCount - reviewedLineCount`を未確認行数として保持する。
- 未確認行数降順、同数ならlocale非依存のpath code-unit昇順でsortする。
- 選択したnodeが保持する元の`PullRequestDiffFileProgress`をhostの`openDiff`へ渡す。

### 入力validation

Tree表示前に次を検証し、不整合な進捗を推測して表示しない。

- file ID/pathの非空
- additions/deletions/reviewed/totalの非負safe integer
- reviewedがtotalを超えないこと
- file/aggregate progressが`0..1`でcountから計算した率と一致すること
- excluded flagとexclusion reasonの存在が一致すること
- file ID/pathの重複がないこと
- aggregate countがfile resultの合計と一致すること

### 理由表示

- binary: `バイナリファイル`
- default glob: `既定除外: <pattern>`
- user glob: `ユーザー除外: <pattern>`

## 8. Changed files

- `test/unit/pull-request-progress-tree.test.ts`
  - 5分類、件数・理由、sort、selection、入力不整合rejectを固定するRed/Green test。
- `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`
  - platform-neutral Tree provider、node contract、validation、classification、sort、selection。
- `src/ui/pr-progress/index.ts`
  - T305以降が利用するpublic UI API export。
- `.github/workflows/ci.yml`
  - T304 focused compile/testと診断logをCIへ接続。

## 9. Intentionally untouched

- `src/extension.ts`
  - Activity Bar、Tree View registration、refresh eventはT305の範囲であるため変更しない。
- `src/ui/diff-editor/*`
  - T303のimmutable diff open contractを変更せず、T304はhost boundaryへ委譲する。
- `src/core/pr-progress/*`
  - T301の検証済みprogress calculator contractを入力として再利用し、再実装しない。
- `doc/design/vscode-review-range-tracker-design.md`
  - 16.3がT304要件を既に定義しており、設計変更を伴わない。
- `tasks/tasks-status.md`、`tasks/phases-status.md`
  - repository ruleでは指定されたprogress management skillを通す必要がある。今回利用可能なworker skillに該当managerがないため直接更新しない。

## 10. Unknowns・blocked・remaining risks

- Blocking item: なし。
- Unknown: encoding対象外fileを表現するruntime progress contractはT402以降で追加される可能性がある。現行T301 contractではbinaryを行単位レビュー対象外として扱う。
- Remaining risk: VS Code固有TreeItem表示、refresh event、Activity Bar integrationはT305/T306の統合試験対象であり、本task単体では実装しない。
- Markdown lint: repository-local wiringが存在しないため、TypeScript lint成功をMarkdown lintの代用とはしていない。

## 11. 次のアクション

PR #38の通常reviewを別workerで実施する。reviewerはPR current HEADと一致するCI runだけを証拠に用い、実装worker自身は独立review verdictを出さない。mergeは利用者が行う。

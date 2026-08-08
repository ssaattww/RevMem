# T505 Global Understanding UI・設定 実装レポート

- 文書種別: implementation report
- 生成日時: 2026-08-06T19:14:05+09:00
- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T505
- Pull Request: #43
- Branch: `feature/t505-global-understanding-ui`
- Base: `main` (`112198c33823a5fc6681399a19e0c5361614143f`)
- 技術実装HEAD: `7989e40fa3eaa68bf23fb13a845e6130fc631464`
- 実装commit range: `112198c33823a5fc6681399a19e0c5361614143f..7989e40fa3eaa68bf23fb13a845e6130fc631464`
- 保存先: `reports/issue-1-t505-implementation-20260806191405.md`

## 1. 目的

T505として、T503・T504で構築済みのGlobal理解率計算をT305のActivity Bar・Status Bar runtimeへ接続し、次を利用可能にする。

- PR Progressとは別の`Global Understanding` View
- リポジトリ全体およびfile別の理解率、確認済み非空行数、対象非空行数の表示
- 除外file数とpruneした除外directory数の分離表示
- T305 Status Barとの併記
- Global確認済み装飾layerの切替
- 装飾設定、共通除外設定、Git管理外snapshot file上限設定のruntime反映
- 現在context、確認・解除操作、設定変更後のGlobal表示再計算

## 2. 権威ある要件と設計根拠

| Source | Reference | 適用内容 |
| --- | --- | --- |
| User instruction | current chat | T505を自立して実装し、TDD、検証、PR更新、report保存まで行う |
| Repository task | `tasks/tasks-status.md` T505 | Global Understanding View、Status Bar併記、Global layer切替、装飾・除外・snapshot上限設定を実装する |
| Repository task | T505終了条件 | 全体・file別率、確認数、対象数をPR進捗と別表示し、`excluded.length`と`excludedDirectories.length`を混ぜない |
| Design rev4 | `doc/design/vscode-review-range-tracker-design.md` 11.3 | Global理解率を現在有効なGlobal確認済み非空行数 / 対象全非空行数として計算する |
| Design rev4 | 16.1、16.5、16.8、16.9 | Activity Bar、Global Understanding View、Global layer切替、主な設定を公開する |
| Project instruction | RevMem project instructions | TDD、失敗診断artifact、connector-first、小さなcommit、詳細report、PR簡易report、非mergeを守る |

## 3. 着手前確認

### 3.1 依存タスク

T505の依存であるT305はPR #42でmainへ統合済みであることを確認した。再開時のmain `112198c33823a5fc6681399a19e0c5361614143f` にはT305、T306、T403が含まれていたため、T305 runtime contractを基準に実装した。

### 3.2 失敗診断workflow

`.github/workflows/ci.yml`には、失敗時に次を収集する既存workflowが存在したため、workflow変更は不要と判断した。

- 各stepの標準出力・標準エラーを保存したlog
- build・test生成物
- `src/`、`test/`、tool、type fixture
- Node/npm、runner、SHA、ref等の環境情報
- Git status
- 失敗調査用diagnostic artifact

## 4. Scope

### 4.1 実装範囲

- Global理解率の純粋presentation model
- Global Understanding Tree View runtime
- Global Status Bar item
- Global layer切替controllerとcommand
- T503 file列挙、T504 background recalculation、永続Global stateのcomposition source
- current context、review-state変更、除外設定変更との再計算連携
- snapshot圧縮後最大byte数の設定とtracker limitsへの変換
- fail-closed表示更新と競合する非同期再計算のgeneration制御
- focused test、source結合test、manifest contract test

### 4.2 非対象

- T506の複数context・再起動を通す統合/Extension Host受入試験
- T404・T405の保存済みGitHub PR context、Review Contexts View
- Global履歴閲覧UI
- unrelated cleanup、schema migration、cache lock、性能最適化
- merge
- 自分の変更に対する通常reviewまたは独立review verdict

## 5. TDD実施記録

### 5.1 RED

現行mainへbranchを載せ直した後、production APIより先に次の失敗先行testを追加した。

- Global summary・file別・除外診断の投影
- Status Bar表記
- Global layer設定の永続化順序
- snapshot上限設定resolver
- manifest command・activation・setting contract

RED HEADは`087402a9062a16809b441d6c2f9df39dab52e84b`である。exact-head CI run `31087207176` は、未実装のGlobal UI APIおよびsnapshot設定resolverが存在しないためunit compileで期待どおり失敗した。failure diagnostic artifact `8961893165` に標準出力・標準エラー、生成物、source、test、環境情報を保存した。

### 5.2 GREENと修正サイクル

| HEAD | Run | 結果 | 原因・対応 |
| --- | --- | --- | --- |
| `6d1c6e2b3dd046c8b1c8f4f7106f11cfcfc93b2f` | `31089893161` | failed | VS Code `Thenable`とTreeDataProvider配列型の境界不整合。composition rootで吸収し、mutable配列contractへ修正。artifact `8962967039` |
| `8db3baa328fbdcfda1ed803f0c8a6268da8c7c9a` | `31090195788` | failed | 純粋unit testがVS Code runtimeを含むbarrelを読み込んだ。純粋model importへ分離 |
| `f45b2e1cb61384a8018ab408f7ee8d2e52db2e24` | `31090319267` | passed | 全CI step成功 |
| `eb4927b35dbe26c250a0ba274aad3d895690bccd` | `31091811575` | failed | 自己点検で追加したtestが再びruntime barrelを読み込んだ。artifact `8963769419` |
| `7989e40fa3eaa68bf23fb13a845e6130fc631464` | `31092139431` | passed | runtime-neutral importへ修正後、全CI step成功 |

失敗したrunについて、別SHAのrunを成功根拠として代用していない。

## 6. 実装内容

### 6.1 Pure UI model

`src/ui/global-understanding/global-understanding-ui-model.ts`へ次を実装した。

- repository summary node
- repository path順で決定的に並ぶfile node
- concrete excluded fileとpruned directoryを分離したdiagnostic node
- countとratioの整合性検証
- Global Status Bar model
- setting永続化成功後に装飾・Global UIを更新するGlobal layer toggle controller
- stale/失敗した再計算から誤った表示を残さないrefresh controller

### 6.2 Global calculation source

`src/t505-global-understanding-source.ts`で次を接続した。

1. current contextからrepository root、repository ID、revision ID、storage targetを解決する。
2. T503 `NodeRepositoryFileEnumerator`で対象fileと除外診断を取得する。
3. 永続化済みRepository Global Stateを読み込む。
4. revisionが一致する場合だけGlobal evidenceとして使用し、不一致時は空の現revision Global stateを使用して未確認に倒す。
5. T504 `GlobalUnderstandingBackgroundRecalculator`でfile別・repository全体を再計算する。
6. `excluded.length`だけを除外file数、`excludedDirectories.length`をpruned directory診断数として返す。

### 6.3 VS Code runtime

`src/ui/global-understanding/vscode-global-understanding-runtime.ts`へ次を実装した。

- `reviewRange.globalUnderstanding` TreeDataProvider
- summary、file別、除外診断の階層表示
- `reviewRange.refreshGlobalUnderstanding`
- `reviewRange.toggleGlobalLayer`
- T305 Status Barと隣接するGlobal Status Bar item
- 除外設定・Global layer設定変更時の再計算
- current generationだけが表示を更新する非同期競合防止
- current generationの再計算失敗時にTreeとStatus Barをclearするfail-closed処理

### 6.4 Composition root

`src/t305-extension.ts`で次を接続した。

- T305 Current Contextのaccept時にGlobal sourceへ同じsnapshotを設定
- context変更後に装飾とGlobal Understandingを同期更新
- review-state操作完了event後にGlobal Understandingを再計算
- Workspace設定へGlobal layer状態を保存

`src/extension.ts`では、通常editor・diff editorの確認状態変更をUIへ通知するruntime portを追加し、snapshot tracker生成時に設定済みmax byte数を適用した。

### 6.5 Manifestと設定

`package.json`へ次を追加した。

- Global refresh/toggle commands
- Global view activation event
- Global view title menu
- `reviewRange.maxSnapshotFileSizeBytes`
  - type: integer
  - minimum: 1
  - default: 5 MiB
- focused test script `test:t505`

既存の次の設定もT505 runtimeで利用している。

- `reviewRange.showGlobalReviewed`
- `reviewRange.showGutterIcon`
- `reviewRange.showOverviewRuler`
- `reviewRange.exclude`

## 7. 変更file

| Path | Purpose |
| --- | --- |
| `package.json` | command、activation、view menu、snapshot上限設定、focused test script |
| `src/application/non-git-snapshots/non-git-snapshot-settings.ts` | user settingからtracker limitsへの変換 |
| `src/extension.ts` | review-state変更event、snapshot設定適用 |
| `src/t305-extension.ts` | T305 current context/runtimeとT505 Global UIのcomposition |
| `src/t505-global-understanding-source.ts` | T503/T504/永続Global stateのsource composition |
| `src/ui/global-understanding/global-understanding-ui-model.ts` | pure model、toggle、fail-closed refresh controller |
| `src/ui/global-understanding/index.ts` | public exports |
| `src/ui/global-understanding/vscode-global-understanding-runtime.ts` | Tree View、Status Bar、commands、configuration refresh |
| `test/unit/global-understanding-ui.test.ts` | UI model、toggle、refresh競合、manifest、snapshot setting test |
| `test/unit/t305-validation-wiring.test.ts` | 標準unit suiteへT505 testを接続 |
| `test/unit/t505-global-understanding-source.test.ts` | file列挙、永続Global state、revision不一致を通す結合test |

## 8. 自己点検で検出・修正した問題

### T505-SR-P1: context切替後の再計算失敗で旧Global表示が残る

- Origin: introduced by initial T505 runtime
- Location: Global Understanding refresh lifecycle
- Impact: 新しいcontextの再計算に失敗した場合、以前のcontextの理解率が表示され続け、誤認につながる
- Correction:
  - current generationの再計算失敗時にTree/Status Barをclear
  - 古いgenerationの遅延失敗は新しいsnapshotをclearできない
  - unit testを追加
- Disposition: addressed

これは実装者による自己点検であり、通常reviewまたは独立review verdictではない。

## 9. 検証結果

### 9.1 技術実装HEAD一致CI

- Workflow: `CI`
- Run: `31092139431`
- Job: `92585409568`
- Head SHA: `7989e40fa3eaa68bf23fb13a845e6130fc631464`
- Conclusion: `success`

成功したstep:

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T403 cache tests
- T304 PR progress tree tests
- T502 Global mapping/display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

### 9.2 Focused evidence

- Global Understanding UI model、toggle、fail-closed generation制御
- snapshot limit resolver
- manifest contract
- T503 enumeration + persisted Global state + T504 recalculationのsource composition
- binary file countとpruned directory countの分離
- revision不一致時の0 reviewed / `missing` state

## 10. 意図的に変更しなかった領域

| Area | Reason |
| --- | --- |
| `.github/workflows/ci.yml` | 必要な失敗diagnostic artifactを既に保存していたため |
| `doc/design/vscode-review-range-tracker-design.md` | rev4にT505要件が既に記載され、設計変更を要しないため |
| T404/T405 GitHub PR context UI | T505 scope外 |
| T506 integration/Extension Host suite | 後続taskの責務 |
| schema migration、lock、cleanup、performance | P6後続taskの責務 |
| merge | 利用者が実施するため |

## 11. Held・未完了事項

### 11.1 Progress tracking同期

`tasks/tasks-status.md`には、このfileを`task-breakdown-planner`、`task-consistency-manager`、または`progress-sync-manager`を通してのみ更新するというrepository内制約がある。現在のChatGPT worker Skill setには該当Skillが提供されていないため、`tasks/tasks-status.md`および`tasks/phases-status.md`のT505完了同期は直接変更せずheldとした。

- Owner: progress-sync capable worker / user-selected follow-up
- Product implementation impact: なし
- Tracking impact: task一覧はT505を未着手のまま表示する可能性がある

### 11.2 Review

通常reviewおよび独立最終reviewは未実施である。本reportは実装証跡であり、review passを主張しない。

## 12. Remaining risks

- T506で予定される複数context、再起動、Global自動反映・解除のExtension Host受入試験は未実施
- 大規模repositoryでのUI性能評価はT607の責務
- 保存済みGitHub PR contextを含む並列layer管理はT404/T405の責務
- Progress tracking同期がheldのため、repositoryのtask表示と実装状態に一時的な差が残る

## 13. 次のaction

1. PR #43を通常reviewへ渡す。
2. findingがあればreview follow-upとして同じPRで対応する。
3. 通常review closure後に独立最終reviewを行う。
4. 該当Skillを利用できるworkerでT505 progress trackingを同期する。
5. mergeは利用者が行う。

## 14. Merge boundary

この作業ではmergeしていない。PR #43はdraftのまま保持する。

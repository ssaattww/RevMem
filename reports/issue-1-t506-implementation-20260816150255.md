# T506 Global複数context統合・Extension Host受入 実装レポート

- 文書種別: implementation report
- 生成日時: 2026-08-16T15:02:55+09:00
- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T506
- Pull Request: #55
- Branch: `task/t506-global-integration`
- Base: `main` (`146aec15783294da1795f268315c85d1a0dffa56`)
- 技術実装HEAD: `daad56c3d192ae6041f34e9f662133980a262bef`
- 実装commit range: `146aec15783294da1795f268315c85d1a0dffa56..daad56c3d192ae6041f34e9f662133980a262bef`
- 保存先: `reports/issue-1-t506-implementation-20260816150255.md`

## 1. 目的

T506として、T501〜T505で構築済みのRepository Global確認状態・Global理解率・PR進捗分離を、複数context、確認解除、変更追従、永続化、Extension Host再起動まで含めて一気通貫で検証する。

終了条件として次を扱った。

- 同一repositoryの複数contextで確認状態を操作してもcontext固有状態とGlobal状態が混同されないこと
- 片方のcontextで作られたGlobal確認状態を別contextから観測・解除できること
- Global確認状態がPR Progressの確認済み行数へ混入しないこと
- Global確認状態が編集差分を通して保守的に追従すること
- 再起動相当のrepository再生成後もGlobal理解率が同じになること
- 実VS Code Extension Hostを複数回起動し直しても、context固有状態とGlobal状態の独立性が維持されること

T505独立reviewでheldとなっていた「複数context」「再起動」「Extension Host統合」の受入証拠もT506で追加した。

## 2. 権威ある要件と設計根拠

| Source | Reference | 適用内容 |
| --- | --- | --- |
| User instruction | current chat | T506を開始し、instructionとworker Skillsに従い、自立して止まらず実装・検証・PR更新まで進める |
| Repository task | `tasks/tasks-status.md` T506 | 複数contextの確認・解除・変更追従とGlobal集計を通す統合・Extension Host試験を追加する |
| Repository task | T506 exit criteria | AC-18〜AC-20、Global状態のPR進捗非混入、再起動後の同一理解率 |
| Prior review | `reports/issue-1-t505-independent-final-review-20260808135616.md` | 複数context、再起動、Extension Host統合をT506へheld |
| Design | `doc/design/vscode-review-range-tracker-design.md` | Repository GlobalとPR Progressの分離、Global理解率、永続化・復元、変更追従のcontract |
| Project instruction | RevMem project instructions | TDD、失敗diagnostic artifact、GitHub connector、小さなcommit、詳細report、PR簡易report、非mergeを必須とする |

## 3. 着手前確認とdiagnostic workflow

### 3.1 対象branchとPR

`main`の`146aec15783294da1795f268315c85d1a0dffa56`から`task/t506-global-integration`を作成し、Draft PR #55を作成した。

### 3.2 失敗diagnostic artifactの不足

着手時の`.github/workflows/ci.yml`には失敗時artifact upload自体は存在したが、各コマンドが`2>&1`で標準出力と標準エラーを一つのlogへ結合していた。Project instructionが要求する「少なくともテスト結果、標準出力、標準エラー、失敗原因調査ログ」を独立証跡として保存できないため、T506本体より先にTDDでdiagnostic workflowを補強した。

#### RED

- HEAD: `6ed1542329703dd441e9cb301da8467cc139f918`
- CI run: `31929560040`
- 結果: failure
- 原因: 先に追加したCI契約testが未実装の`tools/run-ci-command.mjs`を要求して失敗
- Failure artifact: `9258878561`

#### GREEN

- HEAD: `47c716de0342b44a376dae48c3813bc51aac6680`
- CI run: `31929647345`
- 結果: success

`tools/run-ci-command.mjs`を追加し、各CI commandについて次を`test-output/ci/`へ保存するようにした。

- `<label>.stdout.log`
- `<label>.stderr.log`
- `<label>.log`（combined）
- `<label>.result.json`（command、args、開始/終了、exitCode、signal、spawn error）

実際の後続failure artifactでもこれらのfileが生成されることを確認した。

## 4. Scope

### 4.1 実装範囲

- T506専用multi-context integration test
- T506専用3-phase Extension Host acceptance suite
- 同一user-data / workspace / extension storageを使った実Extension Host restart検証
- Global状態とPR Progressの分離検証
- Global確認解除の別context反映検証
- context固有確認状態の独立性検証
- Global理解率のrestart前後同一性検証
- document changeを通したGlobal reviewed range mappingと再集計検証
- focused `test:t506` command
- T506 focused CI step
- failure diagnosticsのstdout/stderr/result/combined log分離保存

### 4.2 非対象

- T501〜T505のproduction contract自体の再設計
- 新しいproduct APIやtest専用production hookの追加
- task status fileの直接更新
- independent final review verdict
- merge

T506受入試験を通すためにproduction実装変更は必要なかった。既存T501〜T505およびT306のruntime contractを組み合わせ、試験とCI wiringだけで終了条件を立証できた。

## 5. TDD実施記録

### 5.1 T506受入testの先行追加

次をproduction/wiringより先に追加した。

- `test/integration/t506-global-multi-context.integration.test.ts`
- `test/vscode/t506-suite/index.ts`
- `test/unit/ci-workflow-contract.test.ts`のT506 focused wiring contract

初回追加commitは`2d0a30cb3b1d172ddef94179b1cc348de35ef81c`。

### 5.2 RED調整

最初の2回はproduct failureではなく、追加test fixture側のreadonly型境界不整合でcompileが先に停止した。いずれもtest側だけを修正し、product codeは変更していない。

| HEAD | CI run | 結果 | 証拠・原因 |
| --- | --- | --- | --- |
| `2d0a30cb3b1d172ddef94179b1cc348de35ef81c` | `31929977606` | failed | test fixture型不整合。artifact `9258989792`。分離されたstdout/stderr/result/combined logを確認 |
| `a24d0136a64e920ec3f0dbb938103e4300f1fde4` | `31930062256` | failed | deep-readonly Global fixture型不整合。artifact `9259011789` |
| `a9efaae6c54b0e4365fd30dddaa2c0144f9ee060` | `31930146724` | failed | 意図したRED。494 tests中493 pass / 1 fail。唯一の失敗は`package.json must define test:t506`。artifact `9259032727` |

`a9efaae6...`でtest自体がcompile可能になり、未実装のT506 focused wiringだけが失敗することを確認したため、TDDのRED境界を確定した。

### 5.3 GREEN

- `2504b31a33bd542b6e59d49e2ebb103f89642404`: `test:t506` focused commandを追加
- `daad56c3d192ae6041f34e9f662133980a262bef`: T506 Extension Host runner、Xvfb CI step、CI契約を接続

技術実装HEAD`daad56c3...`に一致するCI run `31930337980`でT506 focused stepを含む全CIがsuccessになった。

## 6. Multi-context integration test

`test/integration/t506-global-multi-context.integration.test.ts`は、mockされた集計値ではなく、既存productionの次を直接組み合わせる。

- `FileSystemReviewStateRepository`
- `RepositoryGlobalStateRepository`
- `calculatePullRequestDiffProgress`
- `mapRepositoryGlobalStateThroughDocumentChanges`
- `calculateRepositoryGlobalUnderstandingProgress`
- `ReviewFileExclusionPolicy`

### 6.1 Context Aで確認

同一repository / 同一HEADのContext Aを保存し、file全体を確認済みにする。

期待値:

- Context Aの`modifiedReviewed`: `[0, 4)`
- Repository Globalの`reviewed`: `[0, 4)`
- Global Understanding: 4 / 4 = `1.0`

### 6.2 Repository instance再生成

同じstorageを使って`FileSystemReviewStateRepository`を新規生成し、Context Aを再読込する。

期待値:

- Global stateが復元される
- Global Understanding結果がrestart前と完全一致する

### 6.3 Context B作成とPR Progress分離

Context Aと同じHEAD・別baseのContext Bを新規作成する。

期待値:

- Context Bのcontext固有`modifiedReviewed`は空
- owner-wide GlobalはContext Aの`[0, 4)`を継承
- Context BのPR diffには変更行があるが、PR Progressは`reviewed=0`, `total=1`, `progress=0`

これにより、Global確認状態がPR Progressへ混入しないことを直接検証する。

### 6.4 Context BからGlobalを解除

Context BからGlobal-onlyな範囲`[1, 3)`を解除する。

期待値:

- Context Bのcontext固有確認状態は空のまま
- Globalは`[0, 1)`と`[3, 4)`へ更新

さらにrepositoryを再生成してContext Aを再読込すると:

- Context A固有の`[0, 4)`は保持される
- GlobalだけがContext Bで更新した`[0,1), [3,4)`になる

context固有状態とowner-wide Globalの独立性を検証する。

### 6.5 変更追従と再集計

4行fileの途中1行を2行へ置換するdocument changeをGlobal mappingへ通す。

期待値:

- 変更・挿入行は未確認扱い
- 不変suffixの確認済み範囲はshift
- mapped Global reviewed: `[0,1), [4,5)`
- 新revisionのGlobal Understanding: 2 / 5 = `0.4`

## 7. Extension Host acceptance

`test/vscode/t506-suite/index.ts`と`test/vscode/run-extension-host.ts --t506`で、同一workspace・user-data・extensions directoryを共有する3回の実VS Code Extension Host launchを行う。

### 7.1 Git fixture

実Git repositoryを作り、次の3 revisionをtagで固定する。

1. Base A: `review.ts`にremoved行 + retained行
2. Base B: `context-marker.ts`を追加
3. HEAD: `review.ts`をretained行 + added行へ変更

既存`LocalBaseHeadRuntime`はcontext IDを`baseSha..headSha`で分離しつつrepository IDをworkspace rootで共有するため、同一Global ownerに属する別contextをproduction pathで構成できる。

### 7.2 Phase 1: `mark-context-a`

- Context Aをinitialize
- `review.ts`のPR Progressが0 / 2であることを確認
- 実diff tabを開く
- file全体を確認済みにする
- PR Progressが2 / 2になることを確認
- Context A固有stateとGlobal stateの双方に確認済み範囲が永続化されたことを確認

### 7.3 Phase 2: `restore-context-b-unmark-global`

Extension Hostを終了し、同じuser-data/storageで再起動する。

- 別baseのContext Bをinitialize
- Context B固有stateが空であることを確認
- Context A由来のGlobal stateが復元されていることを確認
- Globalが存在してもContext B PR Progressは0 / 2のままであることを確認
- 実diff tabから確認解除
- Context B固有stateは空のまま、Globalだけが解除されることを確認

### 7.4 Phase 3: `restore-context-a`

再度Extension Hostを終了・再起動する。

- Context Aを再initialize
- Context A PR Progressが2 / 2で復元されることを確認
- Context A固有確認状態が残っていることを確認
- Context Bから解除したGlobal状態は空として観測されることを確認
- Global revisionがfixture HEADと一致することを確認

これにより、T505でheldされた複数context・再起動・Extension Host統合の受入証拠を追加した。

## 8. CI failure diagnostics補強

`tools/run-ci-command.mjs`はshellの`2>&1`へ依存せず、child processのstdout/stderrを別streamで保存する。CI workflowの各実行stepをこのrunnerへ統一した。

失敗時artifactには従来のsource、test、build/test生成物、environment、git statusに加えて、各stepごとの以下が含まれる。

- standard output
- standard error
- combined log
- exit result metadata

T506のRED runで実artifactをdownloadして確認したため、契約testだけの検証ではない。

## 9. 変更file

| Path | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | 全stepの診断stream分離とT506 focused CI step |
| `tools/run-ci-command.mjs` | stdout / stderr / combined / result metadataを保存するdiagnostic runner |
| `package.json` | `test:t506` focused command |
| `test/unit/ci-workflow-contract.test.ts` | diagnostic artifact contractとT506 focused wiring contract |
| `test/integration/t506-global-multi-context.integration.test.ts` | 複数context・解除・PR分離・restart・変更追従・理解率のproduction integration test |
| `test/vscode/t506-suite/index.ts` | 3回の実Extension Host restart acceptance suite |
| `test/vscode/run-extension-host.ts` | `--t506`専用3-phase runner |

Production source codeは変更していない。

## 10. 検証結果

### 10.1 技術実装HEAD一致CI

- Workflow: `CI`
- Run: `31930337980`
- Job: `95124027715`
- Head SHA: `daad56c3d192ae6041f34e9f662133980a262bef`
- Conclusion: `success`

成功を確認したstep:

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T602 history rewrite recovery tests
- T403 GitHub cache tests
- T404 GitHub PR context layer tests
- T304 PR progress tree tests
- T502 Global mapping and display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- T505 Global understanding tests
- **T506 Global multi-context integration**
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのrunを成功根拠として代用していない。

### 10.2 T506 focused evidence

`T506 Global multi-context integration` stepでは、`xvfb-run -a npm run test:t506`をdiagnostic runner経由で実行する。

`test:t506`は次を順に実行する。

1. build
2. test compile
3. `t506-global-multi-context.integration.test.js`
4. `run-extension-host.js --t506`
5. 3つのExtension Host phase

このfocused step自体が`success`であるため、integrationと全3 restart phaseが完走している。

## 11. 意図的に変更しなかった領域

| Area | Reason |
| --- | --- |
| `src/**` production implementation | T501〜T505/T306の既存contractだけでT506終了条件を満たせたため |
| `doc/design/**` | T506は既存設計の統合検証であり、新しいproduct設計変更が発生しなかったため |
| `tasks/tasks-status.md` / `tasks/phases-status.md` | repository規則上、専用task-management Skill経由の更新が必要だが、現在のworker Skill setにはそのSkillがないため直接編集しない |
| unrelated task implementation | T506 scope外 |
| merge | 利用者が実施するため |

## 12. Blocked / unknown / remaining risk

### 12.1 Blocked

Technical implementationについてblocked itemはない。

Task tracking同期だけは、必要な専用task-management Skillが利用可能でないためこのworkerからは実施していない。

### 12.2 Unknown

なし。T506終了条件として必要なmulti-context / restart / PR separation / change mappingは自動試験で再現可能な形にした。

### 12.3 Remaining risk

- 本実装者は自分の変更に対するindependent final review verdictを出していない。
- 次の独立reviewでは、T506 testがAC-18〜20を十分に表現しているか、diagnostic runner変更がCI失敗のexit semanticsを損なっていないかを改めて確認する必要がある。

## 13. Commit記録

| SHA | Purpose |
| --- | --- |
| `6ed1542329703dd441e9cb301da8467cc139f918` | diagnostic workflowの失敗先行contract test |
| `47c716de0342b44a376dae48c3813bc51aac6680` | stdout/stderr/result/combined logを分離保存するCI diagnostic runner |
| `2d0a30cb3b1d172ddef94179b1cc348de35ef81c` | T506 multi-context integration・Extension Host acceptance test先行追加 |
| `a24d0136a64e920ec3f0dbb938103e4300f1fde4` | T506 test fixture readonly型修正 |
| `a9efaae6c54b0e4365fd30dddaa2c0144f9ee060` | deep-readonly fixture修正、意図したT506 RED到達 |
| `2504b31a33bd542b6e59d49e2ebb103f89642404` | `test:t506` focused command |
| `daad56c3d192ae6041f34e9f662133980a262bef` | T506 Extension Host runnerとfocused CI wiring |

## 14. 次のaction

PR #55を独立reviewへ渡す。

独立reviewでは最低限次を確認する。

- AC-18〜AC-20のcoverage
- Context A/Bのstate isolationとGlobal共有/解除
- GlobalとPR Progressの非混入
- document change mapping後のGlobal理解率
- Extension Host 3-phase restartの実効性
- diagnostic runnerのfailure propagationとartifact completeness
- current PR HEADとCI run head SHAの一致

本workerはmergeしない。

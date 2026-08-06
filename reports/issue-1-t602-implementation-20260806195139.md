# T602 実装レポート

## Metadata

- repository: `ssaattww/RevMem`
- Pull Request: `#49`
- task: `T602`
- mode: implementation worker
- branch: `agent/t602-rebase-force-push-recovery`
- base SHA: `112198c33823a5fc6681399a19e0c5361614143f`
- reviewed implementation HEAD: `424fdd54e059500d7c9e1b78793bb75f281b6fa3`
- exact-head CI: run `31094706729`, conclusion `success`
- generated at: `2026-08-06T19:51:39+09:00`
- merge: not performed

本レポートは実装作業と検証結果を記録する。通常レビューまたは独立最終レビューのtechnical verdictは付与しない。

## 目的

rebaseまたはforce-pushでGit履歴が置き換わった際、SHAの変化だけを理由に確認済み範囲を全解除せず、次の証拠順序で保守的に回復する。

1. 旧Git objectを用いたimmutable revision間の直接diff
2. 旧objectが存在しない場合だけ、保存snapshotから現在内容へのdiff
3. rename先と内容対応が一意に証明できる場合だけstable file identityを追従
4. 証拠が欠落、破損、曖昧、または矛盾する場合は未確認化

根拠は`tasks/tasks-status.md`のT602定義および`doc/design/vscode-review-range-tracker-design.md` rev4の10.4節である。

## 作業開始時確認

`.github/workflows/ci.yml`には、テスト失敗時の原因調査に必要な診断artifact workflowが既に存在していたため、新規workflowは作成していない。

既存workflowは、少なくとも次を保存する。

- npm install、build、typecheck、architecture、lint、各testの標準出力・標準エラーを`test-output/ci/*.log`へ保存
- runner環境、Git SHA/ref、git status、生成ファイル一覧
- `src/`、`test/`、`dist/`、`test-dist/`、設定・workflowファイル
- failure時のGitHub Actions artifact upload

T602 focused testの出力は`test-output/ci/test-t602.log`へ追加した。

## TDD証跡

### Red 1: 回復service未実装

- HEAD: `ef3e669814c9c3f8036bcf1c27cca7c33d704c54`
- run: `31090848838`
- failure: `history-rewrite-recovery` moduleが存在せずcompile失敗
- diagnostic artifact: `8963364201`

### Red 2: production adapter未実装

- HEAD: `812b0f294a9c5083c192c229780e9af8baeff0a4`
- run: `31091485735`
- failure: Git revision sourceおよびT601 snapshot trackerをT602 contractへ接続するadapter exportが存在しない
- diagnostic artifact: `8963629179`

### Red 3: 保守性境界

- HEAD: `cee3b393984323c3b4bdb25fb62dbb730b372223`
- run: `31091967984`
- failures:
  - same-path snapshot候補のほかにも確認済み範囲を保持する候補がある場合、一意と誤判定した
  - Gitのcomplete old textとpersisted line countが矛盾する場合を受理した
- diagnostic artifact: `8963826320`

### Red 4: production runtime fixture型境界

- HEAD: `276b9e036d04d525a4622fe6a35086e732f295d2`
- run: `31093993447`
- failure: production provider受入fixtureのreadonly snapshotをmutable persistence contractへ直接渡してcompile失敗
- diagnostic artifact: `8964658023`

### Red 5: production配線未完了

- HEAD: `f6be6a37254043472149f4215bbd7a8dc297a66e`
- run: `31094180135`
- result: build、contract typecheck、architecture、lint、unitは成功したが、T602 focused production runtime testが失敗
- failure: core recoveryは実装済みだったが、通常のGit document sessionが確認操作後にcontext/Global snapshotを保存せず、旧object消失後のproduction openで確認済み範囲が`[]`になった
- diagnostic artifact: `8964732426`

### Green

- implementation HEAD: `424fdd54e059500d7c9e1b78793bb75f281b6fa3`
- exact-head run: `31094706729`
- conclusion: `success`

## 実装内容

### 1. 証拠順序を実装

`src/application/history-rewrite-recovery/index.ts`へ`HistoryRewriteRecoveryService`を追加した。

- 旧objectが存在する場合は直接Git diffを最優先する
- non-missing Git failure、壊れたdiff、本文・行数矛盾ではsnapshotへ降格せず未確認化する
- 旧objectがmissingの場合だけT601 snapshot mappingを試す
- snapshot mapping候補全体を評価し、確認済み範囲を保持できる候補が複数なら曖昧として拒否する
- authoritative snapshot mappingが空範囲を返した場合は、content hash一致による復活を行わず未確認を維持する
- snapshotで回復できない場合だけ、line countとexact content hashが一致する一意候補へstable identityを追従する

### 2. Git・snapshot adapter

`src/application/history-rewrite-recovery/adapters.ts`へ次を追加した。

- `GitRevisionMappingHistoryRewritePort`
  - old objectの存在確認
  - immutable revision間diff
  - old/new complete UTF-8 textの取得
  - 同一old pathに複数sectionがある場合のfail-closed
- `NonGitSnapshotHistoryRewritePort`
  - T601 `NonGitSnapshotTracker`のmapped/missing/corrupt/expired/ambiguous結果をT602 contractへ変換

### 3. context・Globalの独立回復

`src/application/history-rewrite-recovery/git-context-recovery.ts`へ`GitHistoryRewriteRecoveryCoordinator`を追加した。

- context stateとrepository-wide Global stateを別snapshot scopeで保持する
- old context objectとold Global objectのavailabilityを独立判定する
- objectがmissingと証明された側だけsnapshot recoveryへ切り替える
- current revisionのimmutable textからline countとSHA-256 content hashを再計算する
- current tree上で一意なrename先だけstable file IDを保持する
- snapshot、current text、path enumerationの取得失敗・曖昧・不正encodingでは確認済み状態を推測しない

### 4. revision mapper統合

`src/application/review-context/history-rewrite-git-context-revision-mapper.ts`で、既存の直接Git mappingをauthoritativeな第一経路として維持し、old object missing時だけT602 coordinatorを呼ぶ構成にした。

current candidate pathが呼出側から与えられない場合、Local Gitのimmutable tree enumerationを利用する。列挙不能時は候補なしとしてfail-closedにする。

### 5. Local Git tree enumeration

`src/adapters/local-git/history-rewrite-local-git-adapter.ts`へ、exact commitに対する次の境界を追加した。

- commit objectのfull SHA検証
- `git ls-tree --full-tree -r --name-only -z <sha> --`
- NUL framingの必須化
- newlineを含むPOSIX pathの保持
- duplicate、空path、非NUL終端の拒否
- missing revisionとempty treeの区別

### 6. production document runtime配線

`src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`で、通常のGit document sessionへT602を接続した。

- T601 snapshot trackerをworkspace providerから同一runtime境界として取得
- revision sourceごとにT602 coordinatorを登録
- Git session open時に、exact revision/pathから読み出した本文がtarget content hashとline countに一致する場合だけcontext/Global snapshotを保存
- command commit前にcontext/Global snapshot pointerを無効化
- state commit成功後にreplacement snapshotを公開
- snapshot公開失敗時は両pointerを再度無効化し、旧generationを再利用可能にしない
- contextとGlobalのreviewed rangesは別snapshotとして保存し、片側の状態を他方へ代用しない

`src/adapters/workspace-review-state/snapshot-tracking-workspace-review-state-session-provider.ts`は、同一のT601 trackerをproduction compositionへ公開するread-only getterを追加した。

## 主要なfail-closed境界

- Git command/API failureをold object missingと同一視しない
- malformedまたはpath不一致のGit diffから確認済み範囲を継承しない
- old/new complete textがpersisted/current line countまたはcontent hashと矛盾する場合は拒否する
- snapshot missing、corrupt、expired、ambiguousを確認済みとして扱わない
- authoritative empty snapshot mappingをhash fallbackで復活させない
- 複数snapshot候補または複数exact-content候補を一意と推測しない
- tree path列挙の不正framing、duplicate、不正pathを拒否する
- replacement snapshot公開失敗後に旧snapshot pointerを残さない

## 変更ファイルの責務

- `.github/workflows/ci.yml`: T602 focused suiteと診断log
- `src/application/history-rewrite-recovery/*`: 回復contract、service、adapter、context/Global coordinator
- `src/application/review-context/*`: missing-object fallbackの統合contractとmapper
- `src/adapters/local-git/*`: immutable tree path列挙とproduction export
- `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`: production snapshot publication/recovery配線
- `src/adapters/workspace-review-state/snapshot-tracking-workspace-review-state-session-provider.ts`: tracker共有境界
- `test/unit/history-rewrite-*.test.ts`: service、保守性、context/Global、tree enumerationの回帰
- `test/unit/local-git-tree-list.test.ts`: Local Git framing・missing/empty境界
- `test/unit/document-git-history-rewrite-runtime.test.ts`: production providerでの保存・旧object消失・復元

## 検証結果

exact implementation HEAD `424fdd54e059500d7c9e1b78793bb75f281b6fa3`に紐づくrun `31094706729`だけを最終判定に使用した。別SHAのrunは代用していない。

| Gate | Result |
| --- | --- |
| npm install | success |
| build | success |
| contract typecheck | success |
| architecture validation | success |
| architecture negative contract | success |
| lint | success |
| unit tests | success（448 tests） |
| T602 focused recovery tests | success |
| T403 GitHub cache tests | success |
| T304 PR progress tests | success |
| T502 Global mapping tests | success |
| T503 repository enumeration tests | success |
| T504 Global understanding tests | success |
| temporary Git integration tests | success |
| mock GitHub integration tests | success |
| VS Code Extension Host tests | success |

## 意図的に変更していない範囲

- `doc/design/vscode-review-range-tracker-design.md`: rev4の10.4節に実装方針が既に定義されており、設計変更を要しないため未変更
- `tasks/tasks-status.md`および`tasks/phases-status.md`: repository内の更新ルールが`task-breakdown-planner`、`task-consistency-manager`、`progress-sync-manager`経由に限定されている。今回利用可能なworker skillに当該更新skillがないため未変更
- merge、release、PR ready化: 実施していない
- 通常レビュー・独立最終レビュー: implementation workerの責務外のため未実施

## 残存リスク・後続所有

- snapshot保存はexact Git revision本文がtarget hashとline countへ一致する場合だけ行う。未commitのworking-tree-only内容はimmutable Git証拠ではないため、history消失時に確認済みとして復元しない
- 大規模repository、巨大file、多数candidateに対する性能計測・最適化はT607の範囲
- schema migration、破損隔離・回復はT603、cross-window lockとatomic history appendはT604、包括的failure policyとprivacy-safe診断はT606の範囲
- 本実装は通常レビュー前である。review findingが発生した場合は同一PRで対応する

## Outcome

T602の実装とproduction runtime接続を完了し、implementation HEAD `424fdd54e059500d7c9e1b78793bb75f281b6fa3`のexact-head CIを成功させた。

次のactionはPR #49に対する通常レビューである。利用者がmergeするまでworkerはmergeしない。
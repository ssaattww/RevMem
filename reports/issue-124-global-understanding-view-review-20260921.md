# Issue #124 / PR #125 レビューレポート

## メタデータ

- review mode: initial review
- generated at: 2026-09-21T18:03:47+09:00
- repository: ssaattww/RevMem
- Issue: #124
- Pull Request: #125
- branch: `fix/issue-124-global-understanding-view`
- base: `eb8dc52f1c329a5768c263a8773289c9865f5dd4`
- reviewed implementation HEAD: `4e6ddb45966ec96e7b5e16834f44af7e5858979d`
- execution environment: FA780 / Windows / PowerShell / RDC
- worktree: `C:\Users\donabe\Project\RevMem-issue124`
- source state at review: clean

## レビュー対象

Issue #124 の受け入れ条件、設計書、PR #125 の全11変更ファイル、
Global Understanding の source / UI model / VS Code runtime、
folder scope controller、repository path enumerator、関連テスト、CI 証拠を確認した。

主な要求は次の3点である。

1. `running` folder を spinner で識別できること。
2. folder action が現在状態ではなく押下後の操作 `開始` / `停止` / `再開` を表すこと。
3. path 列挙済み file を本文未収集でも一覧へ残し、未計算値を推測しないこと。
## 検証証拠

reviewed HEAD 上で次を確認した。

- `npm run test:t610`: 75/75 pass。
- T607 の既存 bounded-stage 2 test:
  - large Global Tree deterministic bounded stages: pass。
  - 10,000-file projection accounting: pass。
- path-only file 10,000件を用いた外部 review probe:
  - output: `{"fileCount":10000,"firstYieldPathReads":10128,"totalPathReads":20000,"yields":1249}`
  - probe は reviewed source 外に置き、PR worktree は変更していない。
- GitHub Actions:
  - PR current reviewed HEAD: `4e6ddb45966ec96e7b5e16834f44af7e5858979d`
  - matching run: `35578008752` / CI #4593
  - conclusion: success
  - artifact: `review-range-user-validation-0.1.55-pre+4e6ddb4`
  - artifact id: `10629046478`
  - artifact `head_sha` は reviewed HEAD と一致。

CI 成功は以下の review finding を否定しない。
いずれも現在の test coverage が検出していない契約欠落である。

## Findings

### I124-R001 — High — failed 遷移後の folder row が UI へ公開されない

origin: introduced_by_change / coverage_miss

location:
- `src/composition/global-understanding/global-understanding-source.ts`
- `src/ui/global-understanding/global-understanding-ui-model.ts`

source は scope failure 時に `folderScopes.fail(...)` で controller state を `failed` に更新した後、その error を再throwする。
一方 `GlobalUnderstandingRefreshController.refresh()` は current generation の error を catch すると `host.clear()` を実行して再throwする。
そのため controller 内には `failed` が残っても Tree は消去され、
Issue #124 の「running → active / stopped / failed の遷移後、spinner と action が current generation の状態へ追従する」を満たさない。

impact:
- 収集失敗直後に failed row の warning 表示を確認できない。
- failed state の有効 action である `開始` をその row から実行できない。
- ユーザーには folder が失敗したのか、単に表示が消えたのか判別できない。

evidence:
- source failure paths は `folderScopes.fail(...)` 後に throw する。
- refresh controller の current-generation failure path は `host.clear()` する。
- 既存 T610 test は controller state が failed になることだけを確認し、actual provider への failed row publication を確認していない。

required action:
failed current generation を Tree へ公開できる failure path を設け、
actual source + runtime provider の composition test で failed row、warning icon、`開始` action が残ることを固定する。

### I124-R002 — High — running 再計算中に既知 file 一覧が一時的に消える

origin: introduced_by_change

location:
- `src/composition/global-understanding/global-understanding-source.ts`
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`

各 active folder の `begin()` 後、path enumeration より前に
`publishProgress(this.emptySnapshot(...))` が呼ばれる。
`emptySnapshot()` は `progress.files=[]`、file count 0、`discoveredFilePaths` なしを返す。
runtime はその progress snapshot を直ちに Tree model へ変換して `tree.setModel(stage)` する。
そのため前 generation で既に path 列挙済みだった file も、
新しい refresh が running に入った瞬間から enumeration 完了まで一覧から消える。

impact:
- Issue #124 が解消しようとしている「存在する file 一覧が見えない」状態が収集中に再発する。
- spinner を見ながら file 一覧を確認する用途が成立しない。
- file row の選択・open target も running 中は失われる。

evidence:
- running publication は path enumeration 前の empty snapshot。
- runtime の progress publication は current Tree を置き換える。
- 追加 test は final snapshot の `discoveredFilePaths` のみ確認し、previously-known file rows の running 中保持を確認していない。

required action:
running state の publication で既知の path-only file rows を維持するか、
folder lifecycle publication と file snapshot replacement を分離する。
actual provider test で「成功済み snapshot → 次 refresh running」の間も既知 file rows が残り、
同時に spinner と `停止` action が表示されることを固定する。

### I124-R003 — Medium — discovered path validation が bounded-stage 契約を破る

origin: introduced_by_change

location:
- `src/ui/global-understanding/global-understanding-ui-model.ts`
  - `validateDiscoveredFilePaths`
  - `validateTreeSnapshotIncrementally`

`createGlobalUnderstandingTreeModelIncrementally()` は bounded-stage API だが、
`validateTreeSnapshotIncrementally()` 内で呼ぶ `validateDiscoveredFilePaths()` は
`discoveredFilePaths` 全件と `progress.files` 全件を同期 loop し、その間一度も yield しない。
Issue #124 で本文未収集 file まで `discoveredFilePaths` に含めるため、
large repository ではこの同期 validation が新たに主要 workload になる。

review probe では 10,000 path-only file に対して、
最初の scheduler yield より前に 10,128 path access が発生した。
設計書の「各 stage を決定的 item budget で区切り、各段階で scheduler へ制御を戻す」
および validation を同じ明示 budget に収める契約と一致しない。

impact:
- large repository で Extension Host の応答性を落とす。
- T607 の既存 10,000-file test は accounting 対象外の synchronous validation を数えないため Green のまま回帰を見逃す。

required action:
discovered path validation と progress-path membership validation を cooperative/bounded にし、
path-only 10,000件 fixture で最初の yield までの work が `maxFilesPerStage` 以下であることを検証する。

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_finding | I124-R001, R002, R003 |
| correctness / edge cases | checked_finding | failed transition と running refresh を確認 |
| scope discipline | checked_no_finding | 変更は Issue #124 周辺、report/tracking/handoff に限定 |
| changed files / direct dependencies | checked_finding | source/model/runtime/controller/enumerator/tests を確認 |
| API / data / configuration / compatibility | checked_no_finding | optional `discoveredFilePaths` により legacy snapshot compatibility を維持 |
| error handling / failure diagnostics | checked_finding | failed state publication が欠落 |
| security / secret handling | checked_no_finding | 新規 secret/credential exposure なし |
| tests / validation adequacy | checked_finding | final-state test はあるが failed/running/budget の coverage が不足 |
| current-HEAD CI evidence | checked_no_finding | exact HEAD run 35578008752 success |
| report / tracking / documentation accuracy | checked_no_finding | implementation report は reviewed HEAD と CI の時系列を区別 |
| regression / maintainability risk | checked_finding | unbounded validation と transient Tree clearing |

## Held / unexplored

- held: なし。
- unexplored: 実 VSIX を手動操作した視覚 smoke test は実施していない。
  ただし上記3件は source/runtime control flow と再現 probe で判断可能であり、verdict を保留しない。

## Verdict

**fail**

required finding が3件あるため、PR #125 は現 reviewed implementation HEAD のままでは review pass としない。

## 次のアクション

実装担当へ I124-R001〜R003 を返す。
修正は TDD で行い、各 finding について次を揃えてから同じ normal review chat で fix verification する。

- required action
- production path
- actual composition fixture
- focused validation evidence

修正後は新しい PR current HEAD を取得し、その HEAD と完全一致する CI run のみを CI 証拠として使用する。
merge は行わない。

# PR #68 レビュー指摘対応報告

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: #66
- PR: #68 `Fix #66 Global and PR progress projections`
- Branch: `fix/issue-66-global-untracked-missing`
- Base: `main`
- Base SHA: `7d4df08e6a55b40ecb1d0faf515005912274258d`
- Reviewed implementation HEAD: `20b04efbdf3cc0dfb6a9a9f58e3cf979552cc592`
- Review administrative HEAD at follow-up start: `5bc822a054a856f1709756034fb63d271101f30f`
- Technical implementation HEAD: `d6082974c322421384cf943bf913cd12ef36d20c`
- Technical exact-head CI: `32203046332` / **success**
- Review source: `reports/issue-66-pr68-initial-review-20260819.md`
- Initial review verdict: **fail**
- Findings addressed by implementation: **PR68-R001 High, PR68-R002 High, PR68-R003 High, PR68-R004 High**
- Merge: not performed

この報告はレビュー指摘への実装対応を記録するものであり、レビュワーによるfix verificationのpass判定を代替しない。技術検証は上記`Technical implementation HEAD`と同一SHAのCIだけを根拠とする。report/handoff保存後の管理commit HEADは別途exact-head CIで確認し、PRへ記録する。

## 目的とスコープ

PR #68の初回通常レビューで検出された4件のHigh findingを、RevMemのTDD方針に従って修正した。

対象は次の4点である。

1. Windows mixed-case pathでPR diff editorから先に確認済みにした場合も、同じstateをPR Progressが読み取れること。
2. PR #68以前に保存されたWindows mixed-case persisted stateをupgrade後もcase-insensitive logical identityとして読み取れること。
3. PR Progressの非同期activationをcontext/generationへbindし、stale success/failureやPR離脱後の完了が現在Treeを書き換えないこと。
4. PR Progress取得失敗をderived projection failureとして分離し、Current Context切替後の装飾・Global Understanding・Review Contextsや、成功済みlive-edit state mutationを巻き込まないこと。

非目標は以下である。

- pure working-tree untracked fileをPR Progress分母へ追加すること。
- PR #68の既存設計を変更すること。
- `.github/workflows/ci.yml`を変更すること。既存workflowが必要なfailure diagnostic artifactを保存しているため不要だった。
- `tasks/tasks-status.md`を更新すること。指定manager専用のため変更していない。
- PRをmergeすること。

## 作業開始時のCI artifact確認

`.github/workflows/ci.yml`を確認した。失敗時に各commandの標準出力、標準エラー、combined log、result metadata、environment、git status、source、test、tools、configurationをartifactとして保存する既存構成があり、レビュー指摘調査に必要な情報を満たしていた。そのためworkflowの追加変更は行っていない。

## Authoritative findings

### PR68-R001 — High — WindowsのPR diff初回確認で、自身が保存したstateをPR Progressが拒否する

- Origin: `introduced_by_change`
- Reviewed location: `src/t405-pull-request-review-runtime.ts` (`openSession`, `projectContextFileIdentities`) / `src/core/pr-progress/pr-diff-progress.ts` (`validateFileState`)
- Impact: mixed-case repository pathでPR-diff-firstに確認すると、persist後のPR Progressが`File review currentPath mismatch`で失敗する。
- Required action: empty persisted stateからmixed-case PR diffを確認し、その後`getProgress()`/`activateProgress()`が同じstateを読めるTDD回帰を追加してidentity表現を一貫させる。

### PR68-R002 — High — pre-fix Windows persisted PR stateを互換照合できずGlobal `missing`とidentity分裂が残る

- Origin: `introduced_by_change`
- Reviewed location: `src/t505-global-understanding-source.ts`, `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`, `src/t405-pull-request-review-runtime.ts`
- Impact: upgrade前の`Src/Example.ts`のようなraw-cased stateがGlobalで`missing`になり、normal editorが新hashed identityを作って同一logical fileを分裂させ得る。
- Required action: legacy casingをWindows case-insensitive canonical identityとしてread/migration境界で再利用し、複数identityが同じcanonical pathへ衝突する場合は確実にfail closedする。

### PR68-R003 — High — PR Progress activationの競合で別PRのsnapshotを表示できる

- Origin: `introduced_by_change`
- Reviewed location: `src/t405-pull-request-review-runtime.ts` (`activateProgress`) / `src/t305-extension.ts` / `src/ui/pr-progress/vscode-pull-request-progress-tree.ts`
- Impact: A→B切替で遅いA successがBを上書き、遅いA failureがBをclear、またはPR離脱後にAが復活するraceが成立する。またsource切替直後にold A snapshotをnew B sourceとして再描画できる。
- Required action: activationをcontext/generationへbindし、stale success/errorをpublish不可にし、source switchもold snapshotを新contextとして表示しない順序にする。

### PR68-R004 — High — PR Progress失敗がCurrent Context全体を中断する

- Origin: `introduced_by_change`
- Reviewed location: `src/t305-extension.ts`のCurrent Context dependent refreshおよびlive-edit continuation
- Impact: PR Progress取得失敗が新ownerの通常エディタ装飾、Global Understanding、Review Contexts更新まで止め、live-editではstate mutation成功後のderived projection failureを「レビュー状態更新失敗」として誤報し得る。
- Required action: owner-bound projectionsを独立して更新し、PR Progress failureだけを個別にfail closed/reportし、成功済みstate mutationを失敗扱いしない。

## TDD RED

### PR68-R001 / R002 / R003

回帰testを先に`test/unit/issue-66-pr68-review-findings.test.ts`へ追加した。

Authoritative behavior RED:

- HEAD: `aa385571313dff8bc9f8837a5038189ac3d23b47`
- Exact-head CI: `32202287069`
- Conclusion: **failure**
- Diagnostic artifact: `9347941445`

意図した6 failureを確認した。

- R001: `File review currentPath mismatch for Src/Example.ts`
- R002 Global: actual `missing`, expected `current`
- R002 selected normal editor: legacy `Src/Example.ts`を再利用せず新`repository-file:<hash>`を生成
- R003 stale A success: B成功後にAがactiveになる
- R003 stale A failure: stale failureがrejectとして外へ出る
- R003 PR離脱: pending A完了後にprogress snapshotが復活する

補足として、`4a9225aa864d8cf13b34be06a532323f497e1898` / CI `32202067155` / artifact `9347869272` は最初のtest-only REDだったが、R002 Global fixtureのrepository root設定が不正だったため、そのR002 Global証拠は採用せずfixture修正後の`aa385571...`をauthoritative REDとした。

### PR68-R004 / source switch

`test/unit/t305-projection-refresh.test.ts`を先に追加した。

- HEAD: `779c3d66cd6c6538979f35f468eb805b01424160`
- Exact-head CI: `32202387065`
- Conclusion: **failure**
- Diagnostic artifact: `9347971135`
- Failure: production orchestration module `src/t305-projection-refresh.ts`が存在せずcompile RED (`TS2307`)

このtestは、source switch前のold snapshot消去、PR Progress failure時にもnew-owner decoration/Global/Review Contextsが更新されること、successful edit-state mutationがPR projection failureだけで失敗扱いされないことを固定する。

## 実装

### 1. PR diff / PR Progress identity一貫性

`src/t405-pull-request-review-runtime.ts`を修正した。

- PR diff URIからfileを解決するときもfilesystem semanticsに基づくcanonical pathで照合する。
- persisted Context/Global stateはcanonical pathで既存file IDを解決する。
- legacy persisted IDがある場合はそのIDを再利用する。
- persisted stateがないPR-diff-first経路ではraw PR diff identityとraw logical pathを同じ表現で保存し、`fileId=Src/Example.ts` / `currentPath=src/example.ts`の混成を作らない。
- PR Progress計算時はpersisted stateをraw PR diff IDへcalculation-only projectionする。persisted identity自体は書き換えない。
- 同一canonical pathに複数distinct IDが存在する場合は推測統合せずfail closedする。

### 2. Legacy Windows persisted state互換

`src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`を修正した。

- selected PR normal-editor sessionでpersisted Context/Global pathをWindows case-insensitive canonical pathとして比較する。
- pre-fix `Src/Example.ts` stateを`src/example.ts` current editorから同一fileとして再利用する。
- Context/Global間でdistinct IDsが同じcanonical pathへ競合する場合はfail closedする。
- session target pathはcurrent canonical pathを使用し、次のmutationから正規表現へ収束できる。

`src/t505-global-understanding-source.ts`も修正した。

- persisted Global stateを計算時にcanonical path projectionしてからcore Global calculatorへ渡す。
- Windowsではcase-fold、POSIXではcase-sensitiveを維持する。
- distinct file IDsが同じcanonical pathへ収束する場合はfail closedする。

### 3. PR Progress generation / source switch

`src/t405-pull-request-review-runtime.ts`へ`progressGeneration`と`activeProgressContextId`を導入した。

- activation開始時にgenerationを更新しshared progressを同期的にclearする。
- publish前と各await境界でcurrent context/generationを確認する。
- stale successは`replaceSnapshot()`できない。
- stale failureはcurrent snapshotをclearせず外へ伝播しない。
- `clearProgress()`はgenerationを進め、pending activationを無効化する。
- already-started stale content acquisitionはruntime内でsettleさせ、stale failureをcatchで吸収する。これによりunhandled rejectionを残さない。

`src/t305-projection-refresh.ts`を新設し、PR source切替を`activateProgress()`開始後に行う。`activateProgress()`はawait前にold snapshotをclearするため、新source設定時にold snapshotを新PRとして描画しない。

### 4. Owner projection failure isolation

`src/t305-projection-refresh.ts`へ以下を実装した。

- `refreshCurrentContextDependents`
- `refreshAfterDocumentEdit`

PR Progressは独立したsettled projectionとして実行し、失敗時に個別reportする。一方、Current Context切替では通常editor decorations、Global Understanding、Review Contextsを継続する。

`src/t305-extension.ts`のlive-editはstate mutation Promiseとprojection refresh Promiseを分離した。state mutation成功後のPR Progress failureは`PR Progressを更新できませんでした`として別reportされ、`編集後のレビュー状態を更新できませんでした`へ誤変換されない。

## 小さな論理commit

主要な実装・test commitは以下のとおり。

- `4a9225aa864d8cf13b34be06a532323f497e1898` — initial R001-R003 tests
- `aa385571313dff8bc9f8837a5038189ac3d23b47` — corrected R002 upgrade fixture
- `779c3d66cd6c6538979f35f468eb805b01424160` — R004/source-switch tests
- `fcaa9a151e7e743ad448f5544560c3ef6f011efa` — PR progress identity/generation implementation
- `e049346d056aa5fcf5dff0a8500f7933a395b7` — legacy Windows selected-PR path read
- `6f024da6be229036aa4c38f9b69559b13dcf110d` — legacy Global canonical projection
- `bb629c308c4e4a120240756cb9279326f0f17eaf` — projection refresh orchestration module
- `36618ee5e9f35baf74b90093e82bc8f52ccefb97` — production owner-projection wiring
- `626071f80e0326614ed541aa909121d466227511` — update existing structural regression for guarded source switching
- `d6082974c322421384cf943bf913cd12ef36d20c` — settle stale acquisition failures without unhandled rejection

## 中間検証と調査artifact

### `36618ee5...`

- Exact-head CI: `32202774360`
- Conclusion: failure
- Artifact: `9348097149`
- R001-R004 finding tests自体はsuccess。
- Remaining failuresは、旧Issue #66 structural testがdirect source assignmentという旧実装形を固定していたこと、およびR003 test deferred rejectionがtest終了後unhandled rejectionになったことだった。

### `626071f8...`

- Exact-head CI: `32202921332`
- Conclusion: failure
- Artifact: `9348142571`
- structural testは修正済み、finding testsはsuccess。
- Remaining failureはstale A deferred rejectionの非同期後処理のみだった。

このfailureをruntime境界で吸収する修正を`d6082974...`へ追加した。

## Technical GREEN

- Technical HEAD: `d6082974c322421384cf943bf913cd12ef36d20c`
- Exact-head workflow run: `32203046332`
- Conclusion: **success**

成功した検証:

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests: **534 passed**
- T602 history rewrite recovery tests
- T603 schema migration and corruption recovery tests
- T403 GitHub cache tests
- T404 GitHub PR context layer tests
- T405 Review Contexts follow-up tests
- T304 PR progress tree tests
- T502 Global mapping/display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- T505 Global understanding tests
- T506 Global multi-context integration
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのworkflow runはこのtechnical GREEN判定に使用していない。

## Finding disposition

### PR68-R001 — addressed by implementation

Mixed-case WindowsのPR-diff-first testで、確認済みmutation後の`getProgress()`が`1/2`、`0.5`となりpath mismatchが発生しないことをexact-head CIで確認した。

### PR68-R002 — addressed by implementation

pre-fix raw-cased Windows fixtureで、Globalが`current`となり、selected normal editorがlegacy file IDを再利用することを確認した。canonical duplicate identityはfail closed方針を維持する。

### PR68-R003 — addressed by implementation

Deferred Promiseで、B成功後のstale A successがBを上書きしないこと、stale A failureがBをclearしないこと、PR離脱後のA完了がsnapshotを復活させないこと、source切替時にold snapshotをnew sourceとして描画しないことを確認した。

### PR68-R004 — addressed by implementation

PR Progress failureを注入してもnew-owner decorations、Global Understanding、Review Contextsが更新されること、および成功済みedit-state mutationがderived PR projection failureで失敗扱いされないことを確認した。

これらは実装workerによる「addressed」判定であり、normal reviewerによるfix verification verdictは未実施である。

## 変更・追加ファイル

レビュー指摘対応で主に変更・追加したファイル:

- `src/t405-pull-request-review-runtime.ts`
- `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`
- `src/t505-global-understanding-source.ts`
- `src/t305-projection-refresh.ts`
- `src/t305-extension.ts`
- `test/unit/issue-66-pr68-review-findings.test.ts`
- `test/unit/t305-projection-refresh.test.ts`
- `test/unit/issue-66-global-pr-progress.test.ts`
- `test/unit/core-contracts.test.ts`

## 意図的に変更していない領域

- `.github/workflows/ci.yml`: 既存failure diagnosticsで要件充足。
- `doc/design/vscode-review-range-tracker-design.md`: findingは既存設計への実装不適合であり設計変更不要。
- `tasks/tasks-status.md`: designated manager専用。
- PR Progressの「PR diffに含まれる追加/削除行だけを分母とする」仕様。
- merge状態: user-ownedのため未実施。

## 残存リスクと次アクション

実装workerが確認した範囲ではPR68-R001〜R004の再現ケースはtechnical exact-head CIで閉じている。残る工程は、同じnormal reviewerによるfix verificationで4 findingのclosureを独立に確認すること。

report/handoff保存後は管理commitによりPR HEADが変わるため、その新HEADとworkflow runの`head_sha`が一致するCIを改めて確認し、最終結果をPR body/commentへ記録する。Mergeは行わない。
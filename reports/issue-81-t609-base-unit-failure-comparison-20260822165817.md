# Sub-agent実行レポート

## タスク

- 目的: Issue #81 base commitでtest:unit failureを一度だけ取得し、current 23 failuresがregressionかWindows baselineかを比較する。
- タスク種別: baseline限定ローカル診断

## sub-agentを使う理由

- 理由: ユーザー指定のterra/highで、隔離worktreeの長時間比較をcurrent branch編集から分離するため。

## 対象範囲

- 対象: base `3bba5defe32b7da134817492427e09c70c97beaf` のtest:unit単回実行、current failure identityとの比較、隔離worktree cleanup。

## 対象外

- 対象外: base/current code変更、失敗修正、再試行、他gate、commit、push、CI、レビュー、PR操作、merge。

## 実行コマンド

- 実行コマンド: 指定の隔離worktree `C:\Users\taiga\source\repos\RevMem-issue81-baseline-unit`（detach `3bba5defe32b7da134817492427e09c70c97beaf`）で、current `C:\Users\taiga\source\repos\RevMem-issue81\node_modules` へのdirectory junctionを検証してから、`$unitOutput = @(& npm run test:unit 2>&1 | ForEach-Object { [string]$_ }); $unitExit = $LASTEXITCODE` を一度だけ実行した。stdout/stderr全784行はPowerShell配列に保持し、file redirect・依存再install・再試行は行っていない。exit 1、tests 546、pass 522、fail 22、skipped 2、cancelled 0、duration 29244.4236ms。

## 対象ファイル

- 変更または確認したファイル: current worktreeでは本予約レポートだけを編集した。baseline worktreeはtest実行時の生成物とjunctionを含む使い捨て領域であり、cleanup対象である。baseの22 failure名は、(1) `Git ownership routes a workspace-external file to the branch repository`、(2) `Git ownership wins even when the file belongs to the current workspace`、(3) `workspace reviewed ranges are promoted when Git ownership is detected later`、(4) `an old workspace context records an empty baseline before the target file is first created`、(5) `initial workspace promotion persists ranges and baseline in one real CAS commit`、(6) `a failed initial promotion leaves the Git owner without promoted ranges or baseline`、(7) `workspace and external sources are reconciled by one real CAS commit`、(8) `content changes refresh the reconciliation baseline before later fallback additions`、(9) `Git recovery adds newer fallback ranges even when the Git owner already has state`、(10) `fallback additions do not resurrect ranges removed from the higher owner`、(11) `initial promotion and baseline use one lower-owner observation`、(12) `workspace reviewed state wins over a conflicting external-file removal`、(13) `workspace removal wins over a conflicting external-file addition`、(14) `writable open performs one active-owner Git inspection`、(15) `a new Git context at the same revision inherits repository-wide Global state`、(16) `a new Git context at an unmapped revision does not replace repository-wide Global state`、(17) `recreated lower-owner context does not turn the old baseline into removals`、(18) `stale Git cleanup preserves another context's later owner-wide Global update`、(19) `stale Git cleanup preserves a later same-context current file state`、(20) `metadata timeout escalates to SIGKILL when the process ignores SIGTERM`、(21) `owned Extension Host launch fails and terminates its tree when success is reported before worker close`、(22) `owned Extension Host launch records finite worker failures without treating them as success`。

## 指摘事項

- 指摘要約または「指摘なし」: current classification reportの23 failure名/classとの集合比較は、exact match 22、base-only 0、current-only 1である。exact matchはprovider/store系19件（各々の起点は `Error: document path is outside the resolved Git working tree.`、先頭stackは `DocumentReviewStateSessionProvider.resolveGitMapping`）、SIGKILL assertion 1件（`AssertionError [ERR_ASSERTION]`: expected `/sent SIGKILL/`、actual `Git process terminated by SIGTERM`）、Host assertion 2件（いずれも expected `/failed/` に対する timed-out error）である。current-onlyは `NodeAtomicTextFileStore rejects an outside sibling and a symbolic link or junction`（`EPERM`、Windowsでのsymlink作成拒否）だけである。従ってcurrentのprovider/store系20件はbase既存19件とcurrent-only 1件で構成される。

## 結果

- 結果: base unitは22 failuresでcompleteに取得した。current 23とのexact deltaはcurrent-onlyの`NodeAtomicTextFileStore rejects an outside sibling and a symbolic link or junction` 1件、base-onlyなしである。分類は、exact-match 22件をbaseline failure、confirmed regression 0件、current-onlyのNodeAtomicTextFileStore `EPERM` を単回比較だけではproduct regressionと断定できないunknown（new test/Windows permission fixture候補）とする。Markdown wording checkは、`tools/lint/`設定および`lint:md` scriptが存在しないためunsupportedであり、指定どおり他gateは実行していない。

## リスク

- 未解決のリスクまたは後続対応: baseにもprovider/store 19件、SIGKILL 1件、Host assertion 2件が存在するため、これらをIssue #81によるregressionとは扱えない。一方、current-onlyのNodeAtomicTextFileStore `EPERM` はWindows symlink権限/fixtureまたは実装変更との関係をこの一回の比較だけでは確定できない。junctionは非再帰で削除済みで、resolved exact path照合後のbaseline worktree removeもforceなしで成功した。current HEAD/upstreamは`f320a8810d9dbfaa824d1aa082ed198fec6fc279`のまま、tracked/staged diff 0、statusは本untracked reportのみである。

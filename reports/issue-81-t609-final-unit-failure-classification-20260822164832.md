# Sub-agent実行レポート

## タスク

- 目的: final full local gateで省略されたtest:unit failure一覧と集計を一度だけ再取得し、T609関連性を完全分類する。
- タスク種別: 限定ローカル診断

## sub-agentを使う理由

- 理由: ユーザー指定のterra/highで、実装変更なしの長時間診断を分離実行するため。

## 対象範囲

- 対象: committed/pushed HEAD `f744a2cb3eec5f74775753894c8ecb948a10af77` のtest:unit単回実行、完全failure名/集計/T609関連性、HEAD/status不変。

## 対象外

- 対象外: 他gate、失敗修正、再試行、code/test/design/tracking変更、commit、push、CI、レビュー、PR操作、merge。

## 実行コマンド

- 実行コマンド: `$unitOutput = @(& npm run test:unit 2>&1 | ForEach-Object { [string]$_ }); $unitExit = $LASTEXITCODE` を1回だけ実行した。stdout/stderr全859行はPowerShellプロセス内の配列に保持し、ファイルへのredirect・出力ファイル作成・再試行は行っていない。exit 1、wall-clock 116.4秒。Nodeの実際のreporterは `✖` / `ℹ` 形式であり、指定した `^not ok` および `^# tests|pass|fail|skipped|cancelled|duration_ms` のTAP抽出は0行だった。保持済み出力のfailure/error blockと同一ソースを照合した完全countは、tests 504、pass 479、fail 23、skipped 2、cancelled 0である。

## 対象ファイル

- 変更または確認したファイル: 本レポートだけを編集した。照合したIssue 81 range（`3bba5defe32b7da134817492427e09c70c97beaf..f744a2cb3eec5f74775753894c8ecb948a10af77`）の関連production/test pathは、`src/adapters/state-repository/atomic-text-file-store.ts`、`src/adapters/document-review-state/document-review-state-session-provider.ts`、`src/t609-repository-resolution.ts`、`src/t609-review-contexts-repository.ts`、`test/unit/state-repository.test.ts`、9本の`test/unit/t609-*.test.ts`、`test/vscode/run-extension-host.ts`である。`test:t609` は12ファイルを対象とし、既存same-HEAD evidenceでは77/77であり、今回の23 failure test fileとの交差は0件。Markdown lint wiringはread-onlyで確認し、`tools/lint/` と `lint:md` scriptは存在しないためfocused/full Markdown wording checkはunsupported（実行していない）。

## 指摘事項

- 指摘要約または「指摘なし」: 23 failuresを完全分類した。T609-related（直接の変更production/test pathに到達）20件: (1) `NodeAtomicTextFileStore rejects an outside sibling and a symbolic link or junction` — `EPERM`、Windowsでの`symlink`作成拒否（変更済みatomic store/state test）。(2) `Git ownership routes a workspace-external file to the branch repository`、(3) `Git ownership wins even when the file belongs to the current workspace`、(4) `workspace reviewed ranges are promoted when Git ownership is detected later`、(5) `an old workspace context records an empty baseline before the target file is first created`、(6) `initial workspace promotion persists ranges and baseline in one real CAS commit`、(7) `a failed initial promotion leaves the Git owner without promoted ranges or baseline`、(8) `workspace and external sources are reconciled by one real CAS commit`、(9) `content changes refresh the reconciliation baseline before later fallback additions`、(10) `Git recovery adds newer fallback ranges even when the Git owner already has state`、(11) `fallback additions do not resurrect ranges removed from the higher owner`、(12) `initial promotion and baseline use one lower-owner observation`、(13) `workspace reviewed state wins over a conflicting external-file removal`、(14) `workspace removal wins over a conflicting external-file addition`、(15) `writable open performs one active-owner Git inspection`、(16) `a new Git context at the same revision inherits repository-wide Global state`、(17) `a new Git context at an unmapped revision does not replace repository-wide Global state`、(18) `recreated lower-owner context does not turn the old baseline into removals`、(19) `stale Git cleanup preserves another context's later owner-wide Global update`、(20) `stale Git cleanup preserves a later same-context current file state` — いずれも`Error: document path is outside the resolved Git working tree.`、stack先頭は`DocumentReviewStateSessionProvider.resolveGitMapping`（compiled line 203）であり、変更済みprovider pathに直接到達する。T609-non-related 1件: (21) `metadata timeout escalates to SIGKILL when the process ignores SIGTERM` — `AssertionError [ERR_ASSERTION]`、期待`/sent SIGKILL/`に対し実測`Git process terminated by SIGTERM`、`node-git-command-executor`はIssue 81変更pathではない。T609-unknown（changed runnerに隣接するがT609名/target fileの直接一致なし）2件: (22) `owned Extension Host launch fails and terminates its tree when success is reported before worker close`、(23) `owned Extension Host launch records finite worker failures without treating them as success` — ともに`AssertionError [ERR_ASSERTION]`、期待`/failed/`に対して実測はそれぞれ`Extension Host launch success-without-close timed-out`および`Extension Host launch intentional-failure timed-out`。`ERR_`は上記`ERR_ASSERTION`のみ、`EBUSY`はなし。失敗名に`T609`、T609 test file、またはT609 focused 12-file targetの一致はない。

## 結果

- 結果: `npm run test:unit` は1回のみ実行してexit 1。23 failuresの名前・件数・原因class・T609交差を分類済みで、前回のunit-output省略によるunexploredはこの診断範囲では解消した。失敗をpassへ読み替えず、修正・他gate・再試行は行っていない。実行後もHEADは`f744a2cb3eec5f74775753894c8ecb948a10af77`、staged diff 0、tracked diff 0で、worktreeの変更は本予約reportのみである。

## リスク

- 未解決のリスクまたは後続対応: full local gateの`test:unit` failure自体は未解決である。20件の変更provider/store経路のfailureはT609実装との直接到達を示すが、今回の単回診断だけではproduct regressionとWindows fixture/environment差のいずれかを確定しない。SIGKILL assertion 1件とExtension Host assertion 2件もfailedのままであり、unknownの2件をT609非関連と断定しない。Markdown lint wiring unsupportedとexact-head CI未待機は本診断の対象外。merge、commit、push、CI、PR、review、design/tracking/handoff編集は行っていない。

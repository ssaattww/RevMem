# Sub-agent実行レポート

## タスク

Issue #81 / T609 の通常closure open finding `T609-NR-004`、`T609-NR-006`、`T609-NR-007`を同一batchで限定実装した。technical HEADは`8c4bdedce4e1c8e31ca4484991fd5581d83b068a`（未commit）である。

## sub-agentを使う理由

repository-selection cancellation、Host matrix、public type compatibilityを同じruntime/fixture/gate境界で確認する必要があり、実装担当が予約済みreportへ実行証跡を記録する。

## 対象範囲

- `T609-NR-004` High: multi-root Hostでactual `reviewRange.redetectPullRequest`を通し、cancel/staleのrepository-selection seam到達、provider projectionとauthoritative Review State countの不変を確認する。
- `T609-NR-006` Medium: 上記semantic Host matrixをT609 gate契約へ固定する。
- `T609-NR-007` Medium: public `GitContextRevisionMappingResult.unresolvedReasonsByFileId`をoptionalへ戻し、production consumerのdefaultと旧shape compile fixtureを追加する。
- completeness matrix: NR004=`implementation ready; exact Host three phases passed; runner cleanup incomplete`、NR006=`implementation ready; exact Host three phases passed; runner cleanup incomplete`、NR007=`ready; old-shape fixture compiled by focused gate`。

## 対象外

design/BreakingChanges、tracking、CI、PR/Issue、commit、push、full gate、独立reviewは対象外。productionではfinding直接原因以外の変更をしない。

## 実行コマンド

- Red: 同一pre-implementation stateで旧shape fixtureはTS2741（required member）、Test API cancellation snapshot未提供、T405 projection snapshot未提供として失敗した。
- Red: cancellation TDDは`redetectPullRequest`後のsource loadがbaseline 1から2となり、typed cancel後にもprovider refreshが始まることを再現した。
- Green: `npm run test:t609`は51/51 pass。短絡修正後のfocused `npx tsc -p tsconfig.test.json && node --test test-dist/test/unit/t609-review-contexts-cancellation-boundary.test.js`は2/2 pass。`npm run build`はpass。
- Extension Host exact first run: `node test-dist/test/vscode/run-extension-host.js --t609`はsingle-root pass後、prepareの`multi-root cancellation boundary` timeoutでfail（`test-output/vscode-launch-diagnostics/t609-prepare-1787342839001.json`）。
- Extension Host exact permitted retry: single-root、prepare、restart-reopenの全3 phaseはpass。ただしfixture cleanupが10秒timeoutでrunner exit 1（`test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787343456684.json`）。
- Markdown lint: `tools/lint/`、`lint:md`、cspell/prh配線が見つからずfocused/fullともunsupported。

## 対象ファイル

- production: `src/ui/review-contexts/vscode-review-contexts-runtime.ts`はtyped cancellation outcomeを`mutate`へ返し、post-cancel refreshを開始しない。`src/t405-review-contexts-runtime.ts`と`src/t305-extension.ts`はExtensionMode.Testでのみprovider projection、authoritative context count、selection request countのread-only snapshotを提供する。
- contract: `src/application/review-context/contracts.ts`のdiagnostic memberをoptional化し、mapper/history/provider consumerは`?? {}`でdefaultする。
- tests/gate: multi-root Host fixture、cancellation unit、gate wiring、`tsconfig.test.json`、旧shape fixtureを更新した。
- report write boundary: 本予約reportの9 placeholderのみを置換した。

## 指摘事項

- `T609-NR-004`: cancel/staleともactual T405 commandからselection seamへ1回到達し、terminal reportなし、provider clearなし、post-cancel refreshなし、provider projectionとauthoritative state count不変をfocused unitとHost phaseで確認した。cleanup timeoutのためrunner全体はincomplete。
- `T609-NR-006`: Host fixtureはactual command、seam count、不変snapshotを固定し、T609 gate wiringがfixtureとcompile connectionを一度ずつ固定する。Host 3 phaseはpass、cleanup timeoutはincompleteとして保持する。
- `T609-NR-007`: required memberをoptional化し、legacy consumer literalを`compile:test`から`test:t609`へ一度だけ接続した。production consumer defaultは`?? {}`で保持する。BreakingChanges変更は不要な後方互換方針である。

## 結果

- 3 findingsのimplementationはready。exact Hostのfunctional 3 phaseはpassしたが、runner cleanup timeoutによりexact runner exitは1であり、passへ読み替えない。
- CI/full local equivalence/Markdown lintは未実行またはunsupported。current worktreeは未commitで、次工程はcleanup timeoutの扱いをreviewerが評価すること。

## リスク

- remaining risk: exact Host cleanup worker timeoutはfixture cleanupの未完了として残る。T609 production phaseの失敗ではないが、正常終了証跡ではない。
- no commit/push/CI/tracking/design changes were performed.

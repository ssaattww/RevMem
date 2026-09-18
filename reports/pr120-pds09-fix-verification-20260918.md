# Sub-agent実行レポート

## タスク

- PDS09-NR1-001/002/003（各P2）を修正・検証する。レビュー対象b0afe9f、開始HEAD `a10e2dd74ed60803761a50f27d0f16e6a6b9da25`。

## sub-agentを使う理由

- 同じ実装担当が限定された指摘を修正する。

## 対象範囲

- projection完了待機、実Host表示照合、Test専用観測の隔離と記録訂正。

## 対象外

- PDS-10、Issue #121、無関係な機能、コミット・push・merge。

## Dispatch profile

- implementation follow-up / bounded_technical / medium uncertainty / cross_module / high criticality。
- user_override、gpt-5.6-terra / high、既存 `/root/pds09_host` を継続。
- sequential_dependencies、decomposition_policy forbidden。初回fork none/default role unchangedを保持。
- planned_runtime_profile gpt-5.6-terra / high、applied null、final_profile_hidden。
- application_status reused_existing_agent_profile、2026-09-18に継続依頼送信済み。初回spawn_succeeded_profile_unverified。approval not_required、Astra not_applicable。
- report_persistence_mode normal_persistence。親所有欄。

## 実行コマンド

- 実行環境: Windows / PowerShell、cwd `C:\Users\donabe\CodexProjects\RevMem`、Node `v24.20.0`、npm `11.19.0`、固定 VS Code archive `1.130.0`。
- `pds09-nr1-no-forced-refresh-red`: `npm run test:pr-diff-selection-mode:extension-host` — exit 1。test-only forced refreshだけを除去した最初の実Host Red。replacement side mark直後にoriginal rendererが `[]` で、期待 `[1,2)` を満たさなかった。診断 `test-output/vscode-launch-diagnostics/pr-diff-selection-mode-1789688364699.json`。これは既存listenerがrenderer Promiseを返さないことの回帰証拠である。
- `pds09-nr1-host-projection-green` と `pds09-nr1-host-tree-diagnostic` — ともに exit 1 の試行。listener await後もCurrent Contextのactive-editor lifecycleがTest fixtureの選択sourceをlocal sourceへ置換してtree `[]` になった。各unique wrapper/diagnosticを保持し、Greenと再分類しない。
- `pds09-nr1-build-check` — `npm run build && npm run compile:test`、exit 0。
- `pds09-nr1-host-test-fixture-source-green`、`pds09-nr1-host-final-focused` — `npm run test:pr-diff-selection-mode:extension-host`、ともに exit 0。後者はobserverのproduction gate追加前のfocused Host証拠である。
- `pds09-nr1-host-final-gated-observer` — `npm run test:pr-diff-selection-mode:extension-host`、exit 0。最終focused Host証拠であり、registration層も`ExtensionMode.Test`以外ではTest observerを渡さない。診断 `test-output/vscode-launch-diagnostics/pr-diff-selection-mode-1789689345445.json`。
- `pds09-nr1-host-default-final` — `npm run test:vscode`、exit 0。t306、t302、pr-diff-selection-mode、lifecycle 2 phaseが同じ既定Host discoveryで成功。PR suite診断は `.../pr-diff-selection-mode-1789689165404.json`。
- `pds09-nr1-projection-unit-final` — `npm run compile:test && node --test test-dist/test/unit/issue-112-pr-progress-runtime.test.js`、exit 0（10 pass）。returned projection Promiseのerror reportingとTest observerのみのcaptureを確認。
- `pds09-nr1-t405-impact-final` — `npm run test:t405`、exit 0（83 pass）。PR runtime/immutable diff command impact。
- `pds09-nr1-typecheck-contracts-final`、`pds09-nr1-architecture-final`、`pds09-nr1-architecture-negative-final`、`pds09-nr1-lint-final`、`pds09-nr1-vscode-runner-final` — すべて exit 0。runner contractは7 pass。
- observerのregistration層gateを追加した最終sourceでは、`pds09-nr1-architecture-gated-observer`（positive/negative architecture）と`pds09-nr1-lint-gated-observer`（lint/typecheck:contracts）がともに exit 0。
- CI-T610: `pds09-ci-t610-contract-fix` は初回のsource-slice境界が早過ぎたため exit 1（製品runtimeではないtest contract修正の試行）。`pds09-ci-t610-contract-green` は `npm run test:t610` exit 0（74 pass）。production startupの非blocking範囲とTest fixture initializerのTest guardを別々に検証する。
- wrapperのstdout/stderr/combined/resultはそれぞれ `test-output/ci/<label>.*` に保持する。最初のPDS09の同名wrapper上書き制約は旧implementation reportどおりであり、本follow-upのlabelsはすべてuniqueである。

## 対象ファイル

- `src/ui/pr-progress/vscode-pull-request-progress-tree.ts`: projection listenerが実renderer refresh Promiseをreturnし、error reportをawaitしたうえでsynchronize pathへ返す。適用装飾のmap/range clone/updateはTest observerがある時だけ行い、registration層もTest mode以外へobserverを渡さない。
- `src/extension.ts`: ExtensionMode.Testだけがrenderer application revision/waiter observerとreaderを返す。本番はobserver、map、clone、waiter allocationを作らない。
- `src/composition/extension.ts`: Test fixture targetがある時だけimmutable PR context IDをPR Progress source selectionへ供給する。これはCurrent Context active-editor eventによるfixture source置換を防ぐだけで、public command後のactivate/tree/renderer refreshを行わない。
- `test/vscode/pr-diff-selection-mode-suite/index.ts`: 強制refreshを削除し、public commandの前に実renderer event Promiseを登録して、command Promiseとrenderer applicationの双方をawaitする。各代表mutationにstate/tree/both-pane assertionを追加。
- `test/unit/issue-112-pr-progress-runtime.test.ts`: listenerが返すPromise/error reportingと、本番capture不在/Test observer captureを検証。
- `test/unit/t610-folder-understanding.test.ts`: static whole-file否定をproduction startup sliceへ狭め、Test-only fixture initializerのguard/awaitを明示検証する。
- `reports/pr120-pds09-implementation-20260918.md`: PDS09-NR1-002の日時付き訂正を追記し、元の記録は保持。

## 指摘事項

- **PDS09-NR1-001**: `setPullRequestProgressSource` のlistenerは `refreshReviewDiffDecorations()` のPromiseをreturnする。reportErrorは従来どおりlocal error boundaryで処理し、その処理完了後にlistener Promiseをresolveする。public mark/unmarkはruntime notifierをawaitするため、command Promiseがrenderer completionまで待機する。Host testはTest-only refreshを一切呼ばず、固定sleepも使わない。
- **PDS09-NR1-002**: `assertProjection` は実tree nodeの`reviewedLineCount/totalLineCount`と、実rendererが適用したoriginal/modified paneの範囲を読む。永続stateのコピーを表示期待値として使っていない。boundary markではoriginal durable `[1,2)` に対して両renderer `[1,3)` がContext mappingを含むこと、line 3の次blockは両paneで未装飾であることを確認する。
- **PDS09-NR1-003**: production treeは`appliedReviewDiffDecorations`を`undefined`として保持し、rendererはVS Code Rangeだけを生成する。Test observerを明示注入したTest treeだけがmapとcloneを持つ。readerはTest-mode activated APIからだけ返る。
- **CI-T610**: PDS09 Test initializer内のstartup awaitはTest guard内である。T610のcontractはproduction startup registrationからGlobal startup queueまでを検査し、fixture initializerはguard内awaitを別途検査する。production activationのnonblocking contractを弱めていない。

## 結果

- PDS09-NR1-001/002/003とCI-T610はすべて実装・focused validation済み。commit/push/mergeと同一reviewerによるfinding-limited verificationは親所有であり未実施。

| 必須対応 | 本番/Test経路 | 実fixtureとassertion | focused証拠 |
| --- | --- | --- | --- |
| NR1-001 command完了 | `PullRequestReviewRuntime` → notifier → VS Code tree listener → renderer | Public mark/unmark前に実renderer eventを登録し、commandとeventの双方をawaitする。強制refresh/sleepなし | `pds09-nr1-host-final-gated-observer` exit 0 |
| NR1-002 replacement side/block/unmark | 永続PR state、実`PullRequestProgressTreeFileNode`、original+modified decorations | side original 1/4、block 4/4、modified unmark 0/4 | 同Host run exit 0 |
| NR1-002 addition mark/unmark | 同じ実経路 | 2/2後に0/2、originalは空、modifiedは`[1,3)`後に両方空 | 同Host run exit 0 |
| NR1-002 deletion mark/unmark | 同じ実経路 | 2/2後に0/2、originalは`[1,3)`後に両方空 | 同Host run exit 0 |
| NR1-002 EOL mark | 同じ実経路 | 永続original/modified/globalは`[0,1)`、rowは2/2、両paneは`[0,1)` | 同Host run exit 0 |
| NR1-002 column-0順逆境界 | 同じ実経路 | 順方向は2/4、永続original `[1,2)`・modified `[1,3)`、両rendererはContext投影を含む`[1,3)`、line 3なし。逆方向unmarkは0/4 | 同Host run exit 0 |
| NR1-002 Global mismatch/no-op | 同じ実経路 | public markがGlobalを`[1,3)`へ修復し両pane 4/4。context cursor unmarkはstate・4/4・両paneを保ち、新renderer projectionを発火しない | 同Host run exit 0 |
| NR1-003 Test-only capture | VS Code renderer constructor/refresh、ExtensionMode.Test API | 本番unit treeはcaptureなし。注入Test observerだけがclone済みrange/eventをcaptureし、Host readerは実paneを観測 | `pds09-nr1-projection-unit-final` 10 pass、focused Host exit 0 |
| CI-T610 static contract | composition activation/Test fixture source contract | production startup sliceにawaitなし。guard済みfixtureだけがimmutable fixture install前にawait | `pds09-ci-t610-contract-green` 74 pass |
| 既定discovery | package `test:vscode` runner | PR suiteがt306/t302後の既定実Host経路で起動 | `pds09-nr1-host-default-final` exit 0 |

- 最終executable source fingerprint（最終validation source変更後に採取）: `src/composition/extension.ts` `01ffcd6f62a24b97f45f812747618b9306eced7252350f0163a8866f8075eb3f`; `src/extension.ts` `dae4da7bbad2585c8dc0909b7f134218ed630c2598be4e85bc75d336a1f82ae7`; `src/ui/pr-progress/vscode-pull-request-progress-tree.ts` `d218dabc19353b2d7a6db55c15422934f1291f357245fba80aeeac4e0109cd33`; `test/vscode/pr-diff-selection-mode-suite/index.ts` `0b519712f5398406d4aa7406ae98d07b47fd7aaf9e44f3b010c2b9216fe850b2`; `test/unit/issue-112-pr-progress-runtime.test.ts` `2be940cd9758686a614fd1252848199ca3fd7b40faad9c1486b814cd43fa1470`; `test/unit/t610-folder-understanding.test.ts` `34c6cc99404d66f106dd25618cc6f5a5f22b5913bf3453159d7560bdbcbb0f78`; 保持したdiscovery path `test/vscode/run-extension-host.ts` `3ec8ed53e8984eb7d2dba9c313d126cdc03c4a1c11f8e686fb127a90df63db56` と `package.json` `51982bcee335e231f7d989bfb0aa93f9d3a273697cfe41316db9453136f11c71`。

## リスク

- Test fixture selection precedenceは`ExtensionMode.Test`に限定し、既存`refreshSelectedPullRequestProgress`へimmutable PR context IDを供給するだけである。post-command refreshを呼ばず、本番のselection/notifier/renderer動作を変えない。focused Host Redではfixture URIのopenが実Current Context active-editor lifecycleを発火し、登録済みfixture PR selectionのないsourceを置換するため、この隔離が必要だった。
- PDS-10全体equivalence、最終matching CI、artifact、commit/push、再reviewはこのfollow-upの対象外である。履歴上のfailed CI runはfailedのままであり、local T610 greenによってskipされた後続CI stepをpassにしない。

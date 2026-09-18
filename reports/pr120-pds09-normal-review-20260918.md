# Sub-agent実行レポート

## タスク

- PDS-09通常レビュー。対象 `b0afe9f10dde0e8bc45dbafc9b2d2adcfa145a54`。
- 差分基準 `466ce7137706c1b4ea8ac44c86fb7fd1f9e02005`、PR #120 / main。

## sub-agentを使う理由

- 実装と独立した既存の通常レビュワーが合否を判断する。

## 対象範囲

- 実PR runtimeのHost試験、試験専用API、公開操作、永続状態と実表示、既定検証への組込み。

## 対象外

- PDS-10全体gate、独立最終レビュー、Issue #121、修正実装・merge。

## Dispatch profile

- review / judgment_heavy / uncertainty medium / cross_module / criticality high。
- observed decomposability independent_workstreams、decomposition_policy forbidden、prohibited_by_review_lifecycle。
- continuity_reuse: `/root/normal_review`、元requested gpt-5.6-sol / high / fork none。
- default role unchangedの初回証拠を継承、planned_runtime_profile gpt-5.6-sol / high。
- applied null、final_profile_hidden、初回spawn_succeeded_profile_unverifiedを保持。
- application_status reused_existing_agent_profile、2026-09-18に継続依頼送信済み。approval not_required、Astra not_applicable。
- report_persistence_mode normal_persistence。親所有欄。
- 100人で月1回以下の問題は頻度根拠と影響を記したIssueのみとする方針を適用。

## 実行コマンド

- 実行環境: Windows / PowerShell、cwd `C:\Users\donabe\CodexProjects\RevMem`、Node `v24.20.0`、npm `11.19.0`、固定VS Code archive `1.130.0`。`runtime_local` / `local_execution_available`。
- `git rev-parse HEAD` と `git rev-parse origin/investigation/issue-119-linked-diff-blocks` を照合し、双方がreviewed SHA `b0afe9f10dde0e8bc45dbafc9b2d2adcfa145a54` であることを確認した。対象rangeは `466ce7137706c1b4ea8ac44c86fb7fd1f9e02005..b0afe9f10dde0e8bc45dbafc9b2d2adcfa145a54`。
- `git status --short --branch`、`git diff --name-status`、`git diff --stat`、`git diff --check` と9ファイルの全差分を確認した。whitespace errorはなく、worktree差分は許可された本レビュー報告だけである。
- `rg` と行番号付き `Get-Content` で、公開diff command routing、`PullRequestReviewRuntime`、projection notifier、実PR Progress tree、両pane decoration renderer、Test API gating、永続repository、Host runner discovery、task/design/reportを追跡した。
- 実装報告の6 source fingerprintを再計算し全件一致した。対象は `package.json`、`src/composition/extension.ts`、`src/extension.ts`、`src/ui/pr-progress/vscode-pull-request-progress-tree.ts`、`test/vscode/run-extension-host.ts`、`test/vscode/pr-diff-selection-mode-suite/index.ts`。
- 保存済み証拠を照合した: focused Host `pds09-host-boundary-final3` exit 0、default Host `pds09-host-default-final` exit 0、lint・architecture positive/negative・runner contractはexit 0。成功Host診断 `pr-diff-selection-mode-1789687191471.json` と `...1789687216840.json` はVS Code 1.130.0の実Host起動とexit 0を記録する。
- 失敗Host診断4件も確認した。個別JSONはfixture hunk不整合、test refreshによるcontext競合、original rendererのContext投影を永続original rangeと同一視した期待値誤りを保持する。同一wrapper名の一部log/resultが後続runで上書きされた制約は実装報告どおりで、成功へ丸めていない。
- `pds09-typecheck-contracts` はexit 0。ただしcommit `b0afe9f...` の時刻は2026-09-18 08:27:32 +0900、resultの開始は08:27:58 +0900であり、commit messageの「型契約成功」は時系列上prematureだった。実際の検査はcommit直後の変更されていない同一HEADで成功したpost-commit evidenceとして扱い、pre-commit成功とは記録しない。
- 親から共有されたcurrent-HEAD CI run `35286939708` はfailure。job `105421246755` のT610 Folder Global Understanding step 29で失敗し、それ以前のunit、type contracts、T506、T609は成功、final VS Code Hostはskipされた。原因診断は別workerに保持し、このPDS-09 reviewの3 findingsとは混在させていない。
- 既存のfocused/default Hostを重複実行していない。指摘は保存済み証拠では判定できないcommand完了境界とTest seamの静的追跡から確定した。

## 対象ファイル

- 差分全体:
  - `package.json`
  - `src/composition/extension.ts`
  - `src/extension.ts`
  - `src/ui/pr-progress/vscode-pull-request-progress-tree.ts`
  - `test/vscode/pr-diff-selection-mode-suite/index.ts`
  - `test/vscode/run-extension-host.ts`
  - `reports/pr120-pds09-implementation-20260918.md`
  - `reports/pr-diff-selection-verification-route-20260915.md`
  - `tasks/pr-diff-selection-mode/tasks-status.md`
- 直接依存:
  - `src/composition/pull-request/{pull-request-review-runtime,pull-request-review-runtime-base}.ts`
  - `src/application/review-contexts/{pull-request-review-projection-sync,pull-request-review-projection-notifier}.ts`
  - `src/application/review-commands/diff-editor-review-command-service.ts`
  - `src/ui/pr-progress/{pull-request-progress-tree-data-provider,pr-progress-diff-review-context}.ts`
  - `src/adapters/state-repository/debounced-review-state-repository.ts`
- PDS-09の実Host、最小UI接続、Test seam、default discoveryだけを判定した。PDS-10全体gate、独立最終レビュー、Issue #121の再判定は対象外として保持した。

## 指摘事項

### PDS09-NR1-001 — P2 — test-only refreshで公開commandのprojection完了境界を迂回している

- identity: `PDS09-NR1-001`
- severity: `P2`
- origin: PDS-09で追加した実Host受入試験と、直接依存する既存projection listenerのawait契約。
- location: `test/vscode/pr-diff-selection-mode-suite/index.ts:213`。直接根拠は `src/ui/pr-progress/vscode-pull-request-progress-tree.ts:158-163`、`src/composition/pull-request/pull-request-review-runtime.ts:138-158`、`src/application/review-contexts/pull-request-review-projection-sync.ts:3-18`、`pull-request-review-projection-notifier.ts:20-22`。
- description: Host試験は各公開mark/unmark commandの直後に `refreshPullRequestProgressForTest()` を呼び、progress activate、tree refresh、decoration refreshをtest-only APIで再実行してから表示を読む。実際のruntimeはapplied command時にprojection notifierをawaitするが、tree listenerはdecoration refreshを`void`で開始して直ちにreturnする。このため「全projection refresh完了後にcommandが返る」という同期境界を満たしておらず、追加試験もその境界を検証していない。
- impact: supported UIでmark/unmark commandのPromiseが完了しても、左右paneの装飾はまだ旧状態の可能性がある。通常は直後に非同期更新されるが、呼出側とHost試験はcommand完了を表示確定として扱えず、実配線の退行をtest-only forced refreshが隠す。
- evidence: `synchronizeAppliedPullRequestReview` はprogressとowned projectionを逐次awaitし、notifierも各listenerをawaitする。一方、登録listenerは `void this.refreshReviewDiffDecorations()` を返さない。Host testの全mutationは公開command後にline 190のtest-only `refresh()`を呼ぶため、この差を観測できない。これは一般的なmark/unmark経路であり低頻度Issue方針の対象ではない。
- required action: PR Progress projection listenerから実decoration refreshのPromiseを返し、error reportingを維持したままnotifier/commandが完了までawaitできるようにする。Host試験では公開command後のtest-only forced refreshを除き、実event経路がsettleした時点のtreeと両paneを読む。固定sleepではなく実Promise/event drainを用いる。

### PDS09-NR1-002 — P2 — PDS-09各ケースでtreeと両paneの確定表示を照合していない

- identity: `PDS09-NR1-002`
- severity: `P2`
- origin: PDS-09受入カバレッジと実装報告の正確性。
- location: `test/vscode/pr-diff-selection-mode-suite/index.ts:247`。
- description: suiteは全mutation後に永続stateを読むが、PR Progress rowを明示検証するのはreplacementのblock mark 1回だけである。addition/deletionのunmark、EOL、column-0正逆境界、Global mismatch修復、context cursorなどではtreeを照合せず、複数ケースで片paneまたは両paneの装飾も照合しない。
- impact: 公開commandが正しい状態を保存しても、Host上のtree集計または片側rendererだけがstale/誤投影になる退行をこのsuiteは通してしまう。実装報告の「各mutation後に実永続Review State、実PR Progress Tree row、左右diff rendererを照合」は現行assertionより強く、レビュー証拠として正確でない。
- evidence: treeの `reviewedLineCount` assertionはlines 231-232だけ。addition unmark lines 253-258、deletion lines 260-273、EOL lines 275-282、boundary lines 284-302、mismatch lines 304-322には、各ケースを保存状態と対応付けるtree assertionがない。装飾もaddition/deletionの一方だけ、EOL/mismatch/no-opでは未確認。PDS-07の132組unit coverageの実Host再実行は要求しないが、PDS-09で列挙した代表ケースにはdisplay acceptanceが必要である。
- required action: PDS-09に列挙した既存の各代表mutationについて、保存後のPR Progress rowと存在する両paneのrenderer結果を保存状態の意味論に沿ってassertする。original decorationはoriginal rangeだけでなくmodified Contextのunchanged-line投影を含み得るため、永続rangeの単純mirrorを期待値にしない。column-0境界では次blockが非装飾であることに加え、選択対象とtree countを確認する。実装報告のmatrix/記述も実際のassertionへ合わせる。

### PDS09-NR1-003 — P2 — test観測用decoration captureがproductionで常時蓄積する

- identity: `PDS09-NR1-003`
- severity: `P2`
- origin: PDS-09で追加したTest seamの製品runtimeへの影響。
- location: `src/ui/pr-progress/vscode-pull-request-progress-tree.ts:86`。
- description: test API用の `appliedReviewDiffDecorations` mapはExtensionModeに関係なくproduction tree instanceで生成され、全decoration refreshでrangeをcloneしてURIごとに保存する。entry削除は現在visibleな非owner editorを処理した場合だけで、閉じた/置換されたPR diff URIは走査されずextension disposeまで残る。
- impact: 通常利用でPR Progressから異なるdiffを開くたび、閉じたtabのURI、label/source、range配列がextension lifetime中に蓄積し、各refreshにもtest観測用cloneコストが加わる。Test-onlyの受入観測がproductionのmemory/performance behaviorを変更している。
- evidence: mapはline 86で無条件作成、lines 192-205で無条件clone/set、line 187は現在visibleな非owner URIだけをdeleteし、全clearはdispose line 225のみ。readerを返すextension API自体はExtensionMode.Testで正しくgateされるが、capture側はgateされていない。open/closeとrefreshは通常経路なので低頻度Issue方針の対象ではない。
- required action: applied decoration captureとreaderをTest modeでだけ有効にする。例えば登録時に任意のtest observer/captureを注入し、productionではclone/map allocation/updateを行わない。visible editor cleanupだけでproduction captureを維持する対応ではTest-only境界を満たさない。

## 結果

- review mode: `initial normal review`。reviewed implementation HEAD: `b0afe9f10dde0e8bc45dbafc9b2d2adcfa145a54`。remote branchと一致。
- verdict: `fail`。required P2 findings 3件。Issue-only heldへ移すfindingはない。
- coverage dispositions:
  - requirement / design conformance: `checked_finding`。実PR runtime、公開PR Progress open、公開mark/unmark、side/block、代表fixtureは実Hostを通る。command完了表示と全代表caseの表示照合が `PDS09-NR1-001/002`。
  - entire 9-file diff / direct dependencies / scope discipline: `checked_finding`。PDS-09外の機能追加はないが、test captureのproduction leakが `PDS09-NR1-003`。
  - Test-mode initializer / persisted state reader gating: `checked_no_finding`。initializerはExtensionMode.Testを再確認し、拡張test APIの返却もTest branchだけ。実filesystem-backed shared repositoryを使う。
  - actual public command and immutable comparison routing: `checked_no_finding`。実active `TabInputTextDiff` pair、owner runtime、pane URIを検証し、LocalBaseHeadRuntimeへ代替していない。
  - setting behavior: `checked_no_finding`。default sideを確認し、workspace block変更は次の公開操作から読まれる。
  - replacement / addition / deletion / EOL / mismatch / forward-reverse column-0 persisted semantics: `checked_no_finding`。保存stateのassertionは設計と一致する。display completenessは `PDS09-NR1-002`。
  - actual PR Progress and decoration event wiring: `checked_finding`。rendererから取得する値自体はexpected-state mirrorではないが、test-only forced refreshと非await listenerが `PDS09-NR1-001`。
  - original-side display semantics: `checked_no_finding`。original rendererがoriginal rangeに加えてmodified Contextのunchanged-line mappingを投影し得ることを確認し、column-0では次のchange block非装飾を正しく見る。
  - default Host discovery / focused route: `checked_no_finding`。focused flagとdefault `test:vscode`双方が新suiteを実起動する。
  - validation evidence / diagnostics / fingerprints: `checked_no_finding`。focused/default Host、lint、architecture positive/negative、runnerはexit 0。失敗wrapper上書き制約とunique diagnostic JSONを明示している。
  - type contract timing / report accuracy: `checked_finding`。post-commit exact-HEAD successとして有効だがcommit messageのpre-commit含意は訂正した。display全件照合のreport過大記述は `PDS09-NR1-002`。
  - secrets/security: `checked_no_finding`。fixture hostはinvalid domain、credential/token出力や外部送信追加なし。
  - PDS-08 held Issue #121: `held`。本reviewで再分類しない。
  - PDS-10 full gate、独立最終レビュー、final matching CI/artifacts: `held`。次taskの明示範囲で、本PDS-09 failの代替証拠にはしない。
  - current-HEAD CI: `held_failure`。run `35286939708` はT610 Folder Global Understandingで失敗し、final VS Code Hostはskip。別workerの原因診断対象であり、本reviewのlocal source-bound findingsを遅延・置換しない。

## リスク

- 3 findingsの修正後は同一レビュワーでfinding-limited verificationを行い、公開command後の実event settle、全PDS-09代表caseのstate/tree/both-pane matrix、Test-only capture gatingを同じreviewed HEADへ束縛する必要がある。
- PDS-09でPDS-07の132組全てを実Host再実行する必要はない。今回の不足はPDS-09自身が列挙した代表caseと実表示・event境界に限定する。
- current-HEAD CIはT610でfailure、PDS-10全体equivalenceは未判定。既存のPDS-08 Issue #121はそのままheldであり、本findingsのseverity/dispositionへ混在させない。

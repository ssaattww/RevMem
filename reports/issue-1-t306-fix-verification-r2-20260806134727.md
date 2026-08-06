# T306 通常レビューfinding修正確認 R2

> 予約済み出力先。初回通常レビューと同じレビュワーが `T306-R1-P1` と `T306-R1-P2` の残存境界だけを再確認する。

## 判定

- verdict: `pass_with_held`
- reviewed implementation HEAD: `98487d7c1e0ce5245b6c67dd2ee239d17ca1bbd2`
- previous reviewed HEAD: `933641219993f44cc96f39932b8837055a3851b8`
- inspected fix range: `933641219993f44cc96f39932b8837055a3851b8..98487d7c1e0ce5245b6c67dd2ee239d17ca1bbd2`
- branch: `task/t306-extension-host-acceptance`
- repository / PR: `ssaattww/RevMem` / `#45`
- verification kind: normal-review finding fix verification R2（bounded closure verification）
- report persistence: repository file（予約済みpathのみ）
- report attestation allowed: `false`（通常レビューcycleのため）

初回全範囲レビューは再実行せず、前回openだった2 findingの残存境界、直接影響、同一欠陥クラスのsibling、必要な既存テスト、指定されたexact-head CIだけを確認した。finding identityとsource severityは維持し、reclassificationおよび新規finding探索は行っていない。

## Finding disposition

### `T306-R1-P1` — High — `closed`

前回残っていた実diff editor境界は閉じた。

- `src/extension.ts:569-579` は `vscode.commands.executeCommand("vscode.diff", ...)` をawaitし、その成功後だけopened recordを追加する。command reject時はTree commandへrejectが伝播し、成功recordを作らない。
- `test/vscode/t306-suite/index.ts:64-75` はactive tabが `vscode.TabInputTextDiff` であること、およびoriginal/modified URIが今回開いた対象URIと完全一致することを検証する。commandがresolveしてもdiffを開かなければこの検証で失敗する。
- `test/vscode/t306-suite/index.ts:181-216` は登録済みTree commandから実diffを開き、`workbench.action.compareEditor.focusSecondarySide` と `focusPrimarySide` で実際のoriginal/modified paneへ移動する。各移動後にactive editor URIを確認してから、既存の `reviewRange.markFileReviewed` / `reviewRange.unmarkFileReviewed` commandを実行する。
- 通常text documentを `showTextDocument` してdiff扱いにする旧false-positive経路はテストから削除された。reject時はawaitで失敗し、未open時はactive `TabInputTextDiff` とURI検証で失敗するため、前回指摘したsiblingもGreenにならない。

直接影響として、実PR Progress Tree、実TextDocumentContentProvider、永続化state、mark/unmark後のTreeとcontext/global state検証が引き続き同じ受け入れ経路に存在することを確認した。追加のrequired actionはない。

### `T306-R1-P2` — Medium — `closed`

前回残っていた成功IPC後の無期限close待ちと、fixture cleanupの同一runner lifecycle境界は閉じた。

- `test/vscode/owned-extension-host-launch.ts:114-194` はlaunch時刻から1個のabsolute timeoutを作り、最初のmessage/exit待ちと成功IPC後のworker close待ちで同じtimeoutを再利用する。成功通知後もdeadlineまでにcloseしなければ `failed` とし、owned PIDをrootとするprocess treeをterminateする。terminate後のclose待ちにも有限のgraceを使う。
- `test/unit/owned-extension-host-launch.test.ts:66-105` は成功IPCを送った後もtimerとnested childを残すworkerを実行し、deadline後のfailure診断、tree termination、nested child消滅、fixture cleanupを確認する。
- `test/vscode/run-extension-host.ts:101-108` はVS Code fixture cleanupも専用owned workerで有限実行する。`test/vscode/owned-temporary-directory-root.ts:8-25` はOS temporary directory直下、`review-range-vscode-` prefix、実directoryというexact-root guardを親helperとcleanup workerの両方で適用する。diagnostic directoryが削除root内になる構成も事前拒否する。
- `test/unit/owned-temporary-directory-cleanup.test.ts:13-115` は正常削除、stalled cleanup worker timeout、temporary root/workspace/nested/non-fixture path拒否、worker側独立guard、対象外path不削除を確認する。
- `package.json:213` のrequired `test:unit` に `owned-extension-host-launch.test.js` と `owned-temporary-directory-cleanup.test.js` が接続されており、専用scriptだけに隔離されていない。

同一欠陥クラスのhang、成功通知後hang、nested child、cleanup hang、危険なrecursive cleanup targetを直接覆っており、追加のrequired actionはない。

## Coverage disposition

- P1 direct fix / command propagation / actual diff tab and pane focus / reject・未open sibling: `checked_no_finding`
- P1 persistence・Tree更新・binary non-diffの必要な既存受け入れ境界: `checked_no_finding`
- P2 absolute deadline / success IPC後hang / nested child termination / finite diagnostics: `checked_no_finding`
- P2 fixture cleanup ownership・bounded execution・parent/worker path guard: `checked_no_finding`
- required `test:unit` wiringとexact-head CI: `checked_no_finding`
- 初回レビュー全範囲、範囲外変更、新規finding探索: `not_applicable`（明示されたbounded closure non-goal）
- 既知のWindows unit test 19 failures: `held`

## Exact-head CI evidence

- GitHub Actions run `31072130240`: `success`、event `push`、head SHA `98487d7c1e0ce5245b6c67dd2ee239d17ca1bbd2`
- job `92522046222` (`build-and-lint`): `success`
- Build、Contract typecheck、Architecture validation/negative contract、Lint、Unit tests、T403、T304、T502、T503、T504、Temporary Git、Mock GitHub、VS Code Extension Host testsはすべて成功した。
- Unit testsは448 pass / 0 fail。ログ上で「success is reported before worker close」、fixture cleanup正常系、stalled cleanup timeout、parent guard、worker独立guardが実行・成功している。
- VS Code Extension Host testsは `t306`、`t302`、3 lifecycle phaseの5 launchがすべて `status: succeeded` / `exitCode: 0`。最後の `vscode-fixture-cleanup` も `status: succeeded` / `exitCode: 0` で有限に完了した。
- run/jobのhead SHAはreviewed implementation HEADと完全一致する。

## 実施した確認

- `git diff --check 933641219993f44cc96f39932b8837055a3851b8..98487d7c1e0ce5245b6c67dd2ee239d17ca1bbd2`: pass
- 指定fix rangeのP1/P2 technical diff、直接依存、対象test、required script wiringの静的確認
- `gh run view 31072130240 --repo ssaattww/RevMem --json ...`: exact-head run/job/step status確認
- `gh run view 31072130240 --repo ssaattww/RevMem --job 92522046222 --log`: 対象runner回帰、448/0 unit結果、5 launchとcleanup成功を確認
- ローカルの広範なtest suiteは再実行していない。指定exact-head CIと残存境界を直接覆うコード・test evidenceで判定した。

## Held / remaining risk

- 初回レビューから保持されている、このWindows worktreeでの既知のunit test 19 failuresは本R2の2 findingへ昇格せず、外部リスクとして引き続きheldとする。exact-head Linux CIのrequired Unit testsは448 pass / 0 failである。
- Markdown wording checkは対象を本レポート1ファイルとして確認したが、repositoryに `tools/lint/`、`lint:md`、cspell設定、focused lint wiringが存在しないためfocused/fullとも `unsupported`。設定変更候補、user review待ち、backtick/quoteによるprose lint回避はない。このunsupported stateは対象technical findingのclosure evidenceを覆さず、heldとして記録する。
- 本R2は `T306-R1-P1` と `T306-R1-P2` の残存境界だけに限定した。明示的non-goalを未探索としてverdictへ混入していない。
- 両findingはsource severityをそれぞれHigh / Mediumのままcloseした。severity reclassification record、erratum、unresolved discrepancyはない。

## Next action / merge boundary

通常レビューcycleの対象findingは収束した。親workflowは必要なtracking/report同期とcommit/pushを行った後、別のfresh reviewerによるindependent final reviewへ進める。ここでは実装、tracking、commit、push、PR操作、mergeを行っていない。

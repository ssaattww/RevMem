# Sub-agent実行レポート

## タスク

- 目的: PR #91のUSR90-002-R2A/R2B technical commitだけを通常reviewする。
- タスク種別: normal review

## sub-agentを使う理由

- 理由: 実装者と異なる既存Sol/high通常reviewerが、PR #91全体を再reviewせず新しい1 commitだけを確認するため。

## 対象範囲

- 対象: baseline `8cadc8431a59358a88902f87d582b373a5b547f6`からtechnical commit `e2a02962116d98263478b67af0540c705ed83312`までのexactly one commit、および直接依存。

## 対象外

- 対象外: PR #91既存差分の再review、既存findingの再open、implementation、commit、push、CI待機、performance、private repository内容・credential。

## 実行コマンド

- 実行コマンド:
  - `Get-Content`でrepository `AGENTS.md`、`work-context-manager`、`review-worker`、`report-writer`、`report-output-manager`の各`SKILL.md`、および本予約済みreportを全文確認した。
  - `git rev-parse HEAD`、`git status --short`、`git show -s --format=...`、`git diff --name-status --stat 8cadc843...e2a0296`で開始identity、exactly one commit、9 changed files、parent-owned working changesを確認した。
  - `git diff --unified=... 8cadc843...e2a0296 -- <changed files>`、`Get-Content`、`rg`で全変更、直接caller/dependency、設計、runtime fixture、package test wiring、implementation report、parent-owned tracking deltaをread-only確認した。
  - `git diff --check 8cadc843...e2a0296`でtechnical rangeのwhitespace errorなしを確認した。
  - 既存evidenceのCurrent Context 20/20、T407 7/7、`compile:test`、`build`、`lint`、`typecheck:contracts`、architecture正負、diff-check Greenをimplementation reportとtest wiringへ照合した。findingは既存suiteで未被覆の中断・composition境界にあるため、許可されたfocused test再実行は行わなかった。full/default/Extension Host/CI待機/performanceは実行していない。

## 対象ファイル

- 対象ファイル:
  - changed 9 files: `doc/design/vscode-review-range-tracker-design.md`、`src/adapters/github/fetch-github-pull-request-adapter.ts`、`src/adapters/github/vscode-github-authentication-provider.ts`、`src/application/github-pr-context/contracts.ts`、`src/t305-extension.ts`、`src/t405-review-contexts-runtime.ts`、`src/ui/current-context/current-context-runtime-composition.ts`、`test/unit/current-context-ui.test.ts`、`test/unit/t407-private-pr-context.test.ts`。
  - direct callers/dependencies: `src/ui/current-context/vscode-current-context-runtime.ts`、`src/ui/current-context/current-context-runtime-coordinator.ts`、`src/ui/current-context/current-context-ui-controller.ts`、`src/ui/review-contexts/vscode-review-contexts-runtime.ts`、`src/application/github-pr-context/github-pull-request-context-resolver.ts`、`src/application/review-contexts/current-pull-request-context.ts`、`package.json`、local `node_modules/@types/vscode/index.d.ts`。
  - evidence/tracking: `reports/issue-90-pr91-private-context-actual-host-followup-20260829.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`。後二者はparent-ownedであり編集していない。

## 指摘事項

- 指摘事項:
  1. `USR90-002-R2-NR-001` — **High / blocking normal-path**。location: `src/t405-review-contexts-runtime.ts:1040-1049,1078-1124`、cancellation owner `src/ui/current-context/vscode-current-context-runtime.ts:107-128`。evidence: `reviewRange.selectContext`をrefresh/別selectionがsupersedeすると共有`AbortSignal`はabortされるが、`detectPullRequest`冒頭の`synchronizeRepository`はsignalを受けずReview State metadataを更新できる。さらにsearch後の複数PR Quick Pickをawaitする`resolver.resolveSearchResult`以降にはabort checkがなく、失効後もReview Stateのcreate/update、`currentPullRequestSelection.select/selectBranch`まで実行する。外側compositionが後で旧resultを拒否しても、旧operationのPR候補picker completionと永続owner mutationは残り、設計`doc/design/vscode-review-range-tracker-design.md:783`の「stale時に受理済み選択を変更しない」を破る。`test/unit/t407-private-pr-context.test.ts:332-337`の「cancelled」はsessionが`undefined`のケースだけで、AbortSignal supersessionを通していない。required action: explicit preparationの同期処理をsignal-awareかつ非publishにし、candidate selection直後と各永続mutation直前にcurrent-generation/abort fenceを設け、失効operationがReview State・PR/branch preferenceを変更しないことをruntime Red→Greenで固定する。
  2. `USR90-002-R2-NR-002` — **Medium / blocking review-evidence gap**。location: `test/unit/current-context-ui.test.ts:308-339`、`test/unit/t407-private-pr-context.test.ts:246-279`、production wiring `src/t305-extension.ts:459-466`。evidence: Current Context testはfake `prepareExplicitSelection`を持つcomposition単体、T407はT405 registered runtimeのoptional preparation methodをcastして直接呼ぶ。どちらもpublic `reviewRange.selectContext`からT305の`reviewContextsRuntimeRef`委譲、T405 auth/search、候補enumerationへ至るproduction chainを同一fixtureで通さないため、T305 wiringの欠落・誤接続やpublic operationのsignal伝播が壊れても20/20と7/7はGreenになり得る。実際にNR-001のsupersession欠落もこの分割fixtureでは観測されない。required action: public commandまたは同等のproduction registration/compositionから、初回private成功、同一HEAD/background prompt 0、authenticated 404のreselect/search各1回、cancel/supersessionの旧mutation 0を通すfocused runtime fixtureをrequired `test:unit`へ配線し、implementation/tracking evidenceをその範囲へ限定する。
  - blocker classification: normal-path product blockerは`USR90-002-R2-NR-001`、validation blockerは`USR90-002-R2-NR-002`。user-confirmation-required capability gapは実VS Code GitHub account picker/private target UIの未検証であり、禁止されたExtension Host・private再試行のためheldとする。既存PR差分・過去findingは再openしていない。

## 結果

- 結果:
  - verdict: **fail**。High 1件、Medium 1件がopenであり、R2A/R2Bをnormal review通過とは判定しない。
  - reviewed identity: baseline `8cadc8431a59358a88902f87d582b373a5b547f6`、reviewed technical commit `e2a02962116d98263478b67af0540c705ed83312`、exact range `8cadc8431a59358a88902f87d582b373a5b547f6..e2a02962116d98263478b67af0540c705ed83312`。開始/終了HEADはいずれも`e2a02962116d98263478b67af0540c705ed83312`で、one-parent baseline一致、review identityはstable。終了statusは開始時と同じparent-owned tasks 2件のmodified、implementation reportと本review reportのuntrackedだけである。
  - coverage disposition: R2Aの候補列挙前prepare、saved same-HEAD skip、background non-interactive、R2Bのtoken-presentかつ`api/404`限定`clearSessionPreference`、1回だけのsearch retry、reselect取消/retry失敗/anonymousのloopなしはsource上でconform。既存`PR再検出`、`GitHub再接続`、public anonymous、branch fallbackも保持され、GitHub CLI credential、tokenの永続化・診断出力、workflow/performance差分はない。
  - coverage disposition: safe `httpStatus`はnumeric optional evidenceだけで、401/403/rate-limitの既存分類を先に保ち、account retry条件以外へ露出しない。auth optionは`interactive && clearSessionPreference`のときだけVS Code APIへ渡され、他callerは従来のnon-interactive defaultを維持する。
  - coverage disposition: designのR2A/R2B記述とtrackingのtechnical identity・既存validation件数はdiff/reportに整合する。ただしcancellation/stale production contractはNR-001で不適合、actual production compositionのGreen claimはNR-002の範囲では未立証である。
  - validation assessment: Current Context 20/20、T407 7/7、compile/test/build/lint/contracts/architecture正負/diff Greenは当該fixtureとstatic gateの成功証拠として受理するが、NR-001/002をcloseする証拠にはならない。追加testは実行していない。

## リスク

- リスク:
  - remaining risk: superseded selectionの旧PR候補pickerが完了すると、旧PRまたはbranch preferenceを永続化して後続Current Contextのownerを変える。外側の旧UI非publishだけでは回復できない。
  - held/unexplored: actual VS Code GitHub account preference UI、private targetでの初回・wrong-account・cancel実動作、Extension Host、full/default suite、exact-head CI、performance。指示により実行・待機せず、successへ読み替えていない。
  - non-blocking held: Markdown focused lintはrepository wiringがなくunsupported。parent-owned tracking 2 filesとimplementation reportはreview開始前からworking changes/untrackedであり、本reviewでは変更していない。
  - next action: まず0.5h枠でNR-001のabort/generation fenceとsupersession focused testを修正し、次の0.5h枠でNR-002のpublic T305→T405 production-composition fixtureを追加する。同じnormal reviewerへfinding限定fix verificationを依頼する。

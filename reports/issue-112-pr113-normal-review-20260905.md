# PR #113 通常レビュー報告

## 1. レビュー識別

- Repository: `ssaattww/RevMem`
- Pull Request: #113 `Issue #112: PR Progressの表示・確認状態・実ファイル表示を修正`
- Review kind: normal review / initial pass / one-pass exhaustive review
- Technical review target: `0ce2a5d0ce138d3de6e1df9659d61b34327326dd`
- Base: `main` / `c10e0d7bb202e2dbd54e8735af45bbace8829e7d`
- Branch: `codex/issue-112-pr-progress-regressions`
- PR state at review start: open / draft / mergeable
- Verdict: **fail**
- Findings: **High 5 / Medium 3 / Low 2**

本reportを追加するcommitはレビュー成果物だけを変更する。技術実装のimmutable review targetは上記 `0ce2a5d0ce138d3de6e1df9659d61b34327326dd` のままとする。

## 2. 要求と判定

| 要求 | 判定 | 根拠 |
| --- | --- | --- |
| 複数VS Code実行環境でPR Progressのcontext/source/refreshが混線しない | 不合格 | 修正対象とされたmodule-globalはExtension Host間で共有されない。実際の複数window/hostを使う回帰試験がなく、workspace scopeの明示PR選択状態にはinstance/window identityがない。`PR113-NR-001` |
| PR Progressから開いたdiffでシンタックスハイライトが効く | 検証不足 | URI末尾へbasenameを追加しているが、Extension Host testは`languageId`を確認していない。さらにspace・非ASCII・literal `%`を含む有効なpathでcommand/session routingが壊れる。`PR113-NR-005`, `PR113-NR-007` |
| diffで確認済みにした後、色とPR Progressが同期する | 不合格 | source切替競合で旧sourceの装飾が再公開され、projection失敗時は後続更新が止まり、成功済みmutationもcommand failureとして返る。成功時は全PR Progress計算が重複する。`PR113-NR-002`, `PR113-NR-003`, `PR113-NR-006` |
| PR Progressの右クリックからworking treeの実ファイルを開ける | 不合格 | PR Aから得た旧nodeをPR Bへ切替後もproduction compositionが受理し、Aの実ファイルを開く。`PR113-NR-004` |

## 3. 診断workflowとexact-head CI

### 3.1 失敗診断workflow

作業開始時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。既存workflowは各CI commandについて少なくとも次を `test-output/ci/<command>/` へ保存する。

- 終了結果JSON
- 標準出力
- 標準エラー
- 標準出力・標準エラーの結合ログ
- 失敗時の環境、Git status、生成物一覧
- `dist/`, `test-dist/`, `src/`, `test/`, `tools/`, type fixture、manifest、lockfile

失敗時は `if: failure()` のartifact uploadが存在するため、Issue #112レビュー開始時点で追加workflowは不要だった。

### 3.2 CI判定

PR current technical HEADとworkflow runの`head_sha`が一致するrunだけを確認した。

- Technical HEAD: `0ce2a5d0ce138d3de6e1df9659d61b34327326dd`
- Workflow run: `33931083888`
- Run `head_sha`: `0ce2a5d0ce138d3de6e1df9659d61b34327326dd`
- Status: completed
- Conclusion: success
- Run attempt: 1
- User validation artifact: `review-range-user-validation-46618686fca94a777bcc8bae84e7c9489d2b8d91`
- Artifact ID: `9958644119`

Build、contract typecheck、architecture positive/negative、lint、unit、focused gates、temporary Git、mock GitHub、VS Code Extension Host、VSIX/source packageはすべて成功している。ただし、後述の競合、失敗分離、stale node、URI command boundary、複数Extension Host、実`languageId`は現在のtest matrixに含まれていないため、Greenを受け入れ条件充足の代用にはできない。

### 3.3 TDD履歴

最初のcommit `b1c5462235ea101d68756bc991fbae0366207b01` はIssue #112のtest追加のみで、同じ`head_sha`のCI run `33699551653` はfailureだった。failure diagnostic artifact `ci-failure-diagnostics-33699551653-1`（artifact ID `9873016053`）も保存されているため、test-firstとRed確認の時系列は成立している。

ただし、Redで固定したownershipとsyntax-highlightingのtestはsource-text assertionまたはURI round-tripに留まり、primary user behaviorを再現していない。この不足は`PR113-NR-001`と`PR113-NR-007`で扱う。

## 4. レビュー範囲

### 4.1 変更ファイル

| File | Disposition |
| --- | --- |
| `package.json` | command、activation、context menu contributionを確認 |
| `reports/2026-09-05-issue-112-pr-progress-regressions.md` | 実装主張、TDD、CI、artifact、最終証跡を確認 |
| `src/application/diff-document/review-diff-uri-codec.ts` | current/legacy URI、language hint、canonical validation、特殊文字境界を確認 |
| `src/extension.ts` | runtime port、command routing、content provider routing、review-state eventを確認 |
| `src/t305-extension.ts` | PR runtime composition、command validation、source refresh、production event listenerを確認 |
| `src/t305-repository-root-uri.ts` | local/remote workspace owner、nested ambiguity、path reconstructionを確認 |
| `src/t405-pr-review-projection-notifier.ts` | listener lifecycle、failure propagationを確認 |
| `src/t405-pr-review-projection-sync.ts` | applied/no-op/cancelledとprojection順序、failure semanticsを確認 |
| `src/t405-pull-request-review-runtime.ts` | progress refresh、decoration mapping、registration、working-tree targetを確認 |
| `src/ui/diff-editor/review-diff-text-document-content-provider.ts` | VS Code URIからapplication URIへの変換を確認 |
| `src/ui/pr-progress/index.ts` | public exportを確認 |
| `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts` | current node ownershipとworking-tree host境界を確認 |
| `src/ui/pr-progress/vscode-pull-request-progress-tree.ts` | active source、event subscription、decoration publication、context commandを確認 |
| `src/ui/pr-progress/working-tree-file-path.ts` | absolute root、canonical relative path、escape防止を確認 |
| `src/ui/pr-progress/working-tree-file-target.ts` | stale/deleted validationを確認 |
| `test/unit/core-contracts.test.ts` | production/test wiring contractを確認 |
| `test/unit/issue-112-pr-progress-runtime.test.ts` | runtime happy pathとworking-tree test coverageを確認 |
| `test/unit/issue-112-pr-progress-working-tree.test.ts` | provider-level current/stale/deleted coverageを確認 |
| `test/unit/issue-112-pr-review-projection-notifier.test.ts` | notifier happy path/dispose coverageを確認 |
| `test/unit/issue-112-pr-review-projection-sync.test.ts` | coordinator happy/no-op/cancelled coverageを確認 |
| `test/unit/issue-112-working-tree-path.test.ts` | path traversal、Windows/POSIX coverageを確認 |
| `test/unit/issue-66-global-pr-progress.test.ts` | runtime compositionのcontract更新を確認 |
| `test/unit/issue-92-pr-progress-context-menu.test.ts` | manifestとsource-text assertionを確認 |
| `test/unit/review-diff-content-provider.test.ts` | URI/content application contractを確認 |
| `test/unit/review-diff-text-document-content-provider.test.ts` | canonical `toString()` adapter coverageを確認 |
| `test/unit/review-diff-uri-unicode.test.ts` | surrogate、language hint、legacy decode coverageを確認 |
| `test/unit/t305-repository-root-uri.test.ts` | remote/nested workspace owner coverageを確認 |
| `test/vscode/t302-suite/index.ts` | actual VS Code URI renderingとprovider direct callを確認 |

### 4.2 直接依存・設計・運用

次の差分外依存も確認した。

- `src/t405-pull-request-review-runtime-base.ts`
- `src/t305-projection-refresh.ts`
- `src/application/review-commands/diff-editor-review-command-service.ts`
- `src/t306-local-base-head-runtime.ts`
- `src/ui/current-context/current-context-candidate-selection.ts`
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
- `src/application/review-contexts/current-pull-request-context.ts`
- `src/t405-review-contexts-runtime.ts`
- `doc/design/vscode-review-range-tracker-design.md`
- `.github/workflows/ci.yml`
- `tools/run-ci-command.mjs`
- `tasks/tasks-status.md`
- `AGENTS.md`

## 5. Findings

### PR113-NR-001 — High — 複数Extension Host混線の主原因と受け入れ条件が確立されていない

- Origin: Issue #112 primary acceptance / root-cause analysis
- Location:
  - `reports/2026-09-05-issue-112-pr-progress-regressions.md:22-28`
  - `test/unit/issue-92-pr-progress-context-menu.test.ts:145-156`
  - `src/ui/review-contexts/vscode-review-contexts-runtime.ts:23,68-96,136-138`
  - `src/t405-review-contexts-runtime.ts:425-435,656-659`
- Description:
  - PRは、`vscode-pull-request-progress-tree.ts`のmodule-globalを除去したことで「別VS Codeインスタンス/別Extension Hostのsourceを参照しない」と結論付けている。
  - VS Codeはwindowごとに独立したExtension Hostを持つ。別Extension HostのNode module-globalは共有されないため、このmodule-globalを原因とする説明だけではIssue #112のwindow間混線を説明できない。
  - regression testはsource textに`activeRuntime`がないことを正規表現で確認するだけで、2つのwindow/Extension Host、2つのruntime、共有workspace state、interleaved selection/refreshを実行していない。
  - 明示PR選択は現在も`workspaceState`の単一key `reviewRange.currentPullRequestSelections.v1`に保存され、subkeyは`repositoryId + NUL + headRevision`だけである。window/instance ownershipは含まれない。この選択はCurrent PR決定へ直接渡される。
- Impact:
  - 実際の共有境界がworkspace-scoped selection等にある場合、別windowで選んだPR/contextが現在windowのCurrent Context/PR Progressへ再利用される問題は残る。
  - 少なくとも、Issue #112の主要求を現在のテストと根拠でclosedにはできない。
- Evidence:
  - VS Code official Extension Host documentation: `https://code.visualstudio.com/api/advanced-topics/extension-host`
  - VS Code official architecture description: `https://code.visualstudio.com/blogs/2022/11/28/remote-even-better`
  - VS Code API `ExtensionContext.workspaceState`: `https://code.visualstudio.com/api/references/vscode-api#ExtensionContext`
  - exact-head distributionに対する共有Memento modelでは、window Aが`pr-A`を選択後、window Bが`pr-B`を選ぶとAの同じstoreのreadも`pr-B`を返した。これはstoreにinstance dimensionがないことを示す。実VS Code window間のlive propagation自体は未実施であり、下記heldへ明記する。
- Required action:
  1. 同じworkspace/repositoryを開いた2つの実Extension Host、または同等の独立runtime fixtureでIssue #112を先に再現する。
  2. 共有される実データ境界を特定する。
  3. session-owned Current PR/source/refreshはper-host memoryへ置くか、永続化が必要なら明示的なinstance ownershipと競合規則を設計する。
  4. A/B windowの選択・refreshが相互に影響しないbehavioral regression testをrequired CIへ追加する。

### PR113-NR-002 — High — source切替後に旧sourceの確認済み装飾が再公開され、失敗は未処理になる

- Origin: runtime concurrency / error boundary
- Location: `src/ui/pr-progress/vscode-pull-request-progress-tree.ts:131-175,183-187`
- Description:
  - `refreshReviewDiffDecorations()`は開始時に`source`をcaptureし、`loadReviewedDecorations()`をawaitした後、source generation、selected source、dispose状態を再確認せず`setDecorations()`する。
  - `setPullRequestProgressSource()`は旧refreshをcancelせず、line 145で返却Promiseを`void`にし、error handlerも付けない。
  - listener callbackでも1 editorのload失敗がloopとnotification全体をrejectするため、後続visible editorは更新されない。
- Impact:
  - source Aのload中にBまたはdefaultへ切替えると、一度clearされたeditorへAの「確認済み」色が後から復活する。
  - stale/removed contextのload failureが`unhandledRejection`になり得る。
  - split editorの一部だけが更新され、表示が不一致になる。
  - `doc/design/vscode-review-range-tracker-design.md:1111`の「new generation/cancel/dispose後に旧stageをpublishしない」契約に反する。
- Evidence:
  - exact-head VSIXのcompiled runtimeで、Aのloadをpendingにし、sourceをdefaultへ切替後にAをresolveすると次を確認した。

    ```text
    before old resolves [ 'clear' ]
    after old resolves [ 'clear', 'set:1' ]
    ```

  - 同じruntimeでloadをrejectさせると次を確認した。

    ```text
    unhandledRejection stale diff
    ```

- Required action:
  1. source/decorations用generationまたはAbortControllerを導入する。
  2. await前後および`setDecorations()`直前にcurrent source/generation/disposeを検証する。
  3. fire-and-forget refreshは必ず`reportError`へ接続する。
  4. editorごとの失敗を分離し、1 editorの失敗で他editorを止めない。
  5. A pending → B/undefined、dispose中、1 editor failure + 2nd editor successをテストする。

### PR113-NR-003 — High — projection失敗がcommit済みmutationをfailureへ変え、後続projectionを止める

- Origin: mutation/projection failure semantics
- Location:
  - `src/t405-pr-review-projection-sync.ts:4-12`
  - `src/t405-pr-review-projection-notifier.ts:20-22`
  - `src/t405-pull-request-review-runtime.ts:127-146`
  - `src/extension.ts:777-783`
- Description:
  - review commandのdurable commit/history完了後、`synchronizeAppliedPullRequestReview()`はPR Progressとowned projectionを直列awaitする。
  - PR Progress refreshがthrowするとowned projectionは実行されない。notifierも最初のlistenerがthrowすると後続listenerを実行しない。
  - wrapperは`applied`を返さずrejectするため、`extension.ts`側の`reviewStateChanged.fire()`にも到達しない。
  - repository stateは既にcommit済みであるため、利用者へ「更新失敗」と表示される一方、再実行時には既に状態が変わっている。
- Impact:
  - 状態、PR Progress、diff decoration、Global/他subscriberが分離する。
  - 成功済み操作を利用者が再試行し、意図しない解除/再適用判断を招く。
  - `src/t305-projection-refresh.ts:107-123`に既に存在する「mutation成功を維持しderived projection failureを別報告する」契約と不一致である。
- Evidence:

  ```text
  sync rejected progress failed projectionCalls 0
  notify rejected first failed calls [ 'first' ]
  ```

- Required action:
  1. mutation結果とderived projection結果を分離し、commit済み`applied`をprojection failureで取り消さない。
  2. PR Progress、各notifier listener、decorations、必要なsubscriberを`allSettled`相当で全てattemptする。
  3. 各failureを既存operation feedback/output boundaryへ個別に報告する。
  4. progress failureでもdecoration listenerが実行されるtest、listener 1 failureでもlistener 2が実行されるtest、command resultが`applied`のままのtestを追加する。

### PR113-NR-004 — High — PR切替後も旧PRのworking-tree nodeを受理する

- Origin: stale identity / wrong-file open
- Location:
  - `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts:891-903`
  - `src/t405-pull-request-review-runtime.ts:96-120,185-221,318-347`
- Description:
  - base providerの`openWorkingTreeFile()`は`currentFileNodes.has(node)`でcurrent snapshot membershipを検証する。
  - production compositionはconstructor内で`progress.workingTreeFileTarget`と`progress.openWorkingTreeFile`を差し替え、provider-level current-node checkを通らず`resolveWorkingTreeOpenTarget()`へ直接到達する。
  - runtimeは複数contextのregistrationを保持する。`resolveWorkingTreeOpenTarget()`はnodeのcontext registrationとそのsnapshotに一致することだけを確認し、「現在PR Progressに表示中のcontext/generation」かを確認しない。
- Impact:
  - PR Aのnodeを保持した状態でPR Bへ切替えた後、A nodeの右クリックcommandを実行するとAのworking-tree pathを開く。
  - 利用者が現在表示中のPR Bの操作だと認識して別ファイルを編集する可能性がある。
  - design `:885`と`:1111`のcurrent snapshot外node拒否契約に反する。
- Evidence:

  ```text
  A node github.com/owner/repo#1 src/a.ts
  B current github.com/owner/repo#2 src/b.ts
  old target accepted { repositoryRoot: '/repo', repositoryPath: 'src/a.ts', ... }
  old open accepted [ { repositoryRoot: '/repo', repositoryPath: 'src/a.ts', ... } ]
  ```

- Required action:
  1. providerの`currentFileNodes` checkを迂回しないcompositionへ戻す。
  2. host target resolutionが必要なら、providerでcurrent nodeを検証した後にfreeze済みtargetを渡す。
  3. active context/snapshot generationもtargetへ束縛し、A→B後のA nodeを拒否する。
  4. actual production compositionを使うA→B stale node testを追加する。

### PR113-NR-005 — High — VS Code display URIとcanonical URIの混在で有効なpathのreview commandが失敗する

- Origin: URI identity boundary / regression introduced by language hint
- Location:
  - `src/ui/diff-editor/review-diff-text-document-content-provider.ts:18-22`
  - `src/extension.ts:778-783,996-1004`
  - `src/t305-extension.ts:630-678`
  - `src/t405-pull-request-review-runtime-base.ts:464-519,669-699`
  - `src/application/diff-document/review-diff-uri-codec.ts:242-354`
- Description:
  - PRはContentProviderだけを`uri.toString()`へ変更したが、command routing、side判定、active tab pair validation、outer provider routingは`toString(true)`を継続している。
  - 新language hintはspace・非ASCII・`%`をpercent encodingする。VS Codeの`toString(true)`はdisplay renderingを返すためcanonical stringと一致しない。
  - codecはspace/非ASCIIのdisplay formをdecodeできても、`validateDiffDocumentPair()` line 515と`openSession()` line 697が入力stringをcanonical re-encode結果と直接比較し拒否する。
  - literal `%`を含むbasenameでは`toString(true)`の`%xx`が別percent sequenceとして解釈され、codec自体がnon-canonicalとして拒否する。outer routingはPR runtime ownershipを認識できず、別providerへ誤routeする。
  - legacy URIはdecode可能だが、同じexact-string comparisonによりcurrent URIとのpair/session validationを通れず、互換性はcontent readに限定される。
- Impact:
  - `src/日本語/space name.ts`のような有効な日本語/空白pathではdiffを表示できても「確認済みにする」commandが失敗する。
  - literal `%`を含むGit pathではvirtual document content自体を開けない場合がある。
  - upgrade前から復元されたlegacy diff tabは表示できてもreview commandを実行できない。
  - Issue #112の「確認済み状態と表示の同期」をvalid repository pathで満たさない。
- Evidence:
  - CIで記録されたVS Code `toString(true)`のdisplay form（`space name.ts`）をexact-head runtimeのcurrent URIへ適用し、次を確認した。

    ```text
    pair rejected PR diff document pair does not identify one current reviewable immutable file.
    session rejected PR diff document is stale for the current immutable comparison.
    ```

  - `src/literal%20name.ts`では次を確認した。

    ```text
    ReviewDiffUriCodecError invalid-review-diff-uri Review diff URI is not in canonical form
    ```

- Required action:
  1. document identity、routing、command、tab pair、sessionへ渡すURIはすべて`Uri.toString()`のcanonical representationへ統一する。
  2. display用以外で`toString(true)`を使用しない。
  3. direct string comparison前にcanonicalizeするか、decode済みdescriptorとcurrent snapshot identityを比較する。
  4. current/legacyそれぞれについてASCII、space、非ASCII、literal `%`、`#`、`?`のactual Extension Host command testを追加する。

### PR113-NR-006 — Medium — applied操作ごとにPR Progress全再計算と装飾更新が重複する

- Origin: refresh ownership / performance and race amplification
- Location:
  - `src/t405-pull-request-review-runtime.ts:127-146`
  - `src/extension.ts:777-783`
  - `src/t305-extension.ts:764-766,861-868`
- Description:
  - command wrapperは`refreshActiveProgress()`とprojection notifierを完了させてから`applied`を返す。
  - その直後、base extensionは`reviewStateChanged.fire()`を発行し、production listenerが`refreshPullRequestProgress()`を再度開始する。
  - test modeのlistenerは早期returnしてqueueへ置き換わるため、現在のtestはproductionの二重計算を観測しない。
- Impact:
  - 1回のreview操作につきPR全fileの取得/計算が少なくとも2回走る。
  - 2回目はfire-and-forgetであり、source再設定、subscription交換、decoration refreshも追加され、`PR113-NR-002`の競合範囲を拡大する。
  - large PRで操作完了latency、Git/GitHub/storage負荷、Extension Host占有が増える。
- Evidence:
  - static production call chain: `createCommandService.synchronize()` → `refreshActiveProgress()` / `projectionNotifier.notify()` → `invokeDiffEditorCommand()` → `reviewStateChanged.fire()` → production `onDidChangeReviewState` → `refreshPullRequestProgress()`。
- Required action:
  1. review-state mutation後のprojection refresh ownerを1経路へ統一する。
  2. event subscriberへ「既に同期済み」のoperation identityを渡すか、direct refreshを除き1つのawait可能event transactionへ集約する。
  3. production compositionで1 applied operationあたりprogress activation 1回、tree publish 1回、decoration generation 1回をcountするtestを追加する。

### PR113-NR-007 — Medium — シンタックスハイライト受け入れ条件をExtension Host testが検証していない

- Origin: test adequacy
- Location: `test/vscode/t302-suite/index.ts:15-39`
- Description:
  - testはURI encode/parse/string round-tripとprovider methodのdirect callだけを実行する。
  - `registerTextDocumentContentProvider()`、`vscode.workspace.openTextDocument(uri)`、diff editor open、`TextDocument.languageId`またはtokenizationを検証していない。
  - 最終path segmentが`.ts`であることは必要条件だが、利用者が見ている「シンタックスハイライトが効く」のbehavioral assertionではない。
- Impact:
  - provider registration、document model、language detection、diff open compositionのどこかが壊れてもCIはGreenになる。
  - PRの主要4要件の1つをacceptance testでclosedにできない。
- Required action:
  1. Extension Host内でactual providerを登録する。
  2. current URIを`openTextDocument()`またはactual diff commandで開き、少なくとも`.ts`の`languageId === "typescript"`を確認する。
  3. added/deleted/renamed、space、非ASCII、literal `%`を含むbasenameをmatrix化する。

### PR113-NR-008 — Medium — working-tree context actionの設計契約が更新されていない

- Origin: design/documentation consistency
- Location:
  - `doc/design/vscode-review-range-tracker-design.md:883-887`
  - `package.json` command/menu contribution
  - `src/ui/pr-progress/vscode-pull-request-progress-tree.ts:104-129`
- Description:
  - 現行designはPR Progress item selectionについて「immutable exact revisionを開き、working treeへ読み替えない」と定義する。
  - PRはそれと別の明示context actionとしてworking-tree openを追加したが、両操作の区別、dirty/checkout mismatch、remote URI、deleted file、stale node、nested workspace ambiguity、command availabilityをdesignへ追加していない。
- Impact:
  - 将来の実装/レビューがimmutable selectionとworking-tree actionを混同し、今回のようなstale validation bypassを再導入しやすい。
  - 公開commandの受け入れ条件がimplementation reportにしかなく、authoritative designから追跡できない。
- Required action:
  1. 16.3へ「左クリックimmutable snapshot」と「右クリックcurrent working tree」を別契約として追記する。
  2. owner resolution、remote authority、deleted/stale rejection、dirty/branch mismatch、error reporting、test matrixを明記する。

### PR113-NR-009 — Low — authoritative task trackerがIssue #92 / PR #94のまま残っている

- Origin: project tracking consistency
- Location: `tasks/tasks-status.md:7-17`
- Description:
  - current issue、PR、branch、HEAD、CI、review verdictがIssue #92 / PR #94の情報のままで、Issue #112 / PR #113を反映していない。
- Impact:
  - repository内のauthoritative current-position情報から、現在の作業対象とblockerを判定できない。
- Required action:
  - `task-breakdown-planner`、`task-consistency-manager`、または`progress-sync-manager`を通し、Issue #112 / PR #113、open findings、technical HEAD、current exact-head CIへ同期する。通常reviewerは当該制約により直接更新しない。

### PR113-NR-010 — Low — 実装reportのworkflow/final evidenceが現在の事実と一致していない

- Origin: report accuracy / audit trail
- Location:
  - `reports/2026-09-05-issue-112-pr-progress-regressions.md:14-18,114-136`
  - `.github/workflows/ci.yml:99-128`
- Description:
  - reportはfailure diagnosticsを`if: always()`相当と記載するが、実workflowは`if: failure()`である。テスト失敗診断要件は満たすが、記載は正確でない。
  - reportのvalidation sectionはtechnical HEAD `0ace212...` / run `33930668481`で止まり、PRのfinal implementation commentが示すcurrent technical HEAD `0ce2a5d...` / run `33931083888`をreport本文へ反映していない。
- Impact:
  - repository内の詳細report単独では、最終exact-head CIを再現・監査できない。
- Required action:
  - actual conditionを`if: failure()`として記載し、final technical HEAD、exact matching run、artifact ID、結果を詳細reportへ同期する。

## 6. 実行した追加検証

CI artifactから取得したexact-head VSIXのcompiled codeを使い、次のdeterministic reproを実行した。

| Repro | Result |
| --- | --- |
| source A decoration load pending → source defaultへ切替 → A resolve | clear後にAのdecorationが再公開された |
| decoration load reject | `unhandledRejection`を確認 |
| progress refresh reject → owned projection | owned projection call count 0、command coordinator reject |
| notifier listener 1 reject → listener 2 | listener 2 call count 0、notify reject |
| PR A node取得 → PR B activate → A working-tree open | A target/openを受理 |
| Japanese/space filenameのdisplay URIでpair/session validation | pair/sessionともreject |
| literal `%20`をファイル名に含むURI | codecがnon-canonicalとしてreject |
| 共有Memento上の2 selection store | B selection後にA readもBを返す。storeにinstance dimensionがないことを確認 |

## 7. Held / 未実施

次は本review環境では実施していない。これらを成功扱いにはしていない。

- 2つの実VS Code window / 2つの実Extension Hostを同時起動したIssue #112のmanual reproduction
- 実画面上のsyntax token color目視
- OS別の実Remote SSH / WSL / Windows working-tree open

これらの未実施は、上記deterministic defectを打ち消さない。特に`PR113-NR-001`はprimary acceptanceの実host reproductionが必要という指摘である。

## 8. Closure matrix

| Finding | Severity | Status |
| --- | --- | --- |
| PR113-NR-001 | High | open |
| PR113-NR-002 | High | open |
| PR113-NR-003 | High | open |
| PR113-NR-004 | High | open |
| PR113-NR-005 | High | open |
| PR113-NR-006 | Medium | open |
| PR113-NR-007 | Medium | open |
| PR113-NR-008 | Medium | open |
| PR113-NR-009 | Low | open |
| PR113-NR-010 | Low | open |

## 9. 結論

PR #113はexact technical HEAD CIがGreenだが、利用者操作で再現するHigh findingが5件あり、Issue #112のprimary cross-window acceptanceも確立されていない。**verdictはfail**とし、承認・mergeは行わない。

修正後は同一finding IDを維持し、各required actionのbehavioral test、current implementation、design/tracking、PR current HEADと完全一致するCI runを対象にclosure reviewを行う。

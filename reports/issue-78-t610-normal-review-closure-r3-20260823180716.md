# Sub-agent実行レポート

## タスク

- 目的: Issue #78 / PR #83 の immutable pushed HEAD `4684c9f8a0d80ae4920b5e90f465277da3aa2841`を base `477725632177f5c4fcbca5eb587644fdef06e4df`に対して、同じ通常reviewerが carried T610-NR-004/005/006/007/008/010、closed T610-NR-001/002/003/009の回帰、およびcurrent-head T506 CI deltaに限定して再closureする。
- タスク種別: same-reviewer normal-review closure R3 / built-in code review

## sub-agentを使う理由

- 理由: 元normal reviewと2回のclosureを担当したreviewerとしてfinding identity/severityを維持し、R7〜R14の修正とcurrent-head CI deltaをproduction、actual composition、focused evidenceへ直接照合するため。

## 対象範囲

- 対象: `477725632177f5c4fcbca5eb587644fdef06e4df...4684c9f8a0d80ae4920b5e90f465277da3aa2841`のT610実装、特に`1ec5c98d9fc88115a819599e4c8794a24134c613...4684c9f8a0d80ae4920b5e90f465277da3aa2841`の28 paths、folder controller/enumerator/source、T305 activation/startup/watcher/storage composition、Global Tree/commands/Status、package/CI、T610/T506/T607 tests、設計§§11.3/16.5/16.8-16.10/17-20、original normal report、closure R1/R2、R7〜R14、performance-local-only、CI follow-up、tracking/BreakingChanges。

## 対象外

- 対象外: 新しいfull review、production/test/config/trackingの修正、test/build/lint/Extension Host/CIの再実行、CI待機、GitHub write、commit/push/merge、独立attestation、nested agent。唯一のwriteは本固定reportのplaceholder置換。

## 実行コマンド

- 実行コマンド: `Get-Content`、`rg`、`git rev-parse`、`git merge-base`、`git status --short`、`git log`、`git diff --name-status/--stat/--unified`、`git show`によるread-only確認だけを実施した。test/build/lint/Host/CIは0回。HEAD/upstreamは`4684c9f8a0d80ae4920b5e90f465277da3aa2841`、base/merge-baseは`477725632177f5c4fcbca5eb587644fdef06e4df`で一致した。既存証跡はR10のT610 51/51、T607 81/81、T604 24/24、R14のT610 57/57、T305 60/60、build/lint/diff-check Green、R14 Host initial 900000ms timeout・restart未到達・cleanup成功、HEAD `400957a` CI run `32600267122`のT506 failure、およびHEAD `4684c9f`のfocused static fix 1/1。Markdown wordingは`tools/lint/`と`lint:md`配線不在のため`unsupported`でありpassではない。

## 対象ファイル

- 変更または確認したファイル: 指定4 Skill、`AGENTS.md`、固定report、original normal/closure R1/R2、R7〜R14、performance-local-only、CI follow-up、設計指定節、tasks/phases、BreakingChanges、`.github/workflows/ci.yml`、`package.json`、folder controller、Node enumerator/stopped store、T305 extension/composition/startup/root URI、T505 source、Global UI model/runtime、operation feedback/atomic storage direct dependencies、T610/T506/T607/CI contract/Extension Host runner・suite。固定report以外は変更していない。

## 指摘事項

- 指摘要約または「指摘なし」: **blocking 7件（High 3、Medium 3、Low 1）**。carried 6件はclosed 0 / blocking 6、新規finding 1件。severity reclassificationなし。

  **T610-NR-004 — High — blocking — direct child folderがscope modelへ入らず、partial/階層が未発見childをcomplete扱いできる**

  - 場所: `src/t505-global-understanding-source.ts:143`、`:202`、`src/adapters/repository-files/node-repository-file-path-enumerator.ts:140`、`:184`
  - Evidence: active scopeの再計算は`enumerateDirectFolders()`を呼ぶが、その結果はfileと除外だけで、非除外directoryは結果へ保持されない。sourceもdirectoryをcontrollerへ渡さず、Tree folder rowは既にcontroller recordになったscopeだけから作る。したがって開始済み`src`直下の未open `src/child`はinactive rowにもpartial childにもならず、parentは未知childなしとしてcompleteになり得る。unitはchild fileをopenしてrecordを先に作り、Host fixtureもnested fileをopenしてから階層をassertするため、この発見境界を覆わない。R14 Hostは最初のmarker前でtimeoutしてpresentationへ未到達。
  - Impact: 設計§11.3/16.5の「開始scopeのdirect childをinactive表示」「inactive childを持つparentはpartial」を破り、repository/folder percentageが未走査subtreeを無視したcomplete値になり得る。
  - Required action: direct enumerationから非除外direct directory identityを返し、contentを読まずcontrollerへinactive childとして登録する。parent partial/summary/Statusをactual providerで確認し、current-head T610 initial/restart/cleanupを成功させる。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | direct child discoveryとpartial UI、current-head Host成功 | incomplete: enumerator/sourceがnonexcluded directoryを破棄 | incomplete: fixtureはchild open後だけをassertしR14は未到達 | incomplete: aggregate/model testは事前作成recordだけ | blocking |

  **T610-NR-005 — High — blocking — editor actionがclicked resource/current selectionへ束縛されない**

  - 場所: `package.json:90`、`src/ui/global-understanding/vscode-global-understanding-runtime.ts:269`、`:402`、`test/vscode/t610-suite/index.ts:103`
  - Evidence: 3 editor menu entryはいずれもresource schemeだけで常時表示され、commandへfolder targetを渡さない。no-arg resolverはexpected actionのcurrent rowが全Treeで一意ならそのobjectを選ぶだけで、editor contextのresource、Tree selection、repository ownerを入力にしない。そのためclicked editorと無関係な一意scopeへ作用するか、複数候補で失敗する。Host fixtureはprovider-owned Tree nodeを明示引数で渡し、editor menu invocationを通らない。R14 HostもTree command前でtimeoutした。
  - Impact: 設計§16.8のcurrent-generation selection contractとmulti-root action identityを満たさず、editor contextから別folderを停止/再開するかactionが利用不能になる。
  - Required action: editor resourceまたは明示current Tree selectionからowner+canonical path+current-generation targetを生成し、command action/stateを検証する。Palette、Tree、editor、single/multi-rootをactual public command fixtureで通す。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | resource/selection-bound typed targetとactual editor/Palette test | incomplete: no-arg global uniquenessだけで解決 | incomplete: HostはTree object引数だけ、editor/Palette未到達 | incomplete: unitはno-arg一意解決とstale objectだけ | blocking |

  **T610-NR-011 — High — new blocking — duplicate manifest keyが既存editor review commandsを上書きする**

  - 場所: `package.json:65`、`:90`、`test/unit/t610-folder-understanding.test.ts:571`
  - Evidence: `contributes.menus`に`"editor/context"`が2回定義される。標準JSON parseでは後のfolder 3件だけが残り、先のselection/file mark/unmark 4件は消える。追加testも`JSON.parse()`後のfolder actionだけを数えるため、上書きをGreenにする。
  - Impact: T305/T505以前からの通常editor primary commandsがmanifest contributionから失われ、package consumerによってはduplicate property自体がvalidation errorになる。
  - Required action: 7 entryを単一`editor/context`配列へ統合し、raw manifest key exactly-once、既存4件保持、folder 3件保持をcontract test/package validationで固定する。

  **T610-NR-006 — Medium — blocking — startup-open actual compositionがなくcurrent-head watcher lifecycleもHost未確認**

  - 場所: `src/t305-extension.ts:630`、`:755`、`:793`、`test/vscode/t610-suite/index.ts:66`、`:86`、`:179`
  - Evidence: productionはCurrent Context startup後に既存documentをobserveし、owner-filtered watcher/listenerを`context.subscriptions`へ登録しているためproduction pathはready。focused helper/filter testもある。一方Host suiteは`extension.activate()`後に初めてfixture documentをopenし、activation-time openをassertしない。real watcherはcreate 1件だけで、R14は最初のmarker前timeoutのためそのpathもcurrent headでは成功していない。
  - Impact: startup-open wiringがproduction activationで回帰してもfocused helperだけでは検出できず、current-head actual watcher/disposal lifecycleの成功証拠もない。
  - Required action: activation前にopen済みdocumentを持つactual fixtureでstartup observationをassertし、scoped real workspace.fs eventとdispose後非発火をcurrent-head Hostで成功させる。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | preactivation-open + scoped/disposed real watcher Host | ready: startup queue、owner filter、subscriptions disposal | incomplete: postactivation open/createのみを記述しR14未到達 | ready: helper/filter/static lifecycle | blocking（missing actual fixture） |

  **T610-NR-007 — Medium — blocking — shared Output failure boundaryはproduction codeにあるがactual activation compositionで未実証**

  - 場所: `src/t305-extension.ts:204`、`:768`、`src/t305-global-understanding-composition.ts:29`、`test/unit/t610-folder-understanding.test.ts:368`
  - Evidence: productionはstorage notifierをstoreへ渡し、document-open failureを`reportActiveOperationFailure`へ送りgeneric UIを表示するためcode pathはready。corruption/ENOSPC/EACCES、atomic mutation、stale lock、redactionのfocused evidenceも存在する。ただしR11 testはexported sourceのfaultを得た後にtest自身が`reportActiveOperationFailure()`を呼ぶため、actual T305 listener、active Output host、store notifier、UIを一つのcompositionで通さない。Host suiteにはfault injectionがなく、R14もactivation後へ未到達。
  - Impact: real activationでnotifier/feedback wiringが外れる、Outputへraw pathが漏れる、またはgeneric UIが出ない回帰を専用gateが検出しない。
  - Required action: actual T305 activationへdeterministic store/open faultを注入し、real shared Outputのredacted terminal、generic UI、stale-lock diagnostic、cleanupを同一fixtureでassertする。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | activated Output/store/open failure fixture | ready: notifier + shared operation feedback + generic UI | incomplete: source fault後にtestがfeedbackを手動呼出し | ready: atomic/corrupt/ENOSPC/EACCES/stale-lock/redaction seams | blocking（missing actual composition） |

  **T610-NR-008 — Medium — blocking — many active scopesでopened/persisted evidenceをscopeごとに全量再投影する**

  - 場所: `src/t505-global-understanding-source.ts:127`、`:151`、`:434`、`:491`
  - Evidence: controller aggregateはsingle-pass indexへ改善され、recursive enumeratorはoperation-wide <=128 budgetとremainderを持ち、R11の257-entry single-scope cancel/stale fixtureもある。しかしsourceは`activeFolders` loop内で毎回`captureOpenedDocuments()`を呼び、全retained/open evidenceをcopyし、毎回persisted Global state全体を`projectGlobalStatePaths()`する。多数scopeでは同じevidence/stateをscope数分複製・検証する。追加testは257 scopeのcontroller aggregateと1 scope/257 fileのcancelで、このproduction multi-scope projectionを通らない。
  - Impact: original findingの重複projection削減とmemory/bounded-stage contractが未完で、多数active folderでO(scope×evidence/state) workと一時保持が再発する。
  - Required action: owner generationごとにopened/persisted projectionを一度だけ作るか、I/O/copy前にscope-local indexへ分割し、多scope exact work count、memory非二重保持、cancel/stale publicationをdeterministic local fixtureで固定する。`test:t607`は設計どおりlocal-onlyで、CI追加は不要。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | scope-local/single projectionとmulti-scope budget | incomplete: active scopeごとに全evidence/state copy | incomplete: actual source cancelはsingle scopeのみ | incomplete: indexed controller/deep 257/T607 81/81はduplicate source projectionを測らない | blocking |

  **T610-NR-010 — Low — blocking — all-exported API documentation契約が依然網羅的でもsymbol-adjacentでもない**

  - 場所: `src/ui/global-understanding/vscode-global-understanding-runtime.ts:36`、`:258`、`src/ui/global-understanding/global-understanding-ui-model.ts:95`、`test/unit/t610-public-api-documentation.test.ts:8`、`:25`
  - Evidence: original findingで明示された`GlobalUnderstandingRuntimeSource.startFolder/stopFolder/resumeFolder`と`RegisteredGlobalUnderstandingRuntime`のpublic methods、`GlobalUnderstandingFolderNode` interface自体などに契約JSDocがない。testのsymbol listは一部だけで、regexは任意の先行JSDocから対象symbolまで中間declarationを跨げるため、対象直前のcommentを保証しない。
  - Impact: external/fixture consumerへidentity、state、failure/cancellation/ownership contractが伝わらず、comment欠落をexactly-once gateが見逃す。
  - Required action: base以後に追加/変更した全exported type/memberへ契約JSDocを付け、ASTまたはdeclaration-adjacent parserで各symbol exactly onceを検証する。BreakingChanges記録は維持する。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | all exported/member docs + adjacency-aware contract | incomplete:複数public APIがundocumented | not applicable: runtime composition不要、export contractが対象 | incomplete: whitelist漏れとcross-declaration regex | blocking |

  Closed regression check:

  - T610-NR-001: `folderScopes`なしlegacy branchはrepository-wide `enumerate()`を維持し、current-head CIのUnit/T505までGreen。`closed`維持。
  - T610-NR-002: inherited stop/resume/prune lifecycleはindexed aggregate変更の影響を受けずfocused fixtureを維持。`closed`維持。
  - T610-NR-003: stopped-only `emptySnapshot()`とrestart marker projectionは維持。`closed`維持。
  - T610-NR-009: actual activation/Test API/selector fixtureは残るが、R11〜R14 current composition Hostはいずれもinitial timeoutし、R14はfirst marker前・restart未到達。sourceでreopen defectは特定していないがcurrent-head confirmationは不足するため`confirmation-required`。

  Current-head T506 CI delta:

  - HEAD `400957a`のrequired CI `32600267122`はbuild/contracts/architecture/lint/unit/T403〜T505 Green後、T506 `restore-context-b-unmark-global`でfile-open lifecycle完了前にsnapshotを読んでfailした。
  - HEAD `4684c9f`は`openNormalReviewEditor`→`drainGlobalUnderstandingFileOpenForTest`→snapshotの順へ限定修正し、静的focused 1/1 evidenceがある。production変更なしで修正は妥当だが、current-head T506 Host/required CIは未実行なので`confirmation-required`。failureをheldまたはGreenへ変換しない。

## 結果

- 結果: verdict **`fail`**。reviewed implementation HEAD/upstreamは`4684c9f8a0d80ae4920b5e90f465277da3aa2841`、base/merge-baseは`477725632177f5c4fcbca5eb587644fdef06e4df`。carried T610-NR-004/005/006/007/008/010はblocking 6、new T610-NR-011はblocking、closed NR-001/002/003はclosed維持、NR-009とcurrent-head T506 deltaはconfirmation-required。unknown=0、unexplored=0。本reportはnormal review closureであり独立attestationではない。

## リスク

- 未解決のリスクまたは後続対応: blocking 7件を修正し、carried 6件の5-cellを同じreviewerへ再提示する。特にmanifest duplicate key、inactive direct child discovery、editor target、startup/failure actual composition、multi-scope projection、public docsを閉じる。R14 Host timeoutとcurrent-head T506 CIはrequired confirmationでありheldではない。heldはR10のWindows symlink `EPERM` 1件（T610非scope/environment privilege）とMarkdown wording `unsupported`のみ。T607 workloadは設計どおりdeveloper-local専用でありCIへ戻さない。current-head exact required CI、独立review、attestation、mergeは未実施。

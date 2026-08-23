# Sub-agent実行レポート

## タスク

- 目的: Issue #78 / PR #83 の pushed HEAD `488c2d561df89955a02e8221ad58dc06b0022879`をbase `477725632177f5c4fcbca5eb587644fdef06e4df`に対して通常review継続し、T610-NR-001〜011とT506 deltaを全criterion・5-cellでdispositionする。
- タスク種別: same-reviewer normal-review closure R4

## sub-agentを使う理由

- 理由: original normal reviewerとしてfinding identityとclosure基準を維持し、R15 owner reportを独立attestationへ読み替えずcurrent code・test・actual composition evidenceを再照合するため。

## 対象範囲

- 対象: immutable HEAD/upstream `488c2d561df89955a02e8221ad58dc06b0022879`、merge-base `477725632177f5c4fcbca5eb587644fdef06e4df`、original NR-001〜010、R3追加NR-011、R15修正差分、T506 drain delta、design §§11.3/16.5/16.8-16.10/17-20、production/source/controller/enumerator/runtime/lifecycle/watcher/storage/menu、focused/Host evidence、trackingとBreakingChanges。

## 対象外

- 対象外: 新規full review、production/test/config/design/tracking修正、test/build/lint/性能/Extension Host/CIの実行または待機、GitHub write、commit/push/merge、nested agent、独立attestation。唯一のwriteは本固定reportのplaceholder置換。

## 実行コマンド

- 実行コマンド: `Get-Content`と`rg`で必須Skill、AGENTS、設計、original/closure/follow-up R7〜R15、performance-local-only、CI follow-up、source/test/config/trackingをread-only確認し、`git rev-parse`、`git merge-base`、`git diff`、`git status`でidentityと差分を照合した。test/build/lint/Host/CIは0回。Markdown wordingはrepositoryに`tools/lint/`と`lint:md` wiringがないため`unsupported`であり、passとは扱わない。

## 対象ファイル

- 変更または確認したファイル: 指定4 Skill、`AGENTS.md`、本固定report、original normal report、closure R1/R2/R3、R7〜R15 follow-up、performance-local-only、CI follow-up、design指定節、BreakingChanges、tasks/phases、`.github/workflows/ci.yml`、`package.json`、Node enumerator/stopped store、folder scope controller、T305 extension/composition/startup/lifecycle/projection refresh/root URI、T505 source、Global UI model/runtime、operation feedback/atomic storage直接依存、T305/T506/T607/T610 unit・integration・Extension Host runner/suite。固定report以外は変更していない。

## 指摘事項

- 指摘要約または「指摘なし」: **blocking 4件（High 1、Medium 2、Low 1）**。NR-004/006/011はclosed、NR-005/007/008/010はblocking、NR-001/002/003/009はclosed維持。T506 deltaはconfirmation-required。unknown=0、unexplored=0。

  **T610-NR-005 — High — blocking — Command Paletteが選択中nodeではなく全Treeの一意action候補へ作用する**

  - 場所: `src/ui/global-understanding/vscode-global-understanding-runtime.ts:277`、`:283`、`:284`、`test/vscode/t610-suite/index.ts:177`、`:186`
  - Evidence: editor URIはcanonical current-owner folderへ解決され、Tree objectはprovider-owned identityでstale/state mismatchを拒否する。一方no-argument handlerはTree selectionを保持せず、同actionのcurrent nodeが全Treeで1件ならそれを返す。runtimeは`createTreeView`/`onDidChangeSelection`を使わず、HostのPalette相当resumeも意図的にresume候補を1件だけにして成功させる。design §16.8はCommand Paletteで「選択中のcurrent-generation folder nodeだけ」を受理すると定める。
  - Impact: 未選択でも一意な別folderへstart/stop/resumeでき、複数候補では実際に選択していても失敗する。Tree/editorが正しくてもPaletteのowner/generation action identityが成立しない。
  - Required action: actual TreeView selectionをowner+canonical path+generation targetとして保持し、no-arg commandはその選択だけを受理する。未選択、複数row、stale selection、multi-root、Tree/editor/Paletteをpublic command fixtureで固定する。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | selection-bound no-arg targetとPalette matrix | incomplete: editor URIとTree objectはreadyだがno-argはglobal uniqueness heuristic | incomplete: HostはTree/URIと一意no-argだけでselectionを通さない | incomplete: stale/state/resource assertionsはready、selection lifecycleなし | blocking |

  **T610-NR-007 — Medium — blocking — owner共有capture失敗が開始済みscopeを`running`のまま残し、actual activated failure compositionも未固定**

  - 場所: `src/t505-global-understanding-source.ts:135`、`:158`、`:169`、`:171`、`:173`、`test/unit/t610-folder-understanding.test.ts:441`、`:458`、`:468`
  - Evidence: 各scopeは`begin()`後に`scopeWork`へ追加されるが、PR HEAD capture、opened-document capture、persisted-state projectionはper-scope `try/catch`の外でawaitされる。いずれかがnon-abort failureになると`folderScopes.fail()`へ到達せず、全開始scopeが`running`のまま残る。R15 failure testはproduction sourceとlifecycle helperを直接結合するが、activated `onDidOpenTextDocument`、actual `VscodeOperationFeedbackHost`/Output channel、store notifierを通したfault injectionではなく、extension wiringはsource text regexだけである。R15 Hostはsuccess pathでこのfailure boundaryを実行しない。
  - Impact: design §17.3のfailed/ancestor partialへのfail-closed遷移を破り、spinner/partial stateが残り得る。actual activation wiringでredactionやgeneric UIが外れる回帰も専用fixtureが検出しない。
  - Required action: shared capture/projection全体をgeneration-aware failure boundaryへ置き、各still-current scopeをfailedへ遷移させる一方stop/cancel/staleはERROR化しない。activated listener/store faultをshared Outputへ注入し、redacted terminal、generic UI、failed snapshot、cleanupを同一fixtureでassertする。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | shared-stage failure→failed/partialとactivated Output fault | incomplete: atomic store/redaction helperはreadyだがshared awaitにfail transitionなし | incomplete: direct helper composition + static regexのみ、Hostはsuccess path | incomplete: corruption/ENOSPC/EACCES/redactionはready、multi-scope shared capture failureなし | blocking |

  **T610-NR-008 — Medium — blocking — scope停止がowner共有captureをcancelせず、停止後もそのscopeのI/Oを継続できる**

  - 場所: `src/t505-global-understanding-source.ts:137`、`:158`、`:168`、`:169`、`:171`、`:173`、`test/unit/t610-folder-understanding.test.ts:297`、`:325`
  - Evidence: enumerationはscopeごとのcombined signalを使うが、scope candidateをunionした後のPR HEAD/opened evidence/global-state captureはouter refresh `signal`だけを受け、folder `scopeSignal`を受けない。enumeration後の共有capture中に1 scopeを停止すると、その候補のhash/copy/state projectionは共有capture完了まで継続し得る。publication前のscope fenceはstale publishを拒否するが、design §§11.3/19の停止後I/O禁止を満たさない。257-file cancel testはenumeration checkpointで停止して共有capture前に抜け、2-scope owner-capture testはcancelしないため、この境界を覆わない。
  - Impact:停止済みfolderのcontent evidenceを読み続け、scope-local privacy/cancellation contractとbounded workを破る。多数scopeでは停止したscopeの不要なowner-wide workも残る。
  - Required action: owner共有captureをactive scope indexとscope cancellationへ結び、各read/hash/copy前後で対象scopeがcurrentか確認して停止scopeを除外する。enumeration完了後のcapture/hash中stop、他scope継続、zero post-stop I/O、no stale publishをdeterministic multi-scope fixtureで固定する。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | shared captureのscope-local cancel/stale fence | incomplete: <=128 enumerator/indexed aggregate/owner-once captureはready、shared stageはouter signalのみ | incomplete: actual source cancelはenumeration中single scope | incomplete: 257-file、2-scope one-capture、T607 81/81既存証跡はpost-enumeration stopを測らない | blocking |

  **T610-NR-010 — Low — blocking — exported API documentation gateが未列挙public contractを見逃す**

  - 場所: `src/ui/global-understanding/vscode-global-understanding-runtime.ts:266`、`:267`、`:268`、`:269`、`:270`、`src/ui/global-understanding/global-understanding-ui-model.ts:95`、`test/unit/t610-public-api-documentation.test.ts:9`、`:14`、`:18`
  - Evidence: AST testはlisted symbolの隣接JSDocを正しく検査するが、whitelistは`RegisteredGlobalUnderstandingRuntime`とその`refresh`/`refreshWithErrorBoundary`/`invalidate`/`clear`、`GlobalUnderstandingFolderNode` interface自体を含まない。これらexported declarationsには実際にcontract JSDocがない。したがってR15の「all exported API」は証明されず、testは列挙外exportが増えてもGreenになる。
  - Impact: public/runtime consumerのrefresh・invalidation・disposal ownershipやfolder node identity contractが文書化されず、future deletion/additionをexactly-once gateが検出できない。
  - Required action: base以後に追加・変更した全exported declaration/memberをenumerateして契約JSDocを追加し、whitelistではなくexport traversalまたはcompleteness assertionで各symbol exactly onceを検査する。BreakingChanges記録は維持する。

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | all-export/member docsとexhaustive AST contract | incomplete: listed symbolsはdocumented、未記載export/memberあり | ready/not-applicable: runtime behaviorではなくexport contract | incomplete: adjacencyはready、export completenessなし | blocking |

  Closed / carried disposition matrices:

  | Finding | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- | --- |
  | T610-NR-001 | legacy controllerなしconsumerをrepository-wide維持 | ready: legacy branchは`enumerate()`を保持 | ready:既存T505 consumers unchanged | ready: legacy4 37/37既存証跡、current diff非回帰 | closed維持 |
  | T610-NR-002 | inherited stop/resume/pruned hierarchy | ready: explicit/inherited markerとancestor fence | ready: exported source lifecycle | ready: parent stop/open/resume/independent child fixturesを保持 | closed維持 |
  | T610-NR-003 | stopped-only/restart row | ready: empty-active snapshotへmarkerを投影 | ready: R15 restart actual Host succeeded | ready: stopped-only/restart assertions | closed維持 |
  | T610-NR-004 | inactive direct child、recursive partial、ratio抑制 | ready: `directDirectories`→`discoverInactive`とindexed aggregate | ready: actual provider/Statusとreal watcher child、R15 initial/restart succeeded | ready: direct child、3-level、partial no-percent、37/37 | closed |
  | T610-NR-006 | startup-open + scoped/disposed watcher | ready: listener-before-snapshot、active-editor、owner/root watcher subscriptions | ready: preactivation documentとreal create/write/change/rename/delete/foreign/dispose、R15 initial succeeded | ready: lifecycle/filter/static assertions | closed |
  | T610-NR-009 | actual activate/events/commands/Tree/restart | ready: production/Test seams retained | ready: R15 exact initial/restart succeeded | ready: focused 37/37とfunctional Host。cleanup worker timeoutは別held | closed |
  | T610-NR-011 | manifest key exactly-once、旧4+新3 | ready:単一`editor/context` 7 entry | ready: packaged public command registrations | ready: raw key count 1、parsed count 7 | closed |

  T506 delta:

  | Required action | Production path | Actual composition fixture | Focused evidence | Current disposition |
  | --- | --- | --- | --- | --- |
  | registered file-open drain後にsnapshotを読む | ready: production semantic変更なし、current-context dependentsは後続Globalも継続 | incomplete: HEAD `400957a` CI failure後、`488c2d5` exact T506 Host/CI未実行 | ready: `openNormalReviewEditor`→`drainGlobalUnderstandingFileOpenForTest`→assertのstatic contractを保持 | confirmation-required（non-blocking、heldへ変換しない） |

  Held / unsupported: R15の`t610-initial`と`t610-restart`は機能成功として採用する。後続の独立cleanup workerだけが10秒timeoutしたが、両owned Hostはexit 0で残存processなしのためPC/Windows cleanup heldとし、NR-009を再openしない。R10のWindows symlink creation `EPERM`は環境権限制約held。Markdown wordingはwiring不在でunsupported。T607 performanceはlocal-only policyを維持しCI実行を要求しないが、上記NR-008 code defectを旧81/81でcloseしない。

## 結果

- 結果: verdict **`fail`**。reviewed HEAD/upstreamは`488c2d561df89955a02e8221ad58dc06b0022879`、base/merge-baseは`477725632177f5c4fcbca5eb587644fdef06e4df`。blockingはNR-005/007/008/010の4件。NR-004/006/011はclosed、NR-001/002/003/009はclosed維持、T506 deltaはconfirmation-required。unknown=0、unexplored=0。本reportはsame normal reviewerのclosureであり独立attestationではない。

## リスク

- 未解決のリスクまたは後続対応: 4 blocking findingを元ID/severityで修正し、Palette selection、shared-capture failure/cancellation、all-export JSDoc completenessを同じreviewerへ再提示する。T506はexact-head non-performance CI/Hostで確認する。R15 cleanup timeout、Windows symlink権限、Markdown unsupportedは機能failureと分離して保持する。固定report以外のworktree、HEAD、upstreamは変更しない。

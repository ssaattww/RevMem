# Sub-agent実行レポート

## タスク

- 目的: frozen target `02eb90588a7c040af20b8ccc50ec12f71beb3ae9`について、同じ通常reviewerがT610-NR-001〜010だけを5-cell finding closureする。
- タスク種別: same-reviewer finding-limited normal-review closure

## sub-agentを使う理由

- 理由: 元findingを検出したreviewerとして、identityとseverityを変えず、R1〜R6の修正をproduction/test/composition/validation/trackingの全セルで再判定するため。

## 対象範囲

- 対象: `origin/main`のmerge-base `477725632177f5c4fcbca5eb587644fdef06e4df`からfrozen HEADまでのうち、元review target `faf3c8ea98ce3ad7e26daef12b6688c8b01abaef`以後のT610-NR-001〜010修正、直接production/test/composition、R1〜R6証跡、tracking、BreakingChanges。

## 対象外

- 対象外: 新しいfull review、新規finding、production/test/tracking編集、test/build/lint/Host/CI再実行、GitHub write、commit/push/merge、独立review/attestation。

## 実行コマンド

- 実行コマンド: `git status --short --branch`、`git rev-parse HEAD`、`git merge-base origin/main HEAD`、`git diff --name-status/--stat/--unified faf3c8e...02eb905`、`rg -n`、`Get-Content`、`git show`によるread-only照合だけを実施した。test/build/lint/Host/CIは0回。提供証跡はR2のlegacy 4 suite 37/37とT607 81/81、R5/R6のT610 41/41、R6 exact Host 258.4秒・exit 0（initial/restart/cleanup全phase succeeded）。`npm run test:unit`は既知Windows/POSIX path、SIGKILL timing、EBUSY/Host cleanup classの失敗を含むためGreenへ変換せずT610非scopeのheld failure、`npm run test:vscode-runner`は未変更`success-without-close` 250ms worker-start raceで6/7・exit 1のheld failure。Markdown wordingは`tools/lint/`/`lint:md` wiring不在のため`unsupported`でありpassではない。

## 対象ファイル

- 変更または確認したファイル: 必須6 Skill、`AGENTS.md`、元normal report、R1〜R6 report、`doc/design/vscode-review-range-tracker-design.md`のT610契約、`Design/BreakingChanges.md`、tasks/phases、`src/application/global-understanding/folder-understanding-scope-controller.ts`、`src/adapters/repository-files/node-repository-file-path-enumerator.ts`、`src/adapters/state-repository/node-folder-understanding-stopped-store.ts`、`src/t305-global-understanding-composition.ts`、`src/t305-repository-root-uri.ts`、`src/t305-extension.ts`、`src/t505-global-understanding-source.ts`、Global Understanding UI/runtime、package/CI、T305/T505/T610/T607/Host/owned-runner tests、および本固定report。

## 指摘事項

- 指摘要約または「指摘なし」: 10件を一括dispositionした。**closed 4件（High 3 / Medium 1）、open 6件（High 2 / Medium 3 / Low 1）**。新規findingは追加していない。

  **T610-NR-001 — High — closed — `src/t505-global-understanding-source.ts:143`、`src/t305-global-understanding-composition.ts:20`、`reports/issue-78-t610-normal-review-followup-r2-20260822211529.md:22`**

  controller未指定時は`enumerate()`、T305 actual factoryだけがcontrollerを注入する分岐を確認した。legacy 4 suiteは37/37で、元の既存consumer回帰は解消された。Impactは解消済み。Required actionなし。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | ready: optional controllerなしはlegacy repository-wide `enumerate()` | ready: legacy nested期待を修正し4 suite 37/37 | ready: production T305だけがscoped controllerを注入し、既存direct consumerはlegacy | ready: legacy 37/37、T610 41/41。umbrella failureは非scope held | ready: R2とtasksがlegacy回帰修正と後続gateを区別 |

  **T610-NR-002 — High — closed — `src/application/global-understanding/folder-understanding-scope-controller.ts:79`、`:106`、`:115`、`test/unit/t610-folder-understanding.test.ts:161`**

  stopped ancestorはopen/begin/subtree startを遮断し、親stopのdescendantはinherited stop、resumeはinheritedだけをinactiveへ戻して独立explicit child markerを保持する。再帰列挙はstopped descendantをpruneする。Impactは解消済み。Required actionなし。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | ready: ancestor-aware stop、scope-local abort、explicit/inherited分離 | ready: parent stop→open拒否→resume、独立marker、stopped prune | ready: T505 open/explicit subtreeがcontrollerの`isStopped`を使用 | ready: focused 41/41、T607 81/81、R6 Host stop/resume/restart | ready: R2〜R6とtasksにlifecycle証跡を同期 |

  **T610-NR-003 — High — closed — `src/t505-global-understanding-source.ts:117`、`:270`、`test/vscode/t610-suite/index.ts:67`、`reports/issue-78-t610-normal-review-followup-r6-cleanup-20260822221743.md:30`**

  active scopeが0件でもstopped-only snapshotを返し、restartではmarkerだけを復元してTreeの`stopped` rowを維持する。R6 actual restartはfile evidence空、`src` stoppedを確認した。Impactは解消済み。Required actionなし。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | ready: `emptySnapshot`がdurable stopped rowsを投影 | ready: restart suiteがstopped-only/no-active evidenceをassert | ready: actual T305 factory→atomic store→source→Tree | ready: R6 initial/restart/cleanup全成功 | ready: R6/tasksにrestart結果を同期 |

  **T610-NR-004 — High — open — `src/ui/global-understanding/global-understanding-ui-model.ts:184`、`:395`、`:406`、`test/vscode/t610-suite/index.ts:82`**

  controllerの再帰aggregateとTree nestingは修正されたが、repository summaryとStatus Barはroot/childの`partial`を見ず、既知active fileだけの`progress`を常にcomplete percentageとして表示する。Hostもpartial parent/hierarchical Treeをassertしていない。Impactとして、incomplete/stopped childを含むrepositoryが依然100%等のcomplete ratioに見える。Required actionはroot aggregateのpartialをsummary/Statusへ運び、partial時はcomplete percentageを出さず、UI unitとactual Hostで3-level/incomplete/stopped parentを固定すること。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | incomplete: recursive aggregate/Tree nestingはreadyだがsummary/Status partial semanticsが欠落 | incomplete: controller 3-level fixtureのみでUI summary/Status fixtureなし | incomplete: runtimeは常に`formatGlobalUnderstandingStatusBar(snapshot)`を呼びpartialを渡さない | incomplete: T607 GreenとR6 Hostはこの表示契約を未実証 | incomplete: tasksは修正中とだけ記録し、残るUI partial gapは未追跡 |

  **T610-NR-005 — High — open — `src/ui/global-understanding/vscode-global-understanding-runtime.ts:241`、`:356`、`package.json:65`、`:81`、`test/vscode/t610-suite/index.ts:82`**

  URI scheme/authority、Windows containment、canonical relative path、stale Tree object fenceは修正された。一方、Command Palette invocationはargumentなしのため常にrejectされ、current Tree selectionからtyped targetを生成する経路がない。`editor/context`にもfolder action 3件は0件で、actual HostはTree/Palette/editor commandではなくTest APIのpath seamを使う。Impactとして設計済みPalette/editor actionは利用不能で、actual command compositionは未証明。Required actionはcurrent-generation Tree selectionを保持してPalette/editor commandへtyped nodeを供給または適切にdisableし、3 editor menu wiringをexactly onceで追加し、single/multi-root actual VS Code command fixtureを通すこと。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | incomplete: URI/path/stale fenceはready、Palette/editor target生成とmenuが欠落 | incomplete: Windows/remote/traversal/stale unitはreadyだがPalette/editor/menu testなし | incomplete: HostはTest API seamでreal folder commands/menuを迂回 | incomplete: T609 root helper 2/2とHost single-rootはreadyだがmulti-root command path未実証 | ready: BreakingChangesがURI identity/marker compatibilityを記録 |

  **T610-NR-006 — Medium — open — `src/t305-extension.ts:730`、`:767`、`:770`、`test/vscode/t610-suite/index.ts:95`**

  open完了後refreshとwatcher登録/disposalは追加されたが、activation時に既にopenのdocumentをobserveするstartup pathがなく、watcher callbackはschemeしか見ずselected owner/scope containmentを検証しない。R6 Hostのwatcher phaseはactual filesystem create/delete/renameではなくTest APIでcallbackを直接呼ぶ。Impactとしてstartup-openは手動操作までinactiveのままで、foreign-root eventが選択scopeの余分なrefreshを起こし、actual directory lifecycleの追従は未証明。Required actionはstartup/background-openとowner-contained create/delete/renameを実listener/coalescerへ接続し、inactive/stopped sibling非開始をactual emitter/Hostで検証すること。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | incomplete: open refresh/watcher/disposalはready、startup-openとowner-scoped filteringが欠落 | incomplete: create/delete/rename/background/startup-open fixtureなし | ready: actual T305 listener、watcher、coalescer、subscription disposalは配線済み | incomplete: Hostはreal openを通すがwatcherはTest seam、startup/rename未到達 | incomplete: R2/R6はseam/Host成功を記録するが未実証lifecycleをclosed trackingへ変換できない |

  **T610-NR-007 — Medium — open — `src/adapters/state-repository/node-folder-understanding-stopped-store.ts:34`、`:47`、`src/t305-global-understanding-composition.ts:25`、`src/ui/global-understanding/vscode-global-understanding-runtime.ts:356`**

  atomic store、root lock、lock内RMW、corrupt/ENOSPC generic failure、two-window lost-update防止は修正された。しかしproduction factoryは`notifyStorageLockDiagnostic`を渡さず、folder start/stop/resumeもoperation feedback lifecycleで包まれないため、stale-lock recoveryやsave failureのOutput diagnosticがない。document-open失敗は`src/t305-extension.ts:746`でraw dependency messageを表示する。Impactとして保存/列挙障害はfail-closedでもOutputで原因追跡できず、pathを含むopen errorがUIへ漏れる可能性が残る。Required actionはT604/T606のdiagnostic notifierとoperation feedbackをactual T305 compositionへ通し、原因をallowlistしたOutputへ残しUIはgenericにし、corruption/ENOSPC/stale-lock/open enumerationをactual boundaryで検証すること。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | incomplete: atomic/lock/RMWはready、operation diagnostic/privacy boundaryが未完 | incomplete: corrupt/ENOSPC/concurrency/generic UI unitはreadyだがactual notifier/Output/raw-open failure testなし | incomplete: factoryはstore optionsなし、folder commandsはfeedback wrapperなし | incomplete: focused/T607 Greenは診断compositionを通さず、Host failure phaseなし | incomplete: BreakingChangesはmarker policyを記録するが残るdiagnostic gap未追跡 |

  **T610-NR-008 — Medium — open — `src/adapters/repository-files/node-repository-file-path-enumerator.ts:148`、`:239`、`test/unit/t610-folder-understanding.test.ts:187`**

  direct列挙は128件ごとにyieldし257-file fixtureは通るが、recursive `walk()`の`pending`はdirectoryごとにresetされ、128未満の多数/deep directoryを一つのdeterministic budgetとしてaccountしない。各directory末尾のremainderも`accountWorkBatch`へ報告しない。testはflat 257件と1 pruneだけでdeep/many/cancel/stale publicationを覆わない。Impactとしてexplicit/auto descendant走査がT607の最大同期work/accounting契約を満たす証拠がなく、大きな階層でHost応答性とcancel fenceが退行し得る。Required actionはrecursive queue全体で全entryを<=128にaccount/yieldし、remainder、deep/many-folder、cancel、stopped prune、stale nonpublicationをdeterministic fixtureで固定すること。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | incomplete: flat direct budgetはready、recursive global budget/remainder accountingが未完 | incomplete: 257-flatのみ。deep/many/cancel/stale fixtureなし | incomplete: T505はbounded optionsを渡すがenumeratorのrecursive gapを継承 | incomplete: T607 81/81は既存suiteで新recursive workloadを含まない | incomplete: tasks/R1は`<=128`完了扱いでgapを追跡しない |

  **T610-NR-009 — Medium — closed — `src/t305-extension.ts:860`、`test/vscode/run-extension-host.ts:61`、`test/vscode/t610-suite/index.ts:55`、`reports/issue-78-t610-normal-review-followup-r6-cleanup-20260822221743.md:34`**

  actual `activate()`がTest APIをexactly once exportし、runnerの`--t610` selectorとexported `run()`がinitial→restart→owned cleanupを実行する。R6で全phase exit 0。元reportのcomposition overclaimはR1〜R6で段階的に訂正された。Impactは解消済み。Required actionなし。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | ready: actual activationに限定Test seam | ready: selector/export/fixture ordering/teardown static contract | ready: actual extension activation、Current Context、open、snapshot、stop/resume/watcher、restart、cleanup | ready: R6 exact Host 258.4秒・exit 0 | ready: R1〜R6とtasksが失敗→原因→最終成功を正確に保持 |

  **T610-NR-010 — Low — open — `src/application/global-understanding/folder-understanding-scope-controller.ts:9`、`:11`、`:17`、`src/ui/global-understanding/global-understanding-ui-model.ts:41`、`:86`、`Design/BreakingChanges.md:3`**

  dependency/method JSDocとBreakingChangesは大幅に補完されたが、新規public `FolderUnderstandingScopeState`、`FolderUnderstandingTotal`、`FolderUnderstandingScopeSnapshot`、`GlobalUnderstandingFolderSnapshot`、`GlobalUnderstandingFolderNode`および各public fieldのidentity/state/partial契約説明がない。JSDoc required-shapeを固定するcontract testもない。Impactとしてpublic consumerがcomplete/partial、canonical identity、restart ownershipを型名だけから誤解できる。Required actionは全新規exported type/memberへ契約JSDocを追加し、public contract fixtureで固定すること。

  | Production | Test | Composition | Validation | Tracking |
  | --- | --- | --- | --- | --- |
  | incomplete: methods/dependenciesはreadyだが新規exported type/member docsが未完 | incomplete: required JSDoc/static contract fixtureなし | ready: factory docsと実配線、legacy optionalityは一致 | incomplete: build/contracts Greenはdoc completenessを検証しない。Markdownはunsupported | ready: BreakingChanges、design、R1〜R6、tasksは存在 |

## 結果

- 結果: verdict **`fail`**。T610-NR-001/002/003/009はclosed、T610-NR-004/005/006/007/008/010はopen。全50セルを`ready`または`incomplete`へdispositionし、unknown=0、unexplored=0、新規finding=0。frozen identityはHEAD/upstream `02eb90588a7c040af20b8ccc50ec12f71beb3ae9`、base/merge-base `477725632177f5c4fcbca5eb587644fdef06e4df`。本reviewは独立attestationではない。
- package/config/CI countは、設定default false、3 activation event、3 command contribution、3 mutually-exclusive Tree inline menu、`test:t610` script、CI invocationが各exactly onceでready。folder actionの`editor/context`は0件でT610-NR-005をopenに保つ。

## リスク

- 未解決のリスクまたは後続対応: open 6件を元ID/severityのまま一括修正し、partial summary/Status、Palette/editor actual command、startup/real watcher、storage Output/privacy、recursive deterministic budget、public JSDocの不足セルを追加証跡で埋めて同じreviewerへ再closureを依頼する。unit umbrella、`test:vscode-runner`、Markdown unsupported、exact-head CI pendingはpassへ変換していない。open findingがあるためfull local equivalence、独立review、exact-head CI、mergeへ進めない。

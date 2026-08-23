# Sub-agent実行レポート

## タスク

- 目的: Issue #78 / PR #83 の一度限りの全範囲 independent final review を、immutable `reviewed_implementation_head` `f868c0df16282b2a92e2ec05aa84852f891703db` に対して実施する。
- review mode: `independent_final_review`。base / merge-base は `477725632177f5c4fcbca5eb587644fdef06e4df`、range は `477725632177f5c4fcbca5eb587644fdef06e4df..f868c0df16282b2a92e2ec05aa84852f891703db`、branch は `task/issue-78-folder-understanding`、PR は #83。
- reviewer identity: `/root/issue78_independent_final`。実装、通常review、通常review finding修正のいずれにも参加していないfresh reviewerであり、本task lifecycleの exhaustive independent pass は本1回だけである。
- reserved report path: `reports/issue-78-t610-independent-final-review-20260823231629.md`。

## sub-agentを使う理由

- 実装ownerおよび通常reviewerから分離し、Issue本文、設計、全変更、直接依存、production composition、test、package / CI、tracking、normal finding `T610-NR-001`〜`011`とR1〜R16 evidenceを既存結論へ依存せず再評価するため。

## 対象範囲

- Issue #78 の「選択folderだけをGlobal Understanding算出対象へ追加し、他team folderの不要な先行算出を避ける」要求、PR #83本文、design rev6 §§11.3、16.5、16.8〜16.10、19、20、Breaking Changes、T610 tracking。
- base以後のchanged 62 pathsすべて。productionはfolder controller / stopped store / enumerator / T305 composition・activation・startup・watcher / T505 source / PR immutable provider / Tree model・runtime、direct dependenciesはworkspace URI identity、canonical repository path、background recalculator、atomic store / lock、Current Context refresh、T405 / T506 consumers。
- test、package、workflow、normal / implementation / CI / performance reports、PR / CI facts。normal finding `T610-NR-001`〜`011`はidentityとseverityを変えず、historical closureとcurrent sibling caseを独立に照合した。
- verification capabilityは `local_execution_available`。technical targetはcommitted / pushed。current f868 PR checksはcancelledであり、predecessor `05cbf830096dd90320c6a1f655f8534704aa6ff6`のpull_request CI `32643852094`だけがbuild、contracts、architecture、lint、unit、T506、T610、general VS Code Hostを含めsuccessである。`05cbf83..f868c0d`はtracking-only 2 paths。

## 対象外

- production、test、design、tracking、normal report、package、workflowの修正。findingの実装、commit、push、PR / Issue comment、review request、CI待機、merge。
- performance、test、build、lint、Extension Host、CIの再実行または待機。T607 performance workloadはrepository policyどおりlocal-onlyで、本reviewでは実行していない。
- report以外のwrite。本reviewの唯一のwriteはpre-reserved reportにある9 placeholderの置換である。

## 実行コマンド

- Skill / repository / source / test / design / tracking / report確認: `Get-Content -Raw`、`rg -n`、`Get-ChildItem`。
- immutable identity / diff確認: `git status --short --branch`、`git rev-parse HEAD`、`git merge-base`、`git log --first-parent`、`git diff --name-status/--stat/--numstat/--unified`、`git show`、read-only whitespace inspectionの`git diff --check`。
- GitHub read-only facts: `gh issue view 78 --json ...`、`gh pr view 83 --json ...`、`gh pr checks 83 --json ...`、`gh run view 32643852094 --json ...`。GitHub writeとCI waitは0回。
- performance / test / build / lint / Host / CI実行は各0回。Markdown wording gateはrepo-local `tools/lint/`、`lint:md`、focused wiringが存在しないため実行せず`unsupported`。backtick / quoteによるprose lint回避は本reportに認めない。

## 対象ファイル

- changed 62/62 pathsを確認した。production / contract: `.github/workflows/ci.yml`、`Design/BreakingChanges.md`、`doc/design/vscode-review-range-tracker-design.md`、`package.json`、`src/adapters/repository-files/node-repository-file-path-enumerator.ts`、`src/adapters/state-repository/node-folder-understanding-stopped-store.ts`、`src/application/global-understanding/`のcontroller / registry / barrel、`src/t305-*`、`src/t405-pull-request-review-runtime.ts`、`src/t505-global-understanding-source.ts`、`src/ui/global-understanding/`、`src/ui/operation-feedback/vscode-operation-feedback.ts`。
- tests: changed unit / Host / runner 11 pathsすべて。特に `test/unit/t610-folder-understanding.test.ts`、`test/unit/t610-public-api-documentation.test.ts`、`test/vscode/t610-suite/index.ts`、T506 drain、CI workflow contractを照合した。
- evidence / tracking: Issue #78 reports 29件（design / implementation / closure、normal review、R1〜R16、closure R1〜R6、CI、performance）と `tasks/tasks-status.md`、`tasks/phases-status.md`。本固定report以外は変更していない。

## 指摘事項

- finding batch: required finding 3件（High 1、Medium 2）。originはすべて本independent final review、severity reclassificationなし。normal `T610-NR-001`〜`011`のhistorical identity / severity / closure記録は変更しない。

  **T610-IFR-001 — High — restart startup-openがdurable stop復元より先にscopeをactive化し、markerを消失させる**

  - Location: `src/application/global-understanding/folder-understanding-scope-controller.ts:72`、`:80`、`:89`、`src/t505-global-understanding-source.ts:129`、`:303`、`src/t305-extension.ts:653`、`:827`、`test/vscode/t610-suite/index.ts:78`、`:93`。
  - Description / evidence: durable markerの復元は`recalculate()`内の`restore()`で初めて行う。一方Current Context dependent refreshとstartup helperは、既存open documentを`observeFileOpen()`へ渡してからrefreshする。新controllerでは`openFile()` / subtree startが先にrecordを作ってactive化し、その後の`restore()`は`records.has(folder)`を理由に同じpersisted markerをskipする。Host restart fixtureはrestart phaseでdocumentを開かずstopped-only snapshotを読むだけなので、このproduction orderingを通していない。
  - Impact: VS Code再起動時に停止folderのdocumentが復元済みなら、明示停止が自動再開されcontent readへ進む。design §§11.3 / 20.3の「restart後もstopped強調」「停止中folderのfile openは自動再開しない」というprivacy / lifecycle contractを破る。
  - Required action: ownerごとのmarker restoreを全open / explicit / auto-start mutationより前に一度だけawaitし、restore中の競合もdurable stop優先で直列化する。実production startupで、停止folderのdocumentをrestart前から開いた状態にして、default false / autoStartDescendants true双方がstoppedのままcontent readしないfixtureを追加する。

  **T610-IFR-002 — Medium — 初回start / file-open計算中の`running` rowとstop actionがpublishされない**

  - Location: `src/application/global-understanding/folder-understanding-scope-controller.ts:104`、`:111`、`:148`、`:154`、`src/ui/global-understanding/global-understanding-ui-model.ts:527`〜`:540`、`src/ui/global-understanding/vscode-global-understanding-runtime.ts:374`、`:465`〜`:469`。
  - Description / evidence: controllerはstart時にscopeを`active`、recalculate開始時に`running`へ変えるが、refresh controllerは`source.recalculate()`完了後にだけsnapshotをhostへ渡す。runtimeのcurrent node setはそのpublication時にしか更新されないため、初回の長いexplicit subtree startやfile-open中は旧`inactive/start` rowまたはrowなしのままであり、expected-action fenceがstop commandを拒否する。
  - Impact: design §11.3 / §16.5が要求するrunning spinnerとrunning中stop / cancellationを初回計算で操作できず、大きいsubtree scanを完了まで止められない。
  - Required action: I/O開始前にcurrent-generation `running` snapshotと`stop` actionをpublishするか、pending generationをowner-bound typed targetとしてruntimeへ公開し、初回計算中もsame rowからstopできるようにする。actual providerでstartを未完のまま止め、AbortSignal、stale nonpublication、generic feedbackを確認する。

  **T610-IFR-003 — Medium — durable marker削除失敗後もresumeのin-memory stateが進行する**

  - Location: `src/application/global-understanding/folder-understanding-scope-controller.ts:131`〜`:143`、`src/t505-global-understanding-source.ts:372`、`test/unit/t610-folder-understanding.test.ts:464`〜`:502`。
  - Description / evidence: `resume()`は`explicitStop=false`、`state=running`、generation incrementを行ってから`persist(remove)`をawaitする。ENOSPC / EACCES等でpersistがrejectしてもrollbackせず、後続manual / watcher refreshはそのscopeをactiveとして計算できる一方、durable markerは残る。既存failure fixtureはgeneric rejection / redactionだけをassertし、controller stateと後続publicationを確認しない。
  - Impact: UIがresume失敗を通知した後に同sessionだけ停止が解除され、restartで再びstoppedへ戻る。durability failureを成功stateへ変換し、failure / restart semanticsを不整合にする。
  - Required action: marker mutation成功をstate / generation transitionのcommit pointにするか、失敗時に全descendant state・explicit flag・generationを原子的にrollbackする。actual compositionでwrite failure後のactiveFolders、snapshot、watcher、restartがstoppedを維持することを固定する。

- Normal finding closure audit: NR-001、004〜006、008、010、011はcurrent production / tests上closedを維持。NR-002 / 003 / 009は復元後のancestor stop・stopped-only restart・Host pathを満たすがIFR-001のrestore-before-open sibling caseを欠く。NR-007はatomic / lock / redacted failure adapterを満たすがIFR-003のtransactional state rollback sibling caseを欠く。これはhistorical findingのsilent reopen / severity変更ではなく、新しいindependent findingである。

## 検証結果

- Coverage dispositions: requirement / design conformance=`checked_finding`、correctness / edge cases=`checked_finding`、scope discipline=`checked_no_finding`、changed files / direct dependencies=`checked_finding`、API / data / configuration / workflow / compatibility=`checked_no_finding`、error handling=`checked_finding`、security / privacy=`checked_finding`、tests / validation adequacy=`checked_finding`、current-head CI=`held`、report / tracking accuracy=`checked_finding`、regression / maintainability=`checked_no_finding`。
- Evidence assessment: predecessor `05cbf83` exact-head PR CI `32643852094`はsuccessで、f868はtracking-only delta。ただしf868のcurrent pull_request / push checksはcancelledでありexact-head Greenへ読み替えない。CIはIFR-001のrestart-with-open-documentとIFR-002のin-flight UI stopを含まず、Greenはfindingを反証しない。
- Held: `H001` Markdown wording gateはrepository wiring不在で`unsupported`（nonblocking）。`H002` f868 exact-head CIはcompleted Green evidenceなし。local routeではpre-review CI必須ではないが、passing attestation headを公開した後のrequired pull_request CIは別のmerge gateである。T607 performanceはlocal-only policyかつ実行禁止のため`not_applicable`で、pass / heldへ変換しない。
- unknown=0、blocked=0、unexplored=0。intentionally untouchedはproduction、test、design、tracking、normal reports、package、workflow、PR metadata。remaining riskはfinding 3件そのものと、修正後targetに対するroute-appropriate validation / normal fix verification / same independent reviewer bounded closureが未実施であること。

## 最終結果

- Verdict: **`fail`**。required finding 3件があるため`pass` / `pass_with_held`ではない。technical verdictは`reviewed_implementation_head` `f868c0df16282b2a92e2ec05aa84852f891703db`にだけ適用する。
- independent lifecycle: initial independent reviewed HEADは`f868c0df16282b2a92e2ec05aa84852f891703db`、closure reviewed HEAD chainは空、finding completeness matrixは未作成。修正が必要なためterminal stateをinvalidateし、implementation、route-appropriate validation、report / tracking同期、normal fix verificationへ戻す。その後、同じindependent reviewerだけがIFR-001〜003とCI deltaに限定したclosureを行い、新しいexhaustive criteriaは追加しない。
- `report_attestation_allowed: false`。本fail reportをf868のadministrative attestationとしてcommitしてはならない。passing bounded closure後にのみ再判定する。
- 将来attestationを許可する厳密条件: passing closureの`reviewed_implementation_head`直後にcommitはちょうど1件、first parentはそのreviewed implementation HEAD、changed pathは事前予約したindependent-final-review report pathだけ、reportはtechnical verdictの対象HEADとadministrative attestationであることを明記し、executable / Skill / design / workflow / configuration / task-tracking / feedback / handoff / product pathを変更しない。attestation SHAはcommit後にbranch外のPR metadataへ記録し、その後のGit commitまたはrepository-writing Skill実行は一切不可。parent mismatch、report以外のpath、2件目またはlater writeがあればcompletionを無効化し、normal fix verificationとsame-reviewer finding / CI-delta closureへ戻る。
- commit / push / PR write / mergeは未実施。次actionはIFR-001〜003を一batchでtracked implementationへ戻すことであり、本reportはmergeを許可しない。

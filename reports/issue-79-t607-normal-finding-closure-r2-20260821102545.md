# T607 normal finding closure R2 report

## タスク

T607 / Issue #79 / PR #80 の同一normal reviewer `/root/t607_normal_review`によるfinding-limited closure R2。前回closure対象HEAD `0c57486bb08d8e096be971c7c3c58e26415857bd`からcurrent fix HEAD `753093eb2ba3cd98d25f54fa6aaaeca3425e15c6`までのdeltaだけを、既存open findings `T607-R001`、`T607-R003`、`T607-R004`、`T607-R006`のrequired actionへ照合した。severityは保存した。

## sub-agentを使う理由

sub-agentは使用していない。同一reviewer continuityとfinding-limited closureの制約に従い、このreviewerがopen four findingsを一括照合した。

## 対象範囲

authoritative source `reports/issue-79-t607-normal-finding-closure-20260821101037.md`、follow-up report `reports/issue-79-t607-normal-review-followup-20260821143000.md`、およびrange `0c57486bb08d8e096be971c7c3c58e26415857bd..753093eb2ba3cd98d25f54fa6aaaeca3425e15c6`のうちopen four findingsへ直接関係する変更を確認した。provided local evidenceは`test:t607` 68 pass / 0 fail、build、contracts、lint、architecture positive/negative、diffcheckのpassであり、再実行していない。unexplored: none within the fixed finding scope。

## 対象外

`T607-R002` Highと`T607-R005` Mediumはclosed maintainedであり再reviewしていない。新規観点、新規finding、sibling exploration、severity変更、full review、implementation/tracking/branch/commit/PR/GitHub変更、test/build/lint/CIの起動・再実行・待機は対象外。exact-head `pull_request` CIはheldであり、local evidenceをCI成功へ読み替えない。Markdown wording toolingはrepository wiring不在のためunsupported heldとした。

## 実行コマンド

`git rev-parse HEAD`、`git status --short --branch`、`git log`、`git diff --stat`、`git diff --name-status`、finding対象pathの`git diff`、`Get-Content`、`rg`、`rg --files`、`Test-Path`によるread-only inspectionだけを実行した。test、build、lint、architecture validation、CI、GitHub操作は実行していない。

## 対象ファイル

Global Tree model/runtime、normal editor decoration controllerとextension composition、T607 workload test、README、tasks/phases、handoff、前回closure report、follow-up reportを確認した。R003ではGlobal runtimeのrefresh owner、partial Tree publication、open controller、status、invalidate/dispose経路を、R004ではdocument descriptor/hash、state load、interval model、controller projection、decoration options、applied-decoration copy、host applyを追跡した。

## 指摘事項

- **T607-R001 — High — closed.** `src/ui/global-understanding/global-understanding-ui-model.ts:209-234,325`はopen-target validationを同じitem budgetとgeneration fenceへ移した。stage modelはprepared prefix arrayをそのままretainし（同:354-356）、complete modelもsorted arrayをretainする（同:362-363）ため、前回指摘した`createTreeModel`内の二重copyは除去された。`test/unit/t607-performance-incremental-ui.test.ts:102-127`はactual 10,000-file build、128-item accounting、全published modelのinput-array identityを固定し、provided 68/68 evidenceを受領した。Required action: none。
- **T607-R003 — High — open.** `test/unit/t607-performance-incremental-ui.test.ts:143-198`はproduction VS Code runtimeで一度partial publishした直後に同じcallback内で`invalidate()`と`dispose()`を連続実行し、abort、stale open rejection、status非発行を確認する。しかし前回required actionのnew context/old-new concurrent refreshを起動しておらず、invalidateとdisposeを独立したlifecycleとしても区別せず、T606 operation feedbackのterminal completion回数もassertしていない。Required action: production runtime compositionでpartial publish後のnew/current refreshとold refreshを並行させ、old generationだけがabort・非publishとなりnew generationがterminal presentationを一度完結すること、invalidate-onlyとdisposeを独立に固定すること、operation feedback terminal lifecycleが一度だけ完結することをassertする。
- **T607-R004 — High — open.** productionはfull document textの同期hashを`src/extension.ts:401-429`で実行し、同期interval modelを同:469で作成する。optionsだけは同:212以降で128件ごとにyieldするが、その後の`appliedDecorations`全件clone（同:502-505）は同期で、controllerのconfigurable budgetとも共有されない。追加test `test/unit/t607-performance-incremental-ui.test.ts:302-358`はfabricated `contentHash`を持つfake editor/host上でdescriptorを組み立て、同期`createNormalEditorDecorationModel`と同期options `map`を実行するため、actual `toDocumentDescriptor`/`stableHash.digest(document.getText())`またはproduction `toDecorationOptions`/VS Code applyを通らない。Required action: document descriptor/hash、interval model、options projection、applied-decoration bookkeeping、host applyのactual production pathを同一のdeterministic budgetまたは同等のbounded contractへ収め、large document、2,048 intervals、split visible editor、supersessionをproduction composition経由でassertする。
- **T607-R006 — Low — closed.** README `README.md:26`、handoff `handoffs/issue-79-t607-implementation-20260821094238.yaml:7-31`、tasks `tasks/tasks-status.md:12-18`と`tasks/phases-status.md:40-41`、follow-up report `reports/issue-79-t607-normal-review-followup-20260821143000.md:5,29-33`はinitial `a695806...`、committed initial fix `0c57486...`、historical failed CI、R002/R005 closed、R001/R003/R004/R006 follow-up、current-head CI held、same-reviewer next actionを区別して記録した。当R2 reportがreviewed current fix HEAD `753093eb2ba3cd98d25f54fa6aaaeca3425e15c6`と最新dispositionを記録する。Required action: none。

## 結果

**Verdict: FAIL.** `T607-R001` closed、`T607-R003` open、`T607-R004` open、`T607-R006` closed。`T607-R002`と`T607-R005`はclosed maintainedかつout of re-review。open four findingsを一括dispositionし、severity変更および新規findingはない。provided local evidenceは受領したが、R003/R004のrequired actionが未完了である。exact-head `pull_request` CIとMarkdown wording toolingはheld。unexplored: none within the fixed finding scope。

## リスク

残存riskは、Global partial publication後のold/new concurrent refresh、invalidate-only/dispose、operation-feedback terminal lifecycleがproduction compositionで未固定であることと、large document hash、interval model、applied-decoration bookkeepingを含むactual decoration pipelineの同期workが明示budget外に残ることである。exact-head `pull_request` CIは未起動・未確認のmerge gateとしてheld。Markdown wording checkはunsupported held。当reportはnormal fix-verification用repository fileであり、implementation HEAD `753093eb2ba3cd98d25f54fa6aaaeca3425e15c6`を変更しない。

# T607 normal finding closure R3 report

## タスク

T607 / Issue #79 / PR #80 の同一normal reviewer `/root/t607_normal_review`によるfinding-limited closure R3。closure R2 reviewed HEAD `753093eb2ba3cd98d25f54fa6aaaeca3425e15c6`からcurrent fix HEAD `e336de3be55f3ac520475464307be7c3a2475b38`までのdeltaだけを、既存open findings `T607-R003`と`T607-R004`のrequired actionへ照合した。severityはHighのまま保存した。

## sub-agentを使う理由

sub-agentは使用していない。同一reviewer continuityとfinding-limited closureの制約に従い、このreviewerが二findingを一括照合した。既存untracked R2 reportは変更していない。

## 対象範囲

authoritative source `reports/issue-79-t607-normal-finding-closure-r2-20260821102545.md`、follow-up evidence `reports/issue-79-t607-normal-review-followup-20260821143000.md`、およびrange `753093eb2ba3cd98d25f54fa6aaaeca3425e15c6..e336de3be55f3ac520475464307be7c3a2475b38`のR003/R004関連変更を確認した。provided evidenceはvalid Red 69 pass / 1 fail後の`test:t607` 70 pass / 0 fail、build、contracts、lint、architecture positive/negative、diffcheckのpassであり、再実行していない。unexplored: none within the fixed finding scope。

## 対象外

`T607-R001`、`T607-R002`、`T607-R005`、`T607-R006`はclosed maintainedであり再reviewしていない。新規観点、新規finding、sibling exploration、severity変更、full review、implementation/tracking/branch/commit/PR/GitHub変更、validation/CIの起動・再実行・待機は対象外。exact-head `pull_request` CIはheldであり、local evidenceをCI成功へ読み替えない。Markdown wording toolingはrepository wiring不在のためunsupported heldとした。

## 実行コマンド

`git rev-parse HEAD`、`git status --short --branch`、`git log`、`git diff --stat`、`git diff --name-status`、finding対象pathの`git diff`、`Get-Content`、`rg`、`Get-FileHash`、`Test-Path`によるread-only inspectionだけを実行した。test、build、lint、architecture validation、CI、GitHub操作は実行していない。

## 対象ファイル

R003についてproduction Global runtime composition testと既存Global runtimeのrefresh/invalidate/dispose/open/operation-feedback経路を確認した。R004について`NodeSha256StableHash`、extensionのdescriptor/hash、state load、normal decoration model、controller projection、options projection、applied-decoration bookkeeping、host apply、およびlarge-document/split-editor fixturesを確認した。follow-up report、handoff、tasks/phasesは対象identityとprovided evidenceの整合だけを確認した。

## 指摘事項

- **T607-R003 — High — closed.** `test/unit/t607-performance-incremental-ui.test.ts:204-265`はproduction VS Code Global runtimeを通し、old/new concurrent refreshでold ownerだけをabortしcurrent Treeをpublishする。さらにinvalidate-only（同:246-254）とdispose（同:255-260）を別のin-flight refreshで固定し、invalidate後のstale node open rejectionと、refresh四回およびstale-node commandを含むshared operation-feedback start/terminal一対一（同:261-264）をassertする。前回partial-publish fixtureと併せ、R2 required actionを満たす。provided Red 69/1とGreen 70/70を受領した。Required action: none。
- **T607-R004 — High — open.** production hashは`src/adapters/crypto/node-sha256-stable-hash.ts:20-41`と`src/extension.ts:431-436`で65,536-character budgetへ移り、options projectionとapplied-decoration copyは同じconfigurable 128-item budgetを使用する（`src/extension.ts:218-232,521-532`）。しかしstate load後の`createNormalEditorDecorationModel`は依然として一回の同期呼出し（同:491-496）であり、2,048 intervalのvalidation、normalization、intersection/subtraction、decoration build、final sortは`src/application/editor-decoration/normal-editor-decoration-model.ts:68-83,129-153,236-336`でyield/generation fenceなしに完了する。retained fixture `test/unit/t607-performance-incremental-ui.test.ts:367-424`もfake host内でこのmodelとoptions `map`を同期実行し、actual extension descriptor/options/applied-copy/VS Code apply compositionを通らない。追加large-document fixture（同:426-435）はproduction SHA-256 adapter単体だけを固定する。したがってR2 required actionのinterval modelを含むactual end-to-end deterministic budgetは未完了。Required action: interval validation/normalization/projection/sortを同じgeneration-aware item budgetへ移し、large document、2,048 intervals、split visible editor、supersessionがactual extension compositionのhash→state→model→options→bookkeeping→single current host applyを通ることをassertする。

## 結果

**Verdict: FAIL.** `T607-R003` closed、`T607-R004` open。`T607-R001`、`T607-R002`、`T607-R005`、`T607-R006`はclosed maintainedかつout of re-review。二findingを一括dispositionし、severity変更および新規findingはない。provided evidenceは受領したが、R004 required actionが未完了である。exact-head `pull_request` CIとMarkdown wording toolingはheld。unexplored: none within the fixed finding scope。

## リスク

残存riskは、多数intervalのnormal decoration modelがExtension Hostを同期占有し、supersessionがmodel完了後まで観測されないこと、およびactual extension end-to-end fixtureがこの段階を回帰固定していないことである。exact-head `pull_request` CIは未起動・未確認のmerge gateとしてheld。Markdown wording checkはunsupported held。当reportはnormal fix-verification用repository fileであり、implementation HEAD `e336de3be55f3ac520475464307be7c3a2475b38`を変更しない。

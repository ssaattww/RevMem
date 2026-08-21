# T607 normal review follow-up report

## タスク

Issue #79 / PR #80 のsame reviewer closure R2はcommitted HEAD `753093eb2ba3cd98d25f54fa6aaaeca3425e15c6`でR001/R002/R005/R006をclosedとし、R003/R004だけをopenとした。本追補はこの二findingのrequired actionだけを扱う。

## sub-agentを使う理由

initial normal reviewとは独立したimplementation workerが、reviewerの六つの既存findingだけを修正した。self-review verdictは出さず、closureはinitial reviewと同じreviewerがfinding IDを限定して行う。

## 対象範囲

`T607-R003`はproduction VS Code Global runtimeでold/new concurrent refresh、old owner abort、invalidate-only、dispose、stale node open rejection、shared operation feedbackのstart/terminal一対一を固定した。`T607-R004`は実production `NodeSha256StableHash`へlarge documentの65,536-character checkpointを追加し、extensionのdescriptor hash、options projection、applied-decoration copy、host applyを128-item work budgetで同じsupersession fenceへ接続した。既存R004 split editor/2,048 interval fixtureは保持する。

## 対象外

new review finding、独立review、exact-head CI、Extension Host E2E、commit、push、PR更新、mergeは対象外である。100msはmachine依存のwall-clock gateではなく、128 item/rangeの決定的work budgetであり、実remote serviceのbenchmarkは実施していない。Markdown wording checkerはrepository tooling不在のためunsupportedである。

## 実行コマンド

R003 production-feedback fixtureの初回Redは`npm run test:t607`で70件中1件fail（feedback start数はstale-node commandを含む5であり、初期想定4を訂正）を観測した。assertionを実operation境界へ合わせたGreen `npm run test:t607`は70 pass / 0 fail。`git diff --check`、`npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`はexit 0（negative architectureは期待どおり11 violations）。CIは起動・待機していない。

## 対象ファイル

PR Progress production runtime/provider、Global UI model/runtime、normal-editor controller/export、extension host、T607/normal-editor tests、Design、README、tasks/phases、handoff、当reportを変更した。T301 calculator、state persistence format、public configuration、CI workflowは既存contractを維持し、T607 focused commandの既存wiringを再利用した。

## 指摘事項

R001/R002/R005/R006はsame reviewer closure R2でclosed済みであり再変更していない。R003はproduction lifecycle/feedback composition、R004はproduction hash と decoration pipeline budgetを追加実装した。severityはinitial reportから変更しない。closure verdictはimplementation ownerにはないためpendingである。

## 結果

closure R2 HEAD `753093e`のfactsを同期した。current worktreeにはR003/R004 follow-upの未commit changesがあり、focused Green 70 passを取得した。same normal reviewerはR003/R004だけをclosure確認し、新しい観点・findingを追加しない。current-head CI evidenceは存在しない。

## リスク

descriptor/hashとdecoration model内部は既存同期contractを保つため、巨大documentの実測はadvisoryのままである。abortを尊重しないstate providerは中断できなくても、post-load/model/copy/apply fenceによりstale outputをapplyしない。PR Treeはpartial treeをpublishせず前のcomplete projectionを維持するため、長いpreparation中は旧表示が残る。exact-head CIとindependent reviewは未実施である。

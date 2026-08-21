# T607 independent-final-review follow-up report

## タスク

Issue #79 / PR #80 の独立final review finding `T607-IFR001`〜`T607-IFR006` を、reviewed implementation HEAD `c4a99db2bf24286cd39e98efdceeaa9c1cd7a6c3`から同一batchで修正する。独立review reportは`reports/issue-79-t607-independent-final-review-20260821110000.md`として歴史的証跡を保持する。

## sub-agentを使う理由

implementation owner `/root/t607_ifr_fix` はreview findingの修正だけを担当し、verdictを出さない。次は同一normal reviewerによるfinding-limited closureであり、新しいreview観点の追加は許可しない。

## 対象範囲

IFR001はPR Progress runtimeのactual schedulerとgeneration fence、IFR002はGlobal source/recalculatorの128-item yieldとAbortSignal、IFR003はnormal editorのtext/version snapshotとdocument-change invalidation、IFR004はproduction decoration scheduler、IFR005はUnicode SHA-256 chunk boundary、IFR006はREADME/tasks/phases/handoff/report provenanceを対象にする。

## 対象外

独立review、CI開始・待機、PR/Issue更新、commit、push、merge、新規product scope、historical reportの書換えは行わない。Markdown wording lintはrepository wiringがないためunsupportedのままとする。

## 実行コマンド

`npm run build`、`npm run test:t607`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check`を各一回実行した。結果はbuild成功、focused test 74 pass/0 fail、lint成功、architecture positive成功、negative expected 11、diffcheck成功である。

## 対象ファイル

`src/core/pr-progress/`、`src/t405-pull-request-review-runtime.ts`、`src/t505-global-understanding-source.ts`、`src/application/global-understanding/global-understanding-background-recalculator.ts`、`src/extension.ts`、normal-editor controller、SHA-256 adapter、T607 workload test、README、tasks/phases、handoff、independent review reportを更新した。

## 指摘事項

- `T607-IFR001`: runtimeはactual `setImmediate` scheduler、128-itemのPR file/hunk/line validation、interval normalization/count/projection、AbortSignal/current-generation fenceでTree swap前のstale requestを拒否する。
- `T607-IFR002`: Global candidate/evidence/open-target/aggregateを128件でyieldし、source→recalculatorへAbortSignalを伝播し、cache mutation/publish前後でcurrent ownerを再確認する。calculation defaultは128へ縮小し、repository-sized state deep copyを除去した。Review Contextsはsaved context/progress準備を128件でstage化した。
- `T607-IFR003`: descriptorは同じTextDocumentのtext、lineCount、version snapshotを束縛し、hash後もversionを確認する。document eventは該当visible editor requestをabort/invalidateする。
- `T607-IFR004`: normal-editor default schedulerはreal event-loop boundaryへ変更し、document line fragment hash、current PR diff、model、option、bookkeeping、host applyは同じ128-item generation fenceを共有する。
- `T607-IFR005`: SHA-256 cooperative chunkはsurrogate pairを分断せず、65,535/65,536/65,537境界のUnicode regressionでcanonical digestとの等価を固定した。
- `T607-IFR006`: historical normal reportsは変更せず、current independent failure/follow-up stateへREADME、tasks/phases、handoffを同期した。

## 結果

実装・focused local validationはGreenである。normal reviewerはIFR001〜IFR006だけをfinding-limitedで検証する必要がある。exact-head CIはまだheldであり、local evidenceをCI成功へ読み替えない。

## リスク

final commit SHAは親のcommit後に確定するため、このreportはpre-commit follow-up evidenceである。VS Code hostの実測は環境依存のadvisory evidenceであり、deterministic 128-item contractを代替しない。CIとMarkdown wording toolingはheld/unsupportedのままで、merge authorizationではない。

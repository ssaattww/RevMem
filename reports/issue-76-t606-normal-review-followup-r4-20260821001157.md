# T606 normal review follow-up R4 report

## タスク

T606 / Issue #76 / draft PR #77 の R4 finding follow-up。開始 HEAD は `c98ac7a13b712bcaca1156f13dcdad242ed115df`、R001〜R005/R007 の未commit修正を same normal reviewer closure へ渡す。R006 は `closed` 維持。

## sub-agentを使う理由

使用しない。依頼により sub-agent、CI、commit、push、review は禁止である。

## 対象範囲

Review Contexts/Current Context/Global/PR Progress のgeneration lifecycle AbortController、Review Contextsのold/new distinct publication fence、T405のpure acquisitionとstate mutation/publicationの分離、explicit `OperationFeedbackContext` のdiagnostic/storage callback伝播、T402 GitHub diff acquisition と T405 lifecycle のdirect focused wiring、R4 evidence/tracking同期を実施した。

## 対象外

R006 の再探索、新規 finding、PR更新、exact-head CI、Extension Host acceptance、commit、push、merge は対象外。Markdown word check は wiring 不在のため `unsupported`。

## 実行コマンド

Red: `npm run test:t606` は old root load が abort されない新規 direct provider test で失敗。Green: `npm run test:t606` は **175 pass / 2 Windows POSIX skip / 0 fail**。`npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check` はすべて pass。CI は起動していない。

## 対象ファイル

`src/ui/review-contexts/vscode-review-contexts-runtime.ts`、`src/t405-review-contexts-runtime.ts`、`src/ui/current-context/`、`src/ui/global-understanding/`、`src/t405-pull-request-review-runtime.ts`、`src/t305-extension.ts`、`src/t505-global-understanding-source.ts`、`test/unit/t606-failure-policy-retry-diagnostics.test.ts`、`package.json`、`test/unit/ci-workflow-contract.test.ts`、当 report、README/tasks/phases/handoff。

## 指摘事項

R001/R002: `ReviewContextsTreeProvider` は新 refresh 前、clear、dispose で前 controller を abort し、signal を production `source.load` へ渡す。T405 source は awaited owner/state/progress step ごとに abort を確認し、superseded root は stale item を publish しない。direct test は old `stale` と new `fresh` を区別して signal aborted と final tree を assert する。

R003/R004: `OperationFeedbackContext` はReview Contexts production registrationからsource、PR progress、cache storage diagnostic callbackへ明示的に渡す。nested child failureは親の一 terminalへjoinし、independent operationは別 lifecycleのまま維持する。T405 refreshはretryableなephemeral remote/cache acquisitionだけをretryし、同期state mutationとtree publicationは一回だけ行う。side-effect commandは一回だけ実行される。

R005: `test:t606`/CI contract へ actual `t402-pr-diff-acquisition.integration` と `t405-github-lifecycle` を必須追加した。GitHub patch 404、incomplete patch の exact content fallback、network/rate-limit lifecycle failure、immutable identity、PR state transition を production adapterで直接実行する。

R007: R4 は addressed だが reviewer closure pending、reviewed technical head は commit前、PR/CI は未実施と同期する。closure pending を closed と表記しない。

## 結果

R001〜R005/R007 の R4 local action と direct evidence は addressed。normal reviewer の finding-limited closure は pending。R006 は closed maintained。CI、commit、push、review、merge は未実施。

## リスク

未commit差分、exact-head CI/real Extension Host 未取得、Markdown check unsupported が残る。Abort は source port に伝播するが、外部依存が signal を尊重しない場合は generation fence が最終 publication を防ぐ。次 action は同一 normal reviewer に R001〜R005/R007 の closure を依頼すること。

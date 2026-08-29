# Sub-agent実行レポート

## タスク

- 目的: exact-head CI `33248295249`で失敗したT405構造契約testを、R2 shared detection構造へ追従させる。
- タスク種別: CI finding implementation follow-up

## sub-agentを使う理由

- 理由: ユーザー指定のTerra/high実装者が、CI failureをtest-onlyの0.5h単位でRed→Green修正するため。

## 対象範囲

- 対象: `test/unit/t405-github-lifecycle.test.ts`のR405-1静的契約、直接参照する`src/t405-review-contexts-runtime.ts`、exact-head CI `33248295249`。

## 対象外

- 対象外: production、design、workflow、performance、PR #91全体、private repository、Extension Host、merge。

## 実行コマンド

- 実行コマンド: `npm run test:t405`（RedとGreenを各1回）、`node --test test-dist/test/unit/t407-private-pr-context.test.js`、`npm run build`、`npm run lint`、`git diff --check`

## 対象ファイル

- 対象ファイル: `test/unit/t405-github-lifecycle.test.ts`、`src/t405-review-contexts-runtime.ts`（確認のみ）、本report

## 指摘事項

- 指摘事項: CI `33248295249`のR405-1 failureは、R2でexisting-PR revision updateが`redetectPullRequest`からshared `detectPullRequest`へ移動した後も旧lexical assertionがredetect block内だけを探索していたことが直接原因だった。testはshared detection内の`await contextStateService.update(`と、public redetectが`await detectPullRequest(local, feedbackContext);`後に`await options.refreshCurrentContext();`する順序の二条件へ置換した。単なるsource全体のstring presenceには弱めていない。

## 結果

- 結果: 約10分。Red: 初回`test:t405`は50/52、CI対象R405-1 lexical assertionと非因果R405-7 selected-PR session fixtureがfail。Green: 修正後R405-1はpass、`test:t405`は51/52（R405-7のみ継続fail）、T407 11/11、build、lint、diff checkはGreen。production/design/workflow/package/performance変更なし。開始・終了HEADは`0a4b041262925743cff48c4e39e03b53a039d917`で不変。

## リスク

- リスク: full/default/Extension Host/CI wait/performanceは指示により未実行。local `test:t405`のR405-7 `selected PR owns normal-editor command and decoration sessions without branch initialization` failureは`DocumentReviewStateSessionProvider.openSelectedPullRequest`のactive-editor ownership errorであり、R405-1 assertion変更・CI failureとは非因果としてheld。exact-head CI再実行は親のcommit/push後に必要。Markdown focused lintはrepo `tools/lint`/`lint:md`不在のためunsupported（設定変更なし）。

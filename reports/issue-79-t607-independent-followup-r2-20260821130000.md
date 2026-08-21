# T607 independent finding follow-up R2

## タスク

IFR001、IFR002、IFR003、IFR004、IFR006の同一batch follow-up。

## sub-agentを使う理由

implementation ownerはfixだけを担当し、同一normal reviewerがfinding-limited closureを行う。

## 対象範囲

PR runtime、Global source/recalculator、Review Contexts、normal editor command/decoration、current trackingに加え、IFR001〜IFR004を実production/composition経由で再現する決定的回帰fixtureを追加した。

## 対象外

IFR005、CI、commit、push、PR、review、merge、新規scopeは対象外。

## 実行コマンド

Red: `npm run test:t607` は新規fixtureの型境界とPR status matrix不整合で失敗した。Green: 同コマンドは78 pass/0 fail。`npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`（expected 11）、`git diff --check`はいずれも一度だけ成功した。CIは実行していない。

## 対象ファイル

PR progress runtime/calculator、Global source/recalculator、Review Contexts runtime、normal editor command/model、extension、T607 focused fixture、README/tasks/phases、reports/handoff。

## 指摘事項

IFR001はactual `PullRequestReviewRuntime.activateProgress`でpersisted projection、10,000 line、reverse supersession、単一current Tree swap、unrelated persisted state非所有を固定した。IFR002はactual T505 source/recalculatorとReview Contexts Tree providerでlarge repository/saved contexts、abort後のstale nonpublication、owner-scoped publish一回を固定した。IFR003はshared command session loaderを抽出し、同一line count editをdescriptor/session/commit各境界へ注入してstale commit 0を固定した。IFR004はactual decoration activationでUnicode target、2,048 intervals、split editor、supersession、host apply、128-item budgetを固定した。IFR006はcurrent stateをR2 evidenceへ同期した。

## 結果

local focused/static evidenceはGreen。次はIFR001〜IFR004/IFR006だけを対象にした同一independent reviewerのfinding-limited closureであり、CIはheldである。

## リスク

technical/admin headは親のcommit後に確定する。fixtureは決定的work budgetを検証し、wall-clock 100msはadvisory measurementのままである。Markdown wording toolingはunsupportedで、merge authorizationではない。

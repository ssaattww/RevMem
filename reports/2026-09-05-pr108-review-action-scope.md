# PR #108 レビュー対応範囲 — 2026-09-05

## 1. 目的

PR #108 の独立レビュー結果について、利用者の運用方針に従い、次の修正ラウンドで**対応必須とする項目だけ**を明確化する。

- 実際の製品動作・ユーザー体験に影響する問題を優先する。
- 過剰な品質要求は行わない。通常運用で月に1度も起こり得ない程度の極端なケースだけを理由に追加実装を要求しない。
- 開発プロセス、PR本文、report整備だけの問題は、製品不具合として修正要求しない。
- 本reportは既存の独立レビューreportを削除・改変せず、**次の実装修正でのauthoritativeな対応範囲**を追記するものである。

## 2. 対象

| 項目 | 値 |
| --- | --- |
| Repository / PR / Issue | `ssaattww/RevMem` / #108 / #106 |
| Branch | `codex/pr94-ci-006-global-three-way` |
| Reviewed implementation HEAD | `0e15ac16809af71bba09694453e7a665c7c452a1` |
| Existing independent review report | `reports/2026-09-05-pr108-independent-final-review.md` |
| Scope decision | 利用者指示により製品影響のある3件へ限定 |
| Merge | 実施しない |

## 3. 対応必須

### PR108-ACTION-001 — P1 — owner state公開後のhistory途中失敗で永続状態が部分化し得る

**対象:** `src/t405-owner-pull-request-synchronization.ts`

`commitRepository(...)` によるowner stateの公開が完了した後、`revisionUpdates` のhistoryを1件ずつ `recordPreparedUpdateHistory(...)` している。複数Contextを更新するケースで、先行historyの記録後に後続historyが失敗すると、owner stateは新generationとして公開済みだがhistoryは一部だけ記録された状態になり得る。

これは単なるテスト品質ではなく、永続化されたstateと監査/historyの不整合を製品上に残す可能性があるため対応必須とする。

**必要な対応:** owner publicationと複数historyの整合性を保証する。実装方式は限定しないが、途中失敗後に「新owner state + 一部history」の状態を恒久的に残さないこと。

**最低限の回帰:** 2件以上のrevision updateを準備し、1件目のhistory記録成功後に2件目を失敗させる。失敗・再試行を含め、state/historyの整合性契約が維持されることを確認する。

### PR108-ACTION-002 — P1 — actual T405 production compositionの回帰検証になっていない

**対象:** `test/unit/issue-106-t405-owner-synchronization.test.ts` およびT405 production composition関連fixture

owner atomic behaviorの主要テストは `synchronizePullRequestOwner(...)` を直接呼び出している。また、`Issue #106 T405 production runtime delegates explicit PR synchronization to the owner synchronization boundary` は `src/t405-review-contexts-runtime.ts` を文字列として読み、`synchronizePullRequestOwner` / `commitRepository` の存在や旧single-context commit呼出しの不在を正規表現で確認している。

このため、production registration / command compositionからowner synchronization、repository publicationまでの実配線が壊れても、文字列条件を満たす限り検出できない。Issue #106が要求するactual T405 composition regressionとしては不足しており、製品経路の回帰を見逃すため対応必須とする。

**必要な対応:** 実際のT405 production compositionを使用するfixtureで、複数PR Contextの同期がowner境界を通り、1 owner CASでContext群とGlobalへ反映されることを検証する。単なるsource text検査をactual compositionの代用にしない。

**最低限の回帰:** 同一repository ownerに2つ以上のPR Contextを構成し、production registration / command経路から同期を実行して、両ContextとGlobalの結果、およびowner publication回数を検証する。

### PR108-ACTION-003 — P3 — ユーザー向け日本語エラーメッセージの文字化け・誤字

**対象:** `src/t405-review-contexts-runtime.ts`

reviewed implementation HEADには次のユーザー向け文言が存在する。

- `対豈PRのローカルGitリポジトリを解決できません。`
- `PR cacheを更新できませんでした: live取得結果をcacheほ保存できませんでした。`

それぞれ少なくとも `対象PR`、`cacheへ保存` を意図した文言と考えられ、ユーザーへ直接表示されるため製品不具合として対応する。

**必要な対応:** 正しい日本語へ修正し、同じメッセージが再度崩れないよう既存テストまたはfocused testで確認する。

## 4. 今回の修正要求から除外するもの

既存独立レビューreportに記録されたその他の観点・指摘は履歴として保持するが、**本修正ラウンドの必須対応にはしない**。特に、製品動作を直接変えないreport/PR metadata等のプロセス品質だけを理由とした修正は要求しない。

また、通常運用で極めて発生しにくいケースに対する追加防御だけを目的とする実装は行わない。上記3件を直すために必要な範囲を越えて設計・実装を広げないこと。

## 5. 完了条件

次の3件すべてについて、実装担当がrequired action、production path、actual composition fixture、focused evidenceを提示し、通常review/fix verificationで確認できる状態にする。

1. `PR108-ACTION-001`: state/historyの部分永続化を残さない。
2. `PR108-ACTION-002`: actual T405 production compositionでowner同期経路を検証する。
3. `PR108-ACTION-003`: ユーザー向け日本語メッセージを修正する。

上記以外を追加のrelease blockerとはしない。
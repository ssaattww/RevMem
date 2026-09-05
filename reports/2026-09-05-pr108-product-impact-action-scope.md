# PR #108 製品影響ベースのレビュー対応範囲 — 2026-09-05

## 1. 位置付け

本reportは既存の独立レビューreportおよび対応範囲reportを**更新・削除せず、新規reportとして追加**する。

PR #108 の正式な独立レビュー `pullrequestreview-5120896273` には P1 4件、P2 3件が記録されている。その後の対応範囲整理で3件へ限定したが、その整理では正式レビューのP1 4件を十分に引き継げていなかった。

利用者の方針は次のとおり。

- 実際の製品動作・ユーザー体験に問題があるものを対応する。
- 通常運用で月に1度も起こり得ない程度の極端なケースだけを理由とした過剰な品質対応は行わない。
- report、task、PR本文等の開発プロセス品質だけの問題は、製品不具合として必須対応にしない。

この基準で正式レビューを再分類し、次回実装のauthoritativeな必須対応を以下の5件とする。

## 2. 対象

| 項目 | 値 |
| --- | --- |
| Repository / PR / Issue | `ssaattww/RevMem` / #108 / #106 |
| Branch | `codex/pr94-ci-006-global-three-way` |
| Technical reviewed HEAD | `0e15ac16809af71bba09694453e7a665c7c452a1` |
| Scope decision時のPR HEAD | `a6a86600ae4089242aefe4151aea9442645179ac` |
| Formal independent review | `pullrequestreview-5120896273` |
| Existing detailed review | `reports/2026-09-05-pr108-independent-final-review.md` |
| Previous 3-item scope | `reports/2026-09-05-pr108-review-action-scope.md` |
| 本reportの扱い | 既存reportを改変せず、後続実装で使用する最新の製品影響ベースscopeを追加 |
| Merge | 実施しない |

`0e15ac1` から `a6a8660` までの追加はreview report 2ファイルのみで、production code/test/workflowの変更はない。そのため以下の製品不具合の技術的再現対象は `0e15ac1` のままである。

## 3. 対応必須 — 5件

### PR108-PRODUCT-001 — P1 — 遅延PRがowner revisionになっても追いつけない

**Formal review:** `PR108-IFR-001`

**対象:** `src/t405-owner-pull-request-synchronization.ts`

異なるremote HEADを持つPRを一旦deferした後、そのHEADがowner synchronization revisionになっても、保存済みPR HEADと現在のGlobal revisionの不一致により再度skipされる。

正式レビューでは、PR52/PR53/Global=Bから、owner CでPR52のみCへ進め、後からowner Dへ切り替えてもPR53がBのまま残り、再試行しても解消しないことを再現している。

これは通常の複数PR運用でPRが恒久的に同期できなくなる製品不具合であり、対応必須とする。

**最低限の受け入れ条件:** B/B/B → C/B/C → C/D/D の連続同期が成立し、deferされたPRがowner revisionになった時点で安全に追随できること。Global先行状態および再試行も含めてactual production pathで確認する。

### PR108-PRODUCT-002 — P1 — lifecycle取得失敗時に新規PR作成が続行され部分更新される

**Formal review:** `PR108-IFR-002`

**対象:** `src/t405-review-contexts-runtime.ts`

既存owner Contextのlifecycle取得がunavailableでowner同期が完了していないにもかかわらず、新規PR選択側ではContext作成とGlobal advanceが続行される。

正式レビューでは、保存済みPR52=B / Global=Bの状態でPR52 lifecycleをunavailableにし、新規PR53=Cを選択すると、Context数が1→2、Global B→C、PR52=B、PR53=Cとして永続化されることをactual T405 command経路で再現している。

GitHub通信・認証・一時的取得失敗は通常運用で発生し得るため、極端な障害注入だけの品質問題とは扱わない。永続状態の部分更新を残す製品不具合として対応必須とする。

**最低限の受け入れ条件:** owner lifecycle取得が1件でも未完了の場合、新規PR作成・Global advance・historyを公開しないこと。private repositoryの再接続経路を壊さず、既存PR選択と新規PR選択の両方をactual T405 compositionで確認する。

### PR108-PRODUCT-003 — P1 — 異なるHEADのPRがあるとReview Contexts全体が表示不能になる

**Formal review:** `PR108-IFR-003`

**対象:** `src/t405-owner-pull-request-synchronization.ts`、`src/t405-review-contexts-runtime.ts`、`src/t405-pull-request-review-runtime-base.ts`

owner同期で別HEADのPRをdeferして保存済みrevisionを維持する一方、read projection側ではremoteの新HEADを使用するため、保存済みContextとdiff registrationのrevisionが不一致になる。

正式レビューでは `Persisted pull-request context does not match the registered diff revision` が発生し、projection数0となり、defer対象PRだけでなくReview Contexts全体の取得が失敗することをproduction compositionで再現している。

主要UIが利用不能になる直接的な製品不具合なので対応必須とする。

**最低限の受け入れ条件:** 異なるremote HEADが混在しても、保存済みrevisionとtree/cache/progress/diff registrationが整合し、Review Contextsの表示・refresh・再検出・再起動が成立すること。PRを一覧から黙って除外して回避しない。

### PR108-PRODUCT-004 — P1 — 正当な別HEAD PRで確認済み操作が失敗する

**Formal review:** `PR108-IFR-004`

**対象:** `src/core/review-state/review-state-service.ts`、`src/t405-pull-request-review-runtime-base.ts` およびIssue #106のowner Global semanticsとの接続

Issue #106の設計上、Globalのcurrent owner revisionと別PRのHEADが異なる状態は正当な状態として存在する。しかしその状態のPRで確認済み操作を行うと、既存core serviceのGlobal revision一致条件により失敗する。

正式レビューでは、PR53の保存済みrevisionとdiff registrationをCで一致させ、owner/GlobalだけDへ進めた状態でprojection自体は成功する一方、PR53 diffの確認済み操作が `Global current revision must match the target revision.` で失敗することを再現している。

Issue #106が成立させる通常状態で主要機能が使えないため対応必須とする。

**最低限の受け入れ条件:** non-owner HEAD PRでもowner Globalを任意PR HEADへ付け替えることなくmark/unmarkが安全に成立すること。original/modified、mark/unmark、sibling isolation、history、再起動をactual compositionで確認する。既存の安全checkを単に削除しない。

### PR108-PRODUCT-005 — P3 — ユーザー向け日本語メッセージが破損している

**対象:** `src/t405-review-contexts-runtime.ts`

technical reviewed HEADには次の文言が存在する。

- `対豈PRのローカルGitリポジトリを解決できません。`
- `PR cacheを更新できませんでした: live取得結果をcacheほ保存できませんでした。`

ユーザーへ直接表示される明白な製品不具合である。

**最低限の受け入れ条件:** `対象PR`、`cacheへ保存` の正しい日本語へ修正し、focused testまたは既存テストで文言が維持されることを確認する。

## 4. 今回の必須対応から除外するもの

### Formal review IFR-005 — manifest公開前のcancellation

技術的な指摘記録は維持するが、今回の必須対応5件には含めない。取消・supersessionのpublication直前競合について、通常利用での現実的な発生頻度を今回のscope決定では十分に確認できていないためである。

今後、通常操作で無視できない頻度で発生することが確認された場合は別途対応対象にできる。本reportではrelease blockerにしない。

### Formal review IFR-006 — owner APIとgetCurrent cache/uncertainの不整合

正式レビュー自身が現行UIへの直接影響を確認できていない。公開API間の不整合という技術的指摘は維持するが、現時点では製品上の具体的障害が立証されていないため必須対応から外す。

### Formal review IFR-007 — report/task/PR本文の不足

開発プロセス・追跡品質の問題であり、製品動作へ直接影響しないため必須対応から外す。

### history append途中失敗

以前の3-item scopeでは必須対応としていたが、正式独立レビューのP1/P2群より優先する根拠はない。post-commit history sinkの途中障害は発生頻度が低い障害ケースであり、今回の「通常利用で現実的な製品影響を優先する」という基準ではrelease blockerにしない。

技術的な懸念を否定・削除するものではなく、今回の必須修正から外すという判断である。

### actual T405 production composition test

テスト追加自体を独立した製品不具合として数えない。PRODUCT-001〜004の修正をproduction pathで固定するための**必須検証手段**として扱う。

単なるsource文字列検査ではなく、実際のT405 production registration / command compositionを通して各修正の受け入れ条件を検証すること。

## 5. 完了条件

次の5件をすべて修正する。

1. `PR108-PRODUCT-001`: deferされたPRがowner revisionへ安全に追随できる。
2. `PR108-PRODUCT-002`: lifecycle取得失敗時にContext/Global/historyを部分公開しない。
3. `PR108-PRODUCT-003`: 異HEAD PRが混在してもReview Contextsが正常に表示・refreshできる。
4. `PR108-PRODUCT-004`: non-owner HEAD PRでも確認済み操作が安全に成立する。
5. `PR108-PRODUCT-005`: ユーザー向け日本語メッセージを修正する。

PRODUCT-001〜004については、実装担当がactual T405 production compositionを使用した回帰を追加し、required action / production path / actual fixture / focused evidenceを対応付ける。

修正後は更新されたPR current HEADと完全一致するCI runだけを検証対象とし、旧HEADの成功runを代用しない。

本reportより前のreportはレビュー履歴としてそのまま保持する。内容を更新・削除しない。mergeは利用者が行う。
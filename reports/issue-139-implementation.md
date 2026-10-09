# Issue #139 実装・検証報告

## 対象

- Issue: https://github.com/ssaattww/RevMem/issues/139
- PR: https://github.com/ssaattww/RevMem/pull/140
- branch: `issue-139-redetect-closed-merged` / base: `main`
- base HEAD: `a479bf5cf2b35f342a8dab90dc886a19d8233520`
- 設計コミット: `6a5d510bdacd06640a63d9a7051ebd59e2211102`
- 設計: `Design/Issue139PullRequestRediscovery.md`
- 本報告は実装者による通常報告。独立レビュー判定ではない。実装公開HEADはPR metadataと親への引渡しに記録する。

## 変更

- GitHub検索を`state=all`へ変更。branchが確定した場合はhead refとhead repositoryを照合し、SHAの違いだけでは除外しない。同じSHAでも別branch/forkを除外する。
- local-gitでtracking remote/refを解決。trackingがないbranchはidentity remoteと現在refを使用し、detached HEADは既存のHEAD一致へ縮退する。異なるhostと削除head repositoryの対応は推測しない。
- 候補にopen / closed / mergedを保持し、既存Quick PickのPR番号・タイトルに状態を表示する。
- 新しいContextは選択PRのimmutable HEADを使用。保存済みPRの再選択も選択HEADをowner同期対象にし、別PRのrevision/review stateを変更しない。
- 明示選択はrepository/HEAD/branch refごとに保存。別branchに同じHEADがあっても選択を持ち越さない。選択closed/mergedはCurrent Contextとして保持する。
- 検索境界を`findByHead`へ改名しcontract fixtureを追随。破壊的TypeScript境界変更を`Design/BreakingChanges.md`へ記録。
- Issue139のproduction回帰を`npm run test:unit`へ追加。T406 HTTP fixtureと明示選択closedの期待値を新要件に合わせた。

## 要件と証拠

| Issue139受入条件 | 検証 |
| --- | --- |
| 未保存open検出・表示 | Issue139 production未保存open |
| 未保存closed検出・表示 | Issue139 production未保存closed |
| 未保存merged検出・表示 | Issue139 production未保存merged |
| 同名別repository/fork除外 | SHA共通でも別fork/branch/削除repositoryを除外、別host除外 |
| 複数候補の状態表示 | production Quick Pickでclosed/open/mergedのdescriptionを確認 |
| 保存有無・Context/Progress/review分離 | 未保存3状態、保存済みclosed/merged、別PR files/head/history不変、同HEAD別branch選択分離 |

## 実行結果

- TDD初期Red: compile:test成功後、Issue139の5件が失敗。SHA不一致の候補未検出、同SHAの別fork/branch混入、tracking境界欠落を再現。
- branch分離Red: 同HEAD別branchへ選択PRが持ち越される1件が失敗。修正後に成功。
- 別hostRed: APIへ進んでnetwork unavailableになる1件が失敗。修正後に空候補として成功。
- `npm run build`: 成功。
- `npm run typecheck:contracts`: 成功。
- `npm run validate:architecture` / `npm run validate:architecture:negative`: 成功。
- `npm run lint`: 成功。
- `npm run compile:test`後、Issue139 / t405-review-followup / review-contexts-storage / pr-progress-remote-tracking-revision / mock-githubの5ファイル: **52/52成功**。
- `git diff --check`: 成功。
- 全体`npm test`、exact-head CI、通常レビュー、独立最終レビューはこの公開時点では未完了。実機UIは未検証。

## 作業境界と次の手順

FA780の専用checkoutのみ変更。PR138、他担当checkout/session、依存、認証・権限・環境設定、workflowは変更しない。通常commit/pushのみ。
全体検証を完了し、正確な公開HEADとログを親へ渡す。親が通常/独立最終レビューを手配する。exact-head必要CIと保護条件を照合し、親の最終連絡前にはマージしない。

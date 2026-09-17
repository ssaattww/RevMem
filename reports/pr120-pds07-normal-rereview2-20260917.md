# PR差分選択 PDS-07 通常再レビュー round 2

## 判定

**pass_with_held**。前回openだった `PDS07-NR1-002 / P2` は **fixed** と判定する。`PDS07-NR1-001 / P2` は前回fixedのまま維持する。今回の修正差分・直接依存・同種ケースに新規必須指摘はない。

この判定はPDS-07の通常レビュー収束を示す。PDS-08〜PDS-10の完了、PR全体の独立最終レビュー、merge可否を意味しない。

## 対象とレビュー継続性

- Repository / PR: `ssaattww/RevMem` / #120
- branch: `investigation/issue-119-linked-diff-blocks`
- base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`
- reviewed implementation HEAD: `290a1054c66ec281d03964e13b9e178021dd43a3`
- reviewed tree: `da843695239182eb444a6f3ba02073ec73ff2d00`
- 前回レビュー記録HEAD: `b84d7f630b2afaf5db3c1d707fb15d314822209a`
- 前回reviewed implementation HEAD: `74d5f31e824d5f1bf52ff6bb5c9ef358ca4fb4ca`
- 確認差分: `b84d7f630b2afaf5db3c1d707fb15d314822209a..290a1054c66ec281d03964e13b9e178021dd43a3`
- review mode: `fix_verification`
- reviewer: 前回と同じ通常レビューチャット。今回も実装修正は行っていない。

対象差分は3commitで、`0763ca7` が正常系unmark履歴payloadの検証追加、`fba9d3a` が未使用helper削除、`290a105` がreport / handoff / tracking同期である。
## 作業環境と証拠

RDCの端末・セッションを確認し、Linux端末 `ibis-ThinkBook-14-G7-IML`（`75840a70-dea0-4d8c-9bb4-fe97c78bc11e`）を固定して実施した。既存の2セッションは別作業のPython REPLであり、操作・終了していない。

レビューworktreeは `/home/ibis/RevMem-pr120-pds07-rereview2-20260917`。検証は同一HEADを `git archive` で展開した `/home/ibis/RevMem-pr120-pds07-rereview2-evidence-20260917/source` で行い、レビュー対象worktree自体に生成物を置いていない。

- Node.js: `v22.13.1`
- npm: `11.4.2`
- package-lock SHA-256: `3e7611244b1729f3d701b60a726b69dcc630f8e0fb1fd945018ca9e74845a3b4`
- 依存元 `/home/ibis/RevMem-pds05-ci` のpackage-lockと同一SHAを確認して既存 `node_modules` を参照
- `git diff --check b84d7f6..290a105`: success
- reviewed worktree: clean
- `origin/investigation/issue-119-linked-diff-blocks` = reviewed HEAD を再確認

## PDS07-NR1-002 / P2 — fixed

前回残件は、正常系matrixがmark後の履歴payloadだけを詳細確認し、同じ正常系ケースのunmark後payloadを確認していなかったことだった。元の重大度P2を維持し、再分類はしていない。

今回の `test/unit/pr-diff-selection-acceptance.test.ts:727-782` は `normalHistoryOperations = ["mark", "unmark"]` を固定し、正常系25ケースすべてで同一fixture・同一command・同一selectionのmark→unmarkを連続実行する。
各操作で次を同時に検証している。

- 保存後のoriginal / modified Context / Global範囲
- commit回数: mark後1、unmark後2
- 履歴event件数と `modified` → `original` の順序
- `reason`: block=`user-block-selection`、side-modified=`user-selection`、side-original=`user-file`
- Context `previousRanges` / `nextRanges`
- modified eventの `globalPreviousRanges` / `globalNextRanges`
- original eventの `diffId`
- PR Progress: mark後の設計値、unmark後0復帰

`eventOffset` を各操作直前の実event数から取り、その操作で追加されたeventだけを `assertHistoryPayloads` に渡すため、markのeventをunmark証拠として誤利用していない。`assertHistoryPayloads` は件数を先に一致させてからside・reason・before/after・Global・diff identityを確認する。

実経路は `buildSnapshotFromLocalGitDiff` → `PullRequestReviewRuntime` → `openReviewDiff` / `createCommandService` → repository commit → `recordPullRequestReviewHistory` → 実 `ReviewHistoryRecorder` → `getProgress`。fixtureの永続化先はMemoryRepositoryだが、PR runtime・command service・履歴生成・recorder・進捗計算は製品経路を使用する。

### 必要対応 completeness matrix

| 必要対応 | 製品経路 | 実composition fixture | focused evidence | 判定 |
| --- | --- | --- | --- | --- |
| 正常系全ケースでmark→unmark | runtime → command service | `normalCases` 25件を同一fixture/commandで連続操作 | direct 61/61 | Complete |
| unmarkのContext/Global before-after | commit → history transaction → recorder | `expectedHistoryPayloads` + `assertHistoryPayloads` | direct 61/61、focused 127/127 | Complete |
| reason / original diffId / event順序 | product history boundary → recorder | 同上。side/block/original/modified全ケース | focused 127/127 | Complete |
| commit回数とProgress復帰 | repository commit → runtime progress | 各normal caseで1→2 commit、分子→0 | direct 61/61 | Complete |
| 前回reportの過大表現訂正 | report / tracking | `pr120-pds07-fix-verification-20260917.md` 等 | diff確認 | Complete |
## PDS07-NR1-001 / P2 — fixed維持

前回再レビューでfixed確認済み。今回のfollow-up差分は正常系unmark履歴payloadの追加と記録訂正だけであり、NR1-001のside受入9ケースを削除・弱体化していない。`normal acceptance matrix preserves required side-mode scenarios` も継続して成功した。

## 記録訂正の確認

`reports/pr120-pds07-fix-verification-20260917.md` の過大表現は、`cebdf25` 時点の実装事実へ訂正された。正常系はmark後payloadのみ、境界と末尾改行・存在はmark/unmark双方、追加18・削除6は各操作payloadを確認していた、という内容になっている。

`tasks/pr-diff-selection-mode/tasks-status.md` と `phases-status.md` も、前回再レビューでNR1-001 fixed / NR1-002 open、その後follow-up修正済み・再確認待ちという経緯へ同期されている。今回のレビュワーはtracking自体を更新していない。

## 現HEADでの独立再実行

reviewed HEAD `290a1054c66ec281d03964e13b9e178021dd43a3` のarchive sourceで以下を再実行した。

| 検証 | 結果 | 証拠 |
| --- | --- | --- |
| compile:test | success | `rereview2-compile.*` |
| PDS-07直接受入 | 61 / 61 success | `rereview2-acceptance.*` |
| focused `test:pr-diff-selection` | 127 / 127 success | `rereview2-focused.*` |
| tooling | 16 / 16 success | `rereview2-unit.*` 内 |
| unit | 858 / 858 success、skip 0（Linux） | `rereview2-unit.*` |
| `git diff --check` | success | Git直接確認 |

実装担当のWindows結果 `856 pass / 0 fail / 2既存skip` と、今回Linuxでの `858 / 858` はOS条件差として整合する。Red証拠は実装担当の `pds07-fix2-unmark-coverage-red-valid` を履歴証拠として確認し、当時の未コミット状態を再現したとは扱わない。
## current-HEAD CI

GitHub connectorで reviewed HEAD と完全一致するpull_request CIだけを確認した。

- workflow: `CI`
- run: `35164155623`
- run number: `4564`
- `head_sha`: `290a1054c66ec281d03964e13b9e178021dd43a3`
- status / conclusion: `completed / success`
- build、contract typecheck、architecture正負、lint、unit、T602/T603、T403〜T406、Issue、T304、T502〜T506、T604〜T606、T609/T610、Temporary Git、Mock GitHub、VS Code Extension Host、package/version/artifact工程: success
- 成功artifact: `review-range-user-validation-0.1.53-pre+290a105`
- artifact ID: `10474620534`
- digest: `sha256:2912687ab9f3514962da47616588fb051e14fc6388998643863582fa21e4f70f`

前回レビュー記録HEAD `b84d7f6...` のfailure run `35162281109` や別SHAのrunは今回のcurrent-HEAD証拠に代用していない。前回失敗箇所だったT506も今回のexact-head runではsuccessである。

## カバレッジ disposition

| 観点 | disposition | 根拠 |
| --- | --- | --- |
| PDS07-NR1-002 required action | checked_no_finding | completeness matrix全行Complete |
| 修正差分・直接依存 | checked_no_finding | test差分、履歴helper、runtime/recorder接続を確認 |
| 同種・sibling cases | checked_no_finding | normal 25件、side/block、original/modified、context/changed/multi-blockを同じ反復で確認 |
| 保存・履歴・Progress | checked_no_finding | mark/unmark双方を同一実経路で照合 |
| report / tracking accuracy | checked_no_finding | 前回過大表現を訂正し、follow-up状態へ同期 |
| current-HEAD CI | checked_no_finding | exact HEAD run 35164155623 success |
| PDS-08 | held | stale comparison / CAS / reloadは次タスク |
| PDS-09 | held | 実Extension Hostでの本機能表示同期は次タスク |
| PDS-10 | held | 統合通常レビュー・独立最終レビュー・最終公開監査は後続 |
## Held / unexplored / merge boundary

HeldはPDS-08〜PDS-10だけで、PDS-07の受入完了を妨げない。今回のbounded fix verificationで対象外の機能を完了扱いにはしていない。

- PDS-08: 古い比較、CAS競合、再読込
- PDS-09: 実Extension Hostでの設定・左右表示同期
- PDS-10: 全体検証、統合通常レビュー、独立最終レビュー、最終公開CI監査

対象範囲内にverdictを妨げる未探索事項はない。mergeは利用者が行うためworkerは実行しない。

## 次の操作

`PDS07-NR1-001` と `PDS07-NR1-002` は同じ通常レビュワー文脈でfixedとなった。PDS-07は通常レビュー収束として扱い、レビュー記録公開後のPR current HEADに一致するCIを確認できれば、実装担当はtrackingを本結果へ同期してPDS-08へ進める。

本レポートと通常再レビューhandoffだけをレビュー記録としてcommitする。製品コード、製品テスト、設計、workflow、設定、task/phase trackingはレビュワーとして変更しない。記録commit後は新しいHEADに一致するworkflow runだけを公開HEADのCIとして確認し、`290a105...` の成功runを代用しない。

## 要約

前回openだった `PDS07-NR1-002 / P2` の残件は解消された。正常系25ケースでmark→unmarkを同一fixtureから実行し、unmarkのContext/Global before-after、reason、original diffId、event順序、保存回数、PR Progress復帰を実runtime・実履歴recorder経路で確認できる。独立再実行は直接受入61/61、focused 127/127、unit 858/858成功。reviewed HEAD一致CIもT506を含めsuccessである。判定は **pass_with_held** とする。

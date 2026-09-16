# PR #120 PDS-07 通常再レビュー

## 判定と対象

判定: **fail / 要修正継続**。前回P2指摘2件のうち、`PDS07-NR1-001`はfixed、`PDS07-NR1-002`はopenのまま。

- Repository: `ssaattww/RevMem`
- PR: `#120`
- branch: `investigation/issue-119-linked-diff-blocks`
- review mode: fix verification / same normal reviewer
- source review: `reports/pr120-pds07-normal-review-20260917.md`
- source reviewed HEAD: `3fe8233320b692a8a68f49b36017098a28514db0`
- source review record HEAD: `15808b6039f1a95930451648344878774aeb8d40`
- re-reviewed implementation HEAD: `74d5f31e824d5f1bf52ff6bb5c9ef358ca4fb4ca`
- fix commits: `e6dd2d19206700f1e19355f869d9bbe9d0f659a9`, `cebdf252af94fa5096d2ab9d4338d5385226ac7e`
- fix report/tracking/handoff commit: `74d5f31e824d5f1bf52ff6bb5c9ef358ca4fb4ca`
- base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`
- reviewer continuity: 2026-09-17のPDS-07初回通常レビューと同じチャット文脈。実装修正には参加していない。

PDS-07の製品コード・設計・設定・workflowに新しい変更はなく、今回の技術差分は受入試験の補強である。再レビューは前回2指摘のrequired action、直接影響、同種ケース、修正HEAD一致の検証・CIに限定した。

## Finding completeness matrix

| Finding | required action | production path / composition fixture | focused evidence | disposition |
| --- | --- | --- | --- | --- |
| `PDS07-NR1-001` / P2 | 正常系表で不足していた`side`動作を実runtime受入に追加し、保存範囲・commit・履歴・PR Progress・Globalを同時照合 | `createFixture`が`buildSnapshotFromLocalGitDiff`→`PullRequestReviewRuntime`→実`DiffEditorReviewCommandService`→repository commit→実`ReviewHistoryRecorder`→PR Progressを接続 | `normalCases`へ9ケース追加。current HEADでfocused 126/126 | **fixed** |
| `PDS07-NR1-002` / P2 | 正常系・境界・末尾改行/存在・追加・削除でmark/unmarkそれぞれの履歴payload（Context before/after、Global before/after、reason、original diffId）を実recorderまで確認 | 同じ実runtime受入fixture。`assertHistoryPayloads`で履歴payloadを照合 | 境界、末尾改行/存在、追加18、削除6は必要なmark/unmark payloadを確認。正常系25ケースはmarkのみで、unmark payloadが未確認 | **open / partial** |

## `PDS07-NR1-001` / P2 — fixed

前回不足していた9個の`side`実経路ケースが`test/unit/pr-diff-selection-acceptance.test.ts`へ追加された。

- 複数行追加の部分選択
- 複数行削除の部分選択
- original / modified context-only
- original / modifiedの変更行+隣接context
- 1 selectionが複数blockに重なる場合
- 同一blockの複数selection
- 別blockの複数selection

`normal selection cases persist the designed ranges with matching history and PR progress`は、各ケースで保存後のoriginal / modified Context / Global、commit 1回、詳細履歴payload、PR Progress分子・分母を同じ実runtime経路で確認している。前回required actionを満たしたため、本findingは**fixed**とする。

## `PDS07-NR1-002` / P2 — open

履歴payload検証自体は大きく改善されている。共通`assertHistoryPayloads`は以下を検証する。

- event件数と順序
- `diffSide`
- `reason`
- `previousRanges` / `nextRanges`
- modified側の`globalPreviousRanges` / `globalNextRanges`
- original側の`diffId`

また、次の範囲ではmark/unmarkのbefore/afterが実recorderまで固定された。

- 選択境界10ケース: `test/unit/pr-diff-selection-acceptance.test.ts:856-894`
- 末尾改行・存在13ケース: `test/unit/pr-diff-selection-acceptance.test.ts:980-1035`
- 追加state product 18ケース: mark/unmarkの全状態組合せ
- 削除state product 6ケース: mark/unmarkの全状態組合せ

しかし、正常系25ケースの受入 `test/unit/pr-diff-selection-acceptance.test.ts:745-768` は `markSelectionReviewed` のみを実行し、mark後のpayloadだけを検証している。`unmarkSelectionReviewed`、unmark後のContext/Global before→after、reason、original diffId、2回目commit、PR Progress復帰はこの正常系matrixでは確認していない。

前回findingのrequired actionは「PDS-07のケースデータに期待する履歴payloadを持たせ、**mark/unmarkそれぞれ**でContext previous/next、Global previous/next、reason、original diffIdを必要に応じて検証し、少なくとも正常系、境界、末尾改行・存在、追加、削除を実recorderまで通す」だった。したがって正常系のunmark証拠が欠ける現状ではrequired actionは部分完了であり、本findingは**open**のままとする。

### 記録上の不一致

`reports/pr120-pds07-fix-verification-20260917.md` は「正常系全ケース、選択境界10ケースのmark/unmark、末尾改行・存在13ケースのmark/unmark…」と記載しているが、現行コード上で正常系全ケースに共通して実行されるのはmarkだけである。次の修正時にレポート・handoff・PR記載も実装事実へ合わせる必要がある。

## 変更範囲の確認

| ファイル | disposition | 確認内容 |
| --- | --- | --- |
| `test/unit/pr-diff-selection-acceptance.test.ts` | checked_finding | NR1-001は解消。NR1-002は正常系unmarkの詳細履歴検証が不足 |
| `reports/pr120-pds07-fix-verification-20260917.md` | checked_finding | 正常系のmark/unmarkを確認したとする記載が実装より広い |
| `handoffs/issue-119-pr120-pds07-fix-verification-20260917.yaml` | checked_finding | NR1-002をaddressedとする根拠は正常系unmarkを含まないためclosureには不足 |
| `tasks/pr-diff-selection-mode/tasks-status.md` | checked_no_finding | PDS-07を再レビュー待ち、PDS-08以降を未着手として保持 |
| `tasks/pr-diff-selection-mode/phases-status.md` | checked_no_finding | PDS-07再レビュー待ちを維持 |

製品コード、設計、設定、workflowの変更はなく、PDS-08〜PDS-10は未着手のままである。

## 再検証

`74d5f31e824d5f1bf52ff6bb5c9ef358ca4fb4ca`をdetached review worktreeから`git archive`で別sourceへ展開し、同一`package-lock.json`の既存依存を再利用した。reviewed tree自体には依存物・生成物を追加していない。

- execution machine: `ibis-ThinkBook-14-G7-IML`
- Node.js: `v22.13.1`
- npm: `11.4.2`
- dependency lock SHA-256: `3e7611244b1729f3d701b60a726b69dcc630f8e0fb1fd945018ca9e74845a3b4`
- `npm run test:pr-diff-selection`: **126 / 126 pass**, fail 0, skip 0
- `npm run test:unit`: tooling **16 / 16 pass**、unit **857 / 857 pass**, fail 0, skip 0（Linux）
- `git diff --check 15808b6039f1a95930451648344878774aeb8d40..74d5f31e824d5f1bf52ff6bb5c9ef358ca4fb4ca`: success
- review evidence: `/home/ibis/RevMem-pr120-pds07-rereview-evidence-20260917/source/test-output/ci/review-pds07-rereview-{focused,unit}.*`

最初のreview wrapper実行では引数形式を誤って`--label`を渡しexit 127となったが、これはreviewer側コマンド呼出しの誤りで製品試験ではない。正しい形式で直ちに再実行し、上記126/126および857/857を得た。

## current-HEAD CI

再レビュー対象HEAD `74d5f31e824d5f1bf52ff6bb5c9ef358ca4fb4ca`と`head_sha`が完全一致するpull_request runだけを採用した。

- workflow: `CI`
- run: `35160967362`
- event: `pull_request`
- `head_sha`: `74d5f31e824d5f1bf52ff6bb5c9ef358ca4fb4ca`
- status / conclusion: `completed / success`
- job `build-and-lint`: build、contract typecheck、architecture正負、lint、unit、T602/T603、T403〜T406、Issue、T304、T502〜T506、T604〜T606、T609/T610、Temporary Git、Mock GitHub、VS Code Extension Host、package/manifest検証までsuccess
- artifact: `review-range-user-validation-0.1.53-pre+74d5f31`
- artifact ID: `10473196816`
- digest: `sha256:a8a662f332593c92174edad37c2efabe7e0a35bdbdceeebfe1d4caf9e62ad27a`

別SHAのrunは代用していない。

## Coverage disposition

| 観点 | disposition | 根拠 |
| --- | --- | --- |
| NR1-001 required action | checked_no_finding | 不足9sideケースが実runtime受入へ追加され、状態・履歴・Progress・Globalを同時照合 |
| NR1-002 required action | checked_finding | 境界/EOF/追加/削除は解消したが、正常系matrixはmarkのみ |
| sibling cases | checked_no_finding | side追加ケース、境界、EOF、state productを確認 |
| current-HEAD focused/unit | checked_no_finding | 126/126、857/857 |
| current-HEAD CI | checked_no_finding | run 35160967362 / exact `head_sha` / success |
| scope discipline | checked_no_finding | src/Design/config/workflow変更なし、PDS-08以降未着手 |
| report/tracking accuracy | checked_finding | fix reportの「正常系mark/unmark」記載が実装より広い |
| PDS-08〜PDS-10 | unexplored | 別タスク。PDS-07収束前は開始しない |

## Held / unexplored / severity

- held: なし
- unexplored: PDS-08 stale/CAS/reload、PDS-09実Extension Host、PDS-10統合・独立最終レビュー
- severity reclassification: なし。`PDS07-NR1-001` / `PDS07-NR1-002`ともsource severity P2を維持する。
- merge: not applicable。利用者が実施する。

## 次の作業

1. `PDS07-NR1-002`の残りとして、正常系matrixの各適用ケースでmark後に同じ対象をunmarkし、Context / Globalのprevious→next、`reason`、original `diffId`、commit回数、PR Progress復帰を実recorderまで検証する。
2. fix report / handoff / PR記載の「正常系mark/unmark済み」という表現を実装事実に合わせて更新する。
3. focused / unit / static gateを再実行し、小さくcommit/pushする。
4. 同じ通常レビュワー文脈で`PDS07-NR1-002`だけを再確認する。収束するまでPDS-08へ進まない。

## 要約

`PDS07-NR1-001`は必要な9個の`side`実経路受入が追加され、**fixed**。`PDS07-NR1-002`は境界、末尾改行・存在、追加、削除では詳細payloadのmark/unmark検証まで改善されたが、正常系25ケースはmarkだけでunmark履歴payloadを確認していないため**open**。current HEADのfocused 126/126、unit 857/857、exact-head CIは成功しているが、required findingが1件残るため判定は**fail**とする。

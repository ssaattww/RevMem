# PR #120 PDS-07 通常レビュー

## 判定と対象

判定: **fail / 要修正**。P2の指摘2件。製品コード・既存テスト・設計・設定・タスク状態は変更していない。

- 対象: `ssaattww/RevMem` PR #120、PDS-07「設計表を実経路の受入条件へ対応付け」。
- ブランチ: `investigation/issue-119-linked-diff-blocks`。
- reviewed HEAD: `3fe8233320b692a8a68f49b36017098a28514db0`。
- reviewed tree: `d006b43c7c90b42bf28d696ad1f677bd4e3e3ffd`。
- PDS-07差分: `a5ab79df980f15394ffb7d9547e25e739f565169..3fe8233320b692a8a68f49b36017098a28514db0`。
- 受入試験コミット: `2f1b3d516209182cfcf867149306a8a2152cda60`。
- PR base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`。
- レビュー種別: initial normal review。PR全体の独立最終レビューではない。

PDS-07で追加された実経路試験そのものはすべて成功し、既存の製品コードに新たな実行時不具合は再現しなかった。一方、PDS-07の完了条件は「設計表全行を実経路受入へ対応付け、保存状態・履歴・PR Progressを一緒に照合する」ことであり、現在の試験にはその証明を満たさない穴が2つ残る。

## 指摘

### PDS07-NR1-001 / P2: 正常系ケース表の `side` 動作を全行で実経路受入していない

origin: introduced_by_change。位置: `test/unit/pr-diff-selection-acceptance.test.ts:498-600`、要求: `Design/pr-diff-selection-mode.md:53-68`、`tasks/pr-diff-selection-mode/tasks-status.md:64-67`。

設計の正常系表は各行に `side` と `block` の期待動作を定義している。しかしPDS-07の `normalCases` で `side` を実経路から保存・履歴・進捗まで確認しているのは、変更行左右、部分置換、異数行置換の一部だけである。追加、削除、context-only、変更行+隣接context、複数ブロック、同一/別ブロックの複数selectionは `block` ケースしかない。
既存のT405や下位単体試験には `side` の追加・削除等の断片的な確認があるが、追加/削除は1行ケースであり、複数行ブロックの一部選択が `side` では狭いまま、`block` では全体へ広がる差を実経路で判別できない。またPDS-07が要求する保存・実履歴・PR Progressの同時照合にもなっていない。

影響: `side` 経路の追加・削除、context混在、複数selection等に回帰が入っても、現在のPDS-07受入は「設計表全行」の成立を検出できない。既定値が `side` であるため、これは補助経路だけの不足ではない。

必要対応: 正常系表の各行について未対応の `side` 動作を実runtime経路へ追加する。少なくとも複数行の追加/削除で部分選択が狭いまま保存されること、context-only/混在、複数ブロック/複数selectionの `side` 動作を、実際の範囲、commit回数、実履歴、PR Progress、Globalと一緒に確認する。既存の下位単体試験を代用せず、PDS-07の実経路受入へ対応付ける。

### PDS07-NR1-002 / P2: 多くの受入ケースが履歴の「内容」ではなく発生側だけを照合している

origin: introduced_by_change。位置: `test/unit/pr-diff-selection-acceptance.test.ts:604-619,707-729,815-854`。要求: `tasks/pr-diff-selection-mode/tasks-status.md:64-67`。

PDS-07の完了条件は「履歴内容」を含めた照合を求めている。108ケースの置換状態積とGlobal-only専用ケースでは `previousRanges` / `nextRanges` / Globalのbefore/after / `reason` / originalの`diffId`まで確認している。一方、正常系16ケースは `eventSides`、境界10ケースはmark/unmark後の `eventSides`、末尾改行・存在13ケースも `eventSides` だけを照合している。追加18ケース・削除6ケースも、履歴の側と理由は見るが、保存されたbefore/after範囲やoriginalのdiff identityまでは照合しない。

実 `ReviewHistoryRecorder` が保存する履歴には、Contextの前後範囲、Globalの前後範囲、理由、originalのdiff identityが含まれる。現在の受入では、該当ケースでイベント数と側が正しくてもこれらの内容が誤っている回帰をPDS-07の受入条件として検出できない。

影響: 末尾改行、追加/削除、境界正規化、正常系各行について、保存状態とPR Progressが正しくても履歴の証拠が誤る不具合を「PDS-07完了」として通せる。

必要対応: PDS-07のケースデータに期待する履歴payloadを持たせ、mark/unmarkそれぞれでContext previous/next、Global previous/next、`reason`、originalでは `diffId` を必要に応じて検証する。少なくとも正常系、境界、末尾改行・存在、追加、削除の受入から実recorderまで通して確認する。

## 変更範囲の確認

| 変更ファイル | disposition | 確認内容 |
| --- | --- | --- |
| `test/unit/pr-diff-selection-acceptance.test.ts` | checked_finding | 実runtime・保存・実recorder・進捗の接続は成立。上記2件の受入網羅性不足あり |
| `package.json` | checked_no_finding | focused commandへ新規受入試験を接続し、既定unitにも含まれる |
| `reports/pr120-pds07-implementation-20260917.md` | checked_no_finding | 実装・検証経緯を確認。実行結果は独立再現できた |
| `handoffs/issue-119-pr120-pds07-implementation-20260917.yaml` | checked_no_finding | 作成時点の技術HEADと公開前状態を明示し、公開commit/CIは再解決事項として分離している |
| `tasks/pr-diff-selection-mode/tasks-status.md` | checked_finding | PDS-07の完了条件自体は明確。現在の受入ではその全条件を満たしていない |
| `tasks/pr-diff-selection-mode/phases-status.md` | checked_no_finding | PDS-07通常レビュー待ち、PDS-08以降へ進まない状態を保持 |

直接依存として、`DiffEditorReviewCommandService`、`PullRequestReviewRuntime`、`ReviewHistoryRecorder`、`recordPullRequestReviewHistory`、変更ブロック/selection target、PR Progress計算、文書行契約、設定読取経路を確認した。PDS-07差分には製品コード変更がないため、製品実装の新規設計逸脱は検出していない。

## 要求・観点のカバレッジ

| 観点 | disposition | 根拠 |
| --- | --- | --- |
| 正常系ケース表を各行から実経路へ対応付け | checked_finding | `side` 列の一部が実経路受入に未対応。PDS07-NR1-001 |
| 選択正規化・境界 | checked_no_finding | 左右、カーソル、順逆、列0終端、空selectionを実runtimeで確認 |
| 三成分132基本ケース | checked_no_finding | 置換108、追加18、削除6を実runtimeで実行し、state productとcommit/no-opを確認 |
| 保存回数・atomicity | checked_no_finding | state product、正常系、境界、EOF、Global-onlyでcommit回数を確認 |
| 履歴内容 | checked_finding | 置換state product等は詳細確認するが、正常系・境界・EOF等はevent side中心。PDS07-NR1-002 |
| PR Progress分子・分母 | checked_no_finding | 変更行のみを数え、Global-onlyを二重加算しない実経路を確認 |
| Global同期 | checked_no_finding | replacement/additionとGlobal-onlyのtarget revision snapshotを確認 |
| 末尾改行・存在表 | checked_no_finding | 13ケースのeditor/Git-content座標、state、progressを確認。履歴payload詳細だけNR1-002へ集約 |
| 設定切替 | checked_no_finding | 操作単位で `block`→`side` を再読取し、次操作から反映することを確認 |
| whole-file既存仕様 | checked_no_finding | selection modeを読まず既存file operationを維持 |
| no-op / failed persistence ordering | checked_no_finding | 既存focused coverageと直接依存を確認。commit前historyなし |
| workflow診断artifact | checked_no_finding | current-HEAD CIに診断収集/アップロードstepが存在し、成功時user-validation artifactを公開 |
| scope discipline | checked_no_finding | PDS-07は受入・記録のみ。PDS-08以降や製品コードへの越境なし |
| PDS-08〜PDS-10 | unexplored | 別タスク。PDS-07収束前には開始しない |

## 独立検証

reviewed HEADを `git archive` で別ディレクトリへ展開し、同一 `package-lock.json` の既存依存を再利用して実行した。レビューworktree自体には生成物や依存物を追加していない。
- `npm run test:pr-diff-selection`: **116 / 116 pass**、fail 0、skip 0。PDS-07新規受入50件を含む。
- `npm run test:unit`: tooling **16 / 16 pass**、unit **847 / 847 pass**、fail 0、skip 0（Linux実行）。実装記録のWindows実行では既存Windows条件により845 pass + 2 skipであり、OS差として整合する。
- `git diff --check a5ab79df980f15394ffb7d9547e25e739f565169..3fe8233320b692a8a68f49b36017098a28514db0`: success。
- evidence: `/home/ibis/RevMem-pr120-pds07-review-evidence-20260917/source/test-output/ci/review-pds07-{focused,unit}.{result.json,stdout.log,stderr.log,log}`。
- dependency lock SHA-256: `3e7611244b1729f3d701b60a726b69dcc630f8e0fb1fd945018ca9e74845a3b4`。
- Node.js `v22.13.1`、npm `11.4.2`。

## current-HEAD CI

レビュー対象HEAD `3fe8233320b692a8a68f49b36017098a28514db0` とworkflow runの `head_sha` が一致するものだけを確認した。

- workflow: `CI`
- run: `35152083842`
- `head_sha`: `3fe8233320b692a8a68f49b36017098a28514db0`
- status/conclusion: `completed / success`
- build、contract typecheck、architecture positive/negative、lint、unit、T403/T404/T405/T406、T304、T502〜T506、T604〜T606、T609、Git/Mock GitHub integration、VS Code Extension Hostはすべてsuccess。
- artifact: `review-range-user-validation-0.1.53-pre+3fe8233`、ID `10469607687`、digest `sha256:109097f9c29b00c31e2948d80d4d45818da6c5c65d8b1112b67db1398091a6df`。
- 別SHAのrunはcurrent HEADの代用に使用していない。

このレビュー報告・handoffの公開commit後はHEADが変わるため、公開後のPR状態については新HEADに一致するrunを改めて確認する。ここに記録したrunは `3fe8233...` のレビュー対象検証であり、将来HEADの代用にはしない。

## TDD・診断artifact

PDS-07は既存実装を設計表へ接続する受入試験タスクで、今回の差分に製品実装はない。実装記録ではvalidな新規受入条件が既存実装で最初からGreenであり、製品欠陥を示す人工的なRedは作成していないことが明記されている。通常レビューでも製品修正は行っていない。

CI workflowには失敗時の結果、stdout、stderr、combined log等を収集する診断経路が既にあり、current-HEAD成功runでは失敗診断stepは条件どおりskip、成功user-validation artifactは公開済みである。

## Held / unexplored / not applicable

- held: なし。
- unexplored: PDS-08のstale/CAS/reload、PDS-09の実Extension Host表示同期、PDS-10の統合・独立最終レビュー。いずれもPDS-07の通常レビュー範囲外。
- not applicable: merge。利用者が実施するためworkerは行わない。
## 次の作業

PDS-07実装側へ戻し、PDS07-NR1-001 / PDS07-NR1-002をTDDで修正する。修正後は同じ通常レビュワー文脈でbounded re-reviewを行い、2件のrequired action、直接依存、回帰テスト、修正HEAD一致CIを確認する。PDS-07が収束するまでPDS-08へ進まない。

## 要約

既存のPDS-07受入50件、focused 116件、unit 847件およびreviewed HEAD一致CIはすべて成功した。製品不具合は新規に再現していない。ただし、正常系設計表の `side` 列を各行まで実経路で証明していないことと、多くのケースで履歴payloadの内容を検証していないことから、PDS-07の明示的な完了条件は未達である。判定は **fail** とする。

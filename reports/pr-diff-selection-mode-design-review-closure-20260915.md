# PR差分の確認単位切替 — 設計再レビュー完了

## 判定と対象

**判定: pass（設計レビュー合格）。D1・D2・D3は設計上の解消を確認。未解消の必須指摘、新規指摘ともに0件。**

- 日付: 2026-09-15（日本時間）
- Repository / PR: `ssaattww/RevMem` / #120
- モード: `fix_verification`。初回・前回と同じチャットの通常レビュワーによる再レビュー。
- 前回レビュー対象: `bb14a8f217a0dd29e269939297aca5e51aff60ae`
- 前回報告コミット: `732eaf1893df502ff0f123aec4157a715ff8a2d5`
- 今回レビュー対象: `fdb4fb977289eb420436f24638fa5eb48154556d`
- 差分範囲: `732eaf1893df502ff0f123aec4157a715ff8a2d5..fdb4fb977289eb420436f24638fa5eb48154556d`（2コミット）
- PR base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`
- branch: `investigation/issue-119-linked-diff-blocks`
- 設計: `Design/pr-diff-selection-mode.md`（325行、blob `028b34f1bf46de75169e823595547b40b613fde5`）
- 保存先: `reports/pr-diff-selection-mode-design-review-closure-20260915.md`

合格の対象は今回の設計とD1〜D3の修正であり、未実装のblockモードの製品動作を保証しない。独立最終レビューではない。本レポートの保存は通常レビュー記録の追加であり、製品の合格証明コミットではない。保存後のHEAD・CI・コメントは公開後にPRコメントへ記録し、上記SHAのCIで代用しない。

## 範囲と根拠

現行PR、前回の指摘コメント `5671251812`、今回の対応コメント `5671560347`、設計書、対応レポート、引継ぎを照合した。前回から変わったのは以下の3ファイルだけである。

| ファイル | 読んだ範囲・役割 |
| --- | --- |
| `Design/pr-diff-selection-mode.md` | 全文1〜325行と前回からの全差分。状態、選択、接続、型、履歴、試験条件を確認 |
| `reports/pr-diff-selection-mode-design-findings-followup-20260915.md` | 全文1〜122行。D1〜D3への対応、実装未着手、検証範囲の説明を確認 |
| `handoffs/issue-119-pr120-design-findings-followup-20260915.yaml` | 全文1〜174行。指摘ID、対象、検証、次工程を確認 |

`src` と `test` のGit treeは前回レビュー対象と今回対象で一致した。前回読んだ選択変換、コマンド、状態更新、履歴、PR runtime、local base/head runtimeの根拠が異なる製品版に差し替わっていないことを確認した。

- `src` tree: `4e483021703f1dbf5a3e2bb1814a0a4d2de2316f`
- `test` tree: `7f55c995d49fcae1a44e10e8e8e3c61938ea09c3`

## 指摘の解消確認

各指摘の重要度は前回のP2を保持する。重要度の変更は行っていない。

### D1 / P2 — Globalを含む変更なし判定: closed

前回の問題は、PRの元・先の状態だけでcommitや履歴を省略し、Globalだけが変わる操作を落とせることだった。

設計95〜167行で状態をoriginal、modified Context、Globalの3成分に分離し、各成分の未確認・一部確認・全確認を独立に遷移させている。130〜145行は3成分の変更有無8組についてcommitと履歴を定義している。modified ContextまたはGlobalに差分があればmodified履歴を1件、originalに差分があればoriginal履歴を記録する。

147〜161行にはGlobalだけの確認・解除、originalとGlobalだけが変わる操作、全成分が不変の操作がある。245〜256行でも同じ履歴規則とContext・Global双方の変更前後を保持する形式を定義している。旧表のPR両側だけによる無条件な履歴省略は残っていない。

3状態の直積を確認・解除で試験する要求もある。操作元が既に目的状態でも他成分の更新を省略しないこと、追加のみではContextとGlobal、削除のみではoriginalだけを扱うことを確認した。D1の必要修正は設計上完了している。

### D2 / P2 — 選択境界: closed

前回の問題は、ブロックへの「接触」にカーソル、逆向き選択、列0終端をどう適用するかが未定義だったことだった。

設計71〜93行で既存の `selectionsToLineIntervals` により操作側の行数を使って半開行区間へ正規化し、その後にブロックとの積集合を判定する順序を指定した。元側・先側のそれぞれについてカーソル、順方向、逆方向、列0終端、空の選択配列を表で定義し、確認・解除に共通適用する。

207〜217行のコマンド処理順でも同じ順序を保つ。空配列はsessionを開く前にno-opとなり、列0終端で除外された行を近接だけで巻き込まない。複数選択の正規化・結合とブロックの重複除去も整合する。D2の必要修正は設計上完了している。

### D3 / P2 — 入力・更新・履歴の接続契約: closed

前回の問題は、左右を原子的に更新する方針だけで、既存session・操作識別値・履歴へどう接続するかが未確定だったことだった。

設計169〜205行で、変更ブロック導出をapplication層の純粋処理とし、PR runtimeが保持する正確なhunkと両側行数から生成する責務を定義した。sessionへ `selectionMode` と `changeBlocks` を渡し、block時には後者を必須とする。local base/headはside固定、設定はsession生成時に取得して操作中は固定する。

219〜256行で専用入力、`markDiffBlockReviewed` / `unmarkDiffBlockReviewed`、専用operation、変更前後に基づく履歴分岐を定義した。310〜325行はblock専用transactionを既存unionに追加する方針を明記する。`invokedFrom` は操作起点であって、更新や履歴の対象側を決めない。既存original操作への偽装は不要となった。

258〜262行は未変更行の写像と変更ブロックの連動を分離し、計画の統合時に範囲集合だけを合成する。既存expected/nextのCAS境界を使い、永続化schemaを増やさない構成に矛盾を認めなかった。D3の必要修正は設計上完了している。

### 必要修正と検証の対応

| ID | 必要修正の証拠 | 既存接続先・回帰根拠 | 設計段階の判定 |
| --- | --- | --- | --- |
| D1 | 状態3成分、変更有無8組、Global-only受入表、履歴形式 | `hasSemanticChange`、`ReviewHistoryRecorder.recordTransaction`、履歴・進捗の既存テスト | 完了 |
| D2 | 選択境界12行、正規化後の積集合、空配列の早期終了 | `selectionsToLineIntervals`、`DiffEditorReviewCommandService`、行区間テスト | 完了 |
| D3 | 純粋処理、PR session、専用入力とtransaction union、履歴分岐 | PR/local runtime、状態更新と履歴の既存契約 | 完了 |

新しい製品経路・実結合fixtureは設計のみという今回の範囲では未作成であり、既存テストをその代用としない。280〜308行の受入条件・TDD順序に基づき、実装時に別途検証する。

## 検証結果と実行環境

RDCのFA780、Windows PowerShell 5.1、Node `v24.20.0`、`C:\Users\donabe\CodexProjects\RevMem` を使用した。開始時と検証後のHEADは今回レビュー対象と一致し、追跡ファイルの変更はなかった。作業ツリーの設計blobもGitHub connectorで取得したblobと一致した。

| 検証 | 結果 |
| --- | --- |
| `git diff --check 732eaf1 fdb4fb9` | 空白エラーなし |
| `node tools/run-ci-command.mjs pr-diff-design-r3-compile node node_modules/typescript/bin/tsc -p tsconfig.test.json` | 終了コード0 |
| 既存関連8ファイルの `node --test` | 64成功、0失敗、0skip、終了コード0 |
| 全体ローカル `npm test` | 今回は再実行していない |
| 新しいblockモード・実Extension Hostでの受入試験 | 製品未実装のため今回未実施 |

再実行したファイルは `test-dist/test/unit/` 配下の `design-document-structure.test.js`、`diff-editor-review-command-service.test.js`、`original-diff-selection-projection.test.js`、`review-history-original-side.test.js`、`pr-diff-progress.test.js`、`issue-92-pr-progress-selection-review.test.js`、`t303-review-followup.test.js`、`line-intervals.test.js`。

診断ログは同じPCの `test-output/ci/pr-diff-design-r3-{compile,focused}.{stdout.log,stderr.log,log,result.json}` に保存した。これらはPC上のローカル証拠であってGitHub Actions artifactではない。

事前の補助的なpackage情報取得はPowerShellの引用符処理でSyntaxErrorとなり、別の読み取り方法で確認した。専用診断runnerをまとめて作成する呼出しはツール側でブロックされ実行されなかった。その後、既存の診断ラッパーを用いた上記compile・focusedを実行し、結果JSONも確認した。これらの試行を製品テストの失敗や成功へ読み替えていない。

修正側レポートが記載するWindows全体試験の711成功・19失敗・2skipは、修正側の報告として保持する。今回その全失敗の原因を個別に再調査しておらず、ローカル全体成功とは判定しない。

## CIと診断workflow

着手時に失敗診断workflowの存在を再確認した。既存ラッパーはテスト結果・標準出力・標準エラー・結合ログを保存し、`.github/workflows/ci.yml` は失敗時に関連ソース、生成物、環境情報とともにアップロードする。workflowの修正は行っていない。

レビュー対象SHAに一致するCIはrun `34902682282`、attempt 1、event `pull_request`、結論 `success`。runの `head_sha` が `fdb4fb977289eb420436f24638fa5eb48154556d` と一致することをGitHub connectorで確認した。

artifact `10371299012` / `review-range-user-validation-0.1.53-pre+fdb4fb9` の存在と同一HEADへの帰属を確認した。今回は内容のダウンロード・実機インストールをしていない。

## カバレッジと文書点検

| 観点 | 状態 | 根拠・範囲 |
| --- | --- | --- |
| 要求・設計整合 | checked_no_finding | D1〜D3の必要修正、side既定、PR限定、状態表からの試験化 |
| 正確性・境界 | checked_no_finding | 状態遷移、履歴8組、選択境界、片側不在、複数選択 |
| 変更範囲と直接依存 | checked_no_finding | 変更3ファイル全文と全差分、src/test tree一致 |
| API・設定・互換性 | checked_no_finding | session時の設定取得、local側固定、専用union、保存形式維持 |
| エラー・診断 | checked_no_finding | hunk不正拒否、stale再確認、CAS原子性、既存診断workflow |
| セキュリティ | checked_no_finding | この差分に認証・外部通信・権限変更なし。別比較・別ファイル拒否を維持 |
| 試験妥当性 | checked_no_finding | 各表の受入契約と既存64件の再実行を区別 |
| current-HEAD CI | checked_no_finding | レビュー対象runのhead_shaとeventを照合 |
| 報告・追跡の正確性 | checked_no_finding | 今回は設計指摘対応。旧報告を上書きせず、製品完了へ進めていない |
| 文書表現 | checked_no_finding | 3ファイル全体で成分名、対象側、条件、未実装の区別を確認 |
| 新製品動作の合否 | not_applicable | このPRで製品へ未接続。設計合格から動作合格を推定しない |

アップロードされた `chatgpt-worker-skills 3.zip` のreview/report/handoff用Skillを使用した。文書表現は同じレビュワーがRDC上の `document-wording-review` と前回読んだdecision examplesを参照して点検した。意味・識別・可読性に必須修正なし。英単語の出現だけで誤りとは扱わず、用語承認の追加や日本語への機械的置換は行っていない。

独立したMarkdown用lint設定は確認できず、`npm run lint` は `eslint src test --max-warnings=0` である。Markdown lint合格とは主張しない。設計構造のテスト成功と文書の意味の点検は別の証拠である。

## 次工程と書込み境界

D1〜D3の設計修正は閉じられる。製品実装へ進む場合は利用者の指示後に、各表と状態直積から先に失敗するテストを作成する。特にGlobalだけの差分、列0終端、PR限定session、専用transaction・履歴の実結合を省略しない。

今回の書込みはこのレビュー報告とPRコメント、手元の引継ぎデータに限定する。設計、製品、テスト、設定、workflow、タスク追跡は修正しない。Issue close、PRのdraft解除、mergeは行わない。設計の必須未解消事項はなく、製品未検証の範囲は上記のとおり残る。

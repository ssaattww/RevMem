# PR差分選択モード PDS-06 通常再レビュー

## 判定

**pass_with_held**。前回の `PDS06-NR1-001` と `PDS06-NR1-002` はともに **fixed**。元の重大度 `P2 / medium` を維持し、再分類はしていない。修正差分と直接影響する範囲に新規指摘はない。
この判定はPDS-06の指摘修正確認であり、PR全体の独立最終レビューやPDS-07〜10の完了を意味しない。

## 対象と証拠の識別

- Repository / PR: `ssaattww/RevMem` / #120。
- ブランチ: `investigation/issue-119-linked-diff-blocks`。
- 今回の reviewed implementation HEAD: `8f2a67e1fe85851e5fc210e21da602ed4f11a7c1`。
- tree: `e61b6794f3160665c5e11648c08c33ef1400beb5`。
- 前回の reviewed implementation HEAD: `d256b2506247c302ad1edd5b2af247368fe2fdba`。前回報告コミット: `cc0a34a16cb9535661fb97b054c99bdeec5b0a25`。
- 確認差分: `cc0a34a16cb9535661fb97b054c99bdeec5b0a25..8f2a67e1fe85851e5fc210e21da602ed4f11a7c1`。4コミット・10変更ファイル。
- 修正コミット: `bc6c143`（snapshotだけの更新）、`444eb6e15a3574d7241ea78ac94181b83d4da428`（履歴識別）。
- base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`。
- review mode: `fix_verification`。前回と同じ通常レビューチャットで実施。実装修正は行っていない。
- 根拠: [前回レビュー](pr120-pds06-normal-review-20260916.md)、[修正報告](pr120-pds06-fix-verification-20260916.md)、[設計](../Design/pr-diff-selection-mode.md)、[タスク一覧](../tasks/pr-diff-selection-mode/tasks-status.md)。

## 環境と実行方法

RDCの端末一覧・セッション一覧を再確認し、短い確認コマンドの応答後、Linux端末 `ibis-ThinkBook-14-G7-IML`（`75840a70-dea0-4d8c-9bb4-fe97c78bc11e`）で実施した。他作業のプロセスや作業ツリーは変更していない。
作業ツリーは `/home/ibis/RevMem-pr120-pds06-rereview-20260916`。検証は同一HEADを `git archive` で展開した別領域 `/home/ibis/RevMem-pr120-pds06-rereview-evidence-20260916/source` で行った。
Node.js `v22.13.1`、npm `11.4.2`。package-lockの一致を確認した既存依存関係を参照し、システム設定・認証・グローバルな依存関係は変更していない。CIのNode.jsは24である。
検証後、追跡1476ファイルのSHA-256を元の作業ツリー・検証用コピーと照合し、不一致0件。内容一覧と実行結果を `source-manifest.json`、`source.json`、`validation-summary.json` へ保存した。
アップロード済みworker skill 5種類は参照先CodexSkillの同名ファイルとSHA-256が一致した。参照先は `70cd31f` で、取得した `origin/main` と同一だった。

## 指摘の確認結果

### PDS06-NR1-001 / P2・medium — fixed

元の問題は、PRのheadとGlobalの現在改訂が異なるとき、PR側のGlobalだけを変更する操作が `no-op` となり、確認状態の不一致と履歴欠落が残ることだった。originは `introduced_by_change`。元の位置は `diff-editor-review-command-service.ts:88-94,234-237,300-303`。
今回の修正では独自のファイル限定比較を削除し、`commitWhenChanged` がcoreの `hasReviewStateSemanticChange` を使用する。比較はContext・Globalの改訂別snapshotを含み、生成時刻だけの違いは無視する。core側の改訂投影・現在Globalの保持処理は変更していない。
常設テストの左右×確認／解除4ケースを実行した。さらに実PR runtimeへ製品の履歴境界・ReviewHistoryRecorderを接続し、現在改訂がPR headと同じ場合／異なる場合の計8ケースを確認した。
全ケースで保存1回・履歴要求1回、変更対象のPR snapshot更新、modified履歴1件、ContextとGlobalの正しい変更前後を確認。異なる現在改訂のGlobal.filesとcurrentRevisionIdは不変だった。続けて同じ操作を行うと `no-op` となり、保存・履歴は増えなかった。

### PDS06-NR1-002 / P2・medium — fixed

元の問題は、sideとblockが同じ履歴reasonとevent typeになり、追加のみなど履歴が1件の操作を保存後に識別できないことだった。originは `introduced_by_change`。元の位置は `src/composition/extension.ts:615-623` と `review-history-recorder.ts:51-60,97-120`。
今回追加された `src/composition/pull-request/pull-request-review-history.ts` が、blockの確認／解除を `user-block-selection` として記録する。modified側の既存side範囲操作は `user-selection`、その他の既存fallbackは `user-file` を維持する。元側の旧side操作を新たに別分類へ変更したとは扱わない。
`extension.ts` がこの境界へ委譲することと、実際の境界からrecorderへ渡されたイベントを確認した。追加のみのside/block×確認／解除4ケース、置換の1成分だけが変わる左右×確認／解除×変更成分8ケース、両側が変わる4ケース、削除のみ2ケースが成功した。
イベントが1件でもblockのreasonが残り、2件の場合はmodified→originalの順序を維持する。存在しないmodified側へGlobal状態や履歴を追加していない。識別用の余分なイベントもない。

## 必要対応と証拠の照合表

| 指摘・必要対応 | 製品経路 | 実行した試験・証拠 | 判定 |
| --- | --- | --- | --- |
| NR1-001: snapshotを含む意味差判定 | command service → core共通判定 → PR Global投影 | 常設runtime 4件、追加Global-only 8件 | Complete |
| NR1-001: 現在のGlobalを保持 | PR投影 → commitCurrentRevisionSnapshot | 異なる改訂のGlobal.files/currentRevisionId不変を照合 | Complete |
| NR1-001: 保存・履歴と変更前後 | 実runtime → 製品履歴境界 → ReviewHistoryRecorder | 追加8件で保存1回・modified履歴1件と双方のbefore/afterを照合 | Complete |
| NR1-001: 同一改訂・繰返しの回帰 | 共通判定と既存whole-file/selection経路 | 追加8件内の再操作no-op、既定単体試験 | Complete |
| NR1-002: 保存後の識別情報 | extension → recordPullRequestReviewHistory | 常設history 3件、追加の追加のみ4件 | Complete |
| NR1-002: 1件だけの履歴・左右・確認／解除 | 実runtime → 製品履歴境界 → recorder | 追加の1成分置換8件と削除のみ2件 | Complete |
| NR1-002: 件数・順序・実接続 | 同上、extensionの委譲 | 両側置換4件、製品委譲の静的確認1件 | Complete |

## 現在のHEADで再実行した検証

| コマンド | 結果 | 診断ラベル（rereview-pds06-に続く値） |
| --- | --- | --- |
| npm run test:pr-diff-selection | 66/66成功 | test-pr-diff-selection |
| npm run test:unit | 単体797/797、tooling 16/16成功。skipなし | test-unit |
| npm run build | 成功 | build |
| npm run typecheck:contracts | 成功 | typecheck-contracts |
| npm run validate:architecture | 成功 | validate-architecture |
| npm run validate:architecture:negative | 期待する違反11件を検出して成功 | validate-architecture-negative |
| npm run lint | 成功 | lint |
| node --test ../closure-probes.mjs | 27/27成功、skipなし | closure-probes |
| git diff --check | 成功 | Gitの直接確認 |

各npm／Node検証は `node tools/run-ci-command.mjs <診断ラベル> <コマンド>` で実行し、結果JSON・標準出力・標準エラー・結合ログを保存した。試験群は重複を含むため、件数を合算した総件数とはしない。
追加27件は、前回指摘と修正影響を検証するレビュー用試験であり、製品のテストファイルを変更していない。チェックイン済みのコンパイル済みfixtureを再利用し、その元の試験登録だけを抑制した。差分計画・core状態更新・PR runtimeは置き換えていない。
履歴用ポートだけに製品の履歴境界とrecorderを接続し、appenderへ渡されたイベントを捕捉した。これは実Extension Hostや実ファイル保存adapterを用いた試験ではない。
RDC証拠ルート: `/home/ibis/RevMem-pr120-pds06-rereview-evidence-20260916`。追加試験は `closure-probes.mjs`、捕捉イベントは `observed-events.json`、診断は `source/test-output/ci/rereview-pds06-*`、集約結果は `validation-summary.json`。
追加試験スクリプトSHA-256: `423f2e1474f5fd71071b0225aab53d8c72bc8a578e863a20d6aeed3bd96d3373`。これらはRDC先のファイルであり、アップロード済み成果物ではない。
修正時のRed→Greenは実装担当の報告にある履歴証拠として扱い、この再レビューで当時の未コミット状態を独立に証明したとはしない。今回は修正後の同一HEADで成功を再実行した。

## CIと診断workflow

開始時に `.github/workflows/ci.yml` と既存診断経路を確認した。テスト結果・stdout・stderr・結合ログを生成し、失敗時にtest-outputと関連ソース・生成物をartifactへ保存する既存workflowがある。追加・変更は不要だった。成功時にも同じ診断一式を公開する最終監査はPDS-10の範囲に残る。
GitHub connectorでCI run `35082927011` を確認。eventは `pull_request`、attempt 1、conclusionは `success`、head_shaは今回のレビュー対象 `8f2a67e1fe85851e5fc210e21da602ed4f11a7c1` と一致した。
対応artifactは `10441406775`、名前は `review-range-user-validation-0.1.53-pre+8f2a67e`。一覧・head_sha対応を確認したが、バイナリ内容は取得していない。
本レポートを含む記録用コミットをpushするとHEADが変わる。そのHEADのCIは別途確認し、レビュー対象HEADの成功を代用しない。記録用コミットのSHAとCI状態はPRコメント・最終回答へ記録する。

## レビュー範囲と留保

| 観点 | disposition | 確認結果 |
| --- | --- | --- |
| 要件・設計への適合 | checked_no_finding | 2件の必要対応は照合表の全行Complete |
| 正しさ・同種の境界条件 | checked_no_finding | 同一／別改訂、左右、確認／解除、繰返し、1件／2件履歴を確認 |
| 全変更ファイル・直接依存 | checked_no_finding | 修正差分10ファイル、core比較とPR投影・履歴生成・呼出元を確認 |
| API・設定・互換性 | checked_no_finding | 履歴reasonの分岐追加と共通判定利用。旧side・whole-fileの回帰成功 |
| エラー・診断 | checked_no_finding | 履歴Promiseと受信オブジェクトを保持し、既存の失敗伝播を変更しない。診断workflow確認 |
| security・secret handling | not_applicable | 修正は状態比較と固定reason値。新しい外部通信・認証経路はない |
| 試験の妥当性・必須経路 | checked_no_finding | 新規history試験がfocusedと既定unitに追加。既存試験の削除なし |
| current-HEAD CI | checked_no_finding | 対象SHA一致のpull_request CI成功 |
| 報告・追跡 | checked_no_finding | 実装報告の成功結果を再実行。追跡の再レビュー待ちは本確認前の状態として正当 |
| 回帰・保守性 | checked_no_finding | 独自比較の重複がなくなり、履歴境界を実コードで試験可能。追加必須指摘なし |
| PDS-07〜10 | held | 全表受入・競合/再読込・実Host・独立最終レビューと最終公開監査は後続担当 |

留保の担当はPDS-07〜10の実装・検証担当である。この27件は指摘修正の確認であり、後続の全表・実Host受入を済ませたことにはしない。後続タスクの未実施はPDS-06の2件の解消を妨げないが、機能全体の完成判断には必要である。
対象範囲内に判定を妨げる未探索事項はない。CI artifactのバイナリ内容、過去の未コミットソース、実ファイル保存・再起動は今回の独立確認対象に含めていない。

## 公開と次の操作

保存対象は本レポートと通常再レビューhandoffのみ。製品コード・製品テスト・設計・workflow・既存タスクファイルは変更せず、PDS-07は開始しない。マージは行わない。
PDS-06の指摘はこの同じ通常レビュワーによって解消確認済みとする。次の実装開始時に担当者がタスク／フェーズの記録を本結果へ同期し、指定された次タスクへ進む。
記録用コミットはnormal reportであり、独立最終レビューのattestationではない。技術判定は上記レビュー対象HEADに結び付ける。後続の記録用HEADへ製品変更が混在していないことを確認し、そのpush・PR更新・CI状態を別に記録する。

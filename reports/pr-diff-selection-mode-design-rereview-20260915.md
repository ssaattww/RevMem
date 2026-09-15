# PR差分の確認単位切替 — 設計再レビュー

## 判定と対象

**判定: fail（要修正）。前回のD1〜D3は全件未解消。新規の指摘IDは追加しない。**

- 日付: 2026-09-15（日本時間）
- Repository / PR: `ssaattww/RevMem` / #120
- モード: `fix_verification`。前回と同じチャットの通常レビュワーによる設計再レビューであり、独立最終レビューではない。
- 前回のレビュー対象: `428409326623a95826361d8953bf045997b8b8f6`
- 今回のレビュー対象: `bb14a8f217a0dd29e269939297aca5e51aff60ae`
- PR base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`
- branch: `investigation/issue-119-linked-diff-blocks`
- 対象設計: `Design/pr-diff-selection-mode.md`（185行、Git blob `e2c7d46c93e583eafb1642a26f5dfa9fcd8ee8bb`）
- 保存先: `reports/pr-diff-selection-mode-design-rereview-20260915.md`

この判定は上記のレビュー対象SHAに対するもの。本レポートの保存コミットはレビュー記録の追加であり、設計・実装の修正ではない。保存後のPR HEADと一致するCIは別途PRコメントに記録し、レビュー対象SHAのCIで代用しない。

## 範囲と要求

依頼はPR #120の設計再レビュー。前回のD1〜D3、その修正差分、同じ問題に属する周辺ケースを確認した。製品コードの未実装自体は指摘にしない。設計・製品・テスト・設定・workflowの修正、別タスクの整理、Issueのclose、mergeは実施しない。

上位の要求は、既存の片側モードを維持しながら変更ブロックの両側を一括更新すること、正常系と状態遷移を表で固定すること、実装時に表をテストの受入条件にすること。前回レビューの必要修正は、Globalを含む変更なし判定、選択境界の定義、ブロック情報と状態更新・履歴の接続契約である。

アップロードされた `chatgpt-worker-skills 3.zip` の `chat-review-worker`、`work-context-manager`、`review-worker`、`report-writer`、`chat-handoff-manager`を適用した。リポジトリの `AGENTS.md` と既存の作業規則も確認した。今回のような設計レビューに製品実装のRed/Greenは要求しない。後続の製品実装にはRevMemのTDD方針が適用される。

## 修正差分の確認

GitHub connectorのcommit比較で、前回SHAから今回SHAまでは3コミット、変更ファイルは次の3つだけであることを確認した。製品コード、既定テスト、workflowの変更はない。

| ファイル | 差分 | 確認結果 |
| --- | --- | --- |
| `Design/pr-diff-selection-mode.md` | 73行追加・22行削除 | 全185行と変更箇所を確認。未確認・一部確認・全確認の3状態、左右9組を確認と解除の双方に追加している |
| `reports/issue-119-feasibility/design-review-followup-20260915.md` | 新規66行 | 全文確認。対応対象は状態遷移の曖昧さであり、D1〜D3の対応完了とは記載されていない |
| `handoffs/issue-119-pr120-design-review-followup-20260915.yaml` | 新規236行 | 全文確認。対応IDは `design-state-transition-ambiguity`。D1〜D3の対応表は含まれていない |

一部確認を含む左右の最終状態の明文化、操作元が既に目的状態でも反対側へ反映する規則、各表の行をテスト化する規則は改善されている。ただし、これは以下の3指摘を解消する修正ではない。

## 継続指摘

### D1 — P2 / medium — Globalを含まない変更なし・履歴判定

- 状態: **未解消**。前回からIDとP2を維持する。`medium`は引継ぎschema上の表現であり、重要度の変更ではない。
- 起源: 前回の設計変更に対する指摘を継続。今回の表にも同じ問題が残る。
- 場所: `Design/pr-diff-selection-mode.md` の状態定義・置換ブロック表（71〜116行）と履歴・進捗・Global（165〜170行）。

新しい表でも、元・先が全確認で確認操作を行う場合、および両側が未確認で解除操作を行う場合を「状態変化なし。commitと追加履歴を作らない」としている。また、元側だけが変化する行を「元側の履歴だけ」としている。いずれもGlobalの対象範囲の状態を条件に含めていない。

| PR元側 | PR先側 | Globalの対象範囲 | 操作 | 既存規則に合わせた結果 |
| --- | --- | --- | --- | --- |
| 全確認 | 全確認 | 未確認 | 確認済みにする | PRは不変でもGlobalが変化し、modified側の履歴が必要 |
| 未確認 | 未確認 | 全確認 | 解除する | PRは不変でもGlobalが変化し、modified側の履歴が必要 |
| 未確認 | 全確認 | 未確認 | 確認済みにする | 元側とGlobalが変化するため、originalとmodifiedの両方の履歴が必要 |
| 全確認 | 未確認 | 全確認 | 解除する | 元側とGlobalが変化するため、originalとmodifiedの両方の履歴が必要 |

根拠は、既存の `DiffEditorReviewCommandService.hasSemanticChange` がContextとGlobalの両方を比較すること、および `ReviewHistoryRecorder.recordTransaction` がContextのmodified範囲またはGlobalの範囲のどちらかに変化があればmodifiedイベントを記録すること。今回も両ファイルのblobは前回と同一である。

影響: 表をそのまま受入テストや早期終了条件にすると、Globalだけの更新を省略するか、必要なmodified履歴を落とす。

必要な修正: ブロック展開後のContextとGlobalを含む実際の更新結果で変更なしを判定する。表のcommit有無と履歴対象側をこの規則に整合させ、上記のGlobalのみ変化するケースと元側＋Globalが変化するケースを確認・解除の受入条件へ追加する。ブロックの現在状態だけでcommitや履歴を確定させない。

### D2 — P2 / medium — ブロック接触判定の選択境界が未定義

- 状態: **未解消**。表とテストの対応規則は追加されたが、必要な選択境界の定義・ケースがない。
- 起源: 前回の設計変更に対する指摘を継続。
- 場所: `Design/pr-diff-selection-mode.md` のblockモード・正常系ケース表（33〜67行）、テストへの対応とブロック境界（139〜149行）、実装順序（178〜185行）。

「選択が接触する変更ブロック」という条件のままで、カーソルのみ、逆向き選択、終点が次行の列0、選択配列が空の場合を固定していない。

既存の `src/core/intervals/selections.ts:55–81` は、カーソルのみならその行を対象にし、非空の選択が列0で終わる場合は終点行を除外する。逆向き選択も文書上の順序に正規化する。したがって、未変更行から次の変更ブロック先頭の列0まで選択した場合、その変更ブロックは対象外である。変更行にカーソルだけを置く操作とは区別しなければならない。

影響: 接触判定の実装によっては、選んでいない次のブロック全体を確認・解除したり、既存のカーソル操作を無効にしたりする。

必要な修正: 既存の `selectionsToLineIntervals` で半開の行範囲へ正規化した後に、操作側のブロック範囲との重なりを判定すると明記する。カーソルのみ、正逆方向、列0終端、空の選択配列を表へ追加し、確認・解除と両方の操作側をテスト条件に対応付ける。

### D3 — P2 / medium — ブロック入力・複合更新・履歴の接続契約が未確定

- 状態: **未解消**。今回の修正差分には接続契約の追加がない。
- 起源: 前回の設計変更に対する指摘を継続。
- 場所: `Design/pr-diff-selection-mode.md` の設定境界（20〜24行）、blockモード（33〜45行）、原子性・履歴（151〜170行）、実装順序（178〜185行）。

一つのトランザクションで左右を更新する方針はあるが、どの層が変更ブロックを生成し、セッションからコマンドへ何を渡すか、どの状態更新操作と履歴分岐を使用するかが確定していない。

現行の `DiffEditorReviewStateSession` は削除範囲と未変更行の対応関係を持つが、左右の変更ブロックやhunkを渡す項目を持たない。現行の `OriginalSelectionReviewRangeMutationInput` は `side: "original"` と未変更行から対応付け済みのmodified範囲を前提にしている。履歴は `mark-original-selection-reviewed` / `unmark-original-selection-reviewed` という操作識別値で複合更新を判定する。これらは、modified側からも置換ブロックの両側を操作する今回の要求と区別して整理する必要がある。

影響: 既存APIをそのまま使うために操作元のsideを偽装する、変更ブロックを未変更行の対応関係へ混ぜる、または状態だけ両側に更新して履歴の分岐を落とす実装につながり得る。製品が既にそのように壊れていると断定する指摘ではない。

必要な修正: ブロック生成の責務、exact base/headとファイルに紐づく入力・セッション契約、左右操作用の状態更新APIを一般化するか追加するかの選択、操作識別値と履歴対象側の決定規則を設計書に記載する。未変更行の対応付けと変更ブロックの連動は分離する。PR以外の既存共有サービス利用箇所へblock動作を広げない結線も明記する。永続化schemaの追加を要求しているわけではない。

## 指摘ごとの完了条件照合

| ID | 必要な設計修正 | 今回の差分 | 設計の完了判定 | 製品の結合fixture |
| --- | --- | --- | --- | --- |
| D1 | Context＋Globalの変更なし判定と履歴対象の表 | 左右3状態を追加したがGlobal条件なし | 未完了 | 設計段階につき今回は対象外。実装時にGlobalのみ・元側＋Globalの更新を検証する |
| D2 | 選択正規化→重なり判定、境界ケースとテスト対応 | 各表行のテスト化のみ追加 | 一部対応・未完了 | 設計段階につき今回は対象外。実装時に実コマンド入力から境界を検証する |
| D3 | ブロック入力、セッション、更新操作、履歴の契約 | 対応する設計追加なし | 未完了 | 設計段階につき今回は対象外。実装時に左右の操作元から実結線を検証する |

製品fixtureがまだないことだけを設計レビューの不合格理由にはしない。今回の不合格理由は上記の設計記述の矛盾・不足である。D1〜D3は前回チャット回答が原典で、前回はGitHubへ投稿されていなかった。今回の修正側handoffが別の状態遷移指摘だけを列挙している事実と区別し、本レポートでは原典の3指摘を保持した。

## 検証環境と実行結果

RDC端末一覧を確認し、前回と同じFA780を使用した。`C:\Users\donabe\CodexProjects\RevMem` は今回のレビュー対象SHAで、実行開始時の追跡ファイルに変更はなかった。Windows PowerShell 5.1.22621.6133 / Node v24.20.0。製品コードとテストコードは編集していない。

| 検証 | 結果 | 証拠 |
| --- | --- | --- |
| GitHub connectorで前回SHAと今回SHAを比較 | 3コミット・上記3ファイルのみ | `compare_commits`、固定SHA間の比較 |
| `node tools/run-ci-command.mjs pr-diff-design-rereview-compile node node_modules/typescript/bin/tsc -p tsconfig.test.json` | 終了コード0 | `test-output/ci/pr-diff-design-rereview-compile.*` |
| 設計構造＋既存関連7ファイルを `node --test` | 46成功、0失敗、0skip、終了コード0 | `test-output/ci/pr-diff-design-rereview-focused.*` |
| 新しいblockモードの製品受入テスト | 未実装・未実行 | 既存テストの成功で代用しない |
| 全体ローカル `npm test` / 実Extension Host再実行 | 今回未実行 | 全体ローカルゲート成功とは主張しない |

実行したテストは `test-dist/test/unit/` 配下の `design-document-structure.test.js`、`diff-editor-review-command-service.test.js`、`original-diff-selection-projection.test.js`、`review-history-original-side.test.js`、`pr-diff-progress.test.js`、`issue-92-pr-progress-selection-review.test.js`、`t303-review-followup.test.js`。

診断ラッパーは各labelについて `.stdout.log`、`.stderr.log`、`.log`、`.result.json` を保存する。実行結果・標準出力・標準エラーを成功時にも保持した。これらはFA780のローカル証拠であり、GitHub artifactにアップロード済みとは主張しない。

## CIと診断artifact

作業開始時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。テスト結果、標準出力・標準エラー、環境・checkout SHA、関連ソース等を失敗時に保存する `ci-failure-diagnostics-*` が既に存在するため、workflowの追加修正は不要だった。

レビュー対象SHAの `pull_request` CIはrun **34898588988 / attempt 1**。runの `head_sha` が `bb14a8f217a0dd29e269939297aca5e51aff60ae` と一致し、`completed / success` であることを確認した。

同runにはartifact **10369653405**、`review-range-user-validation-0.1.53-pre+bb14a8f` が存在し、expiredはfalse。artifact一覧・SHAを確認したが、内容のダウンロード・再検査は今回行っていない。成功runなので失敗診断artifactがないことは異常ではない。

レポート公開後はPR HEADが変わる。公開後HEADのrunは必ず別に照合し、runがなければCI未実施、実行中なら未完了としてPRコメントに記録する。

## カバレッジと未検証範囲

| 観点 | 判定 | 内容 |
| --- | --- | --- |
| 要求・設計整合性 | checked_finding | D1〜D3 |
| 正常系・境界・同種ケース | checked_finding | Globalのみの更新、元側＋Global、選択端。左右3状態の列挙は改善 |
| 変更ファイル・直接依存 | checked_finding | 設計・追記レポート・handoff、コマンド・区間変換・状態更新・履歴との照合 |
| API・データ・設定・互換性 | checked_finding | D3。永続化schema変更の必要性は未確定であり、追加を要求しない |
| エラー・診断 | checked_no_finding | 既存失敗診断workflowと今回のローカル出力保存を確認 |
| スコープ | checked_no_finding | 設計のみの修正。製品未実装を追加指摘にしない |
| セキュリティ | not_applicable | 認証・秘密情報・実行コードの変更なし。セキュリティ監査は実施しない |
| テスト十分性 | checked_finding | D1・D2の受入条件不足。既存46件成功と新機能の検証を分離 |
| 対象HEADのCI | checked_no_finding | 対象SHA一致の成功runを確認 |
| 文書・報告・追跡 | checked_no_finding | 修正側報告は別の状態遷移指摘を対象としている。既存task追跡は変更しない |
| 保守性・回帰 | checked_finding | D2・D3の境界と共有APIの契約 |

文書の意味・条件・用語の対応も確認した。D1の条件欠落を語句の好みの問題には扱わない。機械的な設計構造テストの成功は設計内容の妥当性を証明しない。無関係な過去のtask状態や歴史的レポートの全面監査は対象外である。

保留へ移した必須指摘はない。新機能の実Extension Host表示、実ディスク競合、性能、完全な製品受入表は未検証であり、製品完成・出荷承認は行わない。独立最終レビューも今回の対象外。

## 次の作業と公開境界

設計修正担当はD1〜D3をそれぞれ設計記述とケース表へ反映し、各必要修正と設計箇所・受入ケースを対応付けること。設計修正後はこの通常レビューチャットで再確認する。製品実装は別途の承認後に、修正済み表から失敗テストを作成して開始する。

今回のリポジトリ書込みは本レポートのみ。GitHub connectorで既存PRブランチに保存し、別途簡易報告をPRコメントへ投稿する。公開SHAと公開後CIはコメントで補完する。本レポートを保存したことによってD1〜D3が解消したとは扱わない。mergeは行わない。

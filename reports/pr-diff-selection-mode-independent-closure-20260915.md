# PR差分の確認単位切替 — 独立設計レビューの指摘解消確認

## 判定と対象

**判定: pass（設計の再レビュー合格）。IR1 / P2は設計上closed。未解消の必須指摘と新規指摘は0件。製品実装の合格判定ではない。**

- Repository / PR: `ssaattww/RevMem` / #120
- 日付: 2026-09-15（日本時間）
- モード: `independent_final_closure`。初回独立レビューと同じチャットによる、IR1・修正差分・CIに限定した確認。
- 初回独立レビュー対象: `02440ff43ffa980657a2bb101cd1b3f3ba13c704`
- 前回報告公開commit: `cda5317a6895c4e31628219bae48fc54460995de`
- 今回レビュー対象: `0b29680494858ddf750fc890d45dedbf412de063`
- base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`
- branch: `investigation/issue-119-linked-diff-blocks`
- 差分範囲: `cda5317a6895c4e31628219bae48fc54460995de..0b29680494858ddf750fc890d45dedbf412de063`
- 保存先: `reports/pr-diff-selection-mode-independent-closure-20260915.md`

このチャットは製品実装・設計修正・通常レビューを担当していない。前回の独立レビュー、報告の公開、今回の限定再レビューを担当した。独立レビューを最初からやり直したり、別の判定基準を追加したりしていない。

## 範囲と上位の指定

対象は調査・設計PRである。IR1の設計上の不足を確認し、既存製品の不具合修正が完了したかどうかとは分けて判断した。

「設計書には実装の不備を書かず、実装上の不備はtasklist作成時に織り込む」「指摘を満たす必要箇所だけ修正する」という利用者指定を確認した。このため、具体的なAPI候補・実装順序の削除だけを理由にD3を再開しない。後続の実装調整は対応報告と引継ぎに残されている。今回tasklistの作成・更新は行わない。

アップロードされた `chatgpt-worker-skills 3.zip` のレビュー・報告・引継ぎ用Skill、リポジトリの `AGENTS.md`、前回レビューで参照した文書表現点検の規則を使用した。TDDは後続の製品実装に適用するものであり、この設計再レビューで製品のRed/Green完了を要求しない。

## 修正差分と読んだ範囲

前回報告公開後は2コミット、次の3ファイルだけが変更されている。

| ファイル | 読んだ範囲と役割 |
| --- | --- |
| `Design/pr-diff-selection-mode.md` | 全308行と前回からの全差分。行数、末尾改行、受入表、受渡し、状態・履歴・安全性の契約 |
| `reports/pr-diff-selection-mode-newline-contract-followup-20260915.md` | 全74行。IR1への対応、設計と実装作業の分離、検証の限界 |
| `handoffs/issue-119-pr120-newline-contract-followup-20260915.yaml` | 全115行。後続tasklistへの引継ぎ、未実装の区別 |

設計blobは `83a16fd656f9f66ebc6ef81d3b97c97f902710c9`。GitHub connectorで取得した値とRDC上の対象commitが一致した。`src` treeは `4e483021703f1dbf5a3e2bb1814a0a4d2de2316f`、`test` treeは `7f55c995d49fcae1a44e10e8e8e3c61938ea09c3` で、初回レビュー対象と同一である。workflow、診断runner、AGENTS、task/phase追跡も今回の差分に含まれない。

## IR1 / P2 — closed in design

初回指摘は、既存runtimeのエディタ行数をGit差分の行数として再利用する設計では、有効な末尾改行付きの追加・削除・置換を拒否する点だった。重要度はP2 / mediumのまま保持し、製品回帰ではなく既存依存処理の制約を設計が取り込めていなかった問題として扱う。

今回の設計169〜190行は、エディタ行数と差分内容行数を区別している。既存空ファイルは1 / 0、不存在は0 / 0とし、末尾改行後の表示空行を差分内容行へ数えない。選択境界にはエディタ行数を使い、hunk・ブロック・未変更行の対応・末尾の整合性には差分内容行数を使う。LFとCRLFも区別している。

192〜226行の表には初回再現の7条件が全て含まれ、CRLFの追加・削除、既存空ファイルへの追加・空への変更、末尾改行だけの追加・削除も加わっている。内容と行数の表は13行、操作側と確認・解除の表は4行である。表の数値・対象側を定義と照合した。表示上の末尾空行だけ、または既存空ファイルの表示行だけの操作は状態更新なしと明記されている。

230〜258行は、同じ改訂の本文と差分から存在有無・両方の行数・末尾改行をアプリケーション境界で確定し、操作セッションの不変入力としてブロック生成と未変更行対応へ渡す契約である。矛盾する差分を検証の緩和で受け入れない規則も残っている。旧設計の「既存の行数をそのまま使えばよい」という前提は解消された。

### 必要修正との対応表

| IR1の必要修正 | 設計・引継ぎ上の証拠 | 製品経路・実接続試験との対応 | 判定 |
| --- | --- | --- | --- |
| 行数・末尾空行・空ファイル・不存在側の区別と入力の責務 | 設計169〜190、230〜258行 | 本文取得からPR sessionへ渡す入力契約を修正対象として引き継ぐ。製品は未変更 | 設計上完了 |
| session・未変更行対応・ブロック生成で契約を統一し、不完全な差分拒否を維持 | 設計184〜190、230〜258行。対応報告の後続作業、handoffの `tasklist_carry_forward` | parser → PR runtime → session → projection → commandの既存経路を維持し、必要な調整を後続tasklistで扱う | 設計上完了 |
| 再現7条件、空ファイル、LF/CRLF、操作側、確認・解除を受入条件にする | 設計192〜226、294〜308行。handoffの表から先にテストを作る指定 | 初回の実接続probeを今回の製品から再コンパイルして再実行。新契約に対応する製品試験は実装工程の対象 | 設計上完了 |

実接続probeは `buildSnapshotFromLocalGitDiff` → `PullRequestReviewRuntime` → 左右URI検証 → 実コマンド → session → 未変更行対応を通す。保存先・本文取得・画面・履歴受付はメモリ内の代替実装であり、実Extension Hostの試験ではない。

実装上の不備と具体的修正を設計へ再追記することは要求しない。利用者指定どおり、後続tasklist作成時に上記経路の調整と実接続試験を扱う。設計段階なので、未実装の新しい製品経路が合格することを今回の完了条件へすり替えない。

## D1・D2・D3の維持

D1の3成分・変更有無8組・Globalのみの履歴、D2の選択正規化と列0終端・空選択、D3の入力責務・PR限定・原子的更新・実際の変化に基づく履歴は、修正差分でも保持されている。具体的な型や関数名が除かれても、左右の更新対象を操作元で偽装する仕様には戻っていない。今回の範囲でこれらを再開する理由は認めなかった。

## 今回の検証

| 検証 | 結果と解釈 |
| --- | --- |
| 対象HEADからテストソースをコンパイル | exit 0 |
| 既存関連10ファイル | 77成功・0失敗・0skip、exit 0 |
| 既存の設計構造テスト | 1成功・0失敗、exit 0。新しい設計内容の意味を自動検証するものではない |
| 初回の末尾改行再現7条件 | 3成功・4失敗、exit 1。既存製品の問題が残ることを再確認 |
| `git diff --check cda5317 0b29680` | exit 0 |
| 設計中の作業管理番号パターン検査 | 0件 |
| 検証後の作業ツリー | clean |
| 全体ローカル試験・実Extension Host・新block実装の受入試験 | 今回未実施 |

77件は `diff-editor-review-command-service`、`original-diff-selection-projection`、`diff-review-state-service`、`review-history-original-side`、`review-history-recorder`、`t405-pull-request-review-runtime`、`issue-92-pr-progress-selection-review`、`issue-112-pr-review-projection-sync`、`line-intervals`、`pr-diff-progress` の各 `.test.js` である。修正担当が報告した88件とは別の実行集合であり、混同していない。

再現試験の4失敗は、新規 `new\n`、削除 `old\n`、`old` → `new\n`、`old\n` → `new` の条件である。いずれも `Immutable diff tail does not preserve a one-to-one context mapping.` となり、保存・履歴受付は0回。これを成功扱いしない。今回の設計合格は、この製品問題の修正完了を意味しない。

## 実行環境と診断証拠

RDCの端末一覧を確認し、前回と同じFA780を使用した。Windows / PowerShell / Node v24.20.0。レビュー専用の分離作業ツリー `C:\Users\donabe\Project\RevMem-independent-pr120-closure-20260915` は今回の対象SHAに固定した。元の作業ツリーを切替・reset・cleanしていない。

出力は別の `C:\Users\donabe\Project\RevMem-independent-pr120-closure-evidence-20260915` に保存した。`validate.mjs`、`context.json`、各検証の `.stdout.log`・`.stderr.log`・`.result.json`、`validation-results.json`、再現コード・結果・来歴を保持する。これらはPC上のローカル証拠であり、GitHub Actions artifactではない。

依存は元の作業ツリーのnode_modulesを参照し、package-lockのSHA-256一致を確認した。TypeScriptには対象のtsconfigと外部出力先・依存探索先を指定した。設計構造テストが参照する既存doc/designと検査スクリプトも無変更で出力先へコピーした。再現probeは結果メタデータの対象SHAだけを更新し、試験ロジックは変更していない。

着手時に既存CIと `tools/run-ci-command.mjs` を確認した。標準出力・標準エラー・結果JSON・関連ログ・環境情報・ソースを失敗診断artifactに保存する仕組みが存在するため、workflowは変更していない。

## CI

レビュー対象HEADに一致する `pull_request` CIは run `34933087340` / attempt 1 / `completed / success`。runの `head_sha` が `0b29680494858ddf750fc890d45dedbf412de063` と一致することをGitHub connectorで確認した。

artifact `10382845854` / `review-range-user-validation-0.1.53-pre+0b29680` の存在・同じHEADへの帰属・未期限切れを確認した。内容のダウンロードやVSIXのインストールは行っていない。このCIに独立した末尾改行probeは含まれない。

本報告の公開後はPR HEADが変わるため、新しいHEADに一致するrunを別途確認してPRコメントに記録する。上記runを公開後HEADの成功証拠として流用しない。

## 限定再レビューのカバレッジ

| 観点 | 状態 | 根拠 |
| --- | --- | --- |
| 要求・設計整合、正確性・境界 | checked_no_finding | IR1の3要求、行数と操作側の表、入力契約 |
| 差分・直接依存・互換性 | checked_no_finding | 変更3ファイル、src/test不変、D1〜D3の仕様維持 |
| エラー・診断・安全性 | checked_no_finding | 不完全差分拒否、比較identity固定、既存診断workflow。新しい認証・権限変更なし |
| 受入条件・検証結果の扱い | checked_no_finding | 設計受入表と製品未実装を分離。再現4失敗を保持 |
| 対象HEADのCI | checked_no_finding | SHA・event一致の成功run |
| 文書・報告・追跡 | checked_no_finding | 設計とtasklistの責務分離、過去報告のSHAと時点を保持 |
| 文書表現 | checked_no_finding | 変更3ファイルの意味・対象の識別・可読性を同じレビュワーが確認 |
| 製品完成・出荷承認 | not_applicable | 製品コード未変更。新block動作、実画面、実ディスク競合、性能は未検証 |

Markdown用の独立したlint設定・用語承認台帳は確認されておらず、Markdown lint合格とは主張しない。文書表現の点検と設計構造テストは別の証拠である。必須指摘を保留へ移したものはなく、設計の限定再レビューを妨げる未調査項目はない。

## 公開と次工程

この報告の技術判定は `0b29680494858ddf750fc890d45dedbf412de063` に限定する。書込みは本報告1ファイルの管理commitとPRコメントのみ。設計・製品・既定テスト・設定・workflow・tasklist・過去報告を修正しない。公開commitの親と変更ファイルを照合し、そのSHAはPRコメントで記録する。

初回handoffの `reserved_report_paths` は空だったため、存在しなかった初回予約の証拠を遡及して作らない。本報告は指摘解消の記録であり、製品出荷や完全な最終合格証明の代用ではない。引継ぎはPRブランチ外へ保存し、報告後に追加commitを重ねない。

次工程は、利用者がtasklist作成・実装を指示した際に、対応報告とhandoffの行数境界の調整項目を取り込み、本文取得から実コマンドまで通す受入テストを先に作ること。今回その作業を開始していない。Issue close、draft解除、mergeは行わない。

# PR #120 独立設計レビュー

## 判定と対象

**判定: fail（設計要修正）。新規必須指摘は IR1 / P2 の1件。既存の D1・D2・D3 は設計上の解消を確認した。**

- 対象: ssaattww/RevMem / PR #120
- レビュー日: 2026-09-15（日本時間）
- レビュー対象HEAD: `02440ff43ffa980657a2bb101cd1b3f3ba13c704`
- base: `989317e00893e3b45a9e77ecb550e99274ac7e69`
- branch: `investigation/issue-119-linked-diff-blocks`
- モード: independent final review。対象範囲は調査・設計であり、製品実装の完成判定ではない。
- 独立性: このチャットでは実装・指摘修正・通常レビューを行っていない。設計と既存コードを独立に照合した後、過去のレビュー報告と指摘対応報告を確認した。

開始時と終了前にGitHub connectorでHEADを照合し、変化がないことを確認した。製品コード、設計、既定テスト、設定、workflow、追跡ファイルを編集していない。GitHubへのコメント・コミット・push・merge・Issue closeは行っていない。レビュー成果物と追加実験はPRブランチ外に保存した。合格証明コミットは作成していない。

## IR1 / P2 — 末尾改行を含む差分の行数契約を定義する必要がある

**場所:** `Design/pr-diff-selection-mode.md:176–192`。関連する受入条件は同文書の追加のみ・削除のみの正常系表と、テストへの対応の節。

**起源:** 既存依存処理の制約を、新しいブロック機能の設計が取り込めていない問題。既存コードの不具合を、このPRによる製品コードの回帰として扱う指摘ではない。

設計は `originalLineCount`、`modifiedLineCount`、完全な `DiffHunk[]` を入力とし、既存の座標・行数検証と同等の不変条件を使い、既存の `openSession` へブロック生成を接続する。しかし、エディタの末尾空行を含む行数と、差分の行数の差をどう扱うかが定義されていない。

既存runtimeは、存在する文書の行数を `text.split(/\r\n|\r|\n/u).length` で求める。一方、`createOriginalToModifiedLineMappings` はhunkの消費行数を引いた残りが元・先で一致しないとエラーにする。

例えば新規ファイルの内容が `new\n` の場合、元側の行数は0、先側の文書行数は2となるが、完全な差分 `@@ -0,0 +1 @@` の追加行数は1である。残り行数が0対1となり、次のエラーで確認操作が停止する。

```text
Immutable diff tail does not preserve a one-to-one context mapping.
```

**再現経路:** 既存の `buildSnapshotFromLocalGitDiff` → `PullRequestReviewRuntime.register` → `openReviewDiff` → 左右URIの検証 → 実際のコマンドサービスの `markSelectionReviewed` → `openSession` → 未変更行の対応付け。

入力は有効な追加・削除・置換の差分である。保存先、履歴受付、画面ホスト、改訂の本文取得はメモリ内の代替実装とした。実際のparser・runtime・コマンド・対応付け処理は対象HEADからコンパイルしたものを使用した。実Extension Hostで再現したという主張ではない。

### 独立して追加した7条件の観測

表の `\n` は実際のLFを表し、「不存在」は長さ0の既存ファイルとは区別する。

| ファイルの変更 | 元の内容 | 先の内容 | 観測結果 | commit / 履歴受付 |
| --- | --- | --- | --- | --- |
| 新規追加 | 不存在 | `new` | applied | 1 / 1 |
| 新規追加 | 不存在 | `new\n` | 上記エラー | 0 / 0 |
| 削除 | `old` | 不存在 | applied | 1 / 1 |
| 削除 | `old\n` | 不存在 | 上記エラー | 0 / 0 |
| 置換、両側に末尾改行 | `old\n` | `new\n` | applied | 1 / 1 |
| 置換と末尾改行追加 | `old` | `new\n` | 上記エラー | 0 / 0 |
| 置換と末尾改行削除 | `old\n` | `new` | 上記エラー | 0 / 0 |

7条件を「有効な変更行の確認が成功する」という期待値でテストにした結果は **3成功・4失敗・0skip、終了コード1**。末尾改行を持たない追加・削除、および両側に末尾改行がある置換は成功し、入力全体の組み立てが常に失敗しているわけではないことも確認した。

### 影響と判断

追加のみ・削除のみを正常系として要求しているのに、既存のsession検証を無変更で再利用する構成では、上記の有効な入力を処理できない。今回の調査用probeは合成された行数での試験であり、この本文からの行数計算経路を検証していない。

`src`と`test`のGit treeはbaseとHEADで同一である。既存コード由来の問題であり、ブロック機能がこのPRで実装済み・破損したという意味ではない。設計段階で、必要な入力・既存処理の調整範囲・受入条件を明示すべきという指摘である。

### 必要な設計修正と完了条件

1. エディタの行数、Git差分で数える行数、末尾の空行、存在しない側、長さ0の既存ファイルの区別を定義する。末尾改行の有無など、完全な差分と不完全な差分を区別するために必要な根拠を、どの層で用意してどの処理へ渡すかを決める。
2. `openSession`、未変更行の対応付け、変更ブロック生成の間でこの契約を揃える。既存処理の修正が別作業になる場合は、ブロック機能を成立させる前提作業として明示する。単に末尾の行数一致検証を緩め、不完全なhunkまで受け入れる修正にはしない。
3. 上記7条件を受入表へ追加し、空ファイル、LF/CRLF、確認・解除、操作側、存在しない側の扱いも固定する。実装時は本文取得からsessionとコマンドまで通すテストを先に作り、エディタ行数を合成値へ置き換えた試験だけで代用しない。

今回の完了条件は設計・受入条件の修正であり、このレビュー依頼に含まれない製品修正を要求・実施したわけではない。

## 既存指摘の照合

| ID | 重要度 | 今回の確認 |
| --- | --- | --- |
| D1 | P2を維持 | original・modified Context・Globalの3成分、変更有無8組、Globalのみの変化、履歴対象が設計に定義されている。設計上closed。 |
| D2 | P2を維持 | selectionsToLineIntervalsで正規化後に重なりを判定する。カーソル、正逆方向、列0終端、空配列が定義されている。設計上closed。 |
| D3 | P2を維持 | ブロック生成、PR限定session、専用入力・transaction union・履歴分岐、未変更行の写像との分離が定義されている。設計上closed。 |

IR1をD1〜D3の未解消として読み替えず、別の入力境界の問題として記録する。重要度の変更は行っていない。

## 検証結果

| 検証 | 今回の結果 |
| --- | --- |
| 対象HEADからのテストソースのコンパイル | 成功、終了コード0 |
| コマンド・区間変換・状態・履歴・runtime・表示同期・進捗の既存関連10ファイル | 77成功・0失敗・0skip |
| 既存設計構造テスト | 1成功・0失敗。新しいDesign文書の意味の検証ではない |
| PRに含まれるprobe（無変更コピー） | 7成功・0失敗 |
| 同probeの `--require-feature` | 5成功・2失敗。未実装を示す想定された失敗 |
| 独立して追加した末尾改行の再現試験 | 3成功・4失敗、終了コード1。IR1の根拠 |
| `git diff --check BASE HEAD` | 成功 |
| 今回のDesign文書の作業管理番号パターン検査 | 0件 |
| exact-HEAD CI | run 34904527141 / attempt 1 / pull_request / completed / success |
| 全体ローカル `npm test`、実Extension Host、CI成果物のインストール | 今回未実施 |

対象PRのCI成功は、独立して追加した末尾改行試験の成功を意味しない。新規block機能の製品受入試験も未実装であり、既存テストの成功をその代わりにしていない。

### 実行環境・分離・試行上の制約

RDC端末一覧を確認してFA780を選択。Windows / PowerShell / Node v24.20.0 / npm 11.19.0で実行した。レビュー作業ツリーは `C:\Users\donabe\Project\RevMem-independent-pr120-20260915`。生成物と再現試験は別の `C:\Users\donabe\Project\RevMem-independent-pr120-evidence-20260915` に保存した。

元の作業ツリーのnode_modulesを利用し、両作業ツリーのpackage-lock.jsonのSHA-256が一致することを確認した。TypeScriptは対象作業ツリーのtsconfig.test.jsonを使い、出力先、依存探索先、型探索先を明示した。既存のコンパイル済み製品を対象HEADの検証として流用していない。

設計構造テストの最初の実行は、出力を外部ディレクトリに分けたため、__dirname基準の参照先にdocがなくENOENTとなった。必要な既存設計ディレクトリと検査スクリプトを無変更で外部出力先へコピーし、主要ファイルのハッシュ一致を確認して再実行した結果が上表の1成功である。この失敗を製品不具合として計上していない。補助的なPowerShellのJSON読取も既定文字コードによる失敗があったが、これをpackage.json破損や製品テスト失敗として扱っていない。

## 確認範囲

変更10ファイルを全文確認した。

- `Design/pr-diff-selection-mode.md`
- `reports/issue-119-feasibility/README.md`
- `reports/issue-119-feasibility/probe.mjs`
- `reports/issue-119-feasibility/design-review-followup-20260915.md`
- `reports/pr-diff-selection-mode-design-findings-followup-20260915.md`
- `reports/pr-diff-selection-mode-design-rereview-20260915.md`
- `reports/pr-diff-selection-mode-design-review-closure-20260915.md`
- `handoffs/issue-119-feasibility-20260910.yaml`
- `handoffs/issue-119-pr120-design-findings-followup-20260915.yaml`
- `handoffs/issue-119-pr120-design-review-followup-20260915.yaml`

直接依存は選択変換、diffコマンド、未変更行の対応付け、状態更新、履歴、PR runtime、local base/head runtime、実コマンドの左右URI検証、差分parser、関連テストを確認した。CIとtsconfigも確認した。過去の報告は各報告が対象とするSHA・検証時点を区別して読んだ。

| 必須観点 | 判定 | 根拠 |
| --- | --- | --- |
| 要求・設計整合 | checked_finding | IR1。side既定、PR限定、状態・選択表は整合 |
| 正確性・境界 | checked_finding | IR1。末尾改行の7条件を追加検証 |
| 変更範囲・直接依存 | checked_finding | 10変更ファイル全文と上記直接依存 |
| API・データ・設定・互換性 | checked_finding | IR1の行数入力契約。専用transactionと保存形式維持は確認 |
| エラー処理・診断 | checked_finding | 有効なdiffの不正扱い。既存CAS・古いURI拒否・診断workflowは確認 |
| セキュリティ・秘密情報 | checked_no_finding | 今回の差分に認証や権限変更なし。比較・file identityの検証を確認。包括的監査ではない |
| テストの十分性 | checked_finding | IR1の受入条件不足。既存・調査・独立再現試験を区別 |
| 対象HEADのCI | checked_no_finding | SHAとevent一致の成功run |
| 文書・報告・追跡 | checked_no_finding | 過去報告の対象SHAと製品未実装を区別。表現の好みだけの指摘なし |
| 回帰・保守性 | checked_finding | 既存の行数検証を再利用する前提の不足 |
| 製品完成・出荷の判定 | not_applicable | 調査・設計PR。block未実装 |

設計判定を妨げる未調査領域は追加で残していない。ただし新規blockの実画面、実ディスク競合、大規模diff性能、LF/CRLF全組合せ、空ファイル全組合せの製品動作は今回の実験では検証していない。これらを成功扱いしていない。必須指摘を保留へ移したものはない。

## 根拠と証拠ファイル

- [対象PR](https://github.com/ssaattww/RevMem/pull/120)
- [設計の行数入力・接続契約](https://github.com/ssaattww/RevMem/blob/02440ff43ffa980657a2bb101cd1b3f3ba13c704/Design/pr-diff-selection-mode.md#L176-L192)
- [runtimeの行数計算と対応付け呼出し](https://github.com/ssaattww/RevMem/blob/02440ff43ffa980657a2bb101cd1b3f3ba13c704/src/composition/pull-request/pull-request-review-runtime-base.ts#L736-L762)
- [末尾行数一致の検証](https://github.com/ssaattww/RevMem/blob/02440ff43ffa980657a2bb101cd1b3f3ba13c704/src/application/review-commands/original-selection-review-plan.ts#L147-L152)
- [対象HEAD一致のCI](https://github.com/ssaattww/RevMem/actions/runs/34904527141)

添付の `newline-boundary-probe.mjs`、`newline-boundary-results.json`、`validation-results.json` はRDCから転送した実行ソースと結果である。転送データのSHA-256を検証した。stdout/stderrを含む全ローカルログはFA780の上記evidenceディレクトリに残しており、GitHub Actions artifactへアップロードしたとは主張しない。

## 次の作業

設計修正担当がIR1の3つの必要修正について、修正箇所・受入表・将来の実接続テストを対応表で示す。その後、この独立レビューの継続としてIR1と新しい差分・CIを限定して確認する。今回の判定を別HEADへ自動的に引き継がない。製品実装やmergeは別の指示があるまで行わない。

## 公開追記（2026-09-15）

利用者の「pushして」の指示により、この詳細報告をPR #120の既存ブランチへ保存する。本文の未投稿・未pushという記載は、前回レビュー完了時点の記録である。今回は報告ファイルだけの管理コミットであり、IR1の修正や合格証明ではない。レビュー判定と検証結果は引き続き `02440ff43ffa980657a2bb101cd1b3f3ba13c704` に対するものとする。

公開後のコミットSHA、PRコメント、公開後HEADに一致するCI結果はPRコメントへ記録する。前回の成功runを公開後HEADのCIとして代用しない。添付の再現コード・結果・引継ぎ一式は、前回のチャットで配布した `pr120_independent_review.zip` にあり、今回のリポジトリ追加対象には含めない。

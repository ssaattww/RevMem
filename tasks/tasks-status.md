# Review Range Tracker タスク状況

> 更新ルール: このファイルは `task-breakdown-planner`、`task-consistency-manager`、または `progress-sync-manager` を通してのみ更新する。

## 現在位置

- 設計根拠: `doc/design/vscode-review-range-tracker-design.md` rev1、Issue #13規範的追補 `doc/design/issue-13-document-context-routing.md`
- GitHub Issue: #1、#13
- 現在のPhase: P1 ローカル行範囲管理（完了）、P2 編集・Git差分追従（進行中）、Issue #13横断対応（完了）
- 直近完了タスク: Issue #13 document ownership routing
- 現在のタスク: なし
- 次のタスク: T203 diff parserとrevision間interval mapping
- 実装状態: T202 Local Git Adapterを利用し、Git ownershipをworkspace membershipより先に解決するdocument router、workspace外Git file、external-file、UNC authority、owner昇格、external persistenceを実装した。コードhead `ee95f6bdeaec5d51dbe3e340ed340ca97642c441`のrun `30093939815`と文書同期後head `d390515972093359a8304414e5fd42b34c32d0db`のrun `30094129294`で全CI工程が成功した
- ブロッカー: なし
- Gitブランチ: `issue/13-document-context-routing`
- Pull Request: #15
- PR方針: Issue #13の設計追補、テスト先行実装、独立レビュー、CI証跡を1本のdraft PRへ集約し、マージはユーザーが行う
- T001実装レポート: `reports/issue-1-t001-implementation-20260723104931.md`
- T001レビューレポート: `reports/issue-1-t001-review-20260723110231.md`
- T002実装レポート: `reports/issue-1-t002-implementation-20260723111412.md`
- T002初回レビューレポート: `reports/issue-1-t002-review-20260723112423.md`
- T002修正レポート: `reports/issue-1-t002-rework-20260723112951.md`
- T002再レビューレポート: `reports/issue-1-t002-rereview-20260723113759.md`
- T002追加修正レポート: `reports/issue-1-t002-rework-2-20260723114207.md`
- T002最終レビューレポート: `reports/issue-1-t002-rereview-2-20260723114440.md`
- T003実装レポート: `reports/issue-1-t003-implementation-20260723114808.md`
- T003初回レビューレポート: `reports/issue-1-t003-review-20260723115746.md`
- T003修正レポート: `reports/issue-1-t003-rework-20260723120313.md`
- T003最終レビューレポート: `reports/issue-1-t003-rereview-20260723120507.md`
- T101実装レポート: `reports/issue-1-t101-implementation-20260723123000.md`
- T101レビューレポート: `reports/issue-1-t101-review-20260723123200.md`
- T101独立再レビューレポート: `reports/issue-1-t101-review-r2-20260723123638.md`
- T101 review follow-upレポート: `reports/issue-1-t101-review-followup-20260723124645.md`
- T101最終再レビューレポート: `reports/issue-1-t101-review-r3-20260723125125.md`
- T102実装レポート: `reports/issue-1-t102-implementation-20260723132500.md`
- T102レビューレポート: `reports/issue-1-t102-review-20260723133000.md`
- T102初回レビューレポート: `reports/issue-1-t102-review-20260723132249.md`
- T102 review follow-upレポート: `reports/issue-1-t102-review-followup-20260723133429.md`
- T102最終再レビューレポート: `reports/issue-1-t102-review-r2-20260723134447.md`
- T103実装レポート: `reports/issue-1-t103-implementation-20260723135000.md`
- T103レビューレポート: `reports/issue-1-t103-review-20260723135500.md`
- T103独立再レビューレポート: `reports/issue-1-t103-review-r2-20260724140033.md`
- T103 review follow-upレポート: `reports/issue-1-t103-review-followup-20260723140931.md`
- T103最終再レビューレポート: `reports/issue-1-t103-review-r3-20260723141902.md`
- T104実装レポート: `reports/issue-1-t104-implementation-20260723142500.md`
- T104レビューレポート: `reports/issue-1-t104-review-20260723143000.md`
- T104独立再レビューレポート: `reports/issue-1-t104-review-r2-20260723144001.md`
- T104 review follow-upレポート: `reports/issue-1-t104-review-followup-20260723144622.md`
- T104再レビューレポート: `reports/issue-1-t104-review-r3-20260723145327.md`
- T104追加review follow-upレポート: `reports/issue-1-t104-review-followup-r2-20260723145703.md`
- T104最終再レビューレポート: `reports/issue-1-t104-review-r4-20260723150344.md`
- T104-2復旧実装レポート: `reports/issue-1-t104-2-implementation-20260724205127.md`
- T104-2初回レビューレポート: `reports/issue-1-t104-2-review-20260724210309.md`
- T104-2最終再レビューレポート: `reports/issue-1-t104-2-review-r2-20260724211200.md`
- T105実装レポート: `reports/issue-1-t105-implementation-20260723155600.md`
- T105レビューレポート: `reports/issue-1-t105-review-20260723155800.md`
- T106実装レポート: `reports/issue-1-t106-implementation-20260723175644.md`
- T106レビューレポート: `reports/issue-1-t106-review-20260723175800.md`
- T107実装レポート: `reports/issue-1-t107-implementation-20260723201924.md`
- T107レビューレポート: `reports/issue-1-t107-review-20260723201924.md`
- T108調査レポート: `reports/issue-1-t108-investigation-20260723225437.md`
- T108実装レポート: `reports/issue-1-t108-implementation-20260723230550.md`
- T108初回レビューレポート: `reports/issue-1-t108-review-20260723231514.md`
- T108 review follow-upレポート: `reports/issue-1-t108-review-followup-20260723232037.md`
- T108最終再レビューレポート: `reports/issue-1-t108-review-r2-20260723232331.md`
- T109調査レポート: `reports/issue-1-t109-investigation-20260724201518.md`
- T109実装レポート: `reports/issue-1-t109-implementation-20260724202210.md`
- T109要件変更follow-upレポート: `reports/issue-1-t109-requirement-followup-20260724203235.md`
- T109レビューレポート: `reports/issue-1-t109-review-20260724202930.md`
- T201実装レポート: `reports/issue-1-t201-implementation-20260723142751.md`
- T201初回レビューレポート: `reports/issue-1-t201-review-20260723142751.md`
- T201独立再レビューレポート: `reports/issue-1-t201-review-r2-20260724193522.md`
- T201 review follow-upレポート: `reports/issue-1-t201-review-followup-20260724194226.md`
- T201最終再レビューレポート: `reports/issue-1-t201-review-r3-20260724194817.md`
- T202実装レポート: `reports/issue-1-t202-implementation-20260723143500.md`
- T202初回レビューレポート: `reports/issue-1-t202-review-20260723144000.md`
- T202独立再レビューレポート: `reports/issue-1-t202-review-r2-20260724195352.md`
- T202 review follow-upレポート: `reports/issue-1-t202-review-followup-20260724200119.md`
- T202最終再レビューレポート: `reports/issue-1-t202-review-r3-20260724200649.md`
- Issue #13実装レポート: `reports/issue-13-implementation-20260724.md`
- Issue #13レビューレポート: `reports/issue-13-review-20260724.md`

## 状態と規模

| 値 | 意味 |
| --- | --- |
| 次 | 依存関係が解消済みで、次回選択する唯一のタスク |
| 未着手 | 依存タスクまたは前段の完了を待つタスク |
| 進行中 | 現在実装しているタスク。常に最大1件 |
| 完了 | 必要な検証、レビュー、進捗同期、task commitまで完了したタスク。Phase単位PRを指定された場合は最終task後にまとめて提出する |
| S | 0.5〜1日程度 |
| M | 2〜3日程度 |
| L | 4〜5日程度。超過見込みなら再分解する |

各タスクは、記載した検証に加えて、挙動実装では変更範囲の単体テスト、全タスクで専用レビューと進捗同期を通過してから完了とする。Markdown lintは本repositoryの完了条件に含めない。環境・scaffold-onlyタスクはテスト適用可否を明示し、test harnessを担当する後続タスクと重複させない。

## 横断Issue

| Issue | 状態 | 変更範囲 | 検証・終了条件 |
| --- | --- | --- | --- |
| #13 | 完了 | Git ownershipをworkspace membershipより優先するdocument router、workspace外Git file、external-file、UNC authority、owner昇格、global persistence、README・設計追補 | TDD、失敗診断artifact、独立レビューを実施し、コードheadと文書同期後headの双方に紐づくCI全工程が成功してdraft PR #15を作成済み |

## P0 開発基盤

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T001 | 完了 | M | VS Code TypeScript拡張のmanifest、ビルド、lint、CIを初期化する。現在`package.json`とlockfileを除外している`.gitignore`を修正し、再現可能な依存管理にする | なし | clean checkoutでinstall、build、lintが成功し、Extension Development Hostでactivationできる構造になっている |
| T002 | 完了 | M | `core`、`application`、`adapters`、`ui`の依存方向を定義し、設計書8章のinterval、file、context、global、diff、history、schema version型と設定contractを配置する | T001 | coreからVS Code、GitHub、Node filesystemへのimportがないことを静的検査し、全型fixtureがcompileする |
| T003 | 完了 | M | 単体テスト、temporary Git repository統合テスト、mock GitHub、VS Code Extension Hostの共通fixtureと実行コマンドを整備する | T001、T002 | 4種類の最小テストが独立実行でき、失敗時にfixtureを後始末し、CIから同じコマンドを実行できる |

## P1 ローカル行範囲管理

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T101 | 完了 | M | 0始まり半開区間の正規化、長さ、検索、重複・隣接結合、減算・分割と、空選択・複数選択の行範囲変換を純粋ロジックで実装する | T003 | 0行、最終行、逆向き選択、重複、隣接、包含、部分解除の境界テストが通る。AC-04、AC-05を満たす |
| T102 | 完了 | M | Review State Serviceの範囲確認、解除、ファイル全体確認・解除、context/global更新用transaction contractを実装する | T101、T002 | 状態更新が正規化済みintervalだけを返し、ファイル全解除でoriginal側を含む全状態を消去し、未mapping revisionを拒否し、storage adapterがstale transactionを確実に検出でき、部分失敗で片側だけ更新されない。AC-01、AC-03〜AC-05のcore部分を満たす |
| T103 | 完了 | M | workspace folder、document URI、相対pathからworkspace context、file ID、非Git repository IDを安定生成する | T002、T003 | 同じworkspace/fileは再起動後も同じID、別rootは別IDとなり、Windows・POSIX・remote URI fixtureが通る |
| T104 | 完了 | L | Git・PR用`globalStorageUri`とGitなし用`storageUri`を選択する共通状態repositoryを実装し、manifest、context、schema version、atomic temp-write/flush/replace、書き込み失敗通知contractを定義する | T002、T003 | repository種別ごとに設計どおり保存先が分離され、保存中断で直前状態を壊さず、成功時だけメモリ状態を確定し、再読み込み結果が一致する。後続のhistory、cache、Global保存も同じrouting contractを利用できる |
| T105 | 完了 | M | 選択確認・解除、ファイル全体確認・解除の4コマンドを通常エディタへ接続し、ファイル全体操作だけ仕様どおり確認ダイアログを表示する | T102、T103、T104 | 単一・複数選択とカーソル1行が動き、キャンセル時は状態と履歴要求を変更しない。AC-01、AC-03、AC-06を満たす |
| T106 | 完了 | M | visible editorだけを対象に、テーマ対応グレー背景、ガター、任意overview ruler、確認日時とcontextのhoverを描画する | T102、T105 | editor切替・状態更新後100ms目標で装飾が更新され、未確認は通常背景になる。AC-02を満たす |
| T107 | 完了 | M | activation、deactivation、保存デバウンス、確認直後の即時保存、再起動復元を結ぶExtension Host試験を追加する | T101〜T106 | 再起動後に確認・解除状態と装飾が復元され、未保存の確認操作を成功表示しない。AC-23のローカル部分を満たす |
| T108 | 完了 | S | 初回`main`マージ時に`0.0.1-pre`のGitHub prereleaseを作成して同版のVSIX assetとして添付し、現時点で利用できる機能、インストール方法、使い方を日本語READMEへ記載する | T001、T107 | Release workflowが再現可能な依存導入、検証、`review-range-tracker-0.0.1-pre.vsix`生成・冪等な添付を行い、ローカルpackage検証が成功し、READMEの説明がmanifestと実装に一致し、専用レビューと進捗同期を通過する |
| T109 | 完了 | S | 初回`main`マージ時に固定`0.0.1-pre`を公開するT108の一回限りRelease仕様を廃止し、SSCを参考にpackage version連動のprerelease VSIX配布へ変更する。tagとReleaseが存在しない版は作成し、既存tagとReleaseが同じcommitを指す場合はassetを再添付可能にする。PRは別PRとする | T108 | `package.json`のversionから`v<version>`、Release title、VSIX asset名を導出し、任意の将来versionで初回作成、同一commitの再実行、異なるcommitの既存tag拒否、PR headや旧commitからの手動公開拒否がRelease契約testで固定される。assetはVS Codeから通常インストールできるVSIX形式である。GitHub Actions最終headの全checkが成功し、専用レビューと進捗同期を通過する |

## P2 編集・Git差分追従

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T201 | 完了 | M | `TextDocumentContentChangeEvent`相当の変更列を変更前document座標で受け取り、確認済みintervalを後方から変換する。挿入行は未確認、重複変更はrejectし、空白・EOL無視設定を適用する | T101、T002 | 単一・複数変更、挿入、削除、置換、行途中編集、空白・EOL設定、末尾改行、入力非破壊、境界異常を単体testで確認する |
| T202 | 完了 | M | GitHub APIや認証に依存しないLocal Git Adapterを実装する。workspace-side Extension HostのGit CLIを引数配列で実行し、Git利用可否、repository root、remote正規化、Repository ID、branch/detached HEAD、HEAD、merge-base、object存在確認を提供する | T002、T003 | fake executor単体testとtemporary Git repository統合testで、Git未導入、非Git、remoteあり/なし、fork、detached、revision入力境界を確認する。GitHub未接続でも成功し、失敗時artifactを生成する |
| T203 | 次 | L | unified diff parserとrevision間interval mappingを実装する。`--unified=0` hunkを解析し、hunk前維持、後方shift、重複部解除、追加行未確認、削除行除去、original側保持、複数hunk累積を純粋ロジックで処理する | T201、T202 | 追加のみ、削除のみ、置換、0行hunk、複数hunk、EOF、CRLF、malformed diff、入力非破壊、設計書9.3の境界testが通る。AC-07、AC-08のmapping部分を満たす |
| T204 | 未着手 | M | rename/move mappingを実装し、一意なrenameではfile IDと`previousPaths`を維持し、rename+編集は変更行だけ未確認、copy・split・merge・曖昧候補は新規またはunresolvedへ倒す | T203 | file rename、directory move、rename+edit、copy、split、merge、同一内容複数候補のfixtureで安全側判定を確認する。AC-09、AC-10を満たす |
| T205 | 未着手 | L | Local Git Adapterとmapping engineを接続し、branch ref、detached HEAD、merge-base、old/new revision、force-push/rebase時のobject存在、fallback要求を解決するGit branch context resolverを実装する | T202〜T204 | commit、checkout、branch切替、detached、unborn、rebase、force-push、旧objectあり/なし、GitHub未接続のtemporary repository統合testが通る。AC-07、AC-11、AC-17を満たす |
| T206 | 未着手 | M | 確認、解除、mapping、rename、unresolved、PR state変更をJSON Linesへappendし、state commit成功後だけ履歴を追加し、同一イベントID再送を冪等化する | T102、T104、T205 | 月次ファイル、順序、重複イベント、partial write、state成功/history失敗、履歴再読込、`historyRetentionDays = 0`を確認する。AC-22を満たす |

## P3 diff editor操作

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T301 | 未着手 | M | diff editorのactive sideとselectionを解決し、modified側の選択確認・解除を通常エディタと同じtransactionへ接続する。diff editor command enablementと誤pane防止を含む | T203、T205、T105 | modified側カーソル、複数selection、original側誤実行拒否、通常エディタ非回帰、AC-12 modified側を満たす |
| T302 | 未着手 | M | diff hunkのold/new line対応を使い、original側選択を現在modified範囲へmappingするか、削除行としてoriginal専用範囲へ分類するpure resolverを実装する | T203 | context、置換、削除、追加隣接、0行hunk、複数hunk、mapping不能のfixtureでside判定を確認する |
| T303 | 未着手 | M | original側の選択確認・解除contractをReview State Serviceへ追加し、`originalReviewedByDiff`を正規化・部分解除し、ファイル全解除ではmodified/Global/originalを一括消去する | T302、T102 | original mark/unmark、diff ID分離、部分解除、全解除、atomic rollbackを確認し、AC-12 original側を満たす |
| T304 | 未着手 | M | diff editor両側へ確認済み装飾、hover、ガターを描画し、side別revision、content hash、diff ID不一致時はそのlayerだけ非表示にする | T301〜T303、T106 | split diff、side切替、old/new非対称行、stale original、設定変更、visible editor限定をExtension Host testで確認する。AC-13を満たす |

## P4 GitHub PR統合

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T401 | 未着手 | M | VS Code AuthenticationでGitHub sessionを取得し、public repository匿名fallbackと未認証、拒否、scope不足、Enterprise host判定を実装する。tokenは永続化しない | T003、T202 | token非保存、sessionあり/なし、public fallback、private拒否、Enterprise、rate limit mockが通る。AC-14の認証部分を満たす |
| T402 | 未着手 | M | current branch/HEADに対応するopen PR候補をGitHub APIから取得し、0件branch fallback、1件自動選択、複数件ユーザー選択、未選択fallbackを実装する | T401、T205 | mock GitHubで0/1/複数、fork head、Enterprise、offline、API失敗を確認する。AC-14、AC-16、AC-17を満たす |
| T403 | 未着手 | L | PR metadata、files API、patch、blob取得、ローカルGit優先diff、欠落patch時のcontent差分、ETag/TTL cacheを実装する | T401、T402、T104、T203 | local objectあり、patch完全/欠落、binary、rename、rate limit、offline cache、期限切れ、最終更新時刻を確認する。AC-07、AC-14、AC-17を満たす |
| T404 | 未着手 | M | PR context stateとPR追加commit時のhead/base revision更新、mapping、closed/merged lifecycle、過去PR保持を実装する | T203〜T205、T402、T403 | PR追加commit、base更新、closed、merged、再open、old object欠落、cache fallbackを確認する。AC-08、AC-14、AC-15を満たす |

## P5 進捗UI

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T501 | 未着手 | M | PR変更行を分母、現在PRで確認済みの変更行を分子とするProgress Calculatorを実装し、未確認変更が残るファイル一覧、file別進捗、除外理由を返す | T403、T404、T002 | added/modified/deleted/renamed/binary/excluded、0行、部分確認、Global-only非算入を確認する。AC-18、AC-20を満たす |
| T502 | 未着手 | M | Global理解率を現在ファイル集合と有効Global範囲から計算し、現在PR変更行は現在PRで確認済みの場合だけ reviewed とする表示優先順位を実装する | T501、T106、T304 | Global分母、削除行除外、現在PR優先、別PR layer、設定変更、非Git workspaceを確認する。AC-19、AC-20を満たす |
| T503 | 未着手 | L | Activity Bar container、Current Context、PR Progress、Global Understanding、Review ContextsのTree ViewとStatus Barを実装し、未確認変更ファイル一覧からdiffを開けるようにする | T501、T502、T304、T403 | view初期化、context切替、進捗更新、未確認ファイル表示、Status Bar、キーボード操作、空状態をExtension Host testで確認する。AC-18、AC-19、AC-20を満たす |
| T504 | 未着手 | M | closed PRを一覧・再取得・layer有効化・非表示化・context表示削除できる管理UIを実装し、削除と履歴削除を分離する | T404、T503 | closed PR保持、default disabled、再有効化、context削除、履歴維持、offline cache表示を確認する。AC-15、AC-21を満たす |

## P6 永続化・復旧・互換性

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T601 | 未着手 | L | Gitなし時とGit object欠落時のcontent-addressed snapshot store、圧縮、Myers系line diff mapping、破損・曖昧時の未確認fallbackを実装する | T203、T204、T104 | snapshot作成、同一hash重複排除、圧縮復元、変更追従、破損、対応曖昧、大容量拒否を確認する。AC-11、AC-23を満たす |
| T602 | 未着手 | M | GitHub metadata/diff cacheとsnapshotの容量・TTL管理を実装し、履歴・現在証跡を削除せず、上限超過fileは再起動後未確認へ倒す | T403、T601 | LRU/TTL、履歴保護、current snapshot保護、上限超過、cleanup失敗を確認する。AC-17、AC-24を満たす |
| T603 | 未着手 | M | schema migration registry、起動時backup、version順migration、失敗時rollbackと旧data保全を実装する | T104、T206、T601 | 複数version、partial migration、backup復元、未知future version、再実行冪等性を確認する。AC-24を満たす |
| T604 | 未着手 | L | exclusive lock、期限切れ判定、owner情報、複数windowのserial transaction、stale writer再読込を実装する | T104、T206、T603 | 同repository複数window、crash lock、期限切れ、同時Global更新、stale transaction、lock cleanupを確認する。AC-24を満たす |

## 受け入れ条件トレーサビリティ

| AC | 概要 | 対応タスク |
| --- | --- | --- |
| AC-01 | 選択範囲確認 | T101、T102、T105 |
| AC-02 | 通常エディタ装飾 | T106 |
| AC-03 | 選択解除・ファイル操作 | T102、T105、T303 |
| AC-04 | interval正規化 | T101、T102、T303 |
| AC-05 | 部分解除 | T101、T102、T303 |
| AC-06 | ファイル全体操作の確認ダイアログ | T105、T301 |
| AC-07 | 変更行未確認化・位置追従 | T201、T203、T403 |
| AC-08 | PR追加commit追従 | T203、T404 |
| AC-09 | rename追従 | T204 |
| AC-10 | copy・分割・統合・曖昧対応 | T204 |
| AC-11 | rebase・force-push・fallback | T205、T601 |
| AC-12 | diff editor両側操作 | T301〜T303 |
| AC-13 | diff editor装飾 | T304 |
| AC-14 | GitHub PR検出・取得 | T401〜T404 |
| AC-15 | closed PR並列管理 | T404、T504 |
| AC-16 | 複数PR候補 | T402 |
| AC-17 | GitHub未接続・offline | T202、T403 |
| AC-18 | PR進捗・未確認ファイル一覧 | T501、T503 |
| AC-19 | Global理解率 | T502、T503 |
| AC-20 | PR変更行でGlobal-onlyを非算入 | T501、T502 |
| AC-21 | context表示管理 | T504 |
| AC-22 | 監査履歴 | T206 |
| AC-23 | Gitなし・再起動復元 | T107、T601 |
| AC-24 | migration・容量・複数window整合性 | T602〜T604 |

## 次回開始時の選択

Issue #13の横断対応、T109 Release改善、T104-2永続化レビュー修正を最新`main`へ統合した。次の新規実装はT203だけを選択し、diff parserとrevision間interval mappingの失敗するテストから開始する。

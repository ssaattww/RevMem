# Review Range Tracker タスク状況

> 更新ルール: このファイルは `task-breakdown-planner`、`task-consistency-manager`、または `progress-sync-manager` を通してのみ更新する。

## 現在位置

- 設計根拠: `doc/design/vscode-review-range-tracker-design.md` rev1
- GitHub Issue: #1
- 現在のPhase: P1 ローカル行範囲管理・P2 編集・Git差分追従（並行進行中）
- 直近完了タスク: T201 Range Mapping Engine
- 現在のタスク: なし
- 次のタスク: T103 workspace context・file ID・非Git repository ID
- 実装状態: T201 review follow-up、全CI工程、専用レビュー、進捗同期が完了
- ブロッカー: なし
- Gitブランチ: `task/t201-range-mapping-engine`
- Pull Request: #7
- PR方針: T201を1ブランチ・1PRで提出し、初回Red/Greenとreview follow-up Red/Greenの失敗時診断artifactをPR上に保持する
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
- T201実装レポート: `reports/issue-1-t201-implementation-20260723142751.md`
- T201専用レビューレポート: `reports/issue-1-t201-review-20260723142751.md`

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
| T103 | 次 | M | workspace folder、document URI、相対pathからworkspace context、file ID、非Git repository IDを安定生成する | T002、T003 | 同じworkspace/fileは再起動後も同じID、別rootは別IDとなり、Windows・POSIX・remote URI fixtureが通る |
| T104 | 未着手 | L | Git・PR用`globalStorageUri`とGitなし用`storageUri`を選択する共通状態repositoryを実装し、manifest、context、schema version、atomic temp-write/flush/replace、書き込み失敗通知contractを定義する | T002、T003 | repository種別ごとに設計どおり保存先が分離され、保存中断で直前状態を壊さず、成功時だけメモリ状態を確定し、再読み込み結果が一致する。後続のhistory、cache、Global保存も同じrouting contractを利用できる |
| T105 | 未着手 | M | 選択確認・解除、ファイル全体確認・解除の4コマンドを通常エディタへ接続し、ファイル全体操作だけ仕様どおり確認ダイアログを表示する | T102、T103、T104 | 単一・複数選択とカーソル1行が動き、キャンセル時は状態と履歴要求を変更しない。AC-01、AC-03、AC-06を満たす |
| T106 | 未着手 | M | visible editorだけを対象に、テーマ対応グレー背景、ガター、任意overview ruler、確認日時とcontextのhoverを描画する | T102、T105 | editor切替・状態更新後100ms目標で装飾が更新され、未確認は通常背景になる。AC-02を満たす |
| T107 | 未着手 | M | activation、deactivation、保存デバウンス、確認直後の即時保存、再起動復元を結ぶExtension Host試験を追加する | T101〜T106 | 再起動後に確認・解除状態と装飾が復元され、未保存の確認操作を成功表示しない。AC-23のローカル部分を満たす |

## P2 編集・Git差分追従

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T201 | 完了 | L | `TextDocumentContentChangeEvent`相当の変更列を後方から適用するRange Mapping Engineを実装し、前方維持、後方shift、重複部分無効化、挿入未確認と`ignoreWhitespaceChanges`・`ignoreEolChanges`を扱う | T101、T102 | 挿入、削除、置換、複数変更、CRLF/LF、空白変更を既定値`false`では無効化し、各設定が`true`の場合だけ該当差分を無視する。末尾改行1個の差と追加・削除空行を区別する単体テストを含め、全CI工程と専用レビューが通る |
| T202 | 未着手 | L | 引数配列で実行するLocal Git Adapterを実装し、Git可否、root、remote正規化、Repository ID、branch完全ref、detached HEAD、HEAD、merge-base、object有無を取得する | T003 | shell文字列連結がなく、remote有無、fork、detached HEAD、Git未導入をfixtureで識別できる |
| T203 | 未着手 | L | `--unified=0 --find-renames`のdiff parserとrevision間interval mappingを実装し、hunk前後・重複・追加・削除と空白・EOL無視設定を処理する | T201、T202 | 連続commitと複数hunkで未変更行を維持し変更行だけを解除する。空白・EOLは既定値`false`で変更扱い、設定`true`でのみ無視される。AC-07、AC-08を満たす |
| T204 | 未着手 | M | rename、directory move、rename同時変更、deleteをfile stateへ適用し、copy・分割・統合・複数候補を新規未確認にする | T203 | 100% renameと一意なrenameだけを追従し、曖昧なケースを確認済みにしない。AC-09、AC-10を満たす |
| T205 | 未着手 | L | branch context resolver、detached commit context、Git状態監視、context revision更新と再計算を実装する | T104、T202〜T204 | branch切替で状態が分離され、commit追加後に正しいcontextへmappingされる。AC-12を満たす |
| T206 | 未着手 | M | 設計書6.15のイベントをJSON Linesへ追記し、session、repository、context、revision、side、前後範囲、理由を保存する | T102、T104、T201〜T205 | 全操作とedit・Git diff・rename・context revision mapping結果が1イベントとして適切な保存先へ追記され、現在状態を履歴から毎回再構築しない |
| T207 | 未着手 | L | edit、commit追加、branch切替、rename、deleteを連続実行するtemporary Git repository統合試験を追加する | T201〜T206 | AC-07〜AC-10、AC-12を一連の操作で再現し、再起動後もstateとhistoryが整合する |

## P3 diff editorとPR進捗

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T300 | 未着手 | M | GitHub/Git変更fileに適用できる共通除外policyを実装し、既定glob、ユーザーglob、binary、除外理由、設定変更通知を定義する | T202 | pathとfile属性から除外理由を決定でき、設定変更で再評価され、PR進捗と後続Global集計が同じpolicyを利用できる |
| T301 | 未着手 | L | PR change/hunk/lineモデルと、ユーザー除外を除いた追加・削除行だけを分母にするPR・file進捗calculatorを純粋ロジックで実装する | T102、T203、T300 | 追加、削除、置換、未変更周辺、Global混入防止、ユーザー除外、binary、rename-onlyのテストが通る。除外対象を分母に含めず理由を返す。AC-16を満たす |
| T302 | 未着手 | L | context、file、side、revisionを復元できる仮想URI codecとoriginal/modified content providerを実装する | T104、T202、T203 | URI round-trip、revision別内容、欠落objectの失敗が決定的で、異なるcontextが衝突しない |
| T303 | 未着手 | L | diff editorを開く処理と両側の選択・ファイル操作を実装し、T102 transaction contractをoriginal側のside・diff ID・削除範囲へ拡張して`originalReviewedByDiff`へ保存する | T206、T301、T302 | 両側で選択確認・解除が動く。ファイル全体確認はfocused sideに関係なくmodified全行とoriginal-only削除行を同時に確認し、全解除はcontext・Global・original削除行をすべて解除する。削除行が進捗へ反映される。AC-14、AC-15を満たす |
| T304 | 未着手 | M | PR Progress Tree Viewを実装し、未確認、完了、除外、行以外の変更、行対象外を分類し、未確認数降順・path昇順で表示する | T300、T301、T303 | 各fileの確認数、全変更数、率、追加、削除が一致し、ユーザー除外を理由付きで別表示し、選択でdiffを開く。AC-17を満たす |
| T305 | 未着手 | M | Activity Bar、Current Context View、Status Bar、refresh/select contextの最小UIを実装する | T103、T205、T304 | PR相当、branch、workspaceの表示が切り替わり、再計算後にTreeとStatus Barが同期する |
| T306 | 未着手 | L | local base/headをPR相当として、diff両側操作から進捗UI更新までのExtension Host試験を追加する | T300〜T305 | AC-14〜AC-17をUI操作で通す。focused sideに依存しないファイル全体確認・全解除、ユーザー除外の分母除外と別表示、rename-only、binaryを検証する |

## P4 GitHub PR連携

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T401 | 未着手 | L | VS Code認証APIとGitHub Adapter、remoteからのhost/owner/repository解決、認証sessionまたは公開repositoryの未認証APIによるHEAD対応PR検索、0・1・複数候補のresolverを実装する | T202、T205 | 1件は自動選択、複数はユーザー選択、0件または選択取消はbranchへ戻る。認証なしでも公開repository APIを試し、rate limit・network・API失敗時だけbranchへフォールバックしてローカル操作を止めない |
| T402 | 未着手 | L | PR metadata/file取得と、local Git diff、PR files API patch、base/head内容差分の3段フォールバックを実装する | T203、T301、T401 | 各経路の成功・欠落・不完全patchをmockで再現し、全経路失敗時に確認済みを推測しない |
| T403 | 未着手 | M | GitHub metadata・diff cache、期限、最終更新時刻、429・network failure時のoffline読込を実装する | T104、T402 | tokenとsource本文を不要に永続化せず、offline時に取得済みPRを表示し、古い状態を明示する |
| T404 | 未着手 | L | host/owner/repository/PR番号のcontext ID、base/head revision更新、open/closed/merged保存、複数PRレイヤー状態を`globalStorageUri`へ実装する | T104、T205、T401、T403 | 同じPRのcommit追加で状態を継続し、別PRは分離され、closed PRは既定で装飾無効になり、再起動後も復元される。AC-11、AC-21のcore部分を満たす |
| T405 | 未着手 | L | Review Contexts View、PR再検出、GitHub再接続、cache更新、layer切替、context表示削除、closed PR diff表示を実装する | T302、T304、T305、T404 | 現在PR・branch・保存済みPRを並列表示し、履歴を消さずに表示だけ削除できる。AC-21を満たす |
| T406 | 未着手 | L | GitHub未認証公開repository、401/403/404/429、network断、patch欠落、複数PR、closed PRの統合試験を追加する | T401〜T405 | 未認証公開repositoryではPRを解決し、rate limit・GitHub障害中はbranch contextで確認操作でき、復旧後にcontextとcacheが再同期する。AC-11を満たす |

## P5 Global確認済みと理解率

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T501 | 未着手 | L | Repository Global State repositoryを実装し、確認・解除・ファイル操作を現在contextとGlobalへatomicに反映して履歴を残す | T102、T104、T206 | PR、branch、workspaceの確認がGlobalへ反映され、解除は参照数に関係なくGlobalからも消える。AC-19、AC-20を満たす |
| T502 | 未着手 | L | edit、Git diff、renameによるGlobal mappingと、現在PR未確認変更を最優先する6段階の表示優先順位を実装する | T106、T201、T203、T204、T501 | 現在PR変更行はGlobalだけでグレーにならず、曖昧・変更済みは通常背景になる |
| T503 | 未着手 | M | T300の共通除外policyを使うrepository file列挙、gitignore、空行判定を実装し、Global集計対象を構築する | T300 | PR進捗と同じユーザーglob・binary判定を再利用して除外理由を保持し、コメント行を含む非空行だけを分母候補として決定的に列挙する |
| T504 | 未着手 | L | repository・file別Global理解率calculator、進捗cache、chunk処理、open file優先のbackground再計算を実装する | T501、T503 | 有効なGlobal非空行だけを数え、設定変更で再計算し、イベントループを長時間占有しない。AC-18のcore部分を満たす |
| T505 | 未着手 | M | Global Understanding View、Status Bar併記、Global layer切替、装飾・除外・snapshot上限設定を実装する | T305、T502、T504 | PR進捗と別セクションに全体・file別率、確認数、対象数、除外数を表示する。AC-18を満たす |
| T506 | 未着手 | L | 複数contextの確認・解除・変更追従とGlobal集計を通す統合・Extension Host試験を追加する | T501〜T505 | AC-18〜AC-20を通し、Global状態がPR進捗へ混入せず、再起動後も同じ理解率になる |

## P6 Gitなし対応と堅牢化

| ID | 状態 | 規模 | タスクと変更範囲 | 依存 | 検証・終了条件 |
| --- | --- | --- | --- | --- | --- |
| T601 | 未着手 | L | 圧縮snapshot保存、Myers相当の行差分、Git未導入・非Git時のworkspace context追従、snapshot期限と上限を実装する | T103、T104、T201 | Gitなしで確認・編集・再起動追従が動き、snapshot欠落・破損・曖昧時は未確認になる。AC-13を満たす |
| T602 | 未着手 | L | rebase・force-push時に旧Git object直接diff、snapshot diff、一意mapping、未確認化の順で回復する | T203、T204、T403、T601 | SHAだけの変化で全解除せず、object消失と複数候補では証拠のない範囲を確認済みにしない |
| T603 | 未着手 | L | schema migration chain、移行前backup、JSON/JSONL/snapshot破損検出・隔離・回復を実装する | T104、T206、T601 | 旧schema fixtureを段階移行でき、失敗時はbackupから戻り、不確実な範囲を未確認にする |
| T604 | 未着手 | L | 排他的file lock、期限切れ判定、複数window競合、atomic history append、cache・snapshot整理を実装する | T104、T403、T603 | 同時書き込みでcurrent stateとhistoryを壊さず、stale lockを回復し、履歴は無期限保持する |
| T605 | 未着手 | L | multi-root、Remote SSH、Dev Containers、Codespacesを想定したworkspace側Extension HostとURI・storage境界を実装・試験する | T103、T202、T401、T601、T604 | rootごとのcontextとrepositoryが混線せず、Git・file操作がworkspace側で行われる |
| T606 | 未着手 | L | Git、GitHub、storage、容量不足、途中終了のerror policy、再試行、古い状態表示、privacy-safe診断logを実装する | T403、T601〜T605 | token・source本文をlogへ出さず、全障害fixtureで誤った確認済み表示をしない。AC-24を満たす |
| T607 | 未着手 | L | 1万変更行PR、大規模repository集計、多数interval、visible editor装飾の性能計測と最適化を行う | T301、T504、T606 | Treeを段階表示し、入力を阻害せず、選択後装飾100ms目標と計測結果を記録する |
| T608 | 未着手 | L | 受け入れ条件24件の最終suite、手動確認表、利用・設定・データ保存・制限文書、VSIX packaging検証を完成させる | T107、T207、T306、T406、T506、T601〜T607 | AC-01〜AC-24の証跡が揃い、build・全test・lint・package・専用reviewが通り、初期版をPR提出できる |

## 受け入れ条件トレーサビリティ

| 設計書22章 | 主担当タスク |
| --- | --- |
| AC-01〜AC-06 基本確認・解除・装飾 | T101、T102、T105、T106 |
| AC-07〜AC-10 変更・rename・曖昧mapping | T201、T203、T204、T207 |
| AC-11 PR単位分離 | T401、T404、T406 |
| AC-12 branch単位動作 | T202、T205、T207 |
| AC-13 Gitなし動作 | T103、T601 |
| AC-14〜AC-15 diff両側・削除行 | T302、T303、T306 |
| AC-16〜AC-17 PR進捗・未確認file一覧 | T301、T304、T306 |
| AC-18 Global理解率 | T503〜T506 |
| AC-19〜AC-20 Global自動反映・解除 | T501、T506 |
| AC-21 closed PR並列管理 | T404、T405 |
| AC-22 履歴保存・履歴UIなし | T206、T603、T604 |
| AC-23 再起動復元 | T104、T107、T603 |
| AC-24 不確実な範囲を表示しない | T201〜T204、T402、T502、T601〜T606 |

## 次回開始時の選択

T201は依存済みcore範囲として先行完了した。P1の計画順序を維持し、次回の実装はT103だけを選択してworkspace context、file ID、非Git repository IDの失敗する単体テストから開始する。

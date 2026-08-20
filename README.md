# Review Range Tracker

VS Code で、確認済みにした行範囲を context ごとに記録・表示する拡張機能です。動作には **VS Code 1.125.0 以上**が必要です。

## 現状できること

現在配布している VSIX から利用できる機能は次のとおりです。

- カーソル行、単一選択、複数選択の行を確認済みにしたり、確認済みを解除したりできます。重複・隣接する選択範囲はまとめて扱います。
- ファイル全体を確認済みにする、または全解除する操作があります。どちらも実行前に確認ダイアログを表示します。
- 確認操作と解除操作は、現在の context と repository 単位の Global 状態へ atomic に反映されます。
- 確認済み行をテーマ対応のグレー背景で表示します。ガターアイコンと Overview Ruler の表示は設定で切り替えられます。
- hover で現在の context、確認日時、Global 状態を確認できます。
- Git working tree 内のファイルは、workspace 内外を問わず branch または detached HEAD の context として扱います。
- Git の HEAD や branch が変化した場合は、commit 間の差分から未変更行を保守的に引き継ぎます。一意な rename・move は同じファイルとして追従し、変更行、曖昧な対応、取得できない証拠は未確認にします。
- Git 管理外の workspace ファイルは、圧縮 snapshot と行差分を使って再起動後も確認済み範囲を追従します。snapshot の欠損、破損、期限切れ、曖昧な対応では未確認にします。
- Git 管理外で workspace 外のファイルは external-file context として保存します。
- UNC 共有上のファイルも、VS Code から開ける場合は server authority を含む URI で識別します。
- 状態は owner に応じた VS Code 拡張保存領域に保存され、VS Code を再起動した後も復元されます。
- 確認・解除、context 作成、Git revision mapping の履歴を JSON Lines 形式で保存します。
- Activity Bar の **Review Range** から **Current Context** View を開き、現在の PR、branch、または workspace context を確認できます。
- Current Context View と Status Bar は同じ context を表示します。View の操作から再計算や候補選択を行うと、通常エディタの確認操作と装飾にも選択結果が反映されます。保存済み PR が現在の repository/HEAD に一致する場合は PR context を候補として扱います。
- **Review Contexts** View では、現在の PR/branch、保存済み open・closed・merged PR、workspace context を並列表示できます。PR の再検出、GitHub 再接続、cache 更新、PR layer 切替、表示だけの削除、進捗確認、PR diff の表示を行えます。
- Review Contexts から開く PR diff は通常の review diff と同じ canonical virtual document を使用し、original・modified 両側の確認・解除操作と永続状態を共有します。

現在の実装では、diff editor の仮想文書・両側操作、GitHub PR 検出、PR 差分取得、PR context の永続管理と revision 更新、PR 進捗計算、PR Progress Tree、Review Contexts、Global 理解率計算、失敗分類・bounded retry・privacy-safe Output 診断が production runtime へ接続されています。T406 統合試験は PR #71 のreview closure後、merge commit `96057f9e`でmainへ統合済みです。T604 は PR #73 をsquash mergeし、merge commit `64e47c590960a810a2439bd33f250ecbda9c41bf`とexact-head CI `32367553522` Greenでmainへ統合済みです。T605 は PR #75 をsquash mergeし、merge commit `fb7df6ab79bb23ae16b43b61aa66ab743460be69`とexact-head CI `32376730329` Greenでmainへ統合済みです。T606 は R002〜R005 のR7 old-root失敗、terminal diagnostic後のmutation例外、cache publish failure、focused production matrixをlocal focused 195 passing（Windows POSIX fixture 2 skip）で固定しました。technical commitはpendingで、R001/R006/R007はclosedを維持し、同一normal reviewer closure R7待ちです。exact-head CI はheldです。

## インストール方法

この拡張機能は Marketplace ではなく VSIX で配布します。

1. GitHub Releases の最新 Release から、その version に対応する `review-range-tracker-<version>.vsix` をダウンロードします。初回 Release の例は `0.0.1-pre` と `review-range-tracker-0.0.1-pre.vsix` です。
2. VS Code の拡張機能ビューで `...` を開き、**VSIX からのインストール...** を選んでダウンロードしたファイルを指定します。

CLI を使う場合は、次を実行します。

```powershell
code --install-extension review-range-tracker-<version>.vsix
```

更新時も、新しい Release asset をダウンロードして再インストールしてください。

## 使い方

1. ローカル、Remote、または UNC 上の通常ファイルをエディタで開きます。workspace folder を開いていない場合や、その外側のファイルでも利用できます。
2. 対象行を選択するか、対象行にカーソルを置きます。
3. 右クリックメニューまたはコマンドパレットで、`Review Range: 選択範囲を確認済みにする` または `Review Range: 選択範囲の確認済みを解除する` を実行します。
4. ファイル全体を対象にするには、`Review Range: ファイル全体を確認済みにする` または `Review Range: ファイル全体の確認済みを解除する` を実行し、確認ダイアログを承認します。
5. 現在の context は、Activity Bar の **Review Range** にある **Current Context** View または Status Bar で確認します。候補を選び直す場合は View の選択操作、最新状態を取り直す場合は再計算操作を使います。
6. PR context の一覧・進捗・layer・cache・diff を操作する場合は **Review Contexts** View を使います。現在の branch に対応する PR を取り直す場合は `PRを再検出`、認証状態を含めて接続し直す場合は `GitHubへ再接続` を使います。

Git working tree 内では、ファイルの親ディレクトリから repository root を検出します。Git 管理下かどうかを先に判定し、workspace membership は非 Git 時の保存先選択にだけ使用します。

## 現在の制限

以下のタスク ID は [`tasks/tasks-status.md`](tasks/tasks-status.md) の定義を指します。複数タスクを記載している項目は、最後のタスクまで完了した時点を解消条件とします。

- 確認・解除の4コマンドは、通常エディタと canonical PR diff で使用できます。選択中の保存済み PR context は通常エディタの確認操作と装飾にも反映されます。GitHub 未認証・401/403/404/429・network 断・patch 欠落・複数 PR 候補・closed PR の統合試験は T406で完了し、PR #71からmerge commit `96057f9e`でmainへ統合済みです。untitled editorでは実行できません。**untitled editor対応は初期版の現行タスク範囲外で、解消予定タスクはありません。**
- Activity Bar、Current Context View、Status Bar、PR Progress Tree、Global Understanding View、Review Contexts View は runtime へ接続済みです。通常エディタの変更追従は、選択中の保存済み PR を含む context と owner-wide Global に同期し、再起動後も復元します。GitHub PR の障害系・複数候補・closed PR の統合受け入れは T406で完了し、PR #71からmainへ統合済みです。
- Git、GitHub、storage の失敗は確認済み表示を成功扱いしません。再試行は一時的な read/refresh 障害だけに最大3回で適用され、認証・validation・stale・永続保存失敗は再試行しません。失敗時は Review Range Output に単一行のredacted診断を残し、Current Context、PR Progress、Global、Review Contexts は不確実な結果を採用しません。
- 履歴は保存しますが、閲覧・検索・export 用の UI は未実装です。**履歴UIは初期版の現行タスク範囲外で、解消予定タスクはありません。`T603`はschema migrationと破損回復、`T604`は複数window競合とatomic history appendを扱いますが、履歴UIは追加しません。**
- multi-root workspaceでは最長一致する URI root にdocumentを所属させ、rootごとに非Git state、history、snapshot、lock、cleanupを分離します。Remote SSH、Dev Containers、Codespaces相当のremote authorityもidentityへ含め、Git・file操作はworkspace側Extension Hostで実行します。Remoteサービス自体を起動するnetwork E2Eと初期版全体の最終受け入れは`T608`の対象です。
- `reviewRange.exclude` は PR 進捗と Global 理解率で共有する除外 policy の設定です。対応UIの接続は、GitHub PR進捗が`T404`〜`T406`、Global理解率が`T505`と`T506`の完了で揃います。**除外対象のファイルでも通常エディタでは確認済みにでき、確認済み表示と状態保存も行われますが、そのファイルはPR進捗とGlobal理解率の集計対象から除外されます。**
- UNC access は VS Code の `security.restrictUNCAccess` と `security.allowedUNCHosts` に従います。拡張機能から制限を迂回しません。**これはVS Codeのセキュリティ制約であり、解消予定タスクはありません。**

## 設定

VS Code の設定で次の項目を変更できます。

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `reviewRange.showGlobalReviewed` | `true` | Global 確認済み範囲を通常エディタの装飾へ重ねて表示します。 |
| `reviewRange.ignoreWhitespaceChanges` | `false` | `true` のとき、通常エディタの空白のみの編集では確認済み範囲を無効化しません。 |
| `reviewRange.ignoreEolChanges` | `false` | `true` のとき、通常エディタの改行コードのみの編集では確認済み範囲を無効化しません。 |
| `reviewRange.showGutterIcon` | `true` | 確認済み行のガターアイコンを表示します。 |
| `reviewRange.showOverviewRuler` | `false` | 確認済み範囲を Overview Ruler に表示します。 |
| `reviewRange.exclude` | `**/.git/**`、`**/node_modules/**`、`**/bin/**`、`**/obj/**`、`**/dist/**`、`**/build/**` | PR 進捗と Global 理解率の集計対象から除外する glob 配列です。有効な配列は既定値を上書きし、空配列では binary と `.git` 以外を再包含します。 |

## 開発・検証

Node.js 24 を使用します。依存関係を導入した後、次のコマンドで標準検証を実行できます。

```powershell
npm ci
npm run build
npm run typecheck:contracts
npm run validate:architecture
npm run validate:architecture:negative
npm run lint
npm run test:unit
npm test
```

VSIX を作成するには次を実行します。

```powershell
npm run package -- --pre-release --out artifacts/review-range-tracker-0.0.1-pre.vsix
```


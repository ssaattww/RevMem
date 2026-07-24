# Review Range Tracker

VS Code の通常テキストエディタで、確認済みにした行範囲を記録・表示する拡張機能です。動作には **VS Code 1.125.0 以上**が必要です。

## 現状できること

- カーソル行、単一選択、複数選択の行を確認済みにしたり、確認済みを解除したりできます。重複・隣接する選択範囲はまとめて扱います。
- ファイル全体を確認済みにする、または全解除する操作があります。どちらも実行前に確認ダイアログを表示します。
- 確認済み行をテーマ対応のグレー背景で表示します。ガターアイコンと Overview Ruler の表示は設定で切り替えられます。
- hover で現在の context、確認日時、Global 状態を確認できます。
- Git working tree 内のファイルは、workspace 内外を問わず branch または detached HEAD の context として扱います。
- Git 管理外のファイルは、workspace 内なら workspace context、workspace 外なら external-file context として保存します。
- UNC 共有上のファイルも、VS Code から開ける場合は server authority を含む URI で識別します。
- 状態は owner に応じた VS Code 拡張保存領域に保存され、VS Code を再起動した後も復元されます。
- 安全のため、ファイル内容または Git revision が変わった場合は、以前の確認済み範囲を新しい内容へ無条件に引き継ぎません。

## インストール方法

この拡張機能は Marketplace ではなく VSIX で配布します。

1. GitHub Releases の `0.0.1-pre` から `review-range-tracker-0.0.1-pre.vsix` をダウンロードします。
2. VS Code の拡張機能ビューで `...` を開き、**VSIX からのインストール...** を選んでダウンロードしたファイルを指定します。

CLI を使う場合は、次を実行します。

```powershell
code --install-extension review-range-tracker-0.0.1-pre.vsix
```

更新時も、新しい Release asset をダウンロードして再インストールしてください。

## 使い方

1. ローカル、Remote、または UNC 上の通常ファイルをエディタで開きます。workspace folder を開いていない場合や、その外側のファイルでも利用できます。
2. 対象行を選択するか、対象行にカーソルを置きます。
3. 右クリックメニューまたはコマンドパレットで、`Review Range: 選択範囲を確認済みにする` または `Review Range: 選択範囲の確認済みを解除する` を実行します。
4. ファイル全体を対象にするには、`Review Range: ファイル全体を確認済みにする` または `Review Range: ファイル全体の確認済みを解除する` を実行し、確認ダイアログを承認します。

Git working tree 内では、ファイルの親ディレクトリから repository root を検出します。Git 管理下かどうかを先に判定し、workspace membership は非 Git 時の保存先選択にだけ使用します。

## 現在の制限

- diff editor と untitled editor は対象外です。
- GitHub PR context は未接続です。Git 管理下では現在 branch または detached HEAD context を使用します。
- Git HEAD が変わった場合の revision 間 mapping は未実装です。旧 revision の状態を新しい HEAD へ無条件に再ラベルしません。
- 編集による行位置の追従、rename・move への追従は未実装です。内容が変わったファイルの保存済み範囲は無効化します。
- 複数 root workspace、確認履歴の保存・閲覧は未対応です。
- UNC access は VS Code の `security.restrictUNCAccess` と `security.allowedUNCHosts` に従います。拡張機能から制限を迂回しません。

## 設定

VS Code の設定で次の項目を変更できます。

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `reviewRange.showGlobalReviewed` | `true` | Global 確認済み範囲を通常エディタの装飾へ重ねて表示します。 |
| `reviewRange.showGutterIcon` | `true` | 確認済み行のガターアイコンを表示します。 |
| `reviewRange.showOverviewRuler` | `false` | 確認済み範囲を Overview Ruler に表示します。 |

## 開発・検証

Node.js 24 を使用します。依存関係を導入した後、次のコマンドでビルド、静的解析、単体テストを実行できます。

```powershell
npm ci
npm run build
npm run lint
npm run test:unit
```

VSIX を作成するには次を実行します。

```powershell
npm run package -- --pre-release --out artifacts/review-range-tracker-0.0.1-pre.vsix
```

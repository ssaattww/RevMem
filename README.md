# Review Range Tracker

VS Code の通常テキストエディタで、確認済みにした行範囲を記録・表示する拡張機能です。動作には **VS Code 1.125.0 以上**が必要です。

## 現状できること

- カーソル行、単一選択、複数選択の行を確認済みにしたり、確認済みを解除したりできます。重複・隣接する選択範囲はまとめて扱います。
- ファイル全体を確認済みにする、または全解除する操作があります。どちらも実行前に確認ダイアログを表示します。
- 確認済み行をテーマ対応のグレー背景で表示します。ガターアイコンと Overview Ruler の表示は設定で切り替えられます。
- hover で現在の context、確認日時、Global 状態を確認できます。
- 状態は workspace ごとの VS Code 拡張保存領域に保存され、VS Code を再起動した後も復元されます。
- 安全のため、ファイル内容が変わった場合は、以前の確認済み範囲を新しい内容へ自動で引き継ぎません。

## インストール方法

この拡張機能は Marketplace ではなく VSIX で配布します。

1. GitHub Releases の最新Releaseから、そのversionに対応する `review-range-tracker-<version>.vsix` をダウンロードします。初回Releaseの例は `0.0.1-pre` と `review-range-tracker-0.0.1-pre.vsix` です。
2. VS Code の拡張機能ビューで `...` を開き、**VSIX からのインストール...** を選んでダウンロードしたファイルを指定します。

CLI を使う場合は、次を実行します。

```powershell
code --install-extension review-range-tracker-<version>.vsix
```

更新時も、新しい Release asset をダウンロードして再インストールしてください。

## 使い方

1. 単一の folder を開き、その配下のファイルを通常エディタで開きます。
2. 対象行を選択するか、対象行にカーソルを置きます。
3. 右クリックメニューまたはコマンドパレットで、`Review Range: 選択範囲を確認済みにする` または `Review Range: 選択範囲の確認済みを解除する` を実行します。
4. ファイル全体を対象にするには、`Review Range: ファイル全体を確認済みにする` または `Review Range: ファイル全体の確認済みを解除する` を実行し、確認ダイアログを承認します。

## 現在の制限

- diff editor は対象外です。コマンドは実行されず、装飾も表示しません。
- workspace folder 外のファイルと untitled editor は対象外です。単一 folder workspace での利用を推奨します。
- 現時点では Git repository 内のファイルも workspace context として扱います。branch、commit、Git diff、GitHub PR は認識しません。
- 編集による行位置の追従、rename・move への追従は未実装です。内容が変わったファイルの保存済み範囲は無効化します。
- 複数 root workspace、確認履歴の保存・閲覧は未対応です。

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

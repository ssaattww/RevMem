# T201 実装レポート

## タスク

- 対象: T201 Range Mapping Engine
- 関連Issue: #1
- Pull Request: #7
- ブランチ: `task/t201-range-mapping-engine`
- 基点: `main` commit `43aca3dbd6b27258959ff633117bb4dd2f2ce6a9`

## CI失敗時診断の事前確認

- 作業開始時に`.github/workflows/ci.yml`を確認した
- 既存workflowは各工程の標準出力・標準エラーを`test-output/ci/*.log`へ保存する
- 失敗時は`test-output`、`dist`、`test-dist`、`src`、`test`、`tools`、型fixture、package・TypeScript・ESLint・workflow設定を`actions/upload-artifact@v4`で保存する
- 必要な診断情報が既に含まれていたため、workflow変更は行わなかった

## Test-Driven Development

### Red

- `test/unit/range-mapping-engine.test.ts`を実装より先に追加した
- `package.json`の`test:unit`へテストを接続した
- GitHub Actions run `29981493709`で`Unit tests`が失敗することを確認した
- 失敗理由は未実装の`../../src/core/range-mapping/index`を解決できない`TS2307`だった
- 失敗時診断artifact `ci-failure-diagnostics-29981493709-1`が生成された
- artifact IDは`8553341258`

### Green

- Range Mapping Engine本体と公開APIを追加した
- GitHub Actions run `29981625700`でinstall、build、lint、unit、temporary Git integration、mock GitHub integration、VS Code Extension Hostがすべて成功した

### Review follow-up Red

- 専用レビューで、既に改行で終わるファイルへ追加の改行を挿入した場合と、複数の末尾改行から空行を削除した場合を、`ignoreEolChanges`が通常の末尾改行変更として誤って無視する問題を検出した
- `test/unit/range-mapping-engine-review.test.ts`を修正より先に追加した
- GitHub Actions run `29982011960`で該当2テストが失敗することを確認した
- 追加空行では、元の末尾空行が後方へshiftせず古い位置に残った
- 末尾空行削除では、削除対象の確認済み空行が残った
- 失敗時診断artifact `ci-failure-diagnostics-29982011960-1`が生成された
- artifact IDは`8553537944`

### Review follow-up Green

- 末尾改行の追加・削除を、正規化後の文書全体が末尾改行1個だけ異なる場合に限定して無視するよう修正した
- 既に末尾改行がある文書への追加空行と、複数末尾改行からの空行削除は通常の行変更としてmappingする
- GitHub Actions run `29982141563`でinstall、build、lint、unit、temporary Git integration、mock GitHub integration、VS Code Extension Hostがすべて成功した

## 実装内容

### 変更入力contract

- VS Code APIへ依存しない`TextPosition`、`TextRange`、`DocumentContentChange`をcore層に定義した
- positionと`rangeOffset`・`rangeLength`が同じ変更前文書を指すことを検証する
- 行・文字・offset・lengthを非負のsafe integerとして検証する
- 文書外range、逆順range、重複変更、同一offsetの複数変更を拒否する
- UTF-16 offsetとしてJavaScript文字列indexと整合する

### Range mapping

- 入力intervalをT101の`normalizeLineIntervals`で正規化する
- 変更列を`rangeOffset`降順へ並べ、変更前文書座標のまま後方から適用する
- 変更前の行は位置を維持する
- 変更後方の未変更行はline deltaだけshiftする
- 変更と重なる旧行は確認済み状態を失う
- 挿入で生成された行は確認済みにしない
- 行頭から次行頭までの挿入・削除・置換と、行途中の変更を区別する
- 結果intervalを正規化し、結果文書のline count内へ制限する

### 空白・EOL設定

- 既定値`false`では水平空白だけの変更もCRLF/LFだけの変更も通常の変更として無効化する
- `ignoreWhitespaceChanges: true`では改行を保持したまま水平空白を除去して等価性を判定する
- `ignoreEolChanges: true`ではCRLF、LF、CRを正規化して等価性を判定する
- ファイル末尾改行の有無は、末尾改行1個だけの差である場合に限り無視する
- 追加の空行や空行削除はEOL-onlyとして扱わない

### 非破壊性

- 入力のinterval、change、position、optionsを変更しない
- 結果はdetachedされた新しいinterval配列として返す

## 単体テスト

- whole-line挿入、削除、行数が増える置換
- 同一行内置換
- 行途中への改行挿入
- original座標で渡された複数変更の後方適用
- 空白変更の既定無効化と設定時維持
- CRLF/LF変更の既定無効化と設定時維持
- 一方のignore設定が他方の変更を無視しないこと
- ファイル末尾改行追加の既定無効化と設定時維持
- 追加末尾空行・末尾空行削除をEOL-onlyと誤認しないこと
- no-op変更
- offset、length、overlap、line count境界の拒否
- frozen入力の非破壊性

## 対象ファイル

- `package.json`
- `src/core/range-mapping/index.ts`
- `src/core/range-mapping/range-mapping-engine.ts`
- `test/unit/range-mapping-engine.test.ts`
- `test/unit/range-mapping-engine-review.test.ts`

## 終了条件との対応

- 挿入: 挿入行を未確認にし、後続行をshiftするテストが成功
- 削除: 削除行を除去し、後続行を後方へshiftするテストが成功
- 置換: 重複旧行を無効化し、未変更suffixを維持するテストが成功
- 複数変更: original座標の変更列を高offsetから処理するテストが成功
- CRLF/LF: 既定値`false`で無効化し、`ignoreEolChanges: true`でのみ維持するテストが成功
- 空白: 既定値`false`で無効化し、`ignoreWhitespaceChanges: true`でのみ維持するテストが成功
- core純粋ロジック: VS Code、GitHub、Node filesystemへのimportを追加していない

## 後続タスク

- T203が本engineの考え方をGit diff・revision間interval mappingへ適用する
- T204がrename、directory move、delete、曖昧なfile対応を実装する
- T206がmapping前後の範囲と理由を履歴イベントへ記録する

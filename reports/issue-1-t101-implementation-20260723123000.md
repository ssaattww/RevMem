# T101 実装レポート

## タスク

- 対象: T101 interval操作と選択範囲変換
- 関連Issue: #1
- Pull Request: #3
- ブランチ: `task/t101-line-intervals`

## Test-Driven Development

### Red

- `test/unit/line-intervals.test.ts`を実装より先に追加した
- `package.json`の`test:unit`へT101テストを接続した
- GitHub Actions run `29976767460`で`Unit tests`が失敗することを確認した
- 失敗理由は、未実装の`../../src/core/intervals/index`を解決できないTypeScriptエラーだった
- 失敗時診断artifact `ci-failure-diagnostics-29976767460-1`が生成され、テストログ、環境情報、生成物一覧、ソース、テスト、設定ファイルを含むことを確認した

### Green

- GitHub Actions run `29976842802`で全工程が成功した
- 成功工程: install、build、lint、unit、temporary Git integration、mock GitHub integration、VS Code Extension Host

## 実装内容

### Interval操作

- 0始まり半開区間のendpoint正規化
- 空intervalの除外
- interval長の計算
- interval配列のsort
- 重複intervalの結合
- 隣接intervalの結合
- 正規化済み配列に対する二分探索
- interval減算
- 部分解除による前後fragmentへの分割
- 包含・境界重複・複数解除範囲の処理

### 選択範囲変換

- VS Code APIに依存しない`TextPosition`と`TextSelection`を定義した
- 空選択はcursorが存在する1行へ変換する
- forward selectionとreverse selectionを同じintervalへ変換する
- selection終端がcharacter 0の場合、その行に文字が含まれないため終端行を除外する
- 複数selectionを変換後、重複・隣接intervalを結合する
- line countとpositionの非負整数・document範囲を検証する

## 計算量

- interval正規化: `O(n log n)`
- line検索: `O(log n)`
- 正規化後のinterval減算: `O(n + m)`
- selection変換: `O(s log s)`

## 対象ファイル

- `.github/workflows/ci.yml`
- `package.json`
- `src/core/intervals/index.ts`
- `src/core/intervals/line-intervals.ts`
- `src/core/intervals/selections.ts`
- `test/unit/line-intervals.test.ts`

## 終了条件との対応

- 0行目: cursor-only selection test
- 最終行: final line cursor test
- 逆向き選択: forward/reverse同値test
- 重複: interval正規化test、複数selection test
- 隣接: interval正規化test、複数selection test
- 包含: 全包含解除test
- 部分解除: split fragment test
- AC-04: 重複・隣接結合の純粋ロジックを実装
- AC-05: 一部解除でintervalを分割する純粋ロジックを実装

## 後続タスク

- T102でReview State Serviceからinterval追加・解除を利用する
- T105でVS Codeの`Selection`を`TextSelection`へ変換してcommandへ接続する
- T201以降で編集・diff mappingからinterval操作を再利用する

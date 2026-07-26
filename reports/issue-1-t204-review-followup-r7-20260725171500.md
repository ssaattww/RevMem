# T204 レビュー対応 R7

## 対象

- Pull Request: #24
- レビュー: `reports/issue-1-t204-review-r7-20260725170000.md`
- 対応前HEAD: `f2433715f84f085a83336a3b2348a30346eaa2a3`

## 指摘

1. `newFiles`由来の生成stateが入力snapshotと同じ強化validatorを通らない
2. whitespace/EOL無視に使う全文証拠がdiff hunkおよびlineCountと結び付いていない
3. snapshotの`updatedAt`が非空のみで日時妥当性を確認していない

## TDD

### Red

- commit: `d1a86dbd34fd1c6a3cb19f774e7562ee2e91df60`
- 空`fileId`および空`contentHash`を持つnew-file metadata
- diffと無関係なold/new全文によるEOL無視の不正継承
- `newText`とmetadata `lineCount`の不一致

### Green

- commit: `90076808ef3ce0737813ecb8154d0be1628b4ad7`

## 実装内容

- `newFiles`のpath、fileId、lineCount、contentHash、newText行数を利用前に検証
- unchecked engineの返却後に、入力と同一の`validateStateSnapshot`を適用
- old/new全文をzero-context diffの各hunk座標で再抽出し、removed/added linesと完全一致することを要求
- old全文行数をsource stateのlineCountと照合
- snapshot内`updatedAt`を`Date.parse`可能なtimestampとして検証
- mismatchは保守的な継承ではなくatomic failureとした

## CI

Green commit `90076808ef3ce0737813ecb8154d0be1628b4ad7`に紐づくworkflow run `30149284713`で以下がsuccess。

- Build
- Lint
- Unit tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

## 残事項

- parser二重実装の構造的解消は、今回のBlocking修正範囲では未実施
- 最終再レビューとtask/phase完了同期は未実施
- マージは実施しない

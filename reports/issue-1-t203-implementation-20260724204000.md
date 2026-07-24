# T203 実装レポート

## タスク

- 対象: T203 diff parserとrevision間interval mapping
- 関連Issue: #1
- Pull Request: #16
- ブランチ: `task/t203-diff-interval-mapping`
- 基点: `main` commit `fa0ab9823274d634d492fc09e3260d748075bb3e`

## CI失敗時診断の事前確認

- 作業開始時に`.github/workflows/ci.yml`を確認した
- 既存workflowは各工程の標準出力・標準エラーを`test-output/ci/*.log`へ保存する
- 失敗時は`test-output`、`dist`、`test-dist`、`src`、`test`、`tools`、型fixture、package・TypeScript・ESLint・workflow設定をartifactとして保存する
- 原因調査に必要な情報が既に含まれているためworkflow変更は行わなかった

## Test-Driven Development

### Red

- `test/unit/git-diff-interval-mapping.test.ts`を実装より先に追加した
- 未実装の`src/core/git-diff/index`をimportするfixtureを先行commitした

### Green

- zero-context Git diff parserとrevision間interval mapperを実装した
- `test:t203`を追加し、通常unit suiteへ接続した
- pure addition後の旧座標cursor重複写像を自己検証で検出し、修正commitと回帰fixtureを追加した

## 実装内容

- `diff --git`単位のfile解析
- `---`、`+++`、`rename from`、`rename to` metadata保持
- `@@ -oldStart,oldCount +newStart,newCount @@` hunk解析
- hunk body行数とheader countの整合検証
- hunk順序・重複の拒否
- 未変更旧行のline delta shift
- 変更旧行の確認済み解除
- 挿入新行を確認済みにしない処理
- 空白だけの同数置換を設定時のみ維持
- 文書全体のEOLだけの変更を設定時のみ維持

## 対象外

- rename、directory move、deleteをfile stateへ適用する処理はT204で実装する
- copy、分割、統合、曖昧候補の扱いもT204で実装する

## 対象ファイル

- `package.json`
- `src/core/git-diff/index.ts`
- `src/core/git-diff/git-diff-interval-mapping.ts`
- `src/core/git-diff/revision-interval-mapper.ts`
- `test/unit/git-diff-interval-mapping.test.ts`

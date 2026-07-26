# T204 再レビュー R8 対応レポート

## 対象

- Pull Request: #24
- レビュー: `reports/issue-1-t204-review-r8-20260725174000.md`

## 対応内容

- `previousPaths`にrename先が存在する場合、同一stable IDのrename結果から現行pathを除去し、旧pathを重複なく履歴へ保持するようにした。
- `a.ts -> b.ts -> a.ts`を複数revisionで適用しても、`currentPath=a.ts`、`previousPaths=[b.ts]`となる回帰testを追加した。
- 同一sourceに対するdeleteとrenameの併存を、unchecked engine呼び出し前にatomic拒否するようにした。
- 同一sourceのduplicate deleteをatomic拒否するようにした。
- 返却結果の`files`と`deletedFileIds`に同じfile IDが存在しないことを検証するようにした。

## TDD

- Red: `8f902a91664e039cb090171824966c247ba48b0e`
- Green: `51ec6c9c17f26754f23c0df5ebdce09dab81d524`
- TypeScript narrowing修正: `054a6becd855c67f218ab5c44f37602971d2e255`
- valid delete diffへのtest修正: `55237b81423d0e33218eff8f8827ab3bb28d781a`

## CI

### 失敗確認

- run: `30184496333`
- HEAD: `51ec6c9c17f26754f23c0df5ebdce09dab81d524`
- BuildでTypeScript narrowing error
- 診断artifact収集: success

- run: `30184563403`
- HEAD: `054a6becd855c67f218ab5c44f37602971d2e255`
- Unit testでdelete diffにhunkがないためparser contractに違反
- 診断artifact: `8626614468`

### 成功確認

- run: `30184640527`
- HEAD: `55237b81423d0e33218eff8f8827ab3bb28d781a`
- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

## 残事項

- parser／validator二重実装の構造的統合は別途検討対象。
- new destination追加処理の線形化は本Blocking修正には含めていない。
- 最終再レビュー後にtask／phase状態を同期する。
- マージは行わない。

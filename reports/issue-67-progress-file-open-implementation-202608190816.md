# Issue #67 Progress ファイル項目クリックオープン 実装レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#67`
- Pull Request: `#69`
- Branch: `fix/issue-67-progress-file-open`
- Base: `main`
- 作業種別: implementation
- TDD Red commit: `c61d222b52f43ff54c41501177bcd9130a921d4e`
- 実装検証HEAD: `c8425881d1f44a53bd7acb2b18ac884033032bc3`
- Merge: 実施しない

## 目的

PR Progress / Global Understanding に表示される理解度・進捗のファイル項目をクリックした際に、対応するファイルを開けるようにする。

受け入れ条件は Issue #67 の次の内容とした。

- 表示されているファイル項目をクリックできる。
- クリックすると対応する対象ファイルが開く。
- PR Progress / Global Progress の双方で動作する。
- 既存の進捗表示・理解度表示を壊さない。

## 事前確認

`.github/workflows/ci.yml` を確認し、失敗調査用 diagnostics artifact の仕組みが既に存在することを確認した。

- CI command の stdout / stderr をログへ保存する。
- 失敗時に `test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、設定、workflow 等を artifact として保存する。
- Red 確認時の run `32195922312` でも `ci-failure-diagnostics-32195922312-1` が実際に保存された。

したがって Issue #67 のための workflow 変更は不要と判断した。

## 調査結果

### PR Progress

`src/ui/pr-progress/vscode-pull-request-progress-tree.ts` では、既に file node の `TreeItem.command` に `reviewRange.openPrProgressItem` が設定されていた。reviewable な file node をクリックすると既存の `PullRequestProgressTreeDataProvider.select()` を経由し、PR review diff を開く実装になっている。

この既存動作を変更せず、Issue #67 の回帰条件としてテストへ固定した。

行単位レビュー対象外 node は既存設計どおり text diff を実行しない。この既存仕様は本 Issue の変更対象外とした。

### Global Understanding

`src/ui/global-understanding/vscode-global-understanding-runtime.ts` の file node は path と理解率を表示していたが、`TreeItem.command` が設定されていなかった。このためクリックしても対象ファイルを開く処理が存在しなかった。

一方、`T505GlobalUnderstandingSource` は選択中 Current Context から repository root を既に一意に解決していたため、multi-root や PR Context で別 workspace root を誤って使わないよう、その owner 解決を再利用した。

## TDD

### Red

先に `test/unit/t505-refresh-invalidation.test.ts` へ Issue #67 のテストを追加した。

追加した契約:

1. Global file path は選択中 Context の `repositoryRoot` に対して解決される。
2. `../outside.ts` のような repository 外 path は拒否される。
3. PR Progress file node の既存 click command を維持する。
4. Global file node に専用 open command を設定する。
5. Global runtime が open command を登録し、対象 repository-relative path を open 処理へ渡す。

Red commit:

- `c61d222b52f43ff54c41501177bcd9130a921d4e` `test: define issue 67 progress file opening behavior`

この HEAD と一致する CI run `32195922312` は失敗した。失敗原因は意図どおり、未実装 API に対する次の TypeScript compile error だった。

- `TS2339: Property 'resolveCurrentFilePath' does not exist on type 'T505GlobalUnderstandingSource'.`

### Green 実装

#### `src/t505-global-understanding-source.ts`

- `resolveCurrentFilePath(repositoryPath)` を追加した。
- 現在選択中 Context を既存 `resolveOwner()` で解決する。
- repository-relative path を `requireCanonicalRepositoryRelativePath` で検証する。
- 検証済み path だけを current owner の `repositoryRoot` と結合する。

これにより `../` 等で repository 外を指す path を open 対象にしない。

#### `src/ui/global-understanding/vscode-global-understanding-runtime.ts`

- `reviewRange.openGlobalUnderstandingFile` command ID を追加した。
- Global file node の `TreeItem.command` に上記 command と `node.path` を設定した。
- command handler を登録した。
- 通常経路では `T505GlobalUnderstandingSource.resolveCurrentFilePath()` で filesystem path を解決し、`vscode.workspace.openTextDocument()` と `vscode.window.showTextDocument()` で通常 editor に開く。
- open 処理は optional dependency として差し替え可能にし、runtime wiring をテスト可能な境界にした。
- open failure は既存 `reportError` 経路へ渡す。

### PR Progress の扱い

PR Progress の reviewable file node は既に click で PR diff を開いていたため、production code は変更していない。Issue #67 のテストでこの wiring を回帰条件として確認している。

## 変更ファイル

- `test/unit/t505-refresh-invalidation.test.ts`
- `src/t505-global-understanding-source.ts`
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`
- `reports/issue-67-progress-file-open-implementation-202608190816.md`

## Commit

- `c61d222b52f43ff54c41501177bcd9130a921d4e` `test: define issue 67 progress file opening behavior`
- `07c9ca5072705813da4fe1b9469ba35e08295770` `feat: resolve Global progress files from current context`
- `c8425881d1f44a53bd7acb2b18ac884033032bc3` `feat: open Global progress file items on click`

## 検証結果

### Red run

- PR HEAD: `c61d222b52f43ff54c41501177bcd9130a921d4e`
- Workflow run: `32195922312`
- Result: `failure`
- Expected failure: `resolveCurrentFilePath` 未実装による `TS2339`
- Failure diagnostics artifact: 保存成功

### 実装 HEAD run

- PR HEAD: `c8425881d1f44a53bd7acb2b18ac884033032bc3`
- Workflow run: `32196173542`
- Result: `success`

同 run で確認した主な step:

- Build: PASS
- Contract typecheck: PASS
- Architecture validation: PASS
- Architecture negative contract: PASS
- Lint: PASS
- Unit tests: PASS
- T304 PR progress tree tests: PASS
- T502 Global mapping/display tests: PASS
- T503 repository enumeration tests: PASS
- T504 Global understanding tests: PASS
- T505 Global understanding tests: PASS
- T506 Global multi-context integration: PASS
- Temporary Git integration tests: PASS
- Mock GitHub integration tests: PASS
- VS Code Extension Host tests: PASS

CI 判定には PR current HEAD SHA と workflow run の head SHA が一致する run のみを使用した。別 SHA の run は代用していない。

## 既知事項・残存リスク

- worker 環境から GitHub への直接 DNS 解決ができず、local clone による test 実行はできなかった。そのため Red / Green の実行確認は GitHub Actions の exact-HEAD CI を使用した。
- 専用の Extension Host UI test で Tree View を実際に mouse click する操作までは追加していない。file node command wiring、path 解決、T304/T505 focused tests、および既存 VS Code Extension Host suite の成功で検証している。
- PR Progress の行単位レビュー対象外 node が text diff を開かない既存仕様は維持している。

## 完了時処理

この report 保存により branch HEAD は更新されるため、report commit を含む PR current HEAD に一致する CI run を追加確認する。その最終 exact-HEAD CI 結果と変更要約は PR #69 のコメントへ投稿する。

PR の merge は実施しない。

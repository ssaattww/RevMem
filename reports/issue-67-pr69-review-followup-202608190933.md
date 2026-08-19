# PR #69 Issue #67 レビュー指摘対応レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#67`
- Pull Request: `#69`
- Branch: `fix/issue-67-progress-file-open`
- Base: `main`
- 作業種別: review follow-up implementation
- 初回 reviewed implementation HEAD: `3e4e5cd4a0e63a2aad1d942f7c1dedaaba105097`
- 指摘対応開始時 HEAD: `71a4729adb51e9b508387f6b615c53d9405423ca`
- Technical implementation HEAD: `f7618f943132f2c56cedea3ca91b92345bb0e9bd`
- Merge: 実施しない

## 対応対象

初回レビュー `reports/issue-67-pr69-review-202608190844.md` の全 finding を対象とした。

- `PR69-R001` High: Global file node が表示 snapshot の owner/revision identity を保持せず、Context 切替後の別 repository や mutable working tree を開き得る。
- `PR69-R002` High: PR Progress の `line-review-unsupported` file item は command が付いているが、クリックしても対象ファイルを開かない。
- `PR69-R003` Low: Global file open 失敗が refresh 用の「Global理解率を更新できませんでした」と誤表示される。

3件とも actionable と判断し、finding ID と severity を維持して対応した。

## 事前確認

`.github/workflows/ci.yml` には既に failure diagnostics artifact 保存がある。CI command の標準出力・標準エラーを `test-output/ci` へ保存し、失敗時に test output、生成物、`src/`、`test/`、設定、環境情報、Git 状態、workflow を artifact へ含めるため、workflow の追加変更は不要だった。

作業開始時 HEAD `71a4729adb51e9b508387f6b615c53d9405423ca` と一致する CI run `32198532350` が success であることも確認した。以降の CI 判定は、各時点の PR current HEAD SHA に一致する pull-request workflow run のみを使用した。

## TDD chronology

### Red

レビュー finding の挙動を先に test へ追加した。

- `test/unit/t505-refresh-invalidation.test.ts`
  - repository A の Global node を作成後に source Context を repository B へ切替えても、open target が A に固定されること。
  - PR HEAD にのみ存在し local working tree に存在しない added file でも、Global snapshot が exact PR HEAD identity を保持すること。
  - stale Global node が open host へ到達しないこと。
  - Global open failure が専用 reporter と `Global のファイルを開けませんでした` メッセージへ到達すること。
- `test/unit/t304-review-followup-r3.test.ts`
  - binary / invalid-encoding / unsupported-encoding の3種類すべてで、unsupported PR Progress node が non-review file host を呼び、text diff host を呼ばないこと。
- `test/unit/t405-pull-request-review-runtime.test.ts`
  - Global PR open 用 URI が exact HEAD の canonical `review-range-diff` document を指すこと。
  - 同 Context が別 HEAD へ更新された後に旧 revision target を使うと stale として拒否すること。
- `test/vscode/t306-suite/index.ts`
  - real Extension Host で binary PR Progress node command を実行し、text diff を増やさず通常 file open host が対象 URI を開くこと。

最初の test-only HEAD `d40e5cd6672d6af7211e7966a9f3628a09443d59` では NodeNext test fixture の import 拡張子不足も同時に検出されたため、test fixture だけを修正した。

Clean Red:

- HEAD: `cc00ea5ce7f7765ccfec6c41a26becc8a0b1fcf3`
- CI run: `32202551461`
- Result: failure
- Primary failure: `GlobalUnderstandingFileNode` に `openTarget` が存在しない `TS2339`
- Diagnostics artifact: `9348022545`

production 実装前に、レビューで要求された snapshot-bound open target が未実装であることを test failure として確認した。

## 実装

### PR69-R001 — Global open target を表示 snapshot に固定

`GlobalUnderstandingTreeSnapshot` / `GlobalUnderstandingFileNode` に immutable open target を導入した。

working-tree target は次を保持する。

- `repositoryId`
- `contextId`
- `revisionId`
- canonical `repositoryPath`
- snapshot 生成時の `filePath`

pull-request target は次を保持する。

- `repositoryId`
- `contextId`
- exact PR HEAD `revisionId`
- canonical `repositoryPath`
- `fileSystemPathSemantics`

`T505GlobalUnderstandingSource.recalculate()` が owner を解決した同じ時点で progress file と対応する open target を生成する。クリック時に mutable `currentContext` を再解決する旧 `resolveCurrentFilePath()` 経路は廃止した。

`GlobalUnderstandingFileOpenController` は現在 model の node identity を保持し、model clear/replacement 後の旧 node を stale として open host に渡さない。Current Context の recompute / explicit accept 時には dependent refresh より前に `globalRuntime.clear()` を行い、旧 Context の node を同期的に無効化する。

PR Context は working tree を代用せず、`PullRequestReviewRuntime.createHeadFileDocumentUri()` で exact registered HEAD の canonical `review-range-diff` virtual document を開く。requested revision と現在 registration の HEAD が一致しない場合は stale として拒否する。これにより未 checkout の PR HEAD、local と内容が異なる PR HEAD、PR HEAD にのみ存在する added file でも Global 計算に使った immutable content と同じ revision を開く。

Remote / multi-root の working-tree target は snapshot に固定された `filePath` を利用しつつ、該当 workspace folder を特定できる場合は folder URI と repository-relative path から URI を構成し、Remote scheme を保持する。

### PR69-R002 — line reviewability と file openability を分離

`PullRequestProgressTreeDataProvider` の host に non-review `openFile` boundary を追加した。

- reviewable node: 従来どおり `openDiff()`
- line-review-unsupported node: `openFile()`

unsupported node で text diff は生成しない。binary / invalid encoding / unsupported encoding の reason は従来どおり保持しつつ、file item のクリック自体は対象を開く。

production Local Base/Head runtime では repository path から workspace URI を作り、`vscode.open` を実行する。Extension Host test API では opened file URI を記録し、binary node command の実挙動を検証する。

### PR69-R003 — open 専用 error boundary

Global refresh と file open の reporter を分離した。

- refresh: `Global理解率を更新できませんでした: ...`
- file open: `Global のファイルを開けませんでした: ...`

stale target、missing target、permission/document open failure は `GlobalUnderstandingFileOpenController` の専用 boundary から `reportOpenError` へ流し、再計算失敗として誤表示しない。

## 互換性修正

実装後の exact-head CI で、対象 file が0件の既存 T505 snapshot deep-equality test が、新しい `fileOpenTargets: []` の追加により failure した。

- HEAD: `0f61cfc1753d8a2f1f01c9d1aa17b47822cd5059`
- CI run: `32203606641`
- Result: failure at `T505 Global understanding tests`
- Diagnostics artifact: `9348380835`

対象 file が0件の場合は `fileOpenTargets` 自体を省略し、従来 snapshot shape を維持した。対象 file が存在する場合だけ identity-bound targets を公開する。

その前の implementation HEAD `7903defd7ae0969bdf983c86cd2f4986c70b1b4d` では `src/t505-global-understanding-source.ts` の `node:path` import 抜けを build が検出した。

- CI run: `32203511342`
- Result: build failure
- Diagnostics artifact: `9348329963`
- 修正: import 1行のみの `0f61cfc1753d8a2f1f01c9d1aa17b47822cd5059` 前段 commit

いずれの失敗も artifact を確認して原因を限定し、別 SHA の run を代用しなかった。

## Commit 構成

- `d40e5cd6672d6af7211e7966a9f3628a09443d59` — review finding behavioral tests を先行追加。
- `cc00ea5ce7f7765ccfec6c41a26becc8a0b1fcf3` — Red fixture の import のみ修正し clean Red を確立。
- `aaf3c0cb291206560a80534a3187f97d822d0235` — Global snapshot-bound target、stale protection、immutable PR HEAD open、専用 open error boundary。
- `7903defd7ae0969bdf983c86cd2f4986c70b1b4d` — unsupported PR Progress file の non-review open。
- `0f61cfc1753d8a2f1f01c9d1aa17b47822cd5059` — Global source の `node:path` import を復元。
- `f7618f943132f2c56cedea3ca91b92345bb0e9bd` — empty Global snapshot の既存 shape を維持。

## Technical HEAD 検証

Technical implementation HEAD と完全一致する workflow run のみを採用した。

- HEAD: `f7618f943132f2c56cedea3ca91b92345bb0e9bd`
- Workflow: `CI`
- Run: `32203829305`
- Result: `success`

成功を確認した step:

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T602 history rewrite recovery tests
- T603 schema migration and corruption recovery tests
- T403 GitHub cache tests
- T404 GitHub PR context layer tests
- T405 Review Contexts follow-up tests
- T304 PR progress tree tests
- T502 Global mapping/display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- T505 Global understanding tests
- T506 Global multi-context integration
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

Failure diagnostics stepsは成功 run のため skip された。

## Finding disposition

### PR69-R001

- Severity: High
- Disposition: addressed
- Evidence:
  - snapshot が repository/context/revision-bound open target を持つ。
  - Context switch で old model を clear し、controller が stale node を拒否する。
  - PR Context は exact HEAD virtual document を開き、superseded HEAD を拒否する。
  - repository A -> B、PR added-only / local-missing の behavioral tests が PASS。

### PR69-R002

- Severity: High
- Disposition: addressed
- Evidence:
  - provider が unsupported node を non-review `openFile` host へ委譲する。
  - binary / invalid-encoding / unsupported-encoding の unit behavioral tests が PASS。
  - binary node の Extension Host command test が PASS。
  - unsupported node では text diff host を呼ばない。

### PR69-R003

- Severity: Low
- Disposition: addressed
- Evidence:
  - open 専用 `reportOpenError` を導入。
  - formatter は `Global のファイルを開けませんでした: ...` を返す。
  - open host failure を command/controller 経由で dedicated reporter へ流す behavioral test が PASS。

## 変更しなかったもの

- `.github/workflows/ci.yml`: 必要な diagnostics artifact が既に存在するため変更なし。
- Review verdict: fix worker は自身の変更を独立レビューしない。
- Merge: 利用者が実施するため行わない。
- unrelated task/status tracking: Issue #67 / PR #69 の review follow-up scope 外。

## 残存リスク / 次のアクション

実装 worker として確認できる automated validation は technical HEAD で全て PASS した。レビュー finding の closure は original reviewer または独立 reviewer による fix verification が必要である。

この report と handoff を commit すると PR HEAD が変わるため、commit 後の新しい current HEAD と run head SHA が完全一致する CI を改めて確認し、その結果を PR コメントへ記録する。merge は行わない。

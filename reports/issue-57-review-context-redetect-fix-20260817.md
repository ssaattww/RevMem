# Issue #57 Review Contexts 再検出エラー修正レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#57`
- Pull Request: `#58`
- Branch: `fix/issue-57-review-context-redetect`
- Base: `main` (`31cce9aebaa95592d9570680a59e460475b489b7`)
- 検証対象 implementation HEAD: `b780f764bb9a133e9f0ca9938faf93909b2a51be`
- Report type: implementation report
- Persistence mode: repository file

## 目的

Issue #57 で報告された Review Contexts の2つの失敗経路を修正する。

1. 新規 PR context を作成するとき、owner-wide Global state の revision が検出した PR head と異なると `現在のGlobal stateをPR headへ安全に対応付けできません。` で失敗する。
2. repository に `origin` が列挙される一方で URL を取得できない場合、`git remote get-url origin` の exit code 128 が Current Context 更新まで失敗させる。

## 権威ある要件と設計根拠

- ユーザー指示: Issue #57 のエラー対応。
- Repository instruction: `AGENTS.md`。
- 設計: `doc/design/vscode-review-range-tracker-design.md`。
  - 新規 context 作成時、既存 Global が別 revision なら mapping 後の Context/Global を同一の atomic publish で保存する。
  - GitHub/remote 側の取得失敗でローカル review 操作を停止させない。
- TDD: RevMem 実装作業は、先に失敗するテストを追加して RED を確認してから実装する。

## 作業開始時の診断 artifact 確認

`.github/workflows/ci.yml` には既に失敗診断 artifact の収集・upload があり、`tools/run-ci-command.mjs` がコマンドごとの標準出力、標準エラー、combined log、result metadata を `test-output/ci` に保存する構成だったため workflow 変更は行っていない。

RED CI でも `ci-failure-diagnostics-31992818785-1` が正常に upload され、artifact ID は `9275883653` だった。

## 原因

### 1. Global revision mismatch

`src/t405-review-contexts-runtime.ts` の新規 PR 初期化経路は owner-wide Global を読み、`currentRevisionId` が PR head と一致しない場合に mapping をせず `undefined` を返していた。その後の呼び出し側が Issue #57 のエラーメッセージを投げていた。

既存実装には Git revision 間で確認済み範囲を保守的に移送する `GitContextRevisionMapper` があるため、新規 PR context 初期化だけがその mapping 経路を迂回していた。

### 2. unusable remote URL

`src/adapters/local-git/local-git-adapter.ts` の `resolveIdentityRemote` は `git remote` で `origin` を見つけた後、`git remote get-url origin` の非0終了をそのまま `GitCommandFailedError` にしていた。

remote identity は repository ID を hosted identity に寄せるための補助情報であり、URL が使えない場合でも root-derived identity でローカル Git context は構成できるため、remote URL 取得失敗を repository inspection 全体の失敗にする必要はなかった。

## TDD: RED

### 追加した回帰テスト

- `test/unit/review-contexts-runtime-wiring.test.ts`
  - `Issue #57 maps an existing owner-wide Global revision before publishing a new PR context`
  - production wiring が `GitContextRevisionMapper` を通し、旧 fail-fast エラーパスを残さないことを固定した。
- `test/unit/local-git-adapter.test.ts`
  - `Issue #57 keeps local Git context usable when a listed remote URL cannot be resolved`
  - `git remote` が `origin` を返し、`remote get-url origin` が exit 128 の場合でも repository inspection が成功し、remote は未解決、repository ID は root-derived、branch/HEAD は保持されることを固定した。

### RED commits

- `22791515a51f951c7896a27e1cafa5b52c1fad49` — Global mapping regression test
- `335565f73ca7e5dfec27555040fef908dcf79979` — unusable remote regression test

### RED CI

- PR HEAD: `335565f73ca7e5dfec27555040fef908dcf79979`
- Workflow: `CI`
- Run ID: `31992818785`
- Job ID: `95279238495`
- Run head SHA: `335565f73ca7e5dfec27555040fef908dcf79979`
- Conclusion: `failure`
- Unit tests: 501 total / 500 pass / 1 fail
- 失敗したテスト: `Issue #57 maps an existing owner-wide Global revision before publishing a new PR context`
- Failure diagnostics artifact: `ci-failure-diagnostics-31992818785-1`, ID `9275883653`

この run は PR の当時の current HEAD と run の `head_sha` が一致していることを確認しており、別 SHA の run は RED 判定に使用していない。

## 実装

### `src/adapters/local-git/local-git-adapter.ts`

commit `c8536e49807a95bc99fa480c0bf98bf9fc005d0d`。

- remote 名を列挙し、`origin` を優先して候補を評価する。
- `remote get-url <name>` が非0終了した remote は identity 候補から外し、次の remote を試す。
- URL 出力が空、または正規化できない remote も同様に候補から外す。
- 使用可能な remote がなければ `undefined` を返し、既存の root-derived repository ID にフォールバックする。
- `git remote` 自体、repository root、branch、HEAD などの予期しない Git failure は従来どおり伝播させる。

### `src/t405-review-contexts-runtime.ts`

commit `b780f764bb9a133e9f0ca9938faf93909b2a51be`。

- 新規 PR context 初期化に `GitReviewContextResolver` と `GitContextRevisionMapper` を接続した。
- owner-wide Global が存在しない場合は現在 revision の空 Global を作る。
- Global が既に現在 revision ならその snapshot をそのまま使う。
- Global が別 revision の場合は `GitContextRevisionMapper.map()` で現在の immutable Git revision へ保守的に mapping する。
- `reviewRange.ignoreWhitespaceChanges` と `reviewRange.ignoreEolChanges` を既存 mapping policy と同じ形で適用する。
- PR context の create には、同じ読み取りで取得した旧 Global を expected CAS snapshot、mapping 後 Global を next snapshot として渡す。
- 旧 `現在のGlobal stateをPR headへ安全に対応付けできません。` fail-fast 分岐を削除した。

## GREEN 検証

implementation HEAD `b780f764bb9a133e9f0ca9938faf93909b2a51be` に対して、同一 SHA に紐づく workflow run のみを確認した。

- Workflow: `CI`
- Run ID: `31993055281`
- Run head SHA: `b780f764bb9a133e9f0ca9938faf93909b2a51be`
- Job ID: `95279856634`
- Conclusion: `success`

成功した主要 step:

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
- T502 Global mapping and display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- T505 Global understanding tests
- T506 Global multi-context integration
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

この GREEN 判定にも別 SHA の workflow run は使用していない。

## 変更ファイル

- `test/unit/review-contexts-runtime-wiring.test.ts` — Global mismatch 回帰テスト
- `test/unit/local-git-adapter.test.ts` — unusable remote 回帰テスト
- `src/adapters/local-git/local-git-adapter.ts` — remote URL 取得失敗時のローカル継続
- `src/t405-review-contexts-runtime.ts` — 新規 PR context 作成前の Global mapping と CAS

## 意図的に変更していないもの

- `.github/workflows/ci.yml`: 必要な失敗診断 artifact が既に存在するため変更なし。
- `tasks/tasks-status.md`: Issue #57 は既存タスク進捗の更新ではないため変更なし。
- `doc/design/vscode-review-range-tracker-design.md`: 実装を既存設計へ合わせる修正であり、設計変更なし。
- `Design/BreakingChanges.md`: 破壊的変更なし。
- OAuth scope / GitHub authentication policy: Issue #57 の修正範囲外。

## 残存リスク・未実施

- worker は利用者の実 private repository そのものを使った手動 E2E 再現を実施していない。自動回帰テスト、Mock GitHub、Temporary Git、Extension Host を含む exact-head CI で修正経路を検証した。
- report/handoff の repository persistence commit は implementation HEAD の後に追加されるため、PR の最終 HEAD は変化する。最終 HEAD の exact-head CI は persistence 後に別途確認し、PR metadata/comment に記録する。

## 次のアクション

- report と handoff を repository に保存する。
- その persistence 後の PR current HEAD と一致する CI を再確認する。
- PR #58 に簡易 report をコメントする。
- merge は利用者が行う。worker は merge しない。

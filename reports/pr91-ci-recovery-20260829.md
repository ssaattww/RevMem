# PR #91 CI復旧レポート

## 対象

- Repository: `ssaattww/RevMem`
- Pull Request: `#91` (`fix/issue-90-diagnostics-stale-cancellation` -> `main`)
- 目的: PR #91 の current HEAD に紐づく required CI を成功させる。
- Merge: 実施しない。

## 開始時点の状態

- 開始時 current HEAD: `6cbf3c283f2a88ab4a5c55628199d5037e34b649`
- exact-head CI run: `33249532220` (`CI #3865`)
- 結果: `failure`
- 失敗job: `build-and-lint` / `Unit tests`
- Unit tests: 647件中646件成功、1件失敗
- 失敗test: `metadata timeout escalates to SIGKILL when the process ignores SIGTERM`
- 実際の診断: `Git command timed out after 30 ms\nGit process terminated by SIGTERM`
- test期待値: `sent SIGKILL`

## Failure diagnostics workflow確認

開始時点で既存CI workflowが失敗診断を保存していたため、workflow変更は不要だった。

- `Collect failure context`: success
- `Upload failure diagnostics`: success
- artifact: `ci-failure-diagnostics-33249532220-1`
- artifact id: `9713911535`
- artifact workflow `head_sha`: `6cbf3c283f2a88ab4a5c55628199d5037e34b649`
- artifactには `test-output/`, `dist/`, `test-dist/`, `src/`, `test/`, `tools/`, `type-fixtures/`, package/TypeScript/ESLint/CI workflowファイルが含まれ、CI command wrapperがstdout/stderr/combined log/result metadataを保存している。

## 原因

`test/unit/node-git-command-executor.test.ts` のSIGKILL escalation testが実Node child processを起動し、30 ms後にSIGTERMを送っていた。

テストは子Nodeが次のhandlerを登録済みであることを暗黙に前提としていた。

```text
process.on('SIGTERM', () => {})
```

runner負荷やprocess startup時間によってはhandler登録前に30 ms timeoutへ到達する。その場合、子processはSIGTERMを無視せずSIGTERMで終了するため、executorは正常にclose eventを受け取り、SIGKILL escalationへ進まない。

production `NodeGitCommandExecutor` は既に `processFactory` 注入境界を持ち、timeout時に `SIGTERM -> grace period -> SIGKILL -> bounded failure` を実装していた。今回のfailureはproduction lifecycleの欠陥ではなく、OS/process startup timingに依存するtest raceだった。

## Red evidence

1. exact-head CI `33249532220` で同testが失敗した。
2. failure diagnostic artifact内の既compile済みtestを反復実行し、20回以内（3回目）に同じfailureを再現した。

これによりCI runner固有の一時障害ではなく、test自体の非決定性と判断した。

## 修正

変更ファイルは次の1件のみ。

- `test/unit/node-git-command-executor.test.ts`

`SigtermIgnoringGitChild` test doubleを追加し、`processFactory`から注入した。

- `SIGTERM` は受理するがcloseを発生させず、SIGTERM無視状態を決定的に再現する。
- `SIGKILL` 受理時のみmicrotaskで `close(null, "SIGKILL")` を発生させる。
- executorが送ったsignal列を `SIGTERM`, `SIGKILL` の順で検証する。
- failure diagnosticsに `sent SIGKILL` と `terminated by SIGKILL` が含まれることを検証する。

production code、workflow、design、performance test、package metadataは変更していない。

## 検証

### Local focused

failure artifact内の既compile済みJSへ同等の修正を適用し、対象testを100回連続実行した。

- 結果: 100/100 success

ローカル環境で `npm ci --ignore-scripts` は120秒でtimeoutしたため、依存関係を再構築したfull local gateは実行できていない。この点はremote exact-head CIで補完した。

### Technical commit

- commit: `4980667e34e3c89440049e239ef7db1ffc0fb2cf`
- commit message: `test(pr91): SIGKILL timeout testを決定的にする`

### exact-head required CI

- PR current HEAD確認: `4980667e34e3c89440049e239ef7db1ffc0fb2cf`
- run: `33249897397` (`CI #3867`)
- workflow run `head_sha`: `4980667e34e3c89440049e239ef7db1ffc0fb2cf`
- conclusion: `success`

成功step:

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T602 / T603
- T403 / T404 / T405 / T406
- T304
- T502 / T503 / T504 / T505 / T506
- T604 / T605 / T606
- T609 / T610
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests
- Package user validation artifacts
- Upload user validation artifacts

failure diagnostics stepsは成功runのためskipされた。

### success artifact

- artifact id: `9714105581`
- artifact name: `review-range-user-validation-571421783aa5c36dd1c4c88f05f3e66b333c8424`
- artifact workflow `head_sha`: `4980667e34e3c89440049e239ef7db1ffc0fb2cf`
- digest: `sha256:4390955ff0d6931013aa1316380c9f2f5178c200395f48bdadd5fa659d3b251f`

artifact名にはpull_request workflowのmerge SHAが使われているが、GitHub artifact metadata上のworkflow `head_sha` は上記technical HEADと一致している。本CI復旧ではartifact namingは変更していない。

## 変更していない範囲

- `src/**`
- `.github/workflows/**`
- `doc/**` / `Design/**`
- performance tests
- package dependencies / lockfile
- task status

## 残存事項・リスク

- local full gateはdependency install timeoutのため未実施。remote exact-head required CIは全step成功した。
- 本レポート自体の保存はtechnical commit後のreport-only commitになるため、そのcommitのexact-head CI結果はcommit後に確認し、PRコメントで最終attestationを記録する。
- Mergeは実施しない。

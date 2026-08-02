# T304 初回レビュー指摘対応レポート

## 対象

- Repository: `ssaattww/RevMem`
- Pull Request: #38
- Task: T304 PR Progress Tree View
- Branch: `task/t304-pr-progress-tree`
- 初回レビュー対象HEAD: `1fdecc956d6c3a42d7d65b203ff7b75decd7afd8`
- 初回レビューreport: `reports/issue-1-t304-review-20260802213932.md`
- 対応したfinding: `T304-R1-P1`、`T304-R1-P2`、`T304-R1-P3`

## 作業開始時確認

`.github/workflows/ci.yml`には、各commandの標準出力と標準エラーを`2>&1 | tee`で`test-output/ci`へ保存し、失敗時に環境、Git状態、生成物一覧、source、test、tools、type fixtures、manifest、lockfile、設定、workflowをartifactへ含める処理が既に存在した。このため診断workflowの追加は不要だった。

## Finding対応

### T304-R1-P1: diff選択のcontext・revision identity欠落

`PullRequestProgressTreeDataProvider`の入力を集計値だけの`PullRequestDiffProgress`から、次を一体化した`PullRequestProgressTreeSnapshot`へ変更した。

- opaqueなsnapshot generation ID
- PR context ID
- full immutable base/head commit object ID
- canonical original diff ID
- workspace filesystem path semantics
- PR progress
- fileごとのline reviewability

各file nodeは、base/head revision、old/new path、context ID、filesystem semanticsを保持する`PullRequestProgressTreeDiffTarget`を生成する。選択時はこのtargetだけをhostへ渡す。

providerは現在snapshotから生成したnode objectだけをcurrent setへ保持し、refresh、revision更新、context切替、clearより前に取得したnodeの選択を`RangeError`で拒否する。同じfile IDとpathが新snapshotにも存在する場合でも、旧nodeを新contextまたは新revisionへ読み替えない。

### T304-R1-P2: encoding対象外分類の欠落

fileごとのline reviewabilityを次の明示的なunionとして追加した。

- `reviewable`
- `unsupported / binary`
- `unsupported / invalid-encoding`
- `unsupported / unsupported-encoding`

line-review unsupportedは除外globやmetadata-onlyより先に「行単位レビュー対象外」へ分類する。binary、不正encoding、未対応encodingを別の日本語理由で表示する。

reviewability mapはPR progress file IDに対して完全一致を要求する。missing entry、unknown file entry、未知discriminant、空encoding名、binaryとの理由不一致、unsupportedなのにline countが非zeroの入力を保守的に拒否する。

### T304-R1-P3: 標準test discovery欠落

- `test/unit/pull-request-progress-tree.test.ts`を`test:unit`へ登録した。
- `test:t304`を追加し、CI contract testとT304 behavior testを実行するようにした。
- CIのT304 stepをraw `node --test`から`npm run test:t304`へ変更した。
- `test/unit/ci-workflow-contract.test.ts`へ、`test:unit`、`npm test`、`test:t304`、CI stepの接続を検証するcontract testを追加した。

## TDD証跡

### P3 Red

- Test commit: `851c55a66206ac64a82236fce6efa5f64655f3a5`
- Exact-head run: `30748859263`
- Job: `91499168091`
- Result: failure
- Failure: `test:unit must execute the T304 tree contract`
- Diagnostic artifact: `8833773687` / `ci-failure-diagnostics-30748859263-1`

### P1/P2 Red

- Test commit: `c17b97f03af516f0c484356042c91d2ba8bb9c78`
- Exact-head run: `30748932987`
- Job: `91499365739`
- Result: failure
- Failure: snapshot-bound型と`replaceSnapshot`が未実装
- Diagnostic artifact: `8833796187` / `ci-failure-diagnostics-30748932987-1`

### 中間Green確認で検出した境界不整合

- Head: `72a16a48070df9d67e79a82c8160a2d4153a9ec3`
- Exact-head run: `30749149862`
- Job: `91499941813`
- Result: failure
- Diagnostic artifact: `8833863915` / `ci-failure-diagnostics-30749149862-1`
- 原因:
  - diff target構築時にsnapshot固有のprogress/reviewabilityまで展開していた
  - 空encoding reasonより先にline count不整合を報告していた
- 修正:
  - diff targetをimmutable identity、file、original/modified sideだけへ限定した
  - reasonの妥当性を確認した後にunsupported line countを検証する順序へ変更した

## Green検証

- 技術実装HEAD: `e43069a967f6f5179d7a5894b897d05adc3f7f75`
- Exact-head workflow run: `30749231759`
- Job: `91500162120`
- Conclusion: success

成功step:

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T304 PR progress tree tests
- T503 repository enumeration tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのrunは代用していない。

## 変更ファイル

- `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`
- `src/ui/pr-progress/index.ts`
- `test/unit/pull-request-progress-tree.test.ts`
- `test/unit/ci-workflow-contract.test.ts`
- `package.json`
- `.github/workflows/ci.yml`
- 本report
- review follow-up handoff

## Finding disposition

| Finding | 対応 | 状態 |
|---|---|---|
| T304-R1-P1 | identity-bound snapshot、immutable diff target、stale node拒否を追加 | addressed。初回reviewerのclosure確認待ち |
| T304-R1-P2 | binary・invalid encoding・unsupported encodingの分類と理由を追加 | addressed。初回reviewerのclosure確認待ち |
| T304-R1-P3 | standard/focused test discoveryとCI contractを追加 | addressed。初回reviewerのclosure確認待ち |

## 対象外

- Activity Bar、VS Code固有TreeItem/event wiring、Current Context、Status BarはT305以降
- PR metadata/diff取得、encoding判定source、cache、refresh sourceはT402以降
- 独立最終レビュー
- merge

`tasks/tasks-status.md`は、repositoryが指定するprogress management skillを介さない直接更新が禁止されており、該当managerが利用できないため変更していない。

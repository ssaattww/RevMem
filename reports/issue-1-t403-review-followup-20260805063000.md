# T403 通常レビュー指摘対応レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Task: `T403`
- Pull Request: `#44`
- Mode: normal review follow-up
- Reviewed implementation HEAD: `dae613ce12be2027eecf27b4f5c4762dddb0a51d`
- Review report: `reports/issue-1-t403-review-20260805061700.md`
- Review report commit: `6be7658099290bcd957ca97a574d88994825f988`
- Fix implementation HEAD before this report: `059b491b71aa7b71600839d482d15e7bf68a8ec8`
- Merge: 未実施

## 対応対象

通常レビューで報告された次の2 findingへ対応した。

- `T403-R001` high: remote attemptの一部に`rate-limit`または`network`があれば、generic `api` failureが混在してもoffline cacheへfallbackしていた。
- `T403-R002` medium: `tasks/tasks-status.md`のT403実装HEAD・matching CI記録が古い値を示していた。

対応範囲はT403のcache fallback判定、回帰test、T403進捗記録、当レポート、handoff、PR説明・コメントに限定する。`tasks/phases-status.md`とT403以外のtask状態は変更しない。

## T403-R001対応

### Red test

commit `1ecd22388dd60f9986ecd95ab3a49fb2ec59aeb8`で、cacheを事前作成した後に次のmixed remote failureを返す回帰testを追加した。

1. `github-patch=rate-limit`、`github-content=api`
2. `github-patch=api`、`github-content=rate-limit`
3. `github-patch=network`、`github-content=api`
4. `github-patch=api`、`github-content=network`

すべて元の`kind: unavailable`を保持し、offline cacheを返さないことを期待する。

Red HEADに完全一致するCI run `30952268922`、job `92136965055`は、既存unit 416件を通過後、focused T403 suiteで追加testのみ失敗した。

- Result: failure
- Focused T403: 7件中6件成功、mixed failure testのみ失敗
- 最初の失敗: `rate-limit + api must not use offline cache`
- Diagnostic artifact: `ci-failure-diagnostics-30952268922-1`
- Artifact ID: `8909601516`
- Artifact digest: `sha256:9958d185cef2bd6f50cf252d611b13ec6dee8fe744cb4b809204cd50cff0e1f4`

artifactには`test-output/ci/test-t403.log`、標準出力・標準エラー、source、tests、生成物、environment、Git状態、設定が保存された。

### 実装修正

commit `e19861a9452918075b7e12962067d174155a1538`で`allowsOfflineFallback`を修正した。

- local Git attemptをremote判定から除外する。
- terminal remote attemptが`rate-limit`または`network`であることを要求する。
- 全remote attemptを検査し、generic `api`などoffline非許可reasonが1件でも含まれればcacheを利用しない。
- T402の正当なroute遷移として、terminalより前の`github-patch=missing-patch`または`incomplete-patch`だけを許可する。

これにより、`rate-limit/network`と`api`が混在する4通りはfail closedとなる。一方、GitHub patchが欠落・不完全だったためcontent fallbackへ進み、そのcontent取得がnetwork failureになった場合はoffline cacheを利用できる。

### sibling behavior回帰test

commit `059b491b71aa7b71600839d482d15e7bf68a8ec8`で次を追加した。

- `github-patch=missing-patch`、`github-content=network`ではoffline cacheを利用する。
- `github-patch=incomplete-patch`、`github-content=network`ではoffline cacheを利用する。

これにより、finding修正でT402の正当なpatch-to-content fallbackを壊していないことを固定した。

## T403-R002対応方針

`tasks/tasks-status.md`のT403関連箇所だけを次の状態へ同期する。

- 通常reviewの2 findingへの対応完了
- fix implementation HEAD `059b491b71aa7b71600839d482d15e7bf68a8ec8`
- 同HEAD一致CI run `30952458920` success
- 次工程は同じ通常reviewerによるfix verification
- T403 review reportと当follow-up reportを参照

tracking fileを保存するcommit自身のSHAは事前に文書へ記載できないため、「PR current HEAD」と表現せず、検証済みfix implementation HEADとmatching runを明示する。tracking-only commit後も別SHAのrunをproduct fixの証拠へ代用しない。

## 検証

fix implementation HEAD `059b491b71aa7b71600839d482d15e7bf68a8ec8`に完全一致するCI run `30952458920`、job `92137613440`はsuccessだった。

成功したgate:

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T403 GitHub cache tests
- T304 PR progress tree tests
- T502 Global mapping and display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

focused T403 suiteは8件すべて成功した。mixed generic failure 4通りの非fallbackと、patch欠落・不完全後のnetwork fallback 2通りを含む。

## Finding disposition

### T403-R001

- Disposition: addressed
- Red evidence: `1ecd22388dd60f9986ecd95ab3a49fb2ec59aeb8` / run `30952268922` / artifact `8909601516`
- Fix: `e19861a9452918075b7e12962067d174155a1538`
- Preservation test: `059b491b71aa7b71600839d482d15e7bf68a8ec8`
- Green evidence: run `30952458920` / job `92137613440` / success

### T403-R002

- Disposition: addressed by T403-only tracking sync
- Authoritative fix implementation HEAD: `059b491b71aa7b71600839d482d15e7bf68a8ec8`
- Matching CI: `30952458920` / success
- T403以外のtask状態と`tasks/phases-status.md`: 未変更

## 変更ファイル

- `test/unit/github-pull-request-cache.test.ts`
  - mixed remote failure Red test
  - patch fallback preservation test
- `src/application/github-pr-cache/github-pull-request-cache-service.ts`
  - remote attempt全体を評価するoffline fallback判定
- `tasks/tasks-status.md`
  - T403関連のreview follow-up状態だけを同期
- `reports/issue-1-t403-review-followup-20260805063000.md`
  - 本詳細レポート
- `reports/issue-1-t403-review-followup-handoff-20260805063000.yaml`
  - fix verificationへのhandoff

## intentionally untouched

- `tasks/phases-status.md`
- T403以外のtask状態
- T404/T405 runtime・persistent PR layer
- T604 lock・cache cleanup・capacity policy
- merge・release

## 残作業

1. 同じ通常reviewerが`T403-R001`と`T403-R002`のclosureだけをfix verificationする。
2. current PR HEADを固定し、そのSHAに一致するCI runだけを使用する。
3. 通常review finding closure後、独立最終reviewと進捗同期へ進む。
4. mergeは利用者が行う。

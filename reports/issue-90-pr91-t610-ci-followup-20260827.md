# Issue #90 / PR #91 T610 exact-head CI follow-up

## Metadata and target identity

- Repository: `ssaattww/RevMem`
- Pull Request: #91 `Issue #90: 詳細診断とGlobal再計算のstale cancellation`
- Branch: `fix/issue-90-diagnostics-stale-cancellation`
- Base: `main`
- Failing candidate HEAD: `e4f0af17b574bd8affda578427cc7487160f7d14`
- Exact-head pull_request CI: run `32979640229`, job `98212832112`
- Failure diagnostic artifact: `ci-failure-diagnostics-32979640229-1` / artifact ID `9611169063`
- Report type: implementation / CI failure follow-up

## Purpose

PR #91のexact-head CIで失敗したT610 focused gateを、Issue #90で導入したstale Global refresh cancellation契約に合わせて修正する。

## Scope

- `T610-IFR-002 exposes the running row through the actual provider before public stop` の期待値を、supersededされた旧refreshのtyped cancellationへ合わせる。
- public folder stop後に最新refreshが`stopped`行を公開する既存検証を維持する。
- exact-head CI artifactのtest result、stdout、stderr、combined logを根拠として原因を限定する。

## Non-goals and intentionally untouched areas

- T609の実装、試験、workflow wiringは変更しない。
- production runtime、cancellation実装、Global scheduling、PR Progress処理は変更しない。
- `.github/workflows/ci.yml`は変更しない。既存workflowが失敗時にtest result、stdout、stderr、combined log、生成物、source/testをartifactへ保存することを確認済み。
- `tasks/tasks-status.md`および`tasks/phases-status.md`は変更しない。
- mergeは行わない。

## Failure diagnostics and Red evidence

Exact-head `e4f0af17b574bd8affda578427cc7487160f7d14`に紐づくrun `32979640229`を確認した。別SHAのrunは代用していない。

- T609 step: success
- T610 step: failure
- `npm run test:t610`: 72 tests、71 pass、1 fail
- Failure: `T610-IFR-002 exposes the running row through the actual provider before public stop`
- Error: `OperationCancelledError: Operation was cancelled or superseded`

このCI failureをTDDのRed証拠として使用した。

## Root cause

public folder stopにより最新Global refreshが開始され、進行中だった`initialRefresh`はsupersededされる。PR #91ではこの状態がtyped `OperationCancelledError`としてcallerへ返る。一方、T610 testだけが旧契約のまま`await initialRefresh`による正常完了を期待していたため失敗した。

production runtimeの挙動はIssue #90のcancellation契約に一致しており、productionを旧挙動へ戻す変更は行わない。

## Change

- `test/unit/t610-folder-understanding.test.ts`
  - `OperationCancelledError`をimport。
  - public stop後の旧`initialRefresh`について`assert.rejects`で`OperationCancelledError`を要求。
  - `stopCalls === 1`とTree row `state === "stopped"`の検証を維持。

## Validation

- T610 focused gate equivalent: 72/72 pass
- Issue #90 cancellation regression: 14/14 pass
- generated JavaScript syntax: pass
- `npm run compile:test`: local依存未導入かつnpm registry DNS `EAI_AGAIN`のため未確認。Greenとは扱わない。

authoritativeなTypeScript compile、lint、broader CIはpush後のPR current HEADとrun `head_sha`が一致するpull_request CIで確認する。

## Persistence

- Initial test fix attempt: `340c66b7acb295d4bd058133224aa00786e1b54e`。
- Complete T610 regression suite restoration: `f5eb616dde4aaadef218284e54870c6702017d81`。
- Exact cancellation expectation applied to the complete test file: `472a8c14d7ce69f111ee971a5558ab3be639f2c4`。
- Temporary one-shot workflow was removed by the same fix commit and is not part of the resulting tree.
- Mergeは行わない。

## Remaining risk

TypeScript compile、lint、full required CIはpost-change exact-headで未確認。CI Greenになるまでは完了扱いにしない。

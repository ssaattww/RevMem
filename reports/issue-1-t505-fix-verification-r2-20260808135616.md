# T505 通常review finding closure

## 対象

- Pull Request: #43
- finding確認HEAD: `e5f7fbe070a90e855acbc12f51b04c15ce430458`
- 現行main統合HEAD: `374d8e424d59442ff7eb855bec5dc6ceec10f1dd`
- reviewer: `gpt-5.6-sol` / high
- verdict: `pass_with_held`

## Finding disposition

- `T505-R002` Medium: closed。per-snapshotとaggregateの上限を分離し、aggregateがper-snapshot以上である不変条件、保存対象のcleanup保護、実在確認後のlatest公開を回帰で固定した。
- `T505-R005` Medium: closed。document changeで実行中generationを即時無効化し、stale成功・失敗を吸収する。変更のcoalesceとsave/closeの即時refreshを回帰で固定した。
- `T505-R006` Low: closed。`test:t505`はGlobal UIとreview finding suiteを直接各1回だけ実行する。
- `T505-R007` Low: closed。schema v3のrequired fieldsと元legacy packet全文を`source_payloads.payload`へ保持する。

既にclosedの`T505-R001`、`R003`、`R004`は再reviewしていない。新規required findingはない。

## Evidence

- exact-head pull_request CI: run `31131925015`、success
- main統合後 `npm run test:t505`: 18/18 pass
- main統合後 `git diff --check`: pass
- Markdown wording gate: repositoryに`tools/lint/`と`lint:md`がないためunsupported、non-blocking

## Held

reviewerがheldとしたtracking同期は、このreportと同じ通常closure commitで`tasks/tasks-status.md`と`tasks/phases-status.md`へ反映する。

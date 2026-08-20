# T406 / Issue #70 / PR #71 通常review follow-up実装レポート

## タスク

- report type: `implementation_followup`
- source review: `reports/issue-70-t406-normal-review-20260820091339.md`
- branch / base: `task/t406-github-pr-integration` / `main`
- 開始HEAD: `8341d072523422da9f996ef69a109ae2e69ad7b5`
- PR: #71 draft/open
- finding: `T406-R001` High、`T406-R002` Medium、`T406-R003` Medium、`T406-R004` Medium、`T406-R005` Low
- 目的: 通常reviewで確定した5 findingを単一follow-up batchで修正し、local validationを完了する。

## sub-agentを使う理由

- sub-agentは使わない。依頼範囲が同じ実装者による一括TDD follow-upであり、subagent/nested Codexは明示的に禁止されている。

## 対象範囲

1. R001: repositoryとimmutable HEADごとの明示branch/no-PR preferenceを永続化し、saved open PR 1件の自動推測を抑止する。
2. R002: unavailable fallbackをbranch成功として維持しながら、privacy-safeなOutput diagnosticを操作ごとに一度残す。
3. R003: T405 production compositionでlive revision A、stale offline A、cache write failure、復旧live revision Bを完走し、immutable stateとcacheをBへ再同期する。
4. R004: 同一repositoryのPR #52/#53で両側mark/unmark、transaction、history、restart後のAC-11 owner isolationを固定する。
5. R005: task / phase / README / handoffをPR #71 draft/open、通常review fail、follow-up実装済み、closure verification待ちへ同期する。

設計判断の結果、明示branch/no-PR選択は既存workspace Memento内の表示選択を補正する永続behaviorであり、公開API、設定、file format、Review State、review history、PR metadata、Global stateを変更しない。`doc/design/vscode-review-range-tracker-design.md` §16.2へ選択の寿命・自動推測抑止・非変更領域を追記した。破壊的変更ではないため`Design/BreakingChanges.md`は更新していない。

## 対象外

- commit、push、PR操作、merge、GitHub CI、Extension Host全suite、新finding探索、self-review。

## 実行コマンド

- Red: R001のexplicit branch selection APIを要求するtestを先に追加し、未実装APIにより`npm run compile:test`が失敗した。
- Green (R001/R002): production実装後の`npm run test:t406`は28 pass / 0 failだった。
- R003/R004: 既存T403/T405 cache・acquisition・runtime compositionへ実際のA→offline A→B回復、PR #52/#53両方向transaction/history/restart証跡を追加した。production gapは観測されず、追加focused composition testは初回Greenで既存production contractを確認した。
- focused R003/R004: `npm run compile:test`、`node --test test-dist/test/unit/t405-composition-regression.test.js` — 2 pass / 0 fail。
- final validation: `npm run test:t406` — 28 pass / 0 fail、`npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`（expected 11）、`npm run compile:test` + `node --test test-dist/test/unit/ci-workflow-contract.test.js` — 10 pass / 0 fail、`git diff --check`は各一回Green。diff-checkのCRLF変換warningは検出したが、空白errorはない。
- Markdown wording lint: `unsupported`。repositoryには`tools/lint/`、focused wiring、`lint:md`がない。

## 対象ファイル

- `doc/design/vscode-review-range-tracker-design.md`
- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
- `src/application/review-contexts/current-pull-request-context.ts`
- `src/application/operation-feedback/operation-feedback.ts`
- `src/t405-review-contexts-runtime.ts`
- `test/unit/t405-composition-regression.test.ts`
- `test/unit/t405-review-followup.test.ts`
- `tasks/tasks-status.md`、`tasks/phases-status.md`、`README.md`
- `handoffs/issue-70-t406-review-followup-20260820092341.yaml`
- 本report `reports/issue-70-t406-review-followup-20260820092341.md`

## 指摘事項

- `T406-R001` High: `false` sentinelによる明示branch/no-PR選択をrepository/immutable HEAD単位で保存し、single saved open PRのauto-inferenceを抑止する。PR選択成功はsentinelをPR context IDへ置換する。
- `T406-R002` Medium: `GITHUB_PR_DETECTION_UNAVAILABLE reason=<network|api|rate-limit>`をtypedでredactedなfailure Outputとして一度記録し、branch fallback command自体はsuccessのまま継続する。
- `T406-R003` Medium: live A、stale offline A、write failureの後にlive Bを取得し、PR Context base/head、Global current revision、Context/Global file revision、registered immutable document URI、fresh cache content identityをBへ更新し、A headをBとして再利用しないことを確認した。
- `T406-R004` Medium: PR #52/#53についてoriginal/modifiedを双方mark/unmarkし、各transaction後にsibling Context rangesを比較した。append-only historyのowner context IDとrestart後のstateも確認し、AC-11の混線を固定した。
- `T406-R005` Low: tasks、phases、README、handoffを実態へ同期した。

## 結果

- 5 findingの実装とlocal validationを完了した。
- `tasks/tasks-status.md`と`tasks/phases-status.md`はT406をfollow-up実装済み・同一normal reviewer closure verification待ちとする。
- `README.md`のT406制限も同じPR lifecycleに同期した。
- `handoffs/issue-70-t406-review-followup-20260820092341.yaml`は次回のfinding限定closure工程を再開するためのresume-ready packetである。
- PR #71は同一normal reviewerのfinding限定closure verification待ちであり、review・merge・main統合は未実施。

## リスク

- final local validationの結果と同一normal reviewerのclosure verificationはこの実装report単独では代替しない。
- Markdown wording lint wiringと既存dependency security backlogはrepository tooling / release gateのheld itemであり、本batchのscope外である。

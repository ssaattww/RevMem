# Sub-agent実行レポート

## タスク

- 目的: T406-R001 HighとT406-R004 Mediumのclosure未達だけを最小修正する。
- タスク種別: normal finding-limited implementation R2
- source closure: `reports/issue-70-t406-finding-closure-20260820094155.md`
- 開始HEAD: `c9b12ffef42563acba2e01b009f0d37dfc6c54f9`
- 対象finding: `T406-R001` High、`T406-R004` Medium

## sub-agentを使う理由

- sub-agentは使わない。既存2 findingの直接未達だけを同じ実装者が一括修正するtaskであり、subagent/nested Codexは禁止されている。

## 対象範囲

- R001: repository + immutable HEAD keyごとのexplicit branch/no-PR sentinelを保持し、別keyのPR選択が既存`false` sentinelを消さないようにする。single saved open PRでunavailable、zero、multiple cancelのproduction fallback matrixと、branch normal-editor ownerのmark/unmarkを固定する。
- R004: PR #52/#53のoriginal/modified両側transactionごとに、sibling Context ranges・metadata・history ownerが不変であること、repository owner-wide Globalが両PR読出しで同じsnapshotへ同期すること、append eventのcontext ID/file ID/revision/action、restart後のowner別history/rangesを固定する。
- 既存設計の§16.2はexplicit branch/no-PR preferenceの寿命を既に規定しており、R001はその保存実装を訂正する最小修正である。公開API、設定、schema、file formatの変更はないためDesign/BreakingChangesは更新しない。

## 対象外

- R002、R003、R005、commit、push、PR操作、merge、GitHub CI、Extension Host全suite、self-review、新finding探索。

## 実行コマンド

- R001 Red: `npm run compile:test`後のfocused composition testで、別keyのPR選択後に既存branch sentinelが失われる`false !== true`を一回観測した。
- R001/R004 Green: production最小修正と証跡追加後、`npm run test:t406`は28 pass / 0 fail。
- R004: transaction単位assertionは既存productionが満たし、production変更なしでfocused composition Greenとなった。
- final validation: `npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`（expected 11）、`npm run compile:test` + `node --test test-dist/test/unit/ci-workflow-contract.test.js`（10 pass / 0 fail）、`git diff --check`を各一回Green。diff-checkはCRLF変換warningのみで空白errorなし。
- Markdown wording lint: repositoryに`tools/lint/`、focused wiring、`lint:md`がないため`unsupported`。

## 対象ファイル

- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`
- `test/unit/t405-composition-regression.test.ts`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`
- `handoffs/issue-70-t406-review-followup-20260820092341.yaml`
- `reports/issue-70-t406-review-followup-r2-20260820094751.md`

## 指摘事項

- `T406-R001` High: `select()`が既存selection recordからstringだけを復元して他keyの`false` sentinelを破棄していた。`string | false`を同じrecordに保持するよう修正した。single saved open PR #52のmultiple-cancel、zero、network unavailableはすべてbranchへ留まり、network経路ではproduction `NormalEditorReviewCommandService`のbranch ownerがmark/unmarkし、PR #52 Contextを変更しないことを確認した。
- `T406-R004` Medium: history captureをcontext IDだけでなくfile ID、revision、actionまで記録した。PR #52/#53のoriginal/modified mark/unmark各transaction直後にsibling Context state不変とexact history eventをassertし、repository owner-wide Globalが両PR読出しで同じsnapshotへ同期すること、restart後に永続historyをowner別に照合した。既存productionはこの契約を満たしたためsource変更は不要だった。

## 結果

- R001/R004のR2実装とlocal validationを完了した。
- tasks、phases、既存handoffをPR #71 draft/open、R2実装済み、同一normal reviewerのR001/R004限定closure verification待ちへ同期した。
- review・merge・main統合は未実施である。

## リスク

- R001/R004の同一normal reviewerによるfinding限定closure verificationは未実施であり、本reportはその代替ではない。
- Markdown wording lint wiringと既存dependency security backlogはrepository tooling / release gateのheld itemであり、本R2 scope外である。

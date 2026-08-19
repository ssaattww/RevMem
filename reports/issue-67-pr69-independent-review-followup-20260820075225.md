# Sub-agent実行レポート

## タスク

- 目的: PR #69 の独立最終レビューで一括確定した High finding 2件を同じ実装batchで修正する。
- タスク種別: independent review follow-up implementation
- 対象finding: `PR69-R002` High、`PR69-IFR001` High
- 開始HEAD: `7a9aadff277d5d93649a7ad051a60bf7739e0f81`

## sub-agentを使う理由

- 理由: ユーザー指定により、実装とローカル検証を terra high workerへ委譲し、親は管理とGit境界だけを担当するため。

## 対象範囲

- `PR69-R002` High: line-review-unsupported PR Progress nodeのnon-review openを、snapshotのpresent sideとexact immutable revisionへ束縛した。deleted fileはBASE/original、added・modified・renameはHEAD/modifiedを選び、absent sideをworking treeへ代用しない。
- `PR69-IFR001` High: rev5設計、Breaking Changes、公開host/selection unionの互換性方針、contract fixture、unit/Extension Host回帰、task/phase trackingを実装と同期した。

## 対象外

- CI起動・待機、commit、push、merge、PR操作、独立review、新規finding探索、T605所管のRemote/container/multi-root実機受け入れ。

## 実行コマンド

- `npm ci`（ローカル依存をlockfileどおり復元）。
- Red: 開始時のworking-tree URI経路で `npm run build && npm run compile:test && node test-dist/test/vscode/run-extension-host.js --t306`。binary nodeの実際のopen URIが`file:`となり、`review-range-diff://document/v1/`を要求する回帰が決定的に失敗した。診断: `test-output/vscode-launch-diagnostics/t306-1787180749961.json`。
- Green: 修正版で同じT306 Extension Host batchが成功。`test-output/vscode-launch-diagnostics/t306-1787180785847.json`。
- `npm run test:t304`、`npm run build`、`npm run compile:test`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check` は成功。
- Markdown focused lintは未実行。repositoryに`tools/lint/`、`lint:md`、Markdown target wiringがないため、`markdown-word-checker`の分類は`unsupported`。設定変更は行っていない。

## 対象ファイル

- `Design/BreakingChanges.md`: `openFile`必須化と`opened-file` union追加のsource-breaking compatibility policyを記録。
- `doc/design/vscode-review-range-tracker-design.md`: PR Progress/Global clickのimmutable owner/revision/open/error contract、unsupported selection、test方針をrev5へ同期。
- `src/extension.ts`、`src/t306-local-base-head-runtime.ts`、`src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`: present-side immutable URI生成、snapshot validation、required host obligationを実装。
- `type-fixtures/contracts/t304-pr-progress-tree.fixture.ts`、`test/unit/pull-request-progress-tree.test.ts`、`test/unit/t304-review-followup-r3.test.ts`、`test/vscode/t306-suite/index.ts`: public contractとdeleted/rename/stale、HEAD未checkout・dirty working tree、present-side contentを回帰固定。
- `tasks/tasks-status.md`、`tasks/phases-status.md`: design revisionとPR #69 follow-up state/report referenceを同期。

## 指摘事項

- `PR69-R002` High: implementation complete。providerが渡すimmutable targetをhostが再検証し、present sideだけをcanonical `review-range-diff` URIへ変換する。T304 unitはdeleted binaryとrenamed binaryのside/revisionを確認し、stale node拒否を維持する。T306はHEADをcheckoutせずdirty contentの状態でもbinary HEAD URI、deleted BASE URI、reviewable HEAD contentを確認する。
- `PR69-IFR001` High: implementation complete。設計・Breaking Changesをコードより先に更新し、`openFile`を必須にして`opened-file`を公開consumer contractへ反映した。optional hostまたはworking-tree fallbackはsnapshot identityを失うため採用しない、という互換性方針を明示した。

## 結果

- 開始HEADと最終HEADはともに`7a9aadff277d5d93649a7ad051a60bf7739e0f81`。変更は未commitで、通常review/fix verificationへ渡す。
- Red/Greenは同じfocused T306 Extension Host batchで観測した。source/contract/unit/Extension Host/architecture/lintのローカルvalidationは成功し、CIは呼ばなかった。
- 実装者自身による独立review verdictは出さない。

## リスク

- `PR69-R002`と`PR69-IFR001`のsource finding severityはともにHighのまま。closureは通常review/fix verificationの権限で再確認が必要。
- Remote SSH、Dev Containers、Codespaces、full multi-rootの実機acceptanceは既存どおりT605所管のheldであり、本batchでは実行していない。
- Markdown lint wiringがないため、変更Markdownのfocused lintはunsupportedとして記録した。既存lint設定を新設・変更する判断は行っていない。

# Sub-agent実行レポート

## タスク

- 目的: T406 / Issue #70 のGitHub PR障害・候補・closed PR・復旧統合試験を実装し、P4の受け入れ境界を完成させる。
- タスク種別: initial implementation
- 開始HEAD: `bd64d0a884ffe469eb4a8292ce09f03a64825144`
- branch: `task/t406-github-pr-integration`

## sub-agentを使う理由

- 理由: ユーザー指定により、調査・設計判断・実装・TDD・ローカル検証をterra high workerへ委譲するため。

## 対象範囲

- T401〜T405 の既存production composition、mock GitHub、PR diff acquisition、Review Contexts runtimeを統合境界として使用する。
- `test:t406` を追加し、未認証public PR、401/403/404/429、network断、patch欠落時のcontent fallback、複数候補の明示選択・取消、saved closed/merged PRのlayer既定OFF、cache live/offline/live復帰、PR context隔離を固定する。
- GitHub再検出がunavailableをbranch fallbackとして処理し、同一repository/HEADに保存されたPR選択を解除して通常editorのbranch contextを再公開するproduction gapを修正する。
- CIにはdiagnostic runner経由の`test:t406` stepを追加し、CI contract testでpackage/CI wiringを検証する。

### タスク分解

1. T401〜T405、T305 composition、mock GitHub、CI wiringと設計rev5を調査し、T406の受け入れ境界を既存の統合seamへ対応付ける。
2. 対象シナリオを追加してRed batchを実行し、GitHub unavailable時にruntimeがbranchへ戻らないgapを確定する。
3. PR選択解除の最小production修正、focused suite、package/CI contractを追加する。
4. tracking、README、実行レポートを実態へ同期し、local validationを記録する。

## 対象外

- T401〜T405の既存GitHub product contractの再設計、新規GitHub機能、T604 storage locking、T605 remote/multi-root work。
- commit、push、PR作成、merge、branch cleanup、GitHub CIの起動または待機、self-review。
- design rev5または`Design/BreakingChanges.md`の変更。T406は既存contractの統合証跡であり、新規または破壊的な契約を導入しない。

## 実行コマンド

- `npm ci` — 依存関係がないworktreeへlockfile準拠で復元。npm auditはhigh 4件を通知したが、本タスクではdependency更新を行わない。
- Red precondition: `npm run compile:test` — `tsc`未導入で失敗。`npm ci`後に同じfocused batchを再実行した。
- Red: `npm run compile:test; node --test test-dist/test/integration/mock-github.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-composition-regression.test.js` — 27 pass / 1 fail。GitHub network断で`reviewRange.redetectPullRequest`がerrorを表示し、branchへ戻れなかった。
- Green: `npm run test:t406` — 28 pass / 0 fail。compile:testを含む。
- `npm run build` — pass。
- `npm run typecheck:contracts` — pass。
- `npm run validate:architecture` — pass。
- `npm run validate:architecture:negative` — expected 11 violationsを確認してpass。
- `npm run lint` — pass、warnings 0。
- `npm run compile:test; node --test test-dist/test/unit/ci-workflow-contract.test.js` — T406 CI contractを含め10 pass / 0 fail。
- `git diff --check` — pass（最終validation時に再確認）。
- Markdown Word Checker: `tools/lint/`と`lint:md`が存在しないためfocused/fullとも`unsupported`。repository設定変更は行わず、Markdownの文面を既存用語へ合わせた。

## 対象ファイル

- `src/t405-review-contexts-runtime.ts` — unavailableなPR再検出でPR明示選択を解除し、branch fallback後にCurrent Contextを再計算する。
- `test/integration/mock-github.test.ts` — public未認証PRとHTTP/network failureからresolverのbranch fallbackまでをmock serverで検証する。
- `test/integration/t402-pr-diff-acquisition.test.ts` — patch欠落からexact base/head content fallbackへのT406証跡を明示する。
- `test/unit/t405-composition-regression.test.ts` —実際のT405 runtime compositionでmultiple PR、cancel、network断、closed PR、cache復旧、context isolationを通す。
- `package.json`、`.github/workflows/ci.yml`、`test/unit/ci-workflow-contract.test.ts` — focused commandとdiagnostic runner経由CI contractを固定する。
- `tasks/tasks-status.md`、`tasks/phases-status.md`、`README.md` — T406を実装済み・review待ちとして同期する。
- 本レポート — 実装、Red/Green、validation、残存riskを記録する。

## 指摘事項

- production gap: `GitHubPullRequestContextResolver`はunavailableをbranch resolutionへ変換済みだったが、T405 runtimeはこの結果を例外へ変換していた。そのため、network断中に過去の明示PR選択が残り、branch contextへ戻れなかった。
- 修正: unavailableをnot-found/cancelledと同じ選択解除経路で処理した。PR metadataやreviewed rangesを別contextへ投影せず、branch contextの通常editor操作を継続できる。
- closed/merged PRの保存とlayer既定OFF、immutable revisionへのcache/live再同期、PR #52/#53の独立状態は既存T405 composition seamで確認済みであり、T406 suiteへ含めた。
- Design判断: rev5の§16、§17、§20.4、AC-11は既存実装の契約を十分に定義している。新規public API、schema、file format、workflow contractは追加していないためdesign documentおよびBreakingChanges更新は不要。

## 結果

- initial implementation完了。T406 focused suite、build、contract typecheck、architecture positive/negative、lint、CI wiring contractはすべてlocalでpassした。
- Red/Green: Redは既存productionがunavailableを例外化することを再現し、Greenは同じscenarioをbranch fallbackとして通過した。
- T406/P4はreview・commit・PR・main統合前であり、trackingとREADMEでは「実装済み・review待ち」とのみ記録した。
- matching GitHub CI run: なし。ユーザー指示によりGitHub CIは起動も待機もしていない。

## リスク

- GitHub CIとExtension Host全suiteはこのinitial implementationでは未実行。CI wiringはlocal contract testで検証したが、実際のLinux/Xvfb実行はreview後のCIで確認が必要である。
- Markdown用repository lint wiringがないためMarkdown Word Checkerはunsupportedである。既存task policyはMarkdown lintを完了条件に含めない。
- `npm ci`は既存lockfileのauditでhigh severity 4件を報告した。依存関係の変更はT406対象外のため未対応である。
- GitHub実serviceへは接続せず、localhost mockとdeterministic fetch failureだけを使用した。認証情報・token・source本文をtest fixtureまたはreportへ保存していない。

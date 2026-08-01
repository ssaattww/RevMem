# Sub-agent実行レポート

## タスク

- 目的: normal review findings `T205-R3-P1`〜`T205-R3-P4`をidentityとseverityを維持してTDD修正する。
- タスク種別: review follow-up implementation

## sub-agentを使う理由

- 理由: production persistence、revision mapper、extension lifecycle、unit/integration/Extension Host testsの複数moduleを横断し、ユーザー指定の`terra / high`実装workerへ委譲するため。

## 対象範囲

- 対象: `T205-R3-P1` debounced repository経由Global load、`T205-R3-P2` rename後の旧path再利用file identity、`T205-R3-P3` UTF-8 decode可能binaryの保守的失効、`T205-R3-P4` extension deactivation時monitor dispose、および各Red/Green test、必要なpublic API documentation。

## 対象外

- 対象外: T205外の機能追加、設計の再構成、finding severity変更、独立review、tracking更新、commit/push、PR更新、merge、release。

## 実行コマンド

- 実行コマンド: `Get-Content -Raw`（指定5 Skill、review source、固定template、対象source/test）、`git status --short`、`git branch --show-current`、`git rev-parse HEAD`、`npm ci --ignore-scripts`、Red: `npm run compile:test && node --test test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/git-context-revision-mapper-binary.test.js`、Green/focused: 同コマンド、`npm run test:t205`、`npm run build`、`npm run typecheck:contracts`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`npm run lint`、`npm run test:unit`、`npm run test:git`、`npm run test:github`、`npm run test:vscode`、`git diff --check`、`git diff --stat --name-only`。

## 対象ファイル

- 変更または確認したファイル: `src/adapters/state-repository/debounced-review-state-repository.ts`（owner-wide Global load capabilityの透過）、`src/application/review-context/git-context-revision-mapper.ts`（衝突しない決定的new-file ID、Git宣言binary pathの除外）、`src/extension.ts`（document providerのruntime所有とpersistence前dispose）、`test/unit/document-git-context-lifecycle.test.ts`（production compositionのbranch初期化、rename後旧path再利用）、`test/unit/git-context-revision-mapper-binary.test.ts`（NUL UTF-8/attribute binaryの回帰）、および本report。既存のPOSIX fixture 2行はWindowsでも同じPOSIX入力を保つため`path.resolve`を除去した。

## 指摘事項

- 指摘要約または「指摘なし」: `T205-R3-P1` / `high` / `introduced_by_change` は修正実装済み。Debounced boundaryがoptional `loadGlobal`を公開し、pending saveをflushしてdelegateのowner-wide Globalを返す。filesystem＋debounceのproduction compositionでold HEADのmainからnew HEADのfeature contextを初期化し、Globalをnew revisionへmapしてatomic保存するGreen testを追加した。Redでは`persisted review state requires revision mapping before a new context can be initialized.`を観測した。`T205-R3-P2` / `high` / `introduced_by_change` は修正実装済み。既存stable ID集合を予約し、path由来canonical IDが予約済みならrepositoryId/path/discriminatorのSHA-256で最初の未使用IDを決定的に採番する。`a -> b` rename後の新`a`は別ID、persisted `currentPath` routingで再解決され、reviewed rangeを継承しないことをGreen testで保証した。Redでは`New-file metadata fileId must be unique and must not replace an unrelated file.`を観測した。`T205-R3-P3` / `high` / `introduced_by_change` は修正実装済み。raw Git diffのbinary sectionからpathを収集し、そのpathをrefresh対象から除外してcontext/Globalの旧reviewed stateを残さない。NULを含むvalid UTF-8と`GIT binary patch`（attribute-driven binary）の各Green testで両snapshotから除外されることを保証した。Redでは両caseで旧rangeを持つfileが残るAssertionErrorを観測した。`T205-R3-P4` / `medium` / `introduced_by_change` は修正実装済み。document providerを`ActiveExtensionRuntime`と`context.subscriptions`の所有物にし、`deactivate()`でfile-exclusion/decoration後かつpersistence dispose前にproviderをdisposeする。`npm run test:vscode`はdeactivationを伴う4 Extension Host起動・終了を成功した。identity/severityは変更していない。

## 結果

- 結果: TDD根拠はユーザー指定の「behavior fixはRed test実行後に実装」。Red testをsource修正なしで実行し、P1/P2/P3の実障害を上記のactual diagnosticsで記録後、最小修正を適用した。Green/focusedは7 tests成功、`npm run test:t205`は17 tests成功。broader validationは`build`、`typecheck:contracts`、`validate:architecture`、`validate:architecture:negative`（期待10 violation）、`lint`、`test:git`（32 pass、Windows非対応3 skip）、`test:github`（1 pass）、`test:vscode`（4 host lifecycle pass）、`git diff --check`が成功した。`test:unit`は323 tests中302 pass/19 fail/2 skipで、19 failureはいずれも既存POSIX fixtureをWindowsの`path.resolve`で解決し`document path is outside the resolved Git working tree.`となる同一環境依存事象であり、本findingのsource変更・focused T205 testでは再現しない。初回Red前には依存未配置により`tsc is not recognized as an internal or external command`となったため、lockfileを変更しない`npm ci --ignore-scripts`後に実行した。public API追加は`ReviewStatePersistenceDelegate.loadGlobal?`と`DebouncedReviewStateRepository.loadGlobal`のみで、各JSDoc、命名、visibilityを確認し、`lint`/`typecheck:contracts`成功をcoding standards evidenceとする。commit/push/PR更新は行っていない。final workspace HEAD=`d3fbefe61ee5740f7abb374d82472bca1eb9aefc`、branch=`task/t205-branch-context-resolver`、base=`68a2b49847fcaae2dd5943358c8ff875a1ce75a9`、matching CIはこの未commit workspace HEADには存在しない。

## リスク

- 未解決のリスクまたは後続対応: blockerなし。remaining risk: `binaryDiffPaths`はGitの通常の`diff --git a/<path> b/<path>` header形式を対象にbinary pathを収集する。mixed-case Windows Git tree path、実Git object prune、大規模repositoryのpolling/mapping負荷、user-facing polling error notificationは本finding対象外のheld risk。広域`test:unit`の19件は前記Windows/既存POSIX fixture問題として親がIssue化するまで追跡対象とし、本作業ではscope外修正を行っていない。`.vscode-test`と`node_modules`は検証環境生成物でgit管理対象外。

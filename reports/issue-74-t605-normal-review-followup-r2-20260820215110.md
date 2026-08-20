# T605 normal review follow-up R2 report

## タスク

T605 / Issue #74 / PR #75 のnormal finding closureでopenとなったT605-R001 HighとT605-R006 Mediumだけを同一R2 batchで修正した。開始HEADは`d49bf665e8dd0ef3c6ccdba7fa8731e31c5f4ae2`、baseは`origin/main`の`64e47c590960a810a2439bd33f250ecbda9c41bf`である。通常closure report `reports/issue-74-t605-normal-finding-closure-20260820214702.md` のrequired actionをそのまま対象にした。

## sub-agentを使う理由

sub-agentは使用していない。指定のfinding-limited follow-upをこの実装者がboundedに実施した。

## 対象範囲

R001ではsnapshot-aware workspace commitを明示的なtyped capability portへ定義し、registryとreconciled document providerのproduction chainへ接続した。R006では同じactivation factoryを利用するroot registry、concrete filesystem persistence、snapshot tracker、startup migration/restart、T604 lock/cleanup、Git history-rewrite、T405 Git/PR compositionを`test:t605`へ含めた。設計文書、README、task/phase tracking、handoffもR2 closure pendingの実態に同期した。

## 対象外

R002〜R005のproduction behaviorを再設計または再修正していない。commit、push、PR/Issue更新、CI起動・待機、self-review、independent review、merge、Extension Host E2Eは行っていない。`Design/BreakingChanges.md`は更新していない。今回の変更は既存のroot-scoped persistence contractに対する内部typed capabilityと回帰証跡の修正であり、新しい互換性破壊はない。

## 実行コマンド

Red: `npm run test:t605`を一度実行し、`createWorkspaceRootRuntimeRegistry`が未exportであるためcompile:testが失敗することを確認した。Green: production capability/factoryとreconciled receiver保持を実装後、同じ`npm run test:t605`を実行して62 passingを確認した。Green commandには`npm run compile:test`が含まれる。静的検証は各一巡で`npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`を実行して成功した。CIは実行していない。Markdown wording checkはrepo-localの`tools/lint/`、`lint:md`、`cspell.config.jsonc`が存在しないためunsupportedとして記録する。

## 対象ファイル

`src/adapters/workspace-review-state/workspace-review-state-session-provider.ts`にtyped snapshot-aware capability port/type guardを追加し、`workspace-root-runtime-registry.ts`とindexにactivation/test共用factoryを追加した。`reconciled-document-review-state-session-provider.ts`はtype guard後のproviderをclosureで呼び、class receiverを失わない。`src/extension.ts`は同一factoryを使用する。`test/unit/t605-multi-root-remote-boundaries.test.ts`はreconciled mark/unmark、latest snapshot、decoration、restart migration、root add/remove/disposeをconcrete persistence chainで固定し、`package.json`はsnapshot/history、T604、T405 production suitesをfocused wiringへ追加した。`doc/design/document-context-routing.md`、`README.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`、handoffは実態同期である。

## 指摘事項

T605-R001 High: `as unknown as`による未定義構造型を廃止し、`SnapshotAwareWorkspaceReviewStateSessionProviderPort`とtype guardを導入した。reconciled committerはmethodを切り離さず、narrow済みproviderへのclosure callでregistryの`this.runtimeFor(...)`を維持する。focused concrete regressionはmark/unmarkをreconciled document sessionから実行し、root-local latest snapshot、decoration、filesystem persistence/reopenを確認した。T605-R006 Medium: focused suiteはroot registry lifecycle、workspace state/snapshot restart、startup migration、Git history-rewrite recovery、T604 root lock/cleanup、same-repository multi-root Current Context/PR source key、T405 Git/PR production compositionを同じ`test:t605`で実行する62 passing batchへ拡張した。test-only persistence reimplementationは使わず、activationと同じregistry factory、FileSystemReviewStateRepository、NodeNonGitSnapshotStorageを通した。

## 結果

R001/R006のrequired actionに対応するimplementationとfocused Green evidenceを完了した。現在はsame normal reviewerによるR2 finding-limited closure pendingであり、normal review verdictはこの実装者が行わない。

## リスク

残存リスクはMarkdown wording checkがrepo-local wiring不在でunsupportedであること、CIがtask policyにより未起動でexact-head CIはmerge gateとしてheldであること、Remote serviceの実Extension Host E2Eをこのlocal focused batchでは起動していないことである。

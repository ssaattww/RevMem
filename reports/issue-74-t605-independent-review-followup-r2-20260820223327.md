# T605 independent review follow-up R2 report

## タスク

T605 / Issue #74 / draft PR #75 の independent finding T605-IFR-001〜003 をR2として修正した。開始HEADは `a38852e03c165a5aec91436352b058997262a31b` で、commit、push、PR、Issue、CI、review、mergeは実施していない。

## sub-agentを使う理由

ユーザー指示により sub-agent は禁止されているため使用していない。

## 対象範囲

IFR001のremove/re-add generation tombstoneと遅延 open/load/commit拒否、IFR002のshared typed URI eligibilityをproduction descriptor validationとCurrent Context filteringへ接続すること、IFR003の同一remote repository配下の異なるworkspace root ownerのhistory non-mixing regressionだけを対象にした。

## 対象外

新規independent review、通常review、CI起動または待機、commit、push、PR/Issue操作、merge、別タスクの実装は対象外である。JSONL history adapterはappend-onlyであり、read/compaction APIを追加していない。

## 実行コマンド

Red: `npm run test:t605` を一度実行し、shared eligibility typeの未実装による `TS2322` compile failureを観測した。Green: 同じ `npm run test:t605` を一度成功させ、`compile:test` を含む70 passingを確認した。Green後に `npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check` を各一巡実行し成功した。CIは起動・待機していない。

## 対象ファイル

`src/adapters/workspace-review-state/workspace-root-runtime-registry.ts`、`src/application/workspace-identity/workspace-identity-service.ts`、`src/application/workspace-identity/index.ts`、`src/adapters/document-review-state/document-review-state-session-provider.ts`、`src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`、`src/t305-extension.ts`、`test/unit/t605-multi-root-remote-boundaries.test.ts`、`test/unit/review-history-jsonl-store.test.ts`、`README.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`、このreport、およびR2 handoff。

## 指摘事項

T605-IFR-001: `knownGenerations` tombstoneを保持し、active generationをremove/re-addごとに単調増加させる。遅延 open/load/commitがremove/re-add後にrejectし、旧commit callbackがpublishしないproduction registry regressionを追加した。T605-IFR-002: `resolveWorkspaceResourceEligibility`をshared typed primitiveとして導入し、descriptor validationをGit acquisition前に実施し、Current Contextのworkspace folder/editor filteringも同primitiveを呼ぶ。Git suffix URI、virtual workspace、untitled、outside-workspace descriptorをfail closedにするregressionを追加した。T605-IFR-003: 実 `JsonlReviewHistoryStore`へ異なるremote workspace root identityでappendし、root-scoped history filesが相互のeventを含まないregressionを追加した。

## 結果

T605-IFR-001〜003はR2でaddressed。focused Greenは70 passingで、指定local validationも成功した。same independent reviewerによるfinding-limited closure R2はまだpendingであり、この実装者はreview verdictを発行しない。

## リスク

Markdown wording checkはrepository-local `tools/lint/`、`lint:md`、`cspell.config.jsonc`がないためunsupportedである。JSONL history adapterはappend-only contractのため、独立reviewerはIFR003の「load/compaction」表現とappend/read-path regressionの充足性を確認する必要がある。exact-head CI merge gateも未実施である。

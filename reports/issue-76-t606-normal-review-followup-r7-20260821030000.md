# T606 normal review follow-up R7 report

## タスク

T606 / Issue #76 / PR #77 の同一normal reviewer向けR7 finding follow-up。R002〜R005だけを対象にし、technical implementation commitはpendingである。R001、R006、R007はclosedを維持する。

## sub-agentを使う理由

使用しない。依頼によりsub-agent、CI、PR操作、commit、push、review、mergeは禁止である。

## 対象範囲

Review Contextsのfailed old-root load、terminal diagnostic後にthrowするmutation、cache publish failure、既存focused production matrixの実接続を強化した。

## 対象外

新規finding、R001/R006/R007の再探索、Extension Host acceptance、CI、PR更新、commit、push、mergeは対象外である。公開API、設定、保存formatの変更はないためDesign/BreakingChangesは変更しない。Markdown wording toolingは`tools/lint/`と`lint:md` wiring不在でunsupportedである。

## 実行コマンド

Red: `npm run test:t606`でfailed old-root loadのcancellation処理とterminal mutation failure後のpost-refreshを再現した。Green: `npm run test:t606`は195 passing / 2 Windows POSIX skip / 0 fail。final local validationの`npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check`は各一回通過した。CIは起動しない。

## 対象ファイル

Review Contexts VS Code runtime、T606 production matrix、README、tasks/phases status、R7 report/handoffを変更した。

## 指摘事項

R002: old-root sourceは実際にrejectし、root switch後のold nonempty publicationは拒否され、fresh rootのstale/unknown transitionはtyped cancellationで固定する。

R003: actual T405 mutationはstorage diagnosticの後にthrowしても同じexplicit feedback contextをterminal failureとして記録し、post-mutation refreshまたは追加lifecycleを開始しない。

R004: cache publish mutation failureはcache writeを一回だけ行い、publish failureをretryせずpost-refreshも開始しない。

R005: 上記direct scenariosは既存`test:t606` production matrixに含まれ、CI contractのmatrix entryで実行を固定する。

## 結果

R002〜R005のR7 technical implementationとdirect production evidenceはaddressedである。同一normal reviewerのfinding-limited closure R7はpendingである。exact-head CIはheldであり、technical implementation commitもpendingである。

## リスク

exact-head CI、real Extension Host acceptance、Markdown wording checkはheldまたはunsupportedである。次の作業はtechnical commit後のadmin SHA syncを経て、同一normal reviewerによるR002〜R005限定closure R7である。

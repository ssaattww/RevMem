# PR #94 Issue #106 defer compatibility

## Context

Issue #106へmulti-context/shared-Global atomicityを分離し、PR #94では既存multi-PR同期を回帰させない。

## Red

`npm run test:t405` を実行し、57件中55 pass / 2 failを記録した。T406 recovered transition は `reviewRange.redetectPullRequest` でgeneric error通知を出し、原因はshared Globalが先行PRによってtarget HEADへadvanceした後に、sibling PR Contextがsource HEADのままimmutable snapshot captureへ渡されることだった。

同じRedにはWindows上のselected PR session fixture failureもあった。`fileSystemPathSemantics: "posix"` に対して`path.resolve`でWindows pathを渡していたため、productionのownership fail-closed判定が正しく拒否していた。

## Change

`immutable-pull-request-revision-mapper`は、Context source HEADとGlobal current revisionが一致するときだけPR94 immutable snapshot capture/restore/write-throughを使用する。Globalがこのtransitionのtarget HEADと一致する既知のmulti-PR sequential synchronization caseだけは、snapshot処理を使用せずPR94導入前の実diff mappingへ明示的に戻す。

このcompatibility pathは既存per-context CASとcommit後historyをそのまま使用し、状態やhistoryを推測しない。target以外のGlobal revision、corrupt snapshot、その他のcapture failureはfallbackしないため、fail-closedのまま拒否する。T406 regressionにはsibling PR #53もrecovered HEADへ収束するassertionを追加した。

selected PR session fixtureはrepository rootとdocument filesystem pathをPOSIX canonical valueへ揃えた。productionのpath ownership検証は変更していない。

## Green

`npm run test:t405`: 57/57 pass（`compile:test`を内包）。T406はgeneric errorなしでPR #52/#53とshared Globalのrecovered HEAD収束を確認した。

PR94 snapshot focused: `immutable-revision-review-snapshot`、`github-pr-context-layer-store`、`t405-revision-evidence` 合計18/18 pass。`npm run build`、`npm run lint`もpass。

## Remaining risk

Issue #106のmulti-context/shared-Global CAS、shared Globalの異なるPR HEAD間のowner semantics、data model、design更新は実装していない。このPR94 compatibility pathは既知のtarget-HEAD一致caseで既存挙動を保つ暫定境界であり、複数Contextをall-or-nothingでpublishする恒久atomicityはIssue #106で扱う。

workflow、performance、`test:t607`は変更・実行していない。commit、push、CI wait、独立reviewも実施していない。Markdown focused lintは`tools/lint/`と`lint:md`がないためunsupported。

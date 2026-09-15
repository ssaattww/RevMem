# PR #120 PDS-05 通常再レビュー

## 対象

- Repository: `ssaattww/RevMem`
- PR: `#120`
- Review mode: `fix verification`
- Source finding: `PDS05-NR1-001`
- Source severity: `P2 / medium`
- Initial reviewed implementation HEAD: `993c7d589d653ef878f41da795c54f98a7586262`
- Fix technical HEAD: `70eeed759f2b25e9de4b95a32c920374c49f871f`
- Reviewed implementation HEAD: `903480b123fcccf57eb27a5f7d08495f77287a45`
- Reviewer continuity: 前回PDS-05通常レビューと同じChatGPT chat
- Execution: RDC / `ibis-ThinkBook-14-G7-IML`
- Verification capability: `local_execution_available`

## Finding closure

`PDS05-NR1-001` は解消を確認した。

修正は `createDiffBlockTransaction` で更新前の `originalReviewedByDiff[diffId]` の存在を保持し、original対象があっても、次のrangesが空かつ既存keyがない場合は空keyを生成しない。

これにより、missing key + unmark は expected / next ともにkey不存在のままとなり、semantic no-opを維持する。

### Completeness matrix

| required action | production path | fixture / sibling coverage | focused evidence | disposition |
| --- | --- | --- | --- | --- |
| missing `diffId` の解除で空keyを新規生成しない | `src/core/review-state/review-state-service.ts` の `hasOriginalDiffKey` と条件付き代入 | `unmarking a missing original diff key...` | current reviewed HEADでpass | fixed |
| 既存empty keyは再解除でsemantic no-opを維持 | 同上 | `fully unmarking an existing original diff key...` のrepeated unmark | current reviewed HEADでpass | fixed |
| reviewed keyの全解除はempty keyへの実変更として残す | 同上 | 同テストのfirst unmark | current reviewed HEADでpass | fixed |
| no-op時に履歴を生成しない | state service + `ReviewHistoryRecorder` | missing-key test と repeated-unmark test の `eventsFor(...)` | current reviewed HEADでpass | fixed |

severity reclassificationは行わない。`P2 / medium` のままcloseする。

## 再検証

実行前にRDCのsession一覧を確認し、他sessionがすべて `Blocked: true` であることを確認してからコマンドを実行した。

- `git diff --check 7f6c796394e5d5e4f3672f02d8ea62d57eb684f1..903480b123fcccf57eb27a5f7d08495f77287a45`: success
- `npm run test:diff-block-state`: 14 passed / 0 failed / 0 skipped
- 修正報告の保存済み証拠: Red 13/14、Green 14/14、関連回帰56/56、既定unit 782 pass / 0 fail / 2 skip、tooling 16/16、build/typecheck/architecture/lint success
- exact-head CI: run `35023256307`, `head_sha=903480b123fcccf57eb27a5f7d08495f77287a45`, conclusion `success`

別SHAのworkflow runは代用していない。

## Coverage

- requirement / design conformance: `checked_no_finding`
- correctness / edge cases: `checked_no_finding`
- scope discipline / unrelated changes: `checked_no_finding`
- changed files / direct dependency impact: `checked_no_finding`
- API / data / configuration / workflow / compatibility: `checked_no_finding`
- error handling / diagnostics: `checked_no_finding`
- security / secret handling: `not_applicable`
- tests / validation adequacy: `checked_no_finding`
- current-HEAD CI evidence: `checked_no_finding`
- report / tracking accuracy: `checked_no_finding`
- regression / maintainability risk: `checked_no_finding`

## Held

PDS-05初回実装は、テスト追加自体は実装前だったが、有効な製品Red確認前にcore実装断片の編集が始まっており、RevMemのstrictな「Red確認後に実装開始」の時系列を満たしていない。この事実は既存実装報告に明記済みで、今回のfinding修正自体はRed→Greenの順序を満たす。

この既知process deviationは今回のfix verificationで後から修復不能であり、新しい製品不具合としては扱わない。

## Verdict

`pass_with_held`。

`PDS05-NR1-001` はfixed。追加の必須指摘はない。PDS-06未実装は本レビューのscope外。

mergeは行わない。

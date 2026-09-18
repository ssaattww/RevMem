# PR差分選択 PDS-07 再レビュー残指摘対応レポート

## 対象

- Repository: `ssaattww/RevMem`
- PR: `#120`
- branch: `investigation/issue-119-linked-diff-blocks`
- 対象: `PDS07-NR1-002 / P2` の再レビュー残件
- 作業開始HEAD: `b84d7f630b2afaf5db3c1d707fb15d314822209a`
- 技術修正commit: `0763ca7826d7ed2df5a226f91740ad60ee77e3f2`
- cleanup commit: `fba9d3ac4079f4b448ea007496e977cf1302f200`
- 製品コード変更: なし

## 再レビュー残件

同一通常レビュワー再レビューで `PDS07-NR1-001` はfixedとなった。
`PDS07-NR1-002` は、正常系matrixがmark後の詳細履歴payloadだけを確認し、unmark後のContext / Global before-after、`reason`、original `diffId`を実recorderまで確認していないためopenとなった。

再レビュー対象実装HEADは `74d5f31e824d5f1bf52ff6bb5c9ef358ca4fb4ca`、再レビュー記録HEADは `b84d7f630b2afaf5db3c1d707fb15d314822209a` だった。

## TDD / coverage Red

本件は製品挙動の欠陥ではなく、受入網羅性の不足であるためcoverage guardでRedを固定した。
最初の試行はPowerShell挿入時の改行エスケープ不備でTypeScript構文エラーとなったため、Red証拠には数えていない。
有効なRedは `pds07-fix2-unmark-coverage-red-valid`。

- 直接受入: 61件中60成功・1失敗
- 失敗: `normal acceptance matrix verifies both mark and unmark history payloads`
- 実際: `['mark']`
- 期待: `['mark', 'unmark']`
- result / stdout / stderr / combined log は `test-output/ci/pds07-fix2-unmark-coverage-red-valid.*` に保存

## 修正

正常系matrixの各ケースで同じfixture・同じselectionに対してmark→unmarkを連続実行するよう変更した。
各操作ごとに次を実recorderまで照合する。

- Context `previousRanges` / `nextRanges`
- modified eventのGlobal before / after
- `reason`
- original eventの `diffId`
- event順序
- 保存後のoriginal / modified / Global範囲
- commit回数（mark後1回、unmark後2回）
- PR Progress（mark後の期待分子、unmark後0）

blockは `user-block-selection`、side-modifiedは `user-selection`、side-originalは既存互換の `user-file` を明示する。
## Green / 回帰

- 直接受入: `pds07-fix2-unmark-green` 61 / 61成功
- focused: `pds07-fix2-focused-after-cleanup` 127 / 127成功
- 既定unit: `pds07-fix2-unit-final` 858件中856成功・0失敗・2既存Windows skip
- tooling: 16 / 16成功
- build: `pds07-fix2-build-final` 成功
- contract typecheck: `pds07-fix2-contracts-final` 成功
- architecture: `pds07-fix2-architecture-final` 成功
- architecture negative: `pds07-fix2-architecture-negative-final` 期待11件と一致
- lint: `pds07-fix2-lint-after-cleanup` 成功
- `git diff --check`: 成功

`0763ca7` のrefactorで旧 `markSelectionCase` helperが未使用となりlintが1件失敗したため、`fba9d3a` でhelperだけを削除した。focused / lint / unitをcleanup後HEADで再実行し、失敗0を確認した。

## 記録訂正

前回 `reports/pr120-pds07-fix-verification-20260917.md` の「正常系全ケース、選択境界10ケースのmark/unmark...」は過大表現だった。
前回commit `cebdf25` で正常系が検証していたのはmark後payloadのみであり、境界と末尾改行・存在ではmark/unmark双方を検証していた、という実装事実へ訂正した。
`tasks/pr-diff-selection-mode/tasks-status.md` と `phases-status.md` も、同一通常レビュワー再レビューでNR1-001 fixed / NR1-002 openとなった経緯と今回follow-upを反映した。

## CI境界

作業開始時current HEAD `b84d7f630b2afaf5db3c1d707fb15d314822209a` のexact-head CI run `35162281109` はfailureだった。
直接原因はT506 Extension Hostの `T506 timed out: refresh current context after restart` で、failure artifact `ci-failure-diagnostics-35162281109-1`（ID `10472898556`）が保存されている。
今回の管理commit公開後は、その新しいPR current HEADと一致するworkflow runだけを最終CI判定に使う。別SHAのrunは代用しない。

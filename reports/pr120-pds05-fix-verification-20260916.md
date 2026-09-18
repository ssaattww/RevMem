# PR #120 PDS-05 指摘修正検証

## 対象

- Repository: `ssaattww/RevMem`
- Pull Request: `#120`
- Task: `PDS-05`
- Finding: `PDS05-NR1-001`
- Source severity: `P2 / medium`
- Reviewed implementation HEAD: `993c7d589d653ef878f41da795c54f98a7586262`
- Review report commit: `7f6c796394e5d5e4f3672f02d8ea62d57eb684f1`
- Fix technical HEAD: `70eeed759f2b25e9de4b95a32c920374c49f871f`
- Branch: `investigation/issue-119-linked-diff-blocks`
- Verification capability: `local_execution_available`
- Persistence mode: `repository_file`
- Report commit: `commit_pending`

## 指摘

`originalReviewedByDiff` に対象 `diffId` が存在しない状態でoriginal側を解除すると、確認済み範囲は変わらないにもかかわらず空keyを新規生成し、semantic change扱いになる問題が通常レビューで指摘された。

この状態では不要なstate commitが発生し得る一方、履歴側はbefore/afterのoriginal rangesをともに空と見るため履歴を生成せず、state commitと履歴の判定が不整合になる。

## 修正内容

`src/core/review-state/review-state-service.ts` で、対象 `diffId` が既に存在するかを更新前に保持し、original対象がある場合でも次のoriginal rangesが空で既存keyもないときはkeyを書き込まないようにした。

状態表現の方針は次で固定した。

- 未作成key + unmark + 結果空: keyを新規生成しない。semantic no-op。
- 既存empty key + unmark + 結果空: 既存empty keyを維持する。semantic no-op。
- 既存reviewed key + 全解除: 既存keyをempty rangesへ更新する。semantic changeあり。
- 上記全解除後の繰返しunmark: empty keyを維持しsemantic no-op。

製品側のsemantic比較を緩めず、不要な構造差を作らないことで修正した。

## TDD証拠

修正前に `test/unit/diff-block-review-state.test.ts` へ回帰ケースを追加した。

- `pds05-nr1-red`: 14件中13成功 / 1失敗。
- 失敗ケース: `unmarking a missing original diff key stays a semantic no-op without creating the key`。
- 実測はmissing keyがnextで生成され、期待falseに対してactual trueだった。
- 修正後 `pds05-nr1-green`: 14成功 / 0失敗。

追加テストではmissing keyがexpected/nextの双方で不存在、`hasReviewStateSemanticChange` がfalse、履歴イベントが0件であることを確認した。既存keyを全解除した後の繰返しunmarkもsemantic no-opであることを固定した。

## 検証結果

| 検証 | 結果 | 証拠ラベル |
| --- | --- | --- |
| 指摘Red | 13成功 / 1失敗 | `pds05-nr1-red` |
| 指摘Green | 14成功 / 0失敗 | `pds05-nr1-green` |
| PDS-05関連回帰 | 56成功 / 0失敗 | `pds05-nr1-regression` |
| 既定unit | 782成功 / 0失敗 / 2skip（784件） | `pds05-nr1-unit` |
| tooling | 16成功 / 0失敗 | `pds05-nr1-unit` |
| build | 成功 | `pds05-nr1-static` |
| contract typecheck | 成功 | `pds05-nr1-static` |
| architecture | 成功 | `pds05-nr1-static` |
| architecture negative | 期待11件と一致 | `pds05-nr1-static` |
| lint | 成功 | `pds05-nr1-static` |
| `git diff --check` | 成功 | whitespace errorなし |

`test-output/ci/` に各ラベルのresult JSON、stdout、stderr、結合logを保存した。失敗時の診断artifact workflowは既存の `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` で要件を満たしているため変更していない。

## 変更ファイル

- `src/core/review-state/review-state-service.ts`
- `test/unit/diff-block-review-state.test.ts`

PDS-06の設定公開、PR限定コマンド結線、設計本文、保存schema、workflowは変更していない。

## 判定と次の操作

`PDS05-NR1-001` のrequired actionに対する実装修正とローカル検証は完了した。findingのseverityは元レビューどおり `P2 / medium` を維持する。

ただし、元の通常レビュー判定は `fail` のままであり、この報告だけでreview passへ変更しない。同じfinding IDを引き継いで同じレビュワー文脈でfix verificationを行う必要がある。

PDS-05は追跡上「再レビュー待ち」とし、PDS-06には進まない。公開後はPR current HEADと一致するworkflow runのみCI証拠として使用し、別SHAのrunを代用しない。

なお、PDS-05初回実装時のstrict TDD時系列逸脱は既存review/reportの記録どおり残る。今回の指摘修正自体は回帰テストのRedを確認してから実装した。

mergeは行わない。

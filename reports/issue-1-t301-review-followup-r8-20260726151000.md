# Sub-agent実行レポート

## タスク

- 目的: R8 Medium blocking の durable cumulative regression と TDD/evidence gap を解消し、T301 implementation report を実testへ同期する。
- タスク種別: review follow-up / test and evidence

## sub-agentを使う理由

- 理由: 親エージェントから、R8で特定されたテスト・証跡限定の実装修正、検証、報告、ステージングを委譲されたため。

## 対象範囲

- 対象: `test/unit/pr-diff-progress.test.ts` の累積回帰、`reports/issue-1-t301-implementation-20260725094000.md`、R8 follow-up report。
- 対象: R8 review reportの確認とステージング。

## 対象外

- 対象外: production source、T302以降、GitHub adapter、進捗UI、VS Code runtime接続、README、commit・push・merge。

## 実行コマンド

- Red/evidence gap: 既存9-case suiteに要求10 behavior名が0件であることを確認し、`npm run test:t301` が9/9 Greenで未固定の契約を検出できない状態を記録した。
- Green: `npm run test:t301`（19 tests passed）
- `npm run build`
- `npm run lint`
- `npm run typecheck:contracts`
- `npm run validate:architecture`（success）
- `npm run validate:architecture:negative`（期待どおり10 fixture違反を検出し、scriptは非0終了）
- `npm run test:t204`（43 tests passed）
- raw `npm run test:unit`（Issue #13のWindows/POSIX fixture 19件で258/277、exit 1）
- process-only POSIX path preload付き `npm run test:unit`（277 tests passed）
- preload付き `npm run test:git`（21 tests passed）
- preload付き `npm run test:github`（1 test passed）
- `git diff --check` と `git diff --cached --check`

## 対象ファイル

- 変更: `test/unit/pr-diff-progress.test.ts`
- 変更: `reports/issue-1-t301-implementation-20260725094000.md`
- 作成: `reports/issue-1-t301-review-followup-r8-20260726151000.md`
- 確認・stage: `reports/issue-1-t301-review-r8-20260726145022.md`

## 指摘事項

- R8 Medium: production calculatorは正しいが、R7 follow-upで一部assertが置換され、実装報告の累積対象と9-case suiteが一致していなかった。
- 対応: addition opposite-side、context cursor、multi-hunk delta/gap、duplicate changed coordinate、state payload fileId、modified/original interval bounds、valid multiple hunkとzero-count anchor、original deletion、replacement 2行、reviewed context非算入を10件のbehavior JSDoc付きtestとして追加した。
- production sourceは既存実装が全追加契約を満たすため変更不要と判断した。
- repository固有のMarkdown lint設定と`lint:md` scriptがないため、変更したreportのfocused/full Markdown lintはunsupportedである。

## 結果

- T301 focused suiteは9件から19件へ増え、R8で列挙された過去review regressionを機械的に追跡できる。
- implementation reportの累積対象、現在件数、Windows検証差が実testと一致した。
- raw full-unit失敗はT301ではなく既知のIssue #13 Windows/POSIX fixture差であり、process-only preload後の277/277 Greenで分離を確認した。
- R8 review reportを含む全変更をステージング対象とし、コミット・push・mergeは実施しない。

## リスク

- `test:vscode`はproduction/runtime変更がないtest/report follow-upのため未実行。main integration時のExtension Host成功は既存証跡として保持する。
- raw Windows full-unitはpreloadなしではIssue #13 fixture差により失敗するため、CIまたはpreload適用結果と区別して扱う必要がある。

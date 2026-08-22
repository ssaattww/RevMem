# Sub-agent実行レポート

## タスク

T609 IFR005 の Extension Host fixture にある、rename/new/whitespace/EOL の観測境界を安定化するテスト限定修正。

## sub-agentを使う理由

実装・検証を親のマネージャーから分離し、production 変更を伴わない fixture 境界の TDD と実Host観測を限定して実行するため。

## 対象範囲

`test/vscode/t609-suite/index.ts` と `test/unit/t609-gate-wiring.test.ts`。`assertMappedGitTransitions` の4ファイル各 `open`、`show`、`refresh`、`drain` 操作の個別deadlineのみを対象とした。

## 対象外

production source、設計、package/CI、tracking、handoff、GitHub、CI待機、review、commit、push は変更していない。timeout値の延長、固定sleep、公開commandの迂回も行っていない。

## 実行コマンド

Red: `npm run compile:test; node --test test-dist/test/unit/t609-gate-wiring.test.js`（overall mapping deadlineが残るため新規unit 1 failure）。Green: 同コマンド（14/14 pass）。最終HEAD: `npm run test:t609`（61/61 pass）、`npm run build`（pass）、`npm run lint`（pass）、`git diff --check`（pass、LF-to-CRLF warningのみ）、`npm run test:t609:extension-host`（単回、fail、再実行なし）。

## 対象ファイル

変更: `test/vscode/t609-suite/index.ts`、`test/unit/t609-gate-wiring.test.ts`。作成: 本レポート。

## 指摘事項

R10の `committed rename/new/whitespace/EOL mapping` outer deadline を、fixture内にも呼出側にも置かないことをunitで固定した。4つの semantic assertion と各 `open`/`show`/`refresh`/`drain` は10秒の個別deadlineを維持する。最終実Hostは `t609-single-root` 成功後、`t609-prepare` が `refresh mapped renamed.txt` で10秒timeout、cleanup成功となった。診断は `test-output/vscode-launch-diagnostics/t609-prepare-1787359915342.json`。

## 提案内容

IFR005のHost semantic matrixは未完了。次の調査は、`refresh mapped renamed.txt` が個別deadline内に終わらない原因をproduction経路とfixture lifecycleの両方で限定し、必要なら別のreview follow-upでTDDから行うこと。このR11ではHostを再実行しない。

## 未解決事項

最終technical HEADは未commitのため開始HEAD `2512a62f137cfb235a725681f88e11aa185aa098` のまま。作業treeには上記2 test変更と本レポートが未commitである。Markdown wording は repository に `lint:md`/target wiring がないため unsupported として保持する。

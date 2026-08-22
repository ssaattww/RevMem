# Sub-agent実行レポート

## タスク

- 目的: IFR005のsingle-root Hostで、Shift-JIS review stateがpublic mark後のどの境界で欠落するかを特定して最小修正する。
- タスク種別: 独立レビューfinding follow-up実装（R26）

## sub-agentを使う理由

- 理由: ユーザー指定の実装担当terra/highへ、状態可視性の原因追跡と修正を限定委譲するため。

## 対象範囲

- 対象: Shift-JIS mark、UTF-8 BOM mark、Global refresh、persisted snapshot間の実owner/context/state遷移、最小回帰、local gate、actual Extension Host単回検証。

## 対象外

- 対象外: 設計変更、tracking/PR body、レビュー、commit、push、CI待機、merge、IFR001〜004/006の再探索、timeout延長やsleep追加。

## 実行コマンド

- 実行コマンド: Red（観測契約）: `npm run compile:test; node --test test-dist/test/unit/t609-gate-wiring.test.js` は、境界観測未実装により失敗。Green（観測契約）: 同コマンドは25/25成功。Host（単回）: `npm run test:t609:extension-host` は356.2秒で `t609-single-root` 失敗（再試行なし）。Red（production）: `npm run compile:test; node --test test-dist/test/unit/t609-revision-mapping-encoding.test.js` は same-revision re-decode 後の stable identity 欠落で失敗。Green（production）: 同コマンドは5/5成功。最終 local: `npm run test:t609` は76/76成功、`npm run build` 成功、`npm run lint` 成功、`git diff --check` 成功。Markdown lint は `tools/lint/` と `lint:md` 配線がなく unsupported。

## 対象ファイル

- 変更または確認したファイル: `src/application/review-context/git-context-revision-mapper.ts`（same-revision encoding re-decode 不可時のContext/Global stable identity保持）、`test/unit/t609-revision-mapping-encoding.test.ts`（IFR005回帰）、`test/vscode/t609-suite/index.ts`（A/B/C/D read-only状態観測）、`test/unit/t609-gate-wiring.test.ts`（観測契約）、Host診断 `test-output/vscode-launch-diagnostics/t609-single-root-1787379265612.json`（read-only確認）。

## 指摘事項

- 指摘要約または「指摘なし」: IFR005の最初の欠落は(A) Shift-JIS public mark、(B) UTF-8 BOM public mark、(C) Global refresh、(D) live transition前のいずれでもなく、その直後の `files.encoding` をutf8へ変更したShift-JIS documentのclose/reopenおよびvisible-decoration refresh後だった。HostではContextの `shift-jis.txt` entry自体が欠落し、期待した空reviewed intervalを読めなかった。原因はsame-revision encoding mappingがimmutable textを新decoderで取得できない場合にentryをdropしていたこと。修正はunresolved reasonを維持しつつ、Context/Global双方でstable identityを残しreviewed intervalのみ空にする。

## 結果

- 結果: 最小Red→Greenと最終local gateは成功。単回Hostは修正前candidateで失敗し、指定によりR26内で再試行していないため、IFR005はlocal evidenceでは修正済みだがHost証跡は未完了。

## リスク

- 未解決のリスクまたは後続対応: 修正後candidateのExtension Host実行証跡がない。単回HostのA/B/C/D状態観測はすべて成功したため、そのpass時のowner/contextId値は失敗出力には現れなかった。commit、push、CI、PR、mergeは未実施。

# Sub-agent実行レポート

## タスク

Issue #81 / T609 のclosure open reasonに限定し、公開runtime interfaceへ追加されたTest-only required memberのsource-breakingを解消した。technical HEADは`405c6af047523ebc0e15f81904b77f0ac4e0e2b7`（未commit）である。

## sub-agentを使う理由

既存R16のactual Host behaviorを変更せず、公開type compatibilityを旧shape consumer compile fixtureで確認して同じT609 gateへ固定する必要があるため。

## 対象範囲

- NR007限定: `RegisteredReviewContextsRuntime.getProjectionSnapshotForTest`と`RegisteredT405ReviewContextsRuntime.getCancellationSnapshotForTest`をoptional Test-only memberへ変更する。
- production/Test callerはoptional presence checkを通してsnapshotを使用する。
- `RegisteredReviewContextsRuntime`と`RegisteredT405ReviewContextsRuntime`のlegacy implementation shapeをcompile fixtureへ追加し、`compile:test`から`test:t609`へ一度だけ接続する。
- completeness: NR007=`ready`（implementation、legacy shape 2種、focused gate、build）。Markdown lintは`incomplete/unsupported`。

## 対象外

R16 Host fixture/production behaviorの変更、actual Extension Host再実行、CI、tracking、design/BreakingChanges、commit、push、review、PR/Issue操作は対象外。

## 実行コマンド

- combined Red: `npx tsc -p tsconfig.test.json`は旧shape 2種で失敗した。`RegisteredReviewContextsRuntime`はTS2741、`RegisteredT405ReviewContextsRuntime`はTS2739で、それぞれTest-only required member不足を示した。
- Green: `npm run test:t609`は52/52 pass（static gateは3 legacy fixtureの`tsconfig.test.json` exactly-once connectionと`test:t609`のcompile:test一回を確認）。`npm run build`はpass。`git diff --check`はpass。
- Host: R16 actual functionalityとTest seam実装は不変のため、指示どおり再実行していない。
- Markdown lint: `tools/lint/`、`lint:md`、cspell/prh配線がなくunsupported。

## 対象ファイル

- `src/ui/review-contexts/vscode-review-contexts-runtime.ts`: projection snapshotをoptional memberへ変更した。
- `src/t405-review-contexts-runtime.ts`、`src/t305-extension.ts`: optional snapshot methodsをpresence checkして既存Test-only cancellation snapshotの挙動を維持した。
- `test/unit/t609-review-contexts-cancellation-boundary.test.ts`: optional snapshotを確認して既存cancel/stale no-refresh assertionを維持した。
- `type-fixtures/contracts/t609-registered-review-contexts-runtime-old-shape.fixture.ts`と`t609-registered-t405-review-contexts-runtime-old-shape.fixture.ts`、`tsconfig.test.json`、`test/unit/t609-gate-wiring.test.ts`を更新した。
- report write boundary: 本予約reportの9 placeholderだけを置換した。

## 指摘事項

`T609-NR-007` Medium: `getProjectionSnapshotForTest`と`getCancellationSnapshotForTest`はoptionalであり、旧公開interface implementation shapeをsource-breakしない。実runtimeはmethodsを提供し続けるが、production/Test callerは存在を確認してから使用する。legacy fixture 2種はfocused compile/test gateでGreen。BreakingChanges変更は不要な後方互換方針である。

## 結果

NR007 completenessは`ready`。R16 Host functional evidenceは保持され、R17はruntime behaviorを変えないpublic type compatibility follow-upである。CI/full local equivalence/Markdown lintは未実行またはunsupportedであり、passへ読み替えない。

## リスク

- remaining risk: optional Test-only seamが不在のcustom legacy runtimeはsnapshotを取得できず、T305 Test APIは既存どおり明示的にunavailableとして失敗する。production behaviorには影響しない。
- no design/BreakingChanges/tracking/CI/commit/push/review changes were performed.

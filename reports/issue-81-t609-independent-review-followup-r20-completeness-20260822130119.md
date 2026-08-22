# Sub-agent実行レポート

## タスク

T609 independent-review follow-up R20。IFR004 と IFR005 の限定不足を同一バッチで補完した。

## sub-agentを使う理由

実装担当として、親が保持するレビュー独立性を保ったまま、既存の実 Extension Host fixture と production composition に限定して補完・検証した。

## 対象範囲

- IFR004: T305/T405 共通の `vscode.Uri`→filesystem path 境界を実 `vscode.Uri` fixture で観測し、query、fragment、untitled、workspace 外の remote URI を拒否する。
- IFR005: 実 Host fixture に、opened Shift-JIS document の workspace encoding 変更、同一 Host 内の close/reopen、production decoration refresh、read-only Context/Global persistence snapshot、および restart-reopen snapshot assertion を追加する。
- Test API は URI/path と永続 Review State の read-only 観測のみとした。

## 対象外

- Review、commit、push、CI/GitHub 操作、tracking、設計書、既存履歴レポートの変更。
- Test API からの Review State mutation、fixture の直接 state seed、fixed sleep、timeout 延長。
- Extension Host の再実行。R20 の最終実行は一度だけであり、失敗後に再試行していない。

## 実行コマンド

- Red: `npm run compile:test; node --test test-dist/test/unit/t609-gate-wiring.test.js`
  - 19/21 pass、2 fail。Host fixture の encoding setting 更新を旧静的契約が禁止し、未実装の T305/T405 actual-Uri read-only probe と Git persistence snapshot API を要求した。
- Green: `npm run compile:test; node --test test-dist/test/unit/t609-gate-wiring.test.js`
  - 21/21 pass。
- `npm run test:t609`
  - delta HEAD で 71/71 pass。
- `npm run build`
  - pass。
- `npm run lint`
  - pass。
- `git diff --check`
  - pass。
- Final actual Host (one run only): `npm run test:t609:extension-host` with shell timeout 900000ms。
  - fail。`t609-single-root` で workspace 外 `vscode-remote://ssh-remote+t609/tmp/file.txt` が accept された。diagnostic: `test-output/vscode-launch-diagnostics/t609-single-root-1787372464306.json`。
  - 失敗後、shared helper を workspace-contained remote のみ accept へ修正し、上記 local gates は delta HEAD で再 Green。ただし Host は指示どおり再実行していない。

## 対象ファイル

- `src/t609-repository-resolution.ts`: remote URI を同 authority の workspace root 配下に限定する shared validation。
- `src/t305-extension.ts`: T305 path probe、T405 path probe の公開 Test observation と、Git Context/Global persistence の read-only summary。
- `src/t405-review-contexts-runtime.ts`: T405 の shared workspace-side URI composition と read-only probe。
- `test/vscode/t609-suite/index.ts`: actual Uri/public command、live encoding close/reopen、persistence/restart assertion fixture。
- `test/unit/t609-repository-resolution.test.ts`: remote workspace 内 accept・外部 reject。
- `test/unit/t609-gate-wiring.test.ts`: actual fixture/API と mutation seam 不在の wiring assertion。

## 指摘事項

- IFR004: delta local evidence は ready。shared helper は T305/T405 の production入口で workspace-side remote URI だけを通す。actual Host evidence は旧 helper で失敗した一度の実行のみであり、修正済み delta HEAD には未対応。
- IFR005: fixture と read-only snapshot assertion は追加済み。実 Host は URI boundary assertion で先に停止したため、live encoding transition と restart snapshot の semantic cells は未実行。したがって IFR005 は incomplete。
- Host failure は再試行禁止に従い held とした。CI は未実施。

## 提案内容

次の限定 follow-up で、current delta HEAD の T609 Extension Host を一度だけ実行し、IFR004 の actual Uri/public command cell と IFR005 の live encoding・restart persistence cells をまとめて完走させる。その結果だけを同一 independent reviewer の finding-limited closure に渡す。

## 未解汾事項

- current delta HEAD の actual Extension Host evidence がない。
- IFR005 の actual Host semantic matrix（encoding change、changed-file-only Context/Global clear/remap、unaffected file invariant、restart persisted owner/revision/interval）が未完了。
- commit/push/CI/independent reviewer closure は親の担当であり未実施。

# Sub-agent実行レポート

## タスク

- 目的: R13でrestart-reopen phaseに残ったGlobal snapshot undefinedを、reopened UTF-8 BOM editorとactual Current Context refreshの明示同期で解消する。
- タスク種別: 限定 Host fixture implementation follow-up。

## sub-agentを使う理由

- 理由: 親から委譲されたrestart lifecycle同期、gate contract、focused validation、予約済みR14 reportを限定範囲で担当する。

## 対象範囲

- 対象: restart-reopenのUTF-8 BOM active editor化、actual `reviewRange.refreshContext` completion、Global refresh/recalculate assertion、old Shift-JIS hint non-reuse、T609 gate contract。

## 対象外

- 対象外: production本体、Test-mode seam追加、storage containment修正、timeout延長・sleep、tracking/design/workflow、review、commit、push、CI、GitHub、full suite、`test:t609`全体。

## 実行コマンド

- Red: `node --experimental-strip-types --test test/unit/t609-gate-wiring.test.ts`を1回実行し、新規restart active-editor/Current Context-before-Global契約がfail（既存7件pass）。
- Green: 同一source gateを実装後に実行し8/8 pass。
- Static: `npm run compile:test`、`npm run build`、`git diff --check`を各1回実行しpass。diff-checkは既存working copyのLF-to-CRLF警告のみ。lint/architectureはR13で直前passのため指示どおり未実行。
- Exact Host: `node test-dist/test/vscode/run-extension-host.js --t609`を1回実行。single-rootとprepareはsucceeded。restart-reopenは`restore restart Current Context`の10秒timeoutでfailed、fixture cleanupも10秒timeout。再試行なし。
- Markdown lint: `tools/lint/`と`lint:md` scriptがないためrepo-local focused Markdown lintはunsupported。

## 対象ファイル

- 変更: `test/vscode/t609-suite/index.ts` はreopened UTF-8 BOM documentを`showTextDocument`でactiveにし、active URIを確認後、actual public `reviewRange.refreshContext` completionをawaitしてからGlobal refresh/recalculate assertionを行う。
- 維持: restart hostでShift-JIS documentを開かず、`textDocuments`にShift-JISがないことを確認するold hint non-reuse assertion。
- 変更: `test/unit/t609-gate-wiring.test.ts` はrestart active editor、Current Context→Globalの順序、Shift-JISの未openを固定する。
- 維持: production source、Test-only API、T506 public command scope、storage containment、tracking/design/workflowは変更しない。
- 変更: この予約済みR14 reportの9 placeholderのみ置換した。

## 指摘事項

- source finding: NR-006（normal finding）。
- R13 storage defectはsingle-root/prepare successful evidenceで引き続き解消済み。
- new diagnostic: `test-output/vscode-launch-diagnostics/t609-restart-reopen-1787340799187.json` は`test-dist/test/vscode/t609-suite/index.js:53`の`T609 Extension Host timed out: restore restart Current Context`を報告する。active UTF-8 BOM editorでactual public Current Context commandが10秒内に完了しない。
- cleanup diagnostic: `test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787340810024.json`は10秒timeoutであり、原因は未調査。本限定scopeではproductionまたはTest seamによる推測修正をしない。

## 結果

- 結果: Red/Greenと指定static checksはpass。exact Hostはrestart Current Context timeout/cleanup timeoutでfail、3 phase+cleanupおよびNR-006 readyはincomplete。
- technical HEAD: `1c925c9b66a98e1772918de31110ea2649bbc725`。commit/push/CIは未実施。

## リスク

- 残リスク: restart host active editorでpublic Current Context commandが完了しない原因、Global recalculate、fixture cleanup timeoutは未解決である。
- 次アクション: public Current Context wrapperのerror/lifecycle boundaryを別の許可済みscopeでTest-only diagnostic seamを用いて分離し、production defectが判明した場合だけ別scopeで修正する。

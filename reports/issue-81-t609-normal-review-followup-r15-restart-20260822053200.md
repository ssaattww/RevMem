# Sub-agent実行レポート

## タスク

- 目的: Issue #81のrestart acceptanceを、new Hostがopened UTF-8 BOM documentからencoding hintを再観測し、前Hostのstale hintを再利用しない検証へ限定する。
- タスク種別: 限定 Host fixture/Test-only diagnostic implementation follow-up。

## sub-agentを使う理由

- 理由: 親から委譲されたrestart requirementの過剰assert除去、read-only observed hint evidence、focused validation、予約済みR15 reportを限定範囲で担当する。

## 対象範囲

- 対象: restart-reopenのUTF-8 BOM-only active document、in-memory observed encoding hint Test snapshot、Shift-JIS/invalid document未open assertion、T609 gate contract、exact Host matrix。

## 対象外

- 対象外: production modeの挙動、Current Context/Global requirementの追加、storage containment、encoding hint persistence、tracking/design/workflow、review、commit、push、CI、GitHub、full suite、`test:t609`全体。

## 実行コマンド

- Red: `node --experimental-strip-types --test test/unit/t609-gate-wiring.test.ts`を1回実行し、新規restart encoding-only contractがfail（既存7件pass）。
- Green: 同一source gateを実装後に実行し8/8 pass。
- Static: `npm run compile:test`、`npm run build`、`git diff --check`を各1回実行しpass。diff-checkは既存working copyのLF-to-CRLF警告のみ。
- Exact Host: `node test-dist/test/vscode/run-extension-host.js --t609`を1回実行し、`t609-single-root`、`t609-prepare`、`t609-restart-reopen`、`vscode-fixture-cleanup`の全phaseがsucceeded。再試行なし。
- Markdown lint: `tools/lint/`と`lint:md` scriptがないためrepo-local focused Markdown lintはunsupported。

## 対象ファイル

- 変更: `GitContextDocumentReviewStateSessionProvider`とwrapper providerはHost内のtransient observed encoding hintsをread-only snapshotで返す。`src/extension.ts`はExtensionMode.Test APIでのみこのsnapshotを公開し、production runtime port/modeの挙動を変更しない。
- 変更: restart fixtureはUTF-8 BOMだけをopen/activeにし、visible decoration refresh/drainによりactual provider observationを完了してからsnapshotがそのdocumentだけでcurrent `document.encoding`を持つことをassertする。
- 維持: restart phaseはShift-JISとinvalid documentを開かず、`workspace.textDocuments`に両方がないことをassertする。Current Context/Global command、snapshot assertionはrestart phaseから除去した。
- 変更: `test/unit/t609-gate-wiring.test.ts` はrestart encoding-only contract、decoration observation、observed hints、Current Context/Global command非存在を固定する。
- 変更: この予約済みR15 reportの9 placeholderのみ置換した。

## 指摘事項

- source finding: NR-006（normal finding）。
- R14のrestart public Current Context timeoutはrestart requirementを越えたmanual Current Context/Global assertionによるfixture過剰scopeだった。R15はIssue #81 acceptanceに必要なopened document encoding hint再観測だけをactual Hostで確認する。
- exact evidence: new HostはUTF-8 BOM documentだけをopen/activeし、observed hint snapshotにShift-JISを含めず、single-root mixed encoding、multi-root cancel/stale、restart hint non-reuse、cleanupまで成功した。

## 結果

- 結果: Red/Green、指定static checks、exact 3 phase+cleanupはpass。NR-006 required T609 gate wiringとactual Extension Host matrixはready。
- technical HEAD: `1c925c9b66a98e1772918de31110ea2649bbc725`。commit/push/CIは未実施。

## リスク

- 残リスク: `test:t609`全体、full suite、matching CI、independent review verdictは本限定scopeでは未実行である。observed hint snapshotはTest-only read-only diagnosticでありproduction APIではない。
- 次アクション: 親のreview/commit workflowでNR-006 ready evidenceを評価し、残るrepository-defined gateとreviewを実施する。

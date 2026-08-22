# Sub-agent実行レポート

## タスク

- 目的: NR-006 のactual Extension Host fixtureで、public command UI wrapperを経由せずproduction normal-editor command serviceの結果またはthrowを観測する。
- タスク種別: 限定 implementation follow-up。

## sub-agentを使う理由

- 理由: 親から委譲されたTest-only seam、Host fixture、focused evidence、予約済みR12 reportの作成を一つの限定範囲で担当する。

## 対象範囲

- 対象: `src/extension.ts` Test-mode APIのdirect normal-editor selection seam、`src/t305-extension.ts`の既存base API spreadによる公開、T609 Shift-JIS/UTF-8 BOM Host fixtureのdirect application利用、対応するT609 gate contract。

## 対象外

- 対象外: production mode/API/command registrationの変更、public command wrapperの修正、timeout延長・sleep、tracking/design/workflow、review、commit、push、CI、GitHub、`test:t609`全体、full suite。

## 実行コマンド

- Red: `node --experimental-strip-types --test test/unit/t609-gate-wiring.test.ts` を1回実行し、新規direct-seam契約1件がfail（既存6件pass）。
- Green: 同一source gateを実装後に1回実行し7/7 pass。
- Static: `npm run compile:test`、`npm run build`、`npm run lint`、`git diff --check`を各1回実行しpass。diff-checkは既存working copyのLF-to-CRLF警告のみ。report作成後にscope限定の`git diff --check -- <4 files>`を意図せず追加で1回実行しpassしたため、要求されたdiff-check一回制約には不適合である。
- Exact Host: `node test-dist/test/vscode/run-extension-host.js --t609`を1回実行。`t609-single-root` はdirect seamで `Persistence storage resolves outside its configured storage root.` をthrowしてfailed。再試行なし。fixture cleanupはsucceeded。
- Markdown lint: `tools/lint/`と`lint:md` scriptがないためrepo-local focused Markdown lintはunsupported。

## 対象ファイル

- 変更: `src/extension.ts` はExtensionMode.Testでのみ `markNormalEditorSelectionForTest(editor)` を提供し、production `commandService.markSelectionReviewed(editor)` のresult/throwを直接返す。production modeとpublic command registrationは不変。
- 維持: `src/t305-extension.ts` は既存の`...baseApi` Test API spreadでseamを利用可能にし、追加のproduction wiringは行わない。
- 変更: `test/vscode/t609-suite/index.ts` はShift-JIS/UTF-8 BOMのmarkだけdirect seamをawaitし、既存document drain、visible refresh/drain、reviewed interval assertionを維持する。
- 変更: `test/unit/t609-gate-wiring.test.ts` はTest APIからproduction command serviceへのdirect call、Host seam利用、T609 fixtureにpublic mark command wrapperがないことを固定する。
- 変更: この予約済みR12 reportの9 placeholderのみ置換した。

## 指摘事項

- source finding: NR-006（normal finding）。
- direct seamがprevious public wrapper timeoutを具体的failureへ分離した。exact Hostのsingle-root stderrは `NodeAtomicTextFileStore.physicalPath` から `DocumentReviewStateSessionProvider.replaceSnapshots` へ至る保存経路で `Persistence storage resolves outside its configured storage root.` を報告する。
- location: `dist/adapters/state-repository/atomic-text-file-store.js:113`（source counterpart `src/adapters/state-repository/atomic-text-file-store.ts:127`）から、non-Git snapshot invalidation経由でnormal-editor command application中にthrowする。
- 本限定scopeではproduction defectを推測・修正しない。multi-root cancel/staleとrestart-reopenはsingle-root failureのため未到達。

## 結果

- 結果: Red/Greenと指定static checksはpass。exact Hostはsingle-root direct application failureでfail、3 phase完走およびNR-006 readyはincomplete。
- technical HEAD: `1c925c9b66a98e1772918de31110ea2649bbc725`。commit/push/CIは未実施。

## リスク

- 残リスク: configured storage root外へのsnapshot persistence経路がnormal-editor markを失敗させる。mixed-encoding persistence/visible decoration/Global completion、multi-root cancel/stale、restart-reopenはactual Host evidence未完である。
- 次アクション: storage-root boundary failureを別の許可済みproduction follow-upとして調査し、修正後に新しい実行許可でexact `--t609`を再実行する。public command registrationは既存T506回帰範囲で扱う。

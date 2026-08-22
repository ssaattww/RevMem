# Sub-agent実行レポート

## タスク

Issue #81 / T609 の IFR005 に限定し、Current Context の activation と active-editor change による background refresh を非対話化した。保存済み Current Context または一意候補だけを復元し、候補が 0 件または複数なら状態を変えずに完了させる。明示 `reviewRange.refreshContext` だけは Quick Pick を表示できる。

## sub-agentを使う理由

前任が残した未コミットの design、production code、unit、Host fixture の差分を破棄せず、IFR005 の Host completion 候補として独立に監査・検証するためである。

## 対象範囲

`CurrentContextRuntimeComposition` の非対話 outcome、runtime/controller/coordinator の option 伝播、明示 refresh command と background refresh の分離、Test-mode の Quick Pick 呼出し回数観測、対応する design・unit・T609 Host assertion。activation startup は `allowInteraction: false`、explicit refresh は `allowInteraction: true` で実行される。cancel、stale、unresolved は既存の accepted UI state・selection・dependent projection を変更しない。

## 対象外

Current Context の candidate resolution 順序、storage schema、Git mapping 実装、GitHub、CI、tracking、PR 更新、review、commit、push は変更していない。固定 sleep、timeout 延長、public command の Test seam 置換、Extension Host の再試行は行っていない。破壊的変更ではないため `Design/BreakingChanges.md` は変更対象外である。

## 実行コマンド

既存差分に対応する有効な Red 実行ログは受領した作業ツリー・予約 report に存在しなかった。差分を戻さず、Red 未記録として扱う。

Green: `npm run compile:test && node --test test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/t609-gate-wiring.test.js` は 34/34 pass。`npm run test:t609` は 60/60 pass。`npm run build`、`npm run compile:test`、`npm run lint`、`git diff --check` は pass した（後者は CRLF conversion warning のみ）。

exact: `npm run test:t609:extension-host` は一回だけ実行した。`t609-single-root` は succeeded、`t609-prepare` は `committed rename/new/whitespace/EOL mapping` の timeout により failed、`vscode-fixture-cleanup` は succeeded。timeout を延長・再試行していない。診断は `test-output/vscode-launch-diagnostics/t609-prepare-1787358731482.json`。

Markdown は `tools/lint/` と repository-owned Markdown lint wiring が存在しないため、`markdown-word-checker` の focused lint は unsupported と記録する。report と design の用語は既存表記に合わせた。

## 対象ファイル

`src/ui/current-context/current-context-runtime-composition.ts`: `allowInteraction` と非破壊 `unresolved` outcome を追加。`src/ui/current-context/current-context-ui-controller.ts`、`current-context-runtime-coordinator.ts`、`vscode-current-context-runtime.ts`: option を伝播し、activation/editor event を non-interactive、explicit refresh を interactive に分離。`src/t305-extension.ts`: composition 接続と Test-mode の selection request count を追加。`test/unit/current-context-ui.test.ts`、`test/unit/t609-gate-wiring.test.ts`、`test/vscode/t609-suite/index.ts`: background が Quick Pick を出さず explicit command だけが出すことを検証。`doc/design/document-context-routing.md` と `doc/design/vscode-review-range-tracker-design.md`: accepted behavior を明文化。本 report。

## 指摘事項

R9 で止まった startup Current Context の Quick Pick/依存 refresh timeout は今回の exact run では再現せず、multi-root startup は非対話で settle した。IFR005 の activation no-interaction と explicit command boundary は focused/unit evidence で ready である。

ただし exact Host はその後の `assertMappedGitTransitions` 内、`committed rename/new/whitespace/EOL mapping` で timeout した。これは一回限りの実行で観測した未解決 Host failure であり、IFR005 全体の Host semantic matrix を pass としては扱えない。

## 提案内容

次の限定 follow-up は `assertMappedGitTransitions` の public document-open/mark/state-persistence completion boundary を診断し、今回通過した non-interactive Current Context 契約を戻さずに修正する。修正後は focused、T609、static を収束後に実行し、exact Host は一回だけ実行する。same reviewer の closure は、IFR005 の全 Host semantic matrix が current technical HEAD で通過してからに限定する。

## 未解決事項

IFR005 は incomplete。single-root phase、Shift-JIS/UTF-8 BOM の public review command、startup non-interaction の unit/Host entry は ready だが、multi-root の committed rename/new/whitespace/EOL mapping の exact Host evidence が未完了である。その後段の Current Context cancel/stale/post-pick、invalid encoding isolation、restart/reopen も今回の Host run では未到達。technical HEAD は committed `f34274f7bfd71bc41ce4dfb04a3d99f5cc323ba6` を親とする未commit workspace であり、commit/push/CI/PR 更新は親の責務である。

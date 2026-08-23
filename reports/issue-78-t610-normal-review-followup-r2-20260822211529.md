# Sub-agent実行レポート

## タスク

- 目的: T610 normal-review 10 finding の R1 follow-up を完了し、production composition と one-shot Extension Host の実証範囲を正確に記録する。
- タスク種別: bounded normal-review follow-up implementation (R2; Host evidence incomplete)

## sub-agentを使う理由

- 理由: parent 指定の bounded implementation worker として、R1 の未コミット変更を保持し、許可された source/test/runtime/design/report 範囲だけを補完したため。

## 対象範囲

- 対象: T610-NR-001〜010 の local production/test/composition/validation evidence、T610 Test API/Host runner、stopped marker storage、watcher/error boundary、BreakingChanges、および本固定 R2 report。

## 対象外

- 対象外: historical R1 report 編集、tasks/phases、commit、push、CI/GitHub、review verdict、full local equivalence、Host 再実行。

## 実行コマンド

- 実行コマンド: `npm run compile:test` Green。`npm run test:t610` Green (40/40)。legacy regression name-pattern batch (`issue-66-global-pr-progress`、`t505-refresh-invalidation`、`pull-request-progress-tree`、`t607-performance-incremental-ui`) Green (37/37)。`npm run test:t607` Green (81/81)。`npm run build`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check` は個別 Green。Markdown lint wiring check は `tools/lint/` と `lint:md` が存在せず `unsupported`（pass ではない）。one-shot Host: `npm run build; npm run compile:test; node test-dist/test/vscode/run-extension-host.js --t610` は Red。再実行なし。

## 対象ファイル

- 変更または確認したファイル: R1 の controller/source/enumerator/stopped store/runtime/T305/BreakingChanges/T610 tests を保持。R2 は `src/t305-extension.ts`（registered watcher callback と test seam）、`src/t505-global-understanding-source.ts`（scope failure propagation）、`src/ui/global-understanding/vscode-global-understanding-runtime.ts`（folder command privacy-safe boundary）、`test/unit/t610-folder-understanding.test.ts`（stale/failure boundary）、`test/vscode/run-extension-host.ts`（runner-side initial/restart fixture）、`test/vscode/t610-suite/index.ts`（exported Host runner/phase diagnostics）、本 report を変更。

## 指摘事項

- 指摘要約: R1 の local 実装は 10 finding を対象に維持した。R2 は legacy 4 regression、command failure boundary、registered watcher seam、actual Host selector/export、runner-side fixture lifecycle を補完した。prior Host timeout の原因は `t610-suite` が VS Code test runner 必須の exported `run()` を持たず、worker が `runTests` failure 後に deadline まで待機したことだった。R2 の one-shot はこの原因を越えて `t610-initial` の `open produces Tree snapshot` で Red になった。diagnostic は `test-output/vscode-launch-diagnostics/t610-initial-1787401927274.json`。初期 startup は active document を持たず context が未選択であり、open event が scope start へ到達していない。再実行は禁止されているため未修正/未証明のまま記録する。

  | Finding | Production | Test | Composition | Validation | Tracking | R2 state |
  | --- | --- | --- | --- | --- | --- | --- |
  | T610-NR-001 | ready local: controllerなしは legacy `enumerate()` | ready: legacy nested/4 regressions Green | ready local | ready: targeted 37/37 | report only | incomplete (Host Red) |
  | T610-NR-002 | ready local: inherited/explicit stop separation and pruning | ready | ready local | ready: T610/T607 Green | report only | incomplete (Host Red) |
  | T610-NR-003 | ready local: stopped-only snapshot and durable stop refresh | ready local | ready local | ready: T610 Green | report only | incomplete (Host restart not reached) |
  | T610-NR-004 | ready local: recursive aggregate, ancestor rows, hierarchical Tree | ready | ready local | ready: T607 Green | report only | incomplete (Host Red) |
  | T610-NR-005 | ready local: canonical URI identity/traversal/current Tree fence | ready | ready local | ready: targeted legacy regressions Green | BreakingChanges updated | incomplete (Host Red) |
  | T610-NR-006 | ready local: open refresh and create/delete/change watcher callback | partial: seam/unit coverage; no fake-emitter full activation proof | partial | partial: Host stopped before watcher | report only | incomplete |
  | T610-NR-007 | ready local: atomic lock/RMW store and rethrown failures | ready: corruption/ENOSPC/lost-update/error-boundary | ready local | ready: T610/T607 Green | report only | incomplete (Host Red) |
  | T610-NR-008 | ready local: <=128 accounting and stopped-subtree prune | ready: 257-entry accounting | ready local | ready: T607 Green | report only | incomplete (Host Red) |
  | T610-NR-009 | ready local: exactly-once Test API/selector and exported phased runner | ready local | partial: Host starts but snapshot phase Red | Red: one-shot exact Host | report only | incomplete |
  | T610-NR-010 | ready local JSDoc/BreakingChanges | static contract covered | ready local | Markdown wiring `unsupported` | BreakingChanges updated | incomplete (Markdown/Host) |

## 結果

- 結果: `incomplete`。All requested local executable cells are Green except Markdown lint wiring, which is explicitly `unsupported`. The one authorized exact T610 Host run is Red and stopped at `t610-initial/open produces Tree snapshot`; `t610-restart` did not run. No Host retry was made. The R1 report remains historical/incomplete.

## リスク

- 未解決のリスクまたは後続対応: Host initial context selection/open ordering must be corrected in a later authorized follow-up and then the full initial → stop/resume → watcher → runner-side mutation → restart stopped-only/no-active-restore lifecycle must run once. Until then, T610-NR-006 and NR-009 are directly unproven and every finding remains overall incomplete. Markdown terminology gate also remains unsupported because repository wiring is absent; no lint configuration was changed.

# Sub-agent実行レポート

## タスク

- 目的: R3 exact Host の「Current Context ready 後、実open後も Global snapshot が undefined」失敗を、production既定動作を変えずにT305 Test-mode観測で分離し、許可済みT610 Hostを一回だけ実行する。
- タスク種別: bounded normal-review follow-up implementation (R4 Host diagnostic; incomplete)

## sub-agentを使う理由

- 理由: parent指定の狭いHost workerとして、R3 diagnosticからsource pre-controller boundaryを確定し、one-shot Host evidenceとNR-006/NR-009 readinessを固定するため。

## 対象範囲

- 対象: T305 Test-modeのread-only open/source/runtime-publish観測とdrain、T610 suite/static gate、既存runnerのinitial/restart/cleanup lifecycle、fixed R4 report。

## 対象外

- 対象外: production default behavior、T505/controller/enumerator/runtime仕様変更、fixture Host I/O、design/tracking/history、review/commit/push/CI/GitHub、Host再実行、sleep/10秒public-operation wrapper。

## 実行コマンド

- Red: `npm run compile:test; node --test test-dist/test/unit/t610-folder-understanding.test.js` は新規 `T610-R4` static contractが `getGlobalUnderstandingLifecycleObservationForTest` 未配線でfail（既存16件pass）。
- Green: 同一compile後のstatic suiteは17/17 pass。`npm run test:t610` は41/41 pass、`npm run test:t305` は60/60 pass、`npm run build`、`npm run lint`、`git diff --check` はpass。
- Exact Host: 外側960秒上限で `node test-dist/test/vscode/run-extension-host.js --t610` を一回だけ実行し、47.9秒でRed。`t610-initial` failed、`t610-restart` not launched、`vscode-fixture-cleanup` succeeded。再試行していない。
- Markdown word check: `tools/lint/` と `lint:md` wiringがないためunsupported（passではない）。設定は変更していない。

## 対象ファイル

- 変更または確認したファイル: `src/t305-extension.ts`（Test-mode-only: selected source context、accepted open、file-open completion、source refresh outcome/error、runtime publicationのread-only observation）、`src/ui/global-understanding/vscode-global-understanding-runtime.ts`（T305から渡されるTest publish callbackのみ）、`test/vscode/t610-suite/index.ts`（open lifecycleの各境界assertion）、`test/unit/t610-folder-understanding.test.ts`（R4 static wiring contract）、本report。T505 source/controller/enumeratorとproduction default path、runner fixture ownership、design/tracking/historyは未変更。

## 指摘事項

- 指摘要約: R3で通過済みだったactivation、startup drain、public no-active-editor Current Context refresh、selected-context assertionに加えて、R4はopen後を4境界へ分けた。exact Hostではsource contextがnon-undefined、registered document-openは受理され、対象fixture pathの`observeFileOpen()`はerrorなしでcompletedした。一方、runtimeが呼ぶsource refreshはerrorなしの`undefined`を返したため、snapshot publish assertionには到達していない。

  `T505GlobalUnderstandingSource.recalculate()` でcontroller restore/activeFoldersへ達する前に`undefined`を返す箇所は、owner解決または`scopeRoot()`解決だけである。Git fixtureはrunnerがcommit済みで、Current Context selectionはaccepted済み、T305 source context observationも保持済みであるため、失敗はdocument-open delivery、drain、controller scope start、refresh error、runtime publishではない。最も狭い未解決境界は、selected Git repository rootからworkspace URI identityを得るT305 `resolveRepositoryRootUri` のexact-path match（Windows上の`path.resolve(...) === path.resolve(...)`）であり、match失敗時は`scopeRoot()`がundefinedとなってcontroller前でreturnする。source identity/root canonicalizationのproduction修正はこのscopeでは未許可である。

  | Phase | Evidence | State |
  | --- | --- | --- |
  | initial: activation/startup/public context | R3/R4 assertions passed | passed |
  | initial: open accepted/source observed | R4 `sourceContext`、open count/path、`fileOpenOutcome=completed` assertions passed | passed |
  | initial: source refresh | diagnostic `t610-initial-1787403557703.json`: expected `snapshot`, actual `undefined`, no source error | failed |
  | initial: runtime publish | source did not produce snapshot | not reached |
  | initial: stop/resume/watcher/final stop | snapshot prerequisite absent | not reached |
  | restart stopped-only restore | initial launch failed before runner mutation/restart | not launched |
  | cleanup | `vscode-fixture-cleanup-1787403558718.json` | passed |

  - `T610-NR-006`: **not ready**。open event/source observationはHostで確認したが、source snapshot前で停止しwatcher phaseは未到達。
  - `T610-NR-009`: **not ready**。actual exported activation、selector、initial lifecycleとdiagnostic splitは確認したが、snapshot publication、restart、complete lifecycleは未証明。

## 結果

- 結果: `incomplete`。TDD-style Red/Green wiring evidence、focused semantic gates、build、lint、diffcheckはGreen。exact Hostは一回だけ実行しinitial source refreshが`undefined`でRed、restartは未実行、cleanupはGreen。production behaviorは変更していない。

## リスク

- 未解決のリスクまたは後続対応: production T305 repository-root-to-workspace-URI identity matchingを別許可scopeでcanonical filesystem semanticsにより調査・修正し、Test observationがsource `snapshot` とruntime publicationを確認してから、新しい明示authorityでinitial→stop/resume→watcher→final stop→runner mutation→restart stopped-only lifecycleをone-shotで実行する必要がある。R4のHost evidenceは唯一の許可済み実行であり、retryは禁止されたままである。Markdown terminology gateはunsupported、remote CI/commit/push/review/mergeは未実施。

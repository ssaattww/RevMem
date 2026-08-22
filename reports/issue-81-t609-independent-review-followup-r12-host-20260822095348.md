# Sub-agent実行レポート

## タスク

T609 IFR005 R12: committed Git rename/mapping fixture の Extension Host 停止を、production composition で局所化し、誤った個別deadlineを除去する。

## sub-agentを使う理由

実Git・永続化・履歴・Document session・可視editor装飾を同じ経路で検証するため。実装、commit、push、review、CI待機は親担当であり本作業に含めない。

## 対象範囲

`test/vscode/t609-suite/index.ts` の Git transition mapping、対応する gate wiring、production composition regression と T609 script wiring。

## 対象外

whitespace/EOL mapping のproduction修正、独立レビュー、commit/push、CI/GitHub、tracking/design/handoff、Extension Host の再試行。

## 実行コマンド

Red: 新しいcomposition test は当初storageをGit root内に置いたため `git add -A` が状態ファイルを拾いWindows path lengthで失敗した。storageを独立rootに分離した後、model seamの `isCurrent` を補いGreen化した。

Green: `node --test test-dist/test/unit/t609-host-rename-decoration-composition.test.js test-dist/test/unit/t609-gate-wiring.test.js` は15/15 pass。`npm run test:t609` は62/62 pass。`npm run build`、`npm run lint`、`git diff --check` はpass。最終候補で `npm run compile:test` もpass。

Extension Host: `npm run test:t609:extension-host` を一回だけ実行。single-rootはpass、prepareではrename mappingを通過したが、`whitespace.txt` の期待intervalが空でfailした。再試行はしていない。診断は `test-output/vscode-launch-diagnostics/t609-prepare-1787362134907.json`。

Markdown: repositoryに `tools/lint/` と `lint:md` wiringがなく、focused Markdown lintはunsupported。report本文の用語を既存表記に合わせた。

## 対象ファイル

追加した `t609-host-rename-decoration-composition.test.ts` は、実Git、FileSystem/Debounced repository、Jsonl history、DocumentReviewStateSessionProvider、NormalEditorDecorationControllerを接続する。旧reviewed rename sourceをpersistし、rename commit後にvisible-editor eventと明示refreshを並行させ、storage load → revision map/commit/history → decoration model/apply → dispose/owned cleanupを確認する。

Host fixtureではopen/showの個別10秒deadlineを保持し、正常なGit mappingが続く `refreshVisibleEditorDecorations` と `drainVisibleEditorDecorations` の個別deadlineだけを外して、runnerの所有lifecycle deadlineへ委ねた。全体mapping deadlineはR11時点で既に削除済み。

## 指摘事項

`package.json`、`test/unit/t609-gate-wiring.test.ts`、`test/unit/t609-host-rename-decoration-composition.test.ts`、`test/vscode/t609-suite/index.ts`、本report。

## 提案内容

IFR005は incomplete。R12ではrenameのtimeoutを解消して次の実障害を露出したが、Host prepareでwhitespace-only mappingのinterval保持が失敗している。次のfollow-upはこの差分を実production compositionでRed化・修正し、通常reviewerと同一独立reviewerのfinding-limited closure前に、Hostを一回だけ再実行する必要がある。

## 未解決事項

Host prepare phase のwhitespace-only Git transitionが、設定済みの `ignoreWhitespaceChanges` を通してもreviewed intervalを保持していない。R12の変更はこのproduction failureを修正していない。

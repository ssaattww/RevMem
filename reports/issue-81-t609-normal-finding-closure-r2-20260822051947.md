# Sub-agent実行レポート

## タスク

- 目的: 前回normal finding closureでopenとなった`T609-NR-004`、`T609-NR-006`、`T609-NR-007`だけを、同一reviewerがfrozen HEAD `f88c7d8cfd4b8d265d098174aafd8d9cba76ce40`でfinding限定closureする。
- タスク種別: normal finding-limited closure R2。`T609-NR-001`、`002`、`003`、`005`はclosedを維持し、再reviewしていない。新規観点、finding、severity変更はない。

## sub-agentを使う理由

- 理由: 初回通常reviewと前回closureを担当したreviewerが、残る3件のrequired actionを同じcompleteness matrixで継続評価するため。

## 対象範囲

- 対象: base `3bba5defe32b7da134817492427e09c70c97beaf`、前回closure target `6ba97488a96e7ffe94e05115ced23c211704d3bd`、今回review target `f88c7d8cfd4b8d265d098174aafd8d9cba76ce40`。R16 reportと、3 findingsに直接対応するproduction、actual composition、focused evidence、gate wiring、trackingのdeltaだけを確認した。
- provided evidence: `test:t609` 51/51、focused cancellation 2/2、build Green、actual Extension Hostのsingle-root・prepare・restart-reopen functional 3 phase Green。最新runnerのcleanup worker timeoutはpassへ読み替えずheldとした。

## 対象外

- 対象外: closed済み4件、全範囲再review、新規criterion、新規finding、severity変更、実装修正、test/build/lint/CI実行、CI待機、commit、push、PR/Issue操作、tracking変更、独立review。

## 実行コマンド

- 実行コマンド: `Get-Content`、`rg`、`git diff`、`git log`、`git rev-parse`、`git status`によるread-only inspectionだけを実施した。test、build、lint、CIは実行していない。
- Markdown lint: repo-local `tools/lint/`、`lint:md`、cspell/prh配線がないためfocused/fullとも`unsupported`。passではなくheldである。

## 対象ファイル

- 確認対象: R16 follow-up report、前回closure report、`src/ui/review-contexts/vscode-review-contexts-runtime.ts`、`src/t405-review-contexts-runtime.ts`、`src/t305-extension.ts`、mapping contractsとconsumer、T609 cancellation/gate/Host fixtures、legacy type fixture、`tsconfig.test.json`、`package.json`、task/phase tracking、`Design/BreakingChanges.md`。
- write boundary: 本予約reportの9 placeholderだけを置換し、他fileは変更していない。

## 指摘事項

- `T609-NR-004` — High — `closed`。production path=`checked_no_finding`: `src/ui/review-contexts/vscode-review-contexts-runtime.ts:263-305`がtyped cancellationを`mutate`のterminal outcomeとして返し、post-cancel refreshを開始しない。actual composition=`checked_no_finding`: `test/vscode/t609-suite/index.ts:170-197`はactual `reviewRange.redetectPullRequest`から`inspectActiveRepository`、repository selection requestへcancel/stale各1回到達し、provider context IDsとauthoritative context countの不変を観測する。focused evidence=`checked_no_finding`: R16のfocused cancellation 2/2とfunctional Host prepare Green。gate wiring=`checked_no_finding`: `test/unit/t609-gate-wiring.test.ts:99-129`がactual command、snapshot、request count、非破壊assertionを固定する。tracking=`checked_no_finding`: functional passとcleanup heldを分けた記録は証拠と一致する。required actionは完了した。
- `T609-NR-006` — Medium — `closed`。production path=`checked_no_finding`: T609 unit/Host scriptsとCI接続は維持され、cancellation outcome修正は実際のT405 command pathへ構成された。actual composition=`checked_no_finding`: R16でsingle-root mixed encoding、multi-root actual cancel/stale、restart-reopenのfunctional 3 phaseがGreen。focused evidence=`checked_no_finding`: `test:t609` 51/51、cancellation 2/2、build Greenをprovided evidenceとして確認した。gate wiring=`checked_no_finding`: dedicated gateがsemantic Host fixtureとlegacy compile fixtureを一度ずつ固定する。tracking=`checked_no_finding`: functional 3 phase Greenとcleanup timeout heldを区別している。cleanup worker timeoutはproduction behaviorまたはrequired functional matrixの失敗ではなく、pre-freeze/full local equivalenceで再評価するheld concernとした。
- `T609-NR-007` — Medium — `open`。origin: 初回normal reviewのpublic API/compatibility finding。location: `src/ui/review-contexts/vscode-review-contexts-runtime.ts:247-252`、`src/ui/review-contexts/index.ts:2-10`、`src/t405-review-contexts-runtime.ts:152-163`、`Design/BreakingChanges.md`。description: `GitContextRevisionMappingResult.unresolvedReasonsByFileId`はoptional化され、consumer defaultと旧mapping shape fixtureも追加された。しかし同じclosure deltaがpublic barrelの`RegisteredReviewContextsRuntime`へrequired `getProjectionSnapshotForTest`を追加し、`RegisteredT405ReviewContextsRuntime`にもrequired test snapshot methodを追加している。impact: 旧interface shapeを実装するconsumer/mockはrequired method不足でsource compileが壊れ、公開互換性required actionが完了しない。evidence: mapping旧shape fixtureはmapping resultだけを構築し、public runtime interfaceの旧shapeを固定しない。`Design/BreakingChanges.md`はbaseから不変。production path=`checked_finding`: mapping diagnosticは互換化済みだがpublic runtime interfaceが非互換。actual composition=`not_applicable`: 型互換性はconsumer compile contractで判定する。focused evidence=`checked_finding`: provided 51/51は旧runtime shapeを含まない。gate wiring=`checked_finding`: runtime旧shape fixtureがない。tracking=`checked_finding`: 公開旧shape互換完了という記載はdelta全体のpublic interfaceを反映していない。required action: test snapshot methodをpublic runtime interface外のinternal/Test-only intersectionへ分離するかoptional化し、旧`RegisteredReviewContextsRuntime`実装shapeのcompile fixtureをgateへ追加する。breaking changeを選ぶ場合は承認と`Design/BreakingChanges.md`、consumer action、contract fixtureが必要である。

## 結果

- disposition: `T609-NR-004`と`T609-NR-006`はclosed。`T609-NR-007`はopen。closed済み`001`、`002`、`003`、`005`はそのまま維持した。
- normal verdict: `fail`。既存Medium finding `T609-NR-007`のrequired actionが未完了である。normal-path blockerは同finding、user-confirmation-required capability gapはなし。
- coverage: 対象3件のproduction path、actual composition、focused evidence、gate wiring、trackingをすべて処分した。`unexplored`はなし。reviewed HEADは`f88c7d8cfd4b8d265d098174aafd8d9cba76ce40`。

## リスク

- held: exact-head CI、full local equivalence、Markdown lint unsupported、最新Extension Host runnerのcleanup worker timeout。CIは待機していない。
- 次工程: `T609-NR-007`のpublic runtime interface互換だけを限定follow-upし、同じreviewerが同findingだけを再closureする。全7件closed後にpre-freeze/full local equivalenceへ進み、その後に別reviewerのindependent final reviewを実施できる。現時点では進めない。

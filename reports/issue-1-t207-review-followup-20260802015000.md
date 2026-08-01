# Sub-agent実行レポート

## タスク

- 目的: T207通常review findings `T207-R1-P1`〜`P3`を修正し、focused検証する。
- タスク種別: review follow-up implementation / verification

## sub-agentを使う理由

- 理由: `review-enforcer`のfollow-up手順に従い、ユーザー指定terra/high implementation workerへ一括修正を委譲する。

## 対象範囲

- 対象: VS Code準拠lineCountとGit text evidenceの分離、T207 acceptance assertion拡充、T207 testのCI集約接続、関連test/report。

## 対象外

- 対象外: Issue #28、T206以前、無関係なcleanup、commit、push、PR、merge、親所有tracking。

## 実行コマンド

- TDD Red: VS Code `TextDocument.lineCount`規約（empty=1、terminal EOLを終端空行として含む）へ戻したdescriptorでT207を実行し、commit mapping直後にfile stateが`undefined`となることを再現。`test:git`へのT207収録を要求するCI contract testも失敗した。
- TDD Red: P2拡張scenarioでfeatureのcopy/delete後にmainへ戻ると、contextのstable file IDとowner-wide Globalの逆mapping IDが衝突し、`persisted Git review state has conflicting file identities for the current path`でopenが失敗した。
- TDD Green: `npm run test:t207` 成功（1/1）。
- 集約: `npm run test:git` 成功（33 pass、3 Windows/POSIX fixture skip）。T207がaggregate temporary Git suiteに含まれることを確認。
- 関連focused: `npm run test:t205` 成功（31/31）、`npm run test:t206` 成功（25/25）。
- 必須検証: `npm run compile`、`npm run lint`、`npm run validate:architecture`、`git diff --check` はすべて成功。
- CI follow-up: CI run `30704154986`で`rejects full-text evidence whose line count disagrees with metadata`がMissing expected exceptionとなった。P1でlineCountの意味をVS Code規約へ変更した後も、旧physical count fixtureが残っていたためである。
- 追加TDD Red/Green: VS Code lineCount不一致を明示したunitが新validator実装前にMissing expected exceptionとなることを再現後、`test/unit/git-file-state-transition.test.ts`と`-r3.test.ts`を実行して44/44成功。terminal EOLとempty textの正しいVS Code/physical countも固定した。
- 追加検証: `npm run test:t207` 成功（1/1）。`npm run test:unit`は348件中327 pass、Windows Git ownership fixtureの既知19 fail（Issue #28 held）で終了し、P1 transition testの追加failは0。

## 対象ファイル

- `src/application/review-context/git-context-revision-mapper.ts`: persisted state用のVS Code行数と、Git full-text evidence用physical行数を分離して生成する。
- `src/core/git-diff/git-file-state-transition.ts`: `GitNewFileStateInput.physicalLineCount`を明示し、stateの`lineCount`をVS Code規約として固定する。
- `src/core/git-diff/validated-git-file-state-transition.ts`: physical full-text evidenceをstateのeditor行数と比較せず、physical metadataだけで検証する。
- `src/adapters/document-review-state/document-review-state-session-provider.ts`: current branch contextに同一pathのstable IDがある場合、それをowner-wide Globalの別IDより優先する。
- `test/integration/t207-git-history.integration.test.ts`: terminal EOL/no terminal EOL/empty、正確なrange mapping、branch復元、rename、copy非継承、delete、restart、JSONL payloadを1 scenarioで検証する。
- `package.json`、`test/unit/ci-workflow-contract.test.ts`: T207を`test:git`へ接続し、その収録をcontract test化する。
- `test/unit/git-file-state-transition.test.ts`、`test/unit/git-file-state-transition-r3.test.ts`: `newText`を供給するmetadataのlineCountをVS Code規約へ更新し、不一致拒否とterminal EOL/emptyの二重contractを固定する。

## 指摘事項

- `T207-R1-P1` high closure: state/editorはVS Code行数へ復帰し、physical Git evidenceを別metadataに分離。empty、terminal EOL、no terminal EOLをmapping直後のsame openとrestartで確認済みrangeとlineCountが維持されることを実証した。
- `T207-R1-P2` high closure: 変更行と未変更行をmarkしたfileがcommit後に`[0,1)`と`[2,3)`のみを維持する。main/featureの分離とmain復元、unique renameのstable ID/range、copyの新規unreviewed、delete後のcopyとmain restart復元をassertした。repository historyは一回だけ読み、remap/mark/rename/copy/delete eventについてcontextId、revisionId、filePath、previous/next ranges、reasonをdurable stateに対応する値で照合した。
- `T207-R1-P3` medium closure: `test:git`にT207 integrationを追加し、manifest収録をunit contract testで固定した。CIは既存Temporary Git integration stepから実行する。
- `T207-R1-P1` CI follow-up closure: `newText`が存在する場合はVS Code `lineCount`を必ず照合し、`physicalLineCount`が供給される場合はphysical Git line countも追加照合する。これによりphysical metadataがない場合もeditor/persisted line-count evidenceをskipできない。

## 結果

- 結果: findings `T207-R1-P1`、`T207-R1-P2`、`T207-R1-P3`はすべて修正済み。CI follow-upで判明したP1 unit regressionも修正済み。commit/push/PR/mergeは実行していない。新HEADのfull configured CIは親がpush後に確認する。

## リスク

- 未解決のリスクまたは後続対応: Issue #28はheldのまま修正していない。`test:unit`の残存19 failはすべて同じWindows Git ownership fixture起因であり、本P1のtransition contractとは分離している。修正後は同じ通常reviewerがfinding identity/severityを保持して確認し、その後reviewer 2/2の独立reviewを1回だけ行う。

# Issue #90 詳細診断・Global再計算stale cancellation 実装報告

## 概要

Issue #90では、PR Progressが進まない／遅い状況を調査しやすくするopt-in詳細診断、Global理解率再計算のstale cancellation、およびPR Progressが0件になる理由を特定できるfile単位diagnosticを追加した。PR Progress本体の性能アルゴリズムは変更していない。

## TDD

`test/unit/issue-90-diagnostics-and-cancellation.test.ts` を先に更新し、PR Progress zero-denominator診断helperが存在しないため `TS2307` で失敗するCI run `32949715317` を確認した。その後production実装を追加した。

## 実装内容

`reviewRange.diagnostics.detailed` は既定 `false`。ON時のみoperation ID、同時実行operation、reason、phase、target file/pathを出す。通常モードではfile/pathを出さない。

Global理解率は150msの予約済みrefreshを新しい即時refresh前にcancelし、running generationは既存AbortSignal / generation validationでstale publishを抑止する。

### PR Progressが0件になる理由の診断

詳細モードではPR Progress operation開始時にsnapshotとshared exclusion policyから各fileを分類し、file名付きで次を出力する。

- `missing-pr-snapshot`
- `no-pr-files`
- `pr-snapshot-loaded`
- `included`
- `excluded:binary`
- `excluded:default-glob`
- `excluded:user-glob`
- `zero-changed-lines`
- aggregate `zero-denominator` / `calculated`

file detailには `total`, `additions`, `deletions`、aggregateには `snapshotFiles`, `included`, `excluded`, `zeroFiles`, `reviewed`, `total` を含める。これにより「PR snapshotにfileがない」「全fileが除外された」「fileはあるがchanged lineが0」をOutputから区別できる。content取得へ進んだfileには従来の `read-content` とfile名も出る。

分類はPR Progressと同じsnapshot additions/deletionsおよびshared exclusion policyを使用し、診断用の別ルールは持たない。

## PR Progress遅延の原因調査

PR Progressはrepository全体ではなく選択PR snapshotのfilesのみが対象。ただしReview Contexts refresh / runtime registration待ち、各fileのimmutable BASE/HEAD content取得、reviewability計算に直列部分があるため、対象file数が少なくても遅くなり得る。今回性能アルゴリズムは変更していない。

### 再現可能なcode-path調査

1. Global全repository走査はPR Progressの集計対象ではないが、`src/t305-extension.ts:176-216` でopen documentを収集してGlobal sourceを構成し、`src/t305-extension.ts:281-302` から `await globalSource.recalculate(signal, publishProgress)` を呼ぶ。Current Context変更時は `src/t305-projection-refresh.ts:79-99` の順でReview Contextsを待機した後、decorations、Globalをawaitし、最後にPR Progress結果を処理する。したがってGlobal sourceのrepository-wide recalculationが同一refresh waveのcritical pathへ混入し得る。影響はCurrent Context切替直後の表示遅延であり、候補はGlobal refreshを独立queueへ分離してPR Progress開始を待たせないことである。
2. Review Contexts / Current Context / PR Progressには明示的なawait順がある。`src/t305-extension.ts:651-667` は `refreshCurrentContextDependents` を呼び、同helperは `src/t305-projection-refresh.ts:79-86` でReview Contexts refreshをawaitしてからPR Progressを開始する。PR Progress自身も `src/t305-projection-refresh.ts:56-63` で `activateProgress` の完了をawaitする。観測可能な影響は、runtime registrationまたはcontext取得が遅い間、PR Progressのtreeがinput取得前で待機すること。候補はregistration完了時点のdiagnosticを残し、将来の分離は別性能Issueで扱うこと。
3. hidden context / repository refresh / Git / GitHubの重複候補は、`src/t305-extension.ts:313-404` のrepository候補列挙とGit inspection、`src/t405-review-contexts-runtime.ts:796-904` のGitHub identityを用いるreview diff content取得、`src/t305-extension.ts:653-665` のdependent refreshにある。これらはCurrent Context変更の同一waveに並存し、同じrepositoryへ複数のGit/GitHub readが発生し得る。今回の観測では実機traceは未取得であるため重複回数は断定しない。影響範囲はcontext切替・hidden context選択・repository再検出であり、候補はrequest identityごとの共有とI/O traceである。
4. PR Progressのcontent readは `src/t405-pull-request-review-runtime.ts:55-75` がread開始前に `read-content` detailを出し、`await readTextContent(...args)` の後に初めてfile counterを進める。base runtimeは `src/t405-pull-request-review-runtime-base.ts:475-547` でgenerationを開始し、registrationのcontent readerは `src/t405-review-contexts-runtime.ts:896-904` から接続される。したがってread promiseが未解決ならcounterは0のままであり、PR #85で見えた「停止中に0件」の直接原因である。影響はslow Git/GitHub content I/O中の進捗表示であり、今回のdetail再publishで停止fileをtooltip/Outputへ観測可能にし、並列化は候補に留める。
5. PR snapshotに含まれないrepository fileをPR Progressが走査する証拠はない。`src/t405-pull-request-review-runtime.ts:101-145` はsnapshot keyと `snapshot.files` からdiagnosticFilesを作り、`src/t305-extension.ts:575-582` は選択contextだけを `activateProgress` へ渡す。このため遅延の影響範囲は選択PRのfile content、前提となるReview Contexts、同waveのGlobal/decoration refreshである。修正候補はIssue #90の範囲ではdiagnostic、cancellation、single-flightであり、bounded parallelism・cache・priorityは別Issueとする。

## CI failure artifact

失敗時workflowは `test-output`, `dist`, `test-dist`, `src`, `test`, `tools`, `type-fixtures`, package/tsconfig/eslint/workflow、およびcommand stdout/stderr/resultをartifact保存する。今回もRed確認とfailure調査に使用した。

## 検証履歴

- `d6e3adac...`: TDD Red。unit compileでdiagnostic module未実装を確認。
- `99c75f8c...`: exclusion union narrowing不足をBuildで検出。
- `17d7e463...`: Build/typecheck/architecture/lint Green後、test fixture shapeの型誤りをunit compileで検出。
- `9993b996...`: Build/typecheck/architecture/lint/unit/T304/T403-T406/T502-T506/T602-T606までGreenを確認。後続のreport-only commitでHEADが更新されたため、このrunは最終Green判定には使用しない。

最終Green判定はPR current HEADとworkflow run head SHAが一致するrunだけを使用する。別SHAのrunは代用しない。

## 残課題 / 次の候補

実機詳細ログで0件の分類結果とread-content停止点を取得した後、必要ならselected PR file contentのbounded parallelism、immutable content cache、Review Contexts待ちの分離、Global/PR間I/O priorityを別Issueで検討する。

## Merge

Mergeは実施していない。

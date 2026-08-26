# Issue #90 詳細診断・Global再計算stale cancellation 実装報告

## 概要

Issue #90では、PR Progressが進まない／遅い状況を調査しやすくするため、opt-inの詳細診断モードを追加した。また、Global理解率再計算が短時間に重複して走る経路を抑制し、古い予約済みrefreshを取り消すようにした。PR Progress本体の性能アルゴリズムは今回変更せず、原因調査までとした。

## TDD

先に `test/unit/issue-90-diagnostics-and-cancellation.test.ts` を追加し、以下が未実装で失敗することを確認してからproduction実装を追加した。

- `reviewRange.diagnostics.detailed` 設定
- 同時実行operationのidentityと内訳
- 詳細モード時のreason / target / phase
- superseded処理のcancellation terminal
- 予約済みGlobal refreshのcancel / flush

focused testは実装後にGreenとなり、CIのdefault unit suiteにも組み込まれている。

## 実装内容

### 詳細診断モード

`reviewRange.diagnostics.detailed` を追加した。既定値は `false` である。

ON時のみ以下をReview Range Outputおよびbusy tooltipへ出す。

- operation ID
- 同時実行中operationの一覧
- reason
- phase
- target file/path
- PR Progressのfile単位read-content進捗

通常モードでは既存のprivacy-safeなログ形式を維持し、file/pathを出力しない。

### Global理解率再計算

Global refresh requestをcoalescer経由にし、150msの予約済みrefreshが存在する状態で即時refreshへ移る場合、その予約をcancelしてから最新requestを実行するようにした。

既存のgeneration invalidation / AbortSignalによるstale workの抑制と組み合わせ、古い処理が新しい結果をpublishしない境界を維持した。

### PR Progress診断

PR Progressは選択されたPR snapshotの `files` のみを対象にしている。repository全ファイルをProgress計算対象にしているわけではない。

ただし実装経路では以下の待ちが存在する。

1. Review Contexts refresh / selected PR runtime registrationを待つ。
2. 選択PRの各fileについてimmutable BASE/HEAD contentを取得する。
3. full text / reviewability evidenceを使ってeffective progressを計算する。
4. file processingは現在の経路では直列部分がある。

したがって、PR対象file数が少なくても、前段のReview Contexts取得やimmutable content I/Oが遅い場合はPR Progress表示開始・完了が遅くなる。Global理解率再計算が同時に走る場合は追加でI/O/CPU競合が起こり得る。

今回の変更ではPR Progress計算方式の並列化・cache戦略変更は行っていない。詳細モードにより、どのfileのread-contentで止まっているかを観測できるようにした。

## CI失敗調査

作業開始時にCI failure diagnostics workflowを確認し、失敗時artifactへ以下が保存されることを確認したためworkflow追加は不要だった。

- `test-output/`
- `dist/`
- `test-dist/`
- `src/`
- `test/`
- `tools/`
- `type-fixtures/`
- package / tsconfig / eslint / workflow files
- commandごとのstdout / stderr / result metadata

途中のT610 failureでは、詳細診断hostが簡易VS Code mockに存在しない `workspace.onDid*TextDocument` および `workspace.getConfiguration` を必須扱いしていたことが原因だった。これらをoptionalに扱い、設定APIがないtest hostでは詳細診断OFFへフォールバックするよう修正した。本番VS Codeでは通常のAPIを使用する。

## 検証

実装コードHEAD `99dfdd66bd74382a5704b304a525c9a69753b2ef` に一致するCI run `32945935114` はsuccess。

確認対象はPRのcurrent HEAD SHAとrunのhead SHAが一致するrunのみとし、別SHAのrunはGreen判定へ使用していない。

主なGreen項目:

- Build
- Contract typecheck
- Architecture validation / negative contract
- Lint
- Unit tests
- T304
- T403–T406
- T502–T506
- T602–T606
- T609
- T610

## 残課題 / 次の候補

PR Progressの体感速度を改善する場合は、今回の詳細ログで実機ボトルネックを確認したうえで、次を別Issueとして検討できる。

- selected PR file content取得の安全な並列化
- immutable BASE/HEAD content cacheの利用範囲拡大
- Review Contexts取得完了を待つ必要がある部分とPR Progress開始可能な部分の分離
- Global再計算とPR ProgressのI/O scheduling優先度

また、ChatGPT workerが成功CIのexact HEAD sourceを取得しやすくするため、成功時にもsource一式をartifact化する改善は別途検討価値がある。

## Merge

Mergeは実施していない。

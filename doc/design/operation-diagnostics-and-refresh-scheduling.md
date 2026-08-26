# Operation diagnostics / refresh scheduling 設計

## 1. 目的

Review Rangeの長時間処理について、通常利用時のprivacy-safeな表示を維持しながら、必要時だけ「なぜ処理が始まったか」「どのfileを処理中か」「同時に何が動いているか」を観測できるようにする。

また、Global理解率再計算について、すでに新しい再計算要求が発生した場合に古い予約済み処理を開始せず、実行中の旧generationが新しい結果をpublishしない境界を明確にする。

この設計はIssue #90で導入したoperation feedback / Global refresh schedulingを対象とする。PR Progressの性能アルゴリズム変更は含まない。

## 2. 設計原則

### 2.1 詳細診断はopt-in

設定 `reviewRange.diagnostics.detailed` の既定値は `false` とする。通常モードではrepository pathやfile名をdiagnosticへ追加しない。詳細モードでは調査目的としてoperation ID、label、reason、phase、target file/path、同時実行operation一覧を表示してよい。

### 2.2 operation identity

同時実行operationへ一意なIDを与える。詳細モードでは「4件の処理」の内訳として各operationのID、label、phase、targetをtooltipへ列挙する。operation終了時は開始時と同じIDへterminal logを記録する。

### 2.3 cancellationはfailureと分離

supersededされた処理はcancelledとして記録し、通常の障害diagnosticと混同しない。

## 3. 詳細診断情報の生成

### 3.1 Global refresh trigger

詳細診断ON時だけGlobal再計算の実際のtriggerをoperation開始detailとして渡す。document eventは `document-opened` / `document-changed` / `document-saved` / `document-closed` とfilesystem-backed target pathを含め、review-state、exclude/configuration、manual command、folder entryは固定reasonと利用可能なtargetを含める。開始detailは同じoperation IDのOutput lifecycleへ `DETAIL` として記録する。test hostでevent/configuration APIがない場合は診断だけを無効化する。

### 3.2 PR Progress file phase

PR Progressでは対象PR snapshotの各fileについてcontent取得phaseを識別する。

```text
#17 PR Progress [read-content] — src/example.ts
```

### 3.3 PR Progressが0件になる理由

詳細診断ON時は、PR Progress計算開始時にdenominator形成前の入力をfile単位で記録する。file名を出してよいのは詳細モードだけとする。

最低限、次を出力する。

- `missing-pr-snapshot`: 選択contextにPR snapshotがない
- `no-pr-files`: snapshot自体のchanged file数が0
- `pr-snapshot-loaded`: snapshotのfile数
- `included`: denominatorへ含まれるfile。`additions` / `deletions` / `total`を併記
- `excluded:binary`: binaryのため除外
- `excluded:default-glob`: 既定globで除外
- `excluded:user-glob`: user設定globで除外
- `zero-changed-lines`: fileは含まれるがadditions + deletionsが0
- `zero-denominator`: 全file分類後の有効denominatorが0
- `calculated`: 有効denominatorが1以上

aggregate summaryには `snapshotFiles`, `included`, `excluded`, `zeroFiles`, `reviewed`, `total` を出す。これにより「PR fileを取得できていない」「全fileが除外された」「fileはあるがchanged lineが0」のどこで0件になったかをOutputだけで区別できる。

分類diagnosticは実際のshared exclusion policyとsnapshotのadditions/deletionsを使い、PR Progressのdenominator contractと同じ入力から生成する。計算アルゴリズム自体は変更しない。

## 4. Global理解率再計算のcoalescing

### 4.1 予約済みrefresh

document change等から発生する短時間の連続refresh要求は150ms debounceする。予約済みrefreshはまだ開始していないpending workとして扱う。

### 4.2 即時refreshとの競合

より新しい即時refreshが必要になった場合は、予約済みtimerをcancelし、pending requestを最新reason / targetへ更新し、最新requestだけをflushする。

### 4.3 実行中refreshのstale判定

新しいeffective input identityのrefresh generationが開始された場合、旧generationはsupersededとみなす。pending timerはcoalescerがcancelし、running generationはAbortSignal / generation validationでstale結果を抑止し、feedback lifecycleには非errorの `CANCEL` terminalを残す。同じeffective input identityのrunning requestはsingle-flightで共有し、3件以上の連続requestでも再起動しない。

## 5. PR Progressの処理境界

PR Progressの集計対象はrepository全体ではなく、選択されたPR snapshotに含まれるfileだけである。ただし表示までには、Review Contexts refresh / runtime registration、file一覧確定、immutable BASE/HEAD content取得、reviewability/effective progress計算、tree/status更新がある。

対象file数が少なくても前段のReview Contexts取得またはrevision content I/Oが遅い場合は表示が遅くなる。Issue #90では観測可能にするところまでとし、並列化、cache戦略、priority schedulingは変更しない。

## 6. 今後の性能改善候補

- selected PR file content取得のbounded parallelism
- immutable BASE/HEAD content cacheの再利用範囲
- Review Contexts完了待ちとPR Progress開始条件の分離
- Global理解率再計算とPR Progress間のI/O scheduling / priority

## 7. 検証contract

- 詳細診断設定が既定OFF
- 詳細ON時のみreason / target / operation identityを出す
- superseded operationを詳細設定にかかわらずcancelledとして扱い、user error notificationを出さない
- 予約済みGlobal refreshをcancel / flushできる
- 同一effective inputのrunning Global refreshを共有し、異なるinputだけをsupersedeする
- detail変更中にもbusy statusを再publishし、tooltipへreason / phase / targetを出す
- VS Code簡易mockに診断APIがなくてもextension本体が動作する
- PR Progressのexcluded fileとzero changed-line fileをfile名付きで区別する
- aggregate denominatorが0の場合に`zero-denominator`と内訳を出す

## 8. 関連文書

- `doc/design/vscode-review-range-tracker-design.md`
- `reports/2026-08-26-issue-90-diagnostics-global-cancellation.md`
- Issue #90
- PR #91

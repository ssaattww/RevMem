# Operation diagnostics / refresh scheduling 設計

## 1. 目的

Review Rangeの長時間処理について、通常利用時のprivacy-safeな表示を維持しながら、必要時だけ「なぜ処理が始まったか」「どのfileを処理中か」「同時に何が動いているか」を観測できるようにする。

また、Global理解率再計算について、すでに新しい再計算要求が発生した場合に古い予約済み処理を開始せず、実行中の旧generationが新しい結果をpublishしない境界を明確にする。

この設計はIssue #90で導入したoperation feedback / Global refresh schedulingを対象とする。PR Progressの性能アルゴリズム変更は含まない。

## 2. 設計原則

### 2.1 詳細診断はopt-in

設定 `reviewRange.diagnostics.detailed` の既定値は `false` とする。

通常モードでは、既存のoperation label、件数、進捗等だけを表示し、repository pathやfile名をdiagnosticへ追加しない。

詳細モードでは、調査目的としてfile/pathを表示してよい。詳細モードで追加する情報は次とする。

- operation ID
- operation label
- reason
- phase
- target file/path
- 同時実行中operationの一覧

### 2.2 operation identity

同時実行operationを単なるactive countとして扱わず、各operationへ一意なIDを与える。

busy表示はactive countとoperation activityの両方を保持し、詳細モードでは「4件の処理」の4件が何か分かるよう、各operationのID、label、phase、targetをtooltipへ列挙する。

operation終了時は、そのoperation自身のIDに対してterminal logを記録する。別operationが後から開始しても終了logのidentityを取り違えない。

### 2.3 cancellationはfailureと分離

新しい要求によって旧処理が不要になった場合、それをfailureとして扱わない。

terminal stateは少なくともsuccess / failure / cancelledを区別する。supersededされた処理はcancelledとして記録し、通常の障害diagnosticと混同しない。

## 3. 詳細診断情報の生成

### 3.1 Global refresh trigger

VS Code UI adapterは詳細診断ON時だけdocument eventから次のtrigger reasonを保持できる。

- `document-opened`
- `document-changed`
- `document-saved`
- `document-closed`

対象はfilesystem-backed document (`file` / `vscode-remote`) とする。

次のGlobal理解率再計算operation開始時に、保持したreasonとtarget pathをoperation start detailとして消費する。保持値は1回消費したら破棄する。

VS Code APIを限定実装するtest hostでは、event APIやconfiguration APIが存在しない場合がある。その場合は診断機能だけを無効化し、extension本体を失敗させない。

### 3.2 PR Progress file phase

PR Progressの詳細診断では、対象PR snapshotの各fileについて少なくともcontent取得phaseを識別できるようにする。

例:

```text
#17 PR Progress [read-content] — src/example.ts
```

これにより、PR Progress全体が止まっているのか、特定fileのimmutable BASE/HEAD content取得で待っているのかを区別できる。

## 4. Global理解率再計算のcoalescing

### 4.1 予約済みrefresh

document change等から発生する短時間の連続refresh要求はdebounceしてよい。現在の予約待ち時間は150msである。

予約済みrefreshは「実行中」ではなく、まだ開始していないpending workとして扱う。

### 4.2 即時refreshとの競合

予約済みrefreshが存在する状態で、より新しい状態を反映する即時refreshが必要になった場合は次の順序とする。

1. 予約済みtimerをcancelする。
2. pending requestを最新reason / targetへ更新する。
3. 最新requestだけをflushしてrefreshを開始する。

古いtimerを残したまま即時refreshを開始してはならない。そうすると、即時refresh後に古いtimerが発火して同一編集由来の再計算が重複するためである。

### 4.3 実行中refreshのstale判定

実行開始後のGlobal refreshはgeneration / AbortSignal境界に従う。

新しいrefresh generationが開始された場合、旧generationはsupersededとみなす。旧generationは可能な境界で処理を打ち切り、少なくとも最終結果をpublishしてはならない。

予約済みworkのcancelと実行中workのAbortは別の責務である。

- pending timer: coalescerがcancel
- running generation: AbortSignal / generation validationがstale結果を抑止

## 5. PR Progressの処理境界

PR Progressの集計対象はrepository全体ではなく、選択されたPR snapshotに含まれるfileだけである。

ただし、UI上のPR Progress更新までには次の処理経路が存在する。

1. Review Contexts refresh / selected PR runtime registration
2. 選択PR file一覧の確定
3. 各fileのimmutable BASE / HEAD content取得
4. full text / reviewability evidenceに基づくeffective progress計算
5. tree / status表示更新

したがって、対象file数が少なくても前段のReview Contexts取得または各fileのrevision content I/Oが遅い場合は、PR Progress表示が遅くなる。

Issue #90ではこの経路を観測可能にするところまでとし、並列化、cache戦略、priority schedulingは変更しない。

## 6. 今後の性能改善候補

実機の詳細diagnosticでボトルネックを特定してから、別Issueで次を検討する。

- selected PR file content取得のbounded parallelism
- immutable BASE/HEAD content cacheの再利用範囲
- Review Contexts完了待ちとPR Progress開始条件の分離
- Global理解率再計算とPR Progress間のI/O scheduling / priority

性能改善を行う場合も、revision identity、repository path semantics、failure isolation、stale generation抑止の既存contractを崩してはならない。

## 7. 検証contract

最低限、次を自動testで固定する。

- 詳細診断設定が既定OFF
- 詳細ON時のみreason / target / operation identityを出す
- 同時operation終了順に依存せず正しいIDでterminal logを出す
- superseded operationをcancelledとして扱う
- 予約済みGlobal refreshをcancel / flushできる
- 別Global refresh開始後に古い予約済みrefreshを発火させない
- VS Code簡易mockに診断APIがなくてもextension本体が動作する

## 8. 関連文書

- `doc/design/vscode-review-range-tracker-design.md`
- `reports/2026-08-26-issue-90-diagnostics-global-cancellation.md`
- Issue #90
- PR #91

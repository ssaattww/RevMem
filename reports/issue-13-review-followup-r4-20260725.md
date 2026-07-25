# Issue #13 R4レビュー指摘対応レポート

## 対象

- Issue: #13 ワークスペース外のファイル対応
- Pull Request: #15
- Branch: `issue/13-document-context-routing`
- 指摘元: `reports/issue-13-review-r4-20260725131815.md`
- 対応対象: blocking finding 2件
- 基準設計修正: `doc/design/issue-13-document-context-routing.md` 7.2、7.4、7.5、9、10
- 詳細設計追補: `doc/design/issue-13-owner-reconciliation-r4.md`

## 指摘1: 対象file state不在時に空baselineを記録しない

### 問題

workspace contextは複数fileで共有される。別fileによって古いworkspace contextが存在し、対象fileのcontext・Global stateがまだ存在しない場合、従来実装はsourceを処理せずreturnしていた。

その後Git unavailable中に対象fileへ新しい確認済み範囲を作成しても、workspace contextの`createdAt`がGit fileより古いため初回追加と判定できず、Git復旧時に追加範囲を失う可能性があった。

### TDD

`test/unit/issue-13-atomic-reconciliation-review.test.ts`へ次を先行追加した。

- 別fileでworkspace contextを事前作成する
- 対象file state不在のままGit ownerを開き、空baselineが記録される
- Git unavailable中に対象fileへ範囲を追加する
- Git復旧時に追加範囲が反映される
- その後の解除と再追加も安定して差分反映される

### 修正

- lower owner contextが存在する場合、対象file state不在を確実な空集合として扱う
- `reviewed: []`を含むsource snapshotをbaselineとして記録する
- source context自体が存在しない場合はbaselineを推測作成しない
- 空baseline後の追加・解除・再追加を通常のsnapshot deltaとして扱う

## 指摘2: 初回昇格とbaseline記録が複数commitになる

### 問題

base providerがlower ownerのintervalを先にcommitし、reconciliation wrapperがbaselineを別commitしていた。Git ownerでworkspaceとexternal-fileの両sourceを処理する場合はsourceごとにもcommitしていた。

この構造では、途中失敗時にintervalだけ、baselineだけ、または一部sourceだけが反映された中間状態が残り得た。

### TDD

同じtest fileへ次を先行追加した。

- 初回workspace→Git昇格で実repositoryのCAS commit回数が1回
- commit失敗時にGit ownerへ昇格intervalもbaselineも残らない
- workspaceとexternal-fileの両sourceが存在しても実CAS commit回数が1回
- 全sourceのintervalとbaselineが同じ最終snapshotに含まれる

### 修正

- `CapturingDocumentReviewStateRepository`を追加した
- base providerの初回昇格transactionを実repositoryへ公開せず、メモリに捕捉する
- owner初期化とstale state sanitizationの`load`・`save`は従来どおり実repositoryへ委譲する
- workspace sourceとexternal-file sourceをread-onlyで読み込む
- 各sourceのdeltaと次baselineをメモリ上のplanned context・Global snapshotへ順次適用する
- 捕捉した初回transactionの`expected`を維持し、全deltaと全baselineを含む`next`を実repositoryへ1回だけCAS commitする
- final commit成功後だけ上位owner sessionを返す

## 設計書修正

基準設計追補`doc/design/issue-13-document-context-routing.md`を次のように修正した。

- lower owner contextが存在して対象file stateがない場合を、確実な空集合としてbaseline化する
- lower owner context自体が存在しない場合はbaselineを作らない
- 全移行元候補を読み込んでからnext snapshotを計算する
- base routerの初回昇格transactionを永続化前に捕捉する
- 初回昇格範囲、全source delta、全baselineを同じnext snapshotへ集約する
- reconciliationの実CAS commitは1回だけとする
- commit失敗時は範囲だけ、baselineだけ、一部sourceだけを残さない

詳細な処理境界とテスト条件は`doc/design/issue-13-owner-reconciliation-r4.md`にも記録した。

## TDD Red

### 挙動Red

- head: `ccac3a6b1c133d6cc9ab05c77cd7f9dc20769c9e`
- workflow run: `30144211855`
- Build: success
- Lint: success
- Unit tests: failure
- 主な失敗:
  - 空baselineが記録されない
  - 初回昇格の実commit回数が2回
  - workspaceとexternal-fileの実commit回数が3回
- failure artifact: `ci-failure-diagnostics-30144211855-1`

### 型境界Red

- head: `82c444543c3c0a0737595e76f8b6fb5f5260b785`
- workflow run: `30144381827`
- Build: failure
- 原因: `planCertainSource`のmethod境界で`source.owner`のnon-Git絞り込みが保持されていなかった
- failure artifact: `ci-failure-diagnostics-30144381827-1`
- artifact ID: `8615502603`

型境界はmethod内部でもGit sourceを明示的に除外し、実行時契約とTypeScript型を一致させた。

## コードGreen

- code head: `365e8a1f76cf92a12c193c7d02bdeab06810911c`
- workflow run: `30144514053`
- Install dependencies: success
- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

## PR最終Green

- final head: `b731d85f78ba173b5d3dc61ca94384c34d7d9095`
- workflow run: `30144682569`
- Install dependencies: success
- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

同repositoryの別branchや他作業者のrunではなく、各head SHAに紐づくrunだけを検証に使用した。

## Scope確認

R4レビューheadからの製品・test差分は、Issue #13のreconciliation実装、R4回帰test、test runner登録に限定した。

変更していない範囲:

- `tasks/tasks-status.md`
- T300のpolicy、runtime、設定、test
- PR #22のreportと`test/unit/release-vsix-contract.test.ts`
- その他のマージ済み`main`由来ファイル

branchは`main`に対してbehind 0である。

## 独立再レビュー

確認観点:

- lower owner context存在時の対象file不在が空baselineになること
- lower owner context自体が存在しない場合はbaselineを推測しないこと
- 初回昇格intervalとbaselineが同じCAS `next`に含まれること
- 複数sourceのdeltaとbaselineが1つのplanned snapshotに集約されること
- final CASの`expected`がbase providerの初回昇格前snapshotであること
- final CAS失敗時に昇格interval・baseline・一部sourceが残らないこと
- source read後の並行target更新をCASが検出できること
- decoration loadが非変更処理のままであること
- R2・R3で修正済みのHEAD分類、baseline metadata更新、test runner登録を壊していないこと
- 基準設計書とR4詳細設計追補が実装・testと一致すること

判定:

- blocking finding: なし
- non-blocking finding: なし
- merge: 実施しない。ユーザーが行う。

# T104 実装レポート

## タスク

- 対象: T104 共通状態repositoryとatomic persistence
- 関連Issue: #1
- Pull Request: #6
- ブランチ: `task/t104-state-repository`

## Test-Driven Development

### Red

- 実装前に`test/unit/state-repository.test.ts`を追加した
- Git/PRと非Git workspaceの保存先分離、manifest、context/Global state、再読み込み、atomic replace、保存失敗時の状態維持、schema mismatchを先に定義した
- Actions run `29980087663`でunit testが失敗することを確認した
- 失敗理由は未実装の`src/adapters/state-repository`を解決できない`TS2307`だった
- 失敗時診断artifact `ci-failure-diagnostics-29980087663-1`が生成された
- artifact IDは`8552860223`で、ログ、環境情報、生成物、`src`、`test`、設定ファイルを含む

### Green移行

- run `29980289967`は本体compileでNode型が未指定だったためBuildで失敗した
- 既存の`@types/node`と`@types/vscode`を本体`tsconfig.json`へ明示した
- run `29980375859`はunit test 29件中27件成功し、2件が失敗した
- 失敗はrepository-wide Globalの最新値を旧contextで期待していなかったことと、schema mismatch fixtureの親ディレクトリ未作成だった
- Globalの期待値をrepository-wide stateとして補正し、fixtureをatomic file store経由で作成した
- run `29980491372`でBuild、Lint、Unit、Git/GitHub integration、Extension Hostが成功した

### Review follow-up Red/Green

- 専用差分レビューで、別context保存後に`getCurrent`が旧Globalを返すメモリ整合性不具合を検出した
- `test/unit/state-repository-memory.test.ts`へ回帰テストを先行追加した
- repository rootごとに最新Globalを共有するpublic repository facadeを追加した
- T102で確定した完全snapshot CAS契約への接続漏れを検出した
- `ReviewStateTransactionLike`、`commit`、`StaleReviewStateError`を追加し、expected context/Globalと永続状態が一致する場合だけnextを保存するようにした
- stale拒否時にdiskとmemoryを変更せず、`commit`失敗通知を返すテストを追加した
- 複数window間の排他lockと競合window閉鎖は計画どおりT604の責務として維持した

### Branch/PR test入口とmain追従

- T104作業中にT102とT103が順次`main`へmergeされた
- T104テストを既存`core-contracts.test.ts`からimportし、T102/T103が管理する`package.json`のunit入口と競合しない構成にした
- branch単体ではT104テストが実行され、PR mergeではT102、T103、T104のunit testが同じsuiteで実行される
- GitHub Git Data APIをコネクタ経由で使用し、最新`main`を第一親、T104の細かなコミット列を第二親とする解決済みmerge commitを作成した
- `main...task/t104-state-repository`はahead、behind 0となり、PRはmergeableへ復帰した
- T103のworkspace identity実装、設計追記、package test入口、進捗記録を基底treeから保持した

### 最終実装Green

- Actions run `29982939677`
- 対象head: `efdd6c411a0e75ab149e0409dbabf8f57a6a3c8d`
- Install dependencies: success
- Build: success
- Lint: success
- Unit tests: success
- Temporary Git integration tests: success
- Mock GitHub integration tests: success
- VS Code Extension Host tests: success

## 実装内容

### 共通routing contract

- Git repositoryとGitHub PRは`globalStorageUri/repositories/<repository-id-sha256>`へ保存する
- 非Git workspaceは`storageUri`へ保存する
- state、history、snapshot、cache、lockが同じ`ReviewStateStorageRoute`を利用する
- 非Gitで`storageUri`がない場合は明示的に拒否する

### Repository state

- Git/PRではimmutableなcontext documentとGlobal documentを先に保存する
- `manifest.json`を最後にatomic replaceし、manifestをcommit pointとする
- manifestは複数context referenceと現在Global referenceを保持する
- あるcontextを更新しても他context referenceを維持する
- 非Gitではcontext/Globalを`workspace-state.json`の単一documentとしてatomic replaceする

### Atomic file store

- 対象directoryを作成する
- 同一directoryの一時fileを排他的に作成する
- UTF-8内容を書き込む
- file handleを`sync`して閉じる
- 一時fileを対象fileへrenameする
- 失敗時はhandleを閉じ、一時fileを削除して例外を伝播する

### Schema・validation

- manifest、context、Global、commitの`schemaVersion`を現在versionと比較する
- repository ID、context ID、context kindをtargetと照合する
- manifest referenceの絶対pathとstorage root外escapeを拒否する
- JSON破損、参照file欠落、schema mismatchをload失敗として通知する

### Memory確定と通知

- save/commit成功後だけin-memory stateを更新する
- context別stateとrepository-wide Globalを分けて保持し、全contextへ最新Globalを返す
- load/save/commit失敗をVS Code API非依存のnotification contractへ渡す
- notifier自体の失敗は元のpersistence errorを隠さない

### T102 transaction接続

- T102 `ReviewStateTransaction`が構造的に代入可能なsubset contractを定義した
- complete expected context/Globalをdisk上の現在値とdeep compareする
- expectedが古い場合は`StaleReviewStateError`を返す
- stale時はnext document、manifest、memoryを変更しない
- next context/Globalは同じmanifest commit pointで確定する

## 単体テスト

- Git/PRとworkspaceのrouting分離
- history、snapshot、cache、lock route
- workspaceで`storageUri`欠落時の拒否
- manifest-last保存とcontext/Global再読み込み一致
- 複数context reference維持
- repository-wide Global更新
- workspace-state保存とglobalStorage非使用
- manifest/workspace replace失敗時のdisk・memory維持
- load schema mismatchと通知
- target identity不一致をwrite前に拒否
- atomic replace後に一時fileが残らないこと
- context間のGlobal memory同期
- expected一致時のtransaction commit
- stale transaction拒否とdisk・memory不変

## 対象外

- JSON Lines history追記: T206
- GitHub metadata/diff cache: T403
- 複数VS Code windowのexclusive file lockと期限切れlock: T604
- snapshot内容と差分追従: T601
- schema migration chainとbackup: T603

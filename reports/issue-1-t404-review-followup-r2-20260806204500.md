# T404 再fix verification 指摘対応レポート

## 対象

- PR: #48
- 指摘: T404-R003 / R004 / R006 / R008
- 実装HEAD: `26496b4e755b6e505f75616e8ea723a8da82a7d9`
- exact-head CI: run `31097756847` / success

## 対応

### T404-R003

revision mapperの戻り値をContext単体からContext/Global complete commitへ変更した。mapper後はContextのbase/head、GlobalのrepositoryId、Global currentRevisionIdが新headと一致することを検証し、旧revision Globalはcommit前にrejectする。

### T404-R004

T202/T401が生成するcanonical repositoryIdをcontext ID生成の入力として扱う`createGitHubPullRequestContextIdFromRepositoryId`を追加した。create/load/update境界でidentity、repositoryId、contextIdの一致を検証する。

### T404-R006

PR descriptorにoptionalな`decorationEnabled` override contractを定義した。未指定時はopenのみ有効、closed/mergedは無効とし、明示true/falseは状態とともにReviewContextStateへ保存・復元する。

### T404-R008

T404 testを標準unit suiteとCI focused stepで実行し、次を追加した。

- 実FileSystemReviewStateRepositoryへのcreate
- repository再生成後のrestart load
- stale full-snapshot CAS rejection
- Context/Global同時revision mapping
- canonical create boundary
- closed defaultとexplicit overrideのround-trip

既存unit suiteのReview State Service testsで、commit成功後のみhistoryを記録し、commit failure時にhistoryを記録しない契約も同一CIで回帰確認した。

## TDD / failure evidence

- Red実装・テスト追加後のrun `31097599124` は実filesystem testのcommit envelope期待値誤りでfailure。
- failure artifact: `8966095298`
- テスト期待値のみを修正し、production contractを変更せずrun `31097756847` がsuccess。

## 境界

- T405 UIは未実装。
- cross-process lockはT604。
- mergeは実施していない。

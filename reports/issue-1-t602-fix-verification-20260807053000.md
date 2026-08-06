# T602 修正確認レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: #49
- Review mode: fix verification
- Reviewer continuity: 前回のnormal reviewerと同一ChatGPT chat
- Base: `main` (`112198c33823a5fc6681399a19e0c5361614143f`)
- Previous reviewed implementation HEAD: `d1a2b5ffd69ca5154a426072c63942cfb3b177a6`
- Reviewed implementation HEAD: `0108703fa9e7ab3e2aa8d8ef32e2288a4de155fe`
- Fix range: `d1a2b5ffd69ca5154a426072c63942cfb3b177a6..0108703fa9e7ab3e2aa8d8ef32e2288a4de155fe`
- Verdict: **fail**
- Merge performed: No

本修正確認では、ZIP内の `chat-review-worker`、`work-context-manager`、`review-worker`、`report-writer`、`chat-handoff-manager` を再確認し、前回findingのidentityとseverityを維持して、修正差分、直接影響、同一欠陥クラスのsibling case、新規変更箇所を確認した。

## 対象差分

前回reviewed HEADから、実装・テストとして次を確認した。

- `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`
- `src/adapters/local-git/history-rewrite-local-git-adapter.ts`
- `src/application/history-rewrite-recovery/adapters.ts`
- `src/application/history-rewrite-recovery/git-context-recovery.ts`
- `src/application/history-rewrite-recovery/index.ts`
- `src/application/review-context/history-rewrite-git-context-revision-mapper.ts`
- `test/unit/history-rewrite-recovery-conservative.test.ts`
- `test/unit/history-rewrite-review-findings.test.ts`
- `test/unit/local-git-tree-list.test.ts`
- follow-up reportおよびPR本文

## CI

Reviewed implementation HEAD `0108703fa9e7ab3e2aa8d8ef32e2288a4de155fe` に一致するpull-request workflow runは存在しない。

したがって、次の最終検証は**未実施**として扱う。

- build
- public contract typecheck
- architecture validation
- lint
- unit tests
- T602 focused tests
- Git/GitHub integration tests
- VS Code Extension Host tests

別SHAのrunは代用していない。

## Finding dispositions

### T602-R001 — high — addressed

永続commit前のsnapshot invalidationは削除され、delegate commit成功後にsnapshotを置換するよう変更された。post-commit snapshot失敗は両pointerをinvalidateし、永続commit成功を呼出側へ失敗として返さない。旧状態のcommit失敗時に旧snapshotを先に失う問題は解消した。

ただし同じsnapshot世代競合クラスの残存問題は `T602-R010` として継続する。

### T602-R003 — medium — partial

PR本文とfollow-up reportは現在HEAD `0108703f...` および「HEAD一致CIなし」を正しく記載するよう修正された。一方、current implementationをtransportする更新済みhandoffは追加されておらず、`reports/issue-1-t602-handoff-20260806195139.yaml` は古いtarget identityのままである。

Required action:

- 修正完了時点のimplementation HEAD、commit range、finding dispositions、HEAD一致CIを含む新しいimplementation handoffを保存する。
- CIがない現時点では成功証跡を記載しない。

### T602-R004 — high — addressed

`rev-parse`はexit 1だけをmissingとして返し、exit 128を含む他の非0終了は`GitCommandFailedError`となる。unexpected object IDもfatalとして扱う。回帰testが追加された。

### T602-R005 — high — addressed

current tree列挙失敗を空候補へ変換せず、current revision消失を例外とした。catalog読取も`missing-file`だけを不存在として許容し、`missing-revision`、`invalid-encoding`、例外を不完全証拠として停止する。

### T602-R006 — high — addressed

snapshot mapping後の`reviewedRanges.length`をidentity候補数として扱う処理は削除された。same-path以外の回復では、旧content hashとline countによるunique exact-content candidateが別途必要になった。

### T602-R007 — high — addressed

ContextとGlobalで共通するfile IDについて、両側に存在し同じdestination pathへ回復した場合だけ保持する。片側欠落またはpath不一致は両側から除去しunresolvedにする。

### T602-R008 — high — addressed

latest snapshotをrestoreし、`workspaceContextId`と`fileId`が期待値に一致するsnapshotだけをmappingへ渡すようになった。

### T602-R009 — high — addressed

1回のmap内で`objectExists`のPromiseをrepository root/object ID単位でcacheし、availability precheckとdirect mapperが同じ観測結果を共有する。

### T602-R010 — high — **not addressed**

- Origin: introduced_by_fix
- Location: `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`, `open`, `enqueueSnapshotCommit`
- Description: commit経路だけが`snapshotCommitQueue`へ入る一方、`open()`直後の`replaceSnapshots(...)`はqueue外で実行される。複数openとcommitが並行した場合、古い状態を読み込んだopenのsnapshot保存が、新しい永続commit後に発行されたlatest pointerより後に完了できる。
- Impact: 永続状態は新しい解除・確認状態なのに、latest snapshotだけが古い状態へ巻き戻る。次のrebase/force-push recoveryで、解除済み範囲を再び確認済みとして復元し得る。
- Evidence: `open()`は`await this.replaceSnapshots(...)`を直接呼び、queueを使用しない。queueは返却sessionの`committer.commit`だけを包む。open publicationとcommit publicationの順序を検証するtestは追加されていない。
- Required action: 初回/open時のsnapshot publicationも同じscope/fileの順序制御へ含める。単一provider全体queueだけでなく、少なくとも同一snapshot coordinatesについて、永続状態の世代またはexpected stateを確認して古いpublicationが新しいpublicationを上書きしないようにする。遅延open publicationと新commit publicationを逆順完了させる回帰testを追加する。

### T602-R011 — high — **partial**

- Origin: introduced_by_fix
- Location: `src/application/history-rewrite-recovery/adapters.ts`, `containsCopyFrom`
- Description: copy拒否はraw diff lineが完全に ``copy from ${oldPath}`` と一致する場合だけ働く。Gitが空白、tab、引用符、非ASCIIなどを含むpathをquoted metadataとして出力すると、`copy from "..."`は一致せず、後続のdiff parserはdecode済み`oldPath`を返すためcopy sectionが通常の1候補として処理される。
- Impact: quoted pathのcopyでstable file identityと確認済み範囲をcopy先へ移送でき、T204/T602の「copyは新規未確認」要件に反する。
- Evidence: 追加testはunquoted `src/a.ts`だけである。`containsCopyFrom`は既存のcanonical Git path decoderを使用せず、raw string equalityだけで判定する。
- Required action: sectionを構造的に解析し、quoted/unquotedを問わず`copy from`/`copy to` metadataの存在を判定してrejectする。space、tab、引用符、UTF-8またはoctal escaped pathを含むcopy回帰testを追加する。

## 新規変更範囲の追加確認

上記以外に、修正差分から独立した新規required findingは確認しなかった。ただしHEAD一致CIがないため、compile/test結果は未確認である。

## Coverage

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirement/design conformance | checked_finding | R010、R011が保守的回復・copy未継承要件に未達 |
| Correctness/edge cases | checked_finding | open/commit completion order、quoted copy path |
| Scope discipline | checked_no_finding | 修正はT602 finding範囲内 |
| Changed files/direct dependencies | checked_finding | 修正9実装/test fileとsnapshot/Git parser契約を確認 |
| API/data/config/workflow compatibility | checked_finding | snapshot latest pointer整合性に残存問題 |
| Error handling/failure diagnostics | checked_no_finding | fatal Git分類とcatalog failure保持を確認 |
| Security/secret handling | not_applicable | secret/token処理変更なし |
| Tests/validation adequacy | checked_finding | R010 concurrencyとquoted copyのtestが不足 |
| Current-HEAD CI evidence | unexplored | current HEADに一致するrunなし |
| Reports/tracking/documentation accuracy | checked_finding | R003 handoff更新が未完 |
| Regression/maintainability risk | checked_finding | raw stringによるGit metadata分類、queue外publication |

## Held / unexplored

- Held: なし
- Unexplored: current HEADに一致するCIがないため、自動build・testの実行結果。

## Verdict

**fail**。

Required findings `T602-R010`、`T602-R011`が残存し、`T602-R003`もpartialである。さらにcurrent HEAD一致CIが存在しない。修正後は同じnormal review chatでfinding identityとseverityを維持して再度fix verificationを行う。

## 次のaction

1. `T602-R010`のopen/commit snapshot publication順序を修正し、逆順完了testを追加する。
2. `T602-R011`のcopy metadata判定をcanonical parserへ統合し、quoted path testを追加する。
3. 修正後のimplementation handoffを保存して`T602-R003`をclosureする。
4. 新しいimplementation HEADに一致するCI runだけを確認する。
5. mergeは利用者が行う。

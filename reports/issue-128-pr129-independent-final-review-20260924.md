# Issue #128 / PR #129 Independent Final Review

## Metadata

- generated_at: 2026-09-24T10:00:28+09:00
- repository: ssaattww/RevMem
- issue: #128
- pull_request: #129
- review_mode: independent final review
- reviewer: fresh independent ChatGPT review chat
- execution_environment: FA780 / Windows / Remote Desktop Commander
- base_sha: `df1501358be6ad0e6e03989ddc9e08f67a6e1996`
- reviewed_implementation_head: `8d09587e27396027ad808c312ab46e826ebddb19`
- reserved_report_path: `reports/issue-128-pr129-independent-final-review-20260924.md`
- merge: not performed
- verdict: **fail**

## Executive summary

PR #129 の全差分、Issue #128、設計11.3/16.5/17.3、normal review closure、
current HEADのCI、local gate、実装境界を独立に再確認した。
normal reviewの既存findingは閉じているが、独立probeで4件の新規findingを確認した。

- I129-IFR-001 / High: sibling scope失敗時に、成功済みscopeの収集済みline evidenceがpartial snapshotから消える。
- I129-IFR-002 / Medium: filesystem file loaderがAbortSignalを無視し、stop/cancel後もchunk処理を継続する。
- I129-IFR-003 / Medium: invalid UTF-8 exclusionが解析中file変更時の最終stability checkを迂回し、stale exclusionを確定できる。
- I129-IFR-004 / Low: normal review closure後もtask台帳が「same normal reviewer確認待ち」の旧状態を保持する。
## Source identity / CI

レビュー開始時と終了前にFA780 worktreeとGitHub PR HEADを照合した。

- branch: `fix/issue-128-global-understanding-folder-scan`
- local HEAD: `8d09587e27396027ad808c312ab46e826ebddb19`
- origin branch HEAD: 同一
- GitHub PR #129 HEAD: 同一
- tracked worktree: clean
- merge base: `df1501358be6ad0e6e03989ddc9e08f67a6e1996`

current HEAD exact CI:

- CI #4717 / run `35937907256`
- workflow head SHA: `8d09587e27396027ad808c312ab46e826ebddb19`
- conclusion: success
- build-and-lint job: success
- T610 step: success
- VS Code Extension Host step: success
- artifact id: `10783957323`
- artifact: `review-range-user-validation-0.1.56-pre+8d09587`
- artifact workflow head SHA: current HEADと一致

CI failure diagnostics workflowは既存の `Upload failure diagnostics` で、
`test-output/`、stdout/stderr log、生成物、source/test等をfailure artifactへ保存する。
Issue #128開始時の診断artifact要件を満たすため、このPRでworkflow追加は不要だった。
## Local independent validation

reviewed implementation HEADで次を再実行した。

- `npm run compile:test`: pass
- `npm run build`: pass
- `npm run typecheck:contracts`: pass
- `npm run validate:architecture`: pass
- `npm run validate:architecture:negative`: pass
- `npm run lint`: pass
- `npm run test:t610`: 96/96 pass
- `npm test`: pass
- VS Code Extension Host: all launched phases succeeded
- gate終了後のtracked worktree: clean
- gate実行HEAD: `8d09587e27396027ad808c312ab46e826ebddb19`

独立probeとgateのstdout/stderrはreviewed tree外の
`C:\Users\donabe\Project\RevMem-pr129-independent-evidence-20260924`
へ保存した。reviewed repositoryにはprobe用sourceを追加していない。

## Finding I129-IFR-001

- severity: **High**
- origin: PR #129 partial failure publication
- location:
  - `src/composition/global-understanding/global-understanding-source.ts:402-426`
  - `src/composition/global-understanding/global-understanding-source.ts:633-659`
- requirement:
  - design 11.3: failed/incomplete childを含むparentはpartialだが、現在把握済みcountを保持できる。
  - design 16.5: partial nodeは現在把握済みcountを表示し、未収集と誤認させない。
### I129-IFR-001 description

scopeの計算成功後、controllerへ`accept`した直後にlifecycle snapshotをpublishするが、
その時点では`direct`のfile progressをlocal `files`へ追加していない。
さらに`lifecycleSnapshot`はcurrent recalculationの成功済み`files`を受け取らず、
前回の`lastSnapshotByEvidenceKey`だけからprogressを構築する。

このため、先に成功したscopeの後で別scopeが失敗すると、
成功scopeのfolder totalはcontrollerに残る一方、repository progress/file rowからline evidenceが消える。

### I129-IFR-001 independent reproduction

fixture:

- root `root.txt`: 2 non-empty lines
- child `child/bad.txt`: 1 line
- rootとchildを明示開始
- shared capture後に`child/bad.txt`を削除し、child content readをENOENTにする

current HEAD result:

- root folder: `active / partial (0/2)`
- child folder: `failed / partial (0/0)`
- repository summary: `partial (0/0)`
- status bar: `Global: partial (0/0)`
- `root.txt` row: `未収集`
- discovered paths: `root.txt`, `child/bad.txt` の2件を保持

`root.txt`は実際には正常に2行収集済みであり、同一snapshot内で
folder total=2とfile row=未収集/repository total=0が矛盾する。

### I129-IFR-001 required action

successful scopeのcurrent-generation file progressを、後続scope失敗時のpartial publicationにも保持すること。
root成功 + child失敗fixtureで、known root file row/known line countとpartial表示が一貫する回帰testを追加すること。
## Finding I129-IFR-002

- severity: **Medium**
- origin: explicit-folder filesystem scanが利用する既存file-loader contract
- location:
  - `src/application/global-understanding/global-understanding-background-recalculator.ts:35-42`
  - `src/adapters/repository-files/node-global-understanding-file-source.ts:117-127`
  - `src/composition/global-understanding/global-understanding-source.ts:350-361`
- requirement:
  - `GlobalUnderstandingFileLoadOptions.signal` はenclosing recalculation共有のruntime cancellation fence。
  - design 11.3: 各I/O/bounded stage前後でgenerationとAbortSignalを照合し、stop/cancel後の作業を継続しない。

### I129-IFR-002 description

`NodeGlobalUnderstandingFileSource.load`は`signal`を受け取るが、
read/analyze chunk loop内で`options.signal`を一度も確認していない。
PR #129のexplicit-folder scanはこのloaderへscope signalを渡すため、
stop/cancel後も一つの大きなfileのdecode/hash/line scanが最後まで続く。

### I129-IFR-002 independent reproduction

256 KiB file、`maxWorkBytes=1024`、最初のyieldでAbortControllerをabortした。

current HEAD result:

- signalAborted: true
- yields: 255
- `load()`: fulfilled
- nonEmptyLines: 1

外側の`assertScopeCurrent`はstale publishを防ぐが、bounded work自体は中断されない。

### I129-IFR-002 required action

file load/read/analyzeのbounded boundaryでsignalを確認し、abort後は速やかにAbortError相当で終了すること。
first-yield abort後に追加chunk処理を行わないfocused regression testを追加すること。
## Finding I129-IFR-003

- severity: **Medium**
- origin: normal-review fix `1895d41` のinvalid-encoding exclusion path
- location:
  - `src/adapters/repository-files/node-global-understanding-file-source.ts:117-126`
  - `src/adapters/repository-files/node-global-understanding-file-source.ts:172-175`
  - `src/composition/global-understanding/global-understanding-source.ts:352-369`
- requirement:
  - current revision/contentとして確実なevidenceだけを採用する。
  - design 11.3: active scopeのcontent evidence変更をcurrent generation fenceで扱う。

### I129-IFR-003 description

通常のsuccessful analysisでは、line 175のpost-analysis `assertStableRegularFile` が
解析中のfile変更を検出する。
しかしinvalid UTF-8は`analyzeContent`内部で
`NodeGlobalUnderstandingFileExcludedError`をthrowするため、
line 175へ到達せずfinal stability checkを実行しない。

callerはこのerrorを「現在のfileがinvalid encoding」として除外・complete扱いできる。
そのため、解析中にfileがvalid UTF-8へ変化してもstaleな旧bufferを理由に除外可能になる。

### I129-IFR-003 independent reproduction

8-byte fileの後半にinvalid UTF-8を置き、`maxWorkBytes=4`で解析。
first yield中に同じfileをvalid UTF-8 `aaaaaaaa` へ置換した。

current HEAD result:

- file change: true
- current file content: valid UTF-8 `aaaaaaaa`
- `load()` result: rejected as `NodeGlobalUnderstandingFileExcludedError`
- reason: `invalid-encoding / utf-8`

### I129-IFR-003 required action

exclusion判定をcurrent evidenceとして採用する前にもpost-analysis stability validationを必ず通すこと。
解析中にinvalid→validまたはvalid→invalidへ変化するfixtureを追加し、stale exclusionをpublishしないこと。
## Finding I129-IFR-004

- severity: **Low**
- origin: normal review closure record synchronization
- location: `tasks/tasks-status.md:7,24,26`

normal fix verification R2 report/handoffとPR bodyは、
I128-NR-002をclosed、all normal-review findings closed、next=independent final reviewとしている。
一方、current task ledgerは現在も次を記録している。

- line 7: `I128-NR-002-R2 ... same normal reviewer限定確認待ち`
- line 24: `I128-NR-002 ... reviewer限定確認待ち`
- line 26: `I128-FINAL ... NR-002限定fix verification待ち`

これはreview開始時点のcurrent repository stateと一致しない。
独立review freeze前にtracking/report/handoffが同期済みであるべきというreview workflowにも反する。

### I129-IFR-004 required action

normal review closure済みであることと、independent finding対応中であることをtask ledgerへ同期すること。
製品修正とは別のrecord correctionとして履歴を正確に保持すること。

## Required coverage matrix

| Criterion | Disposition |
| --- | --- |
| requirement / design conformance | I129-IFR-001, 002, 003 |
| correctness / edge cases | I129-IFR-001, 003 |
| scope discipline | checked; repository-wide automatic scanは復活していない |
| changed files / direct dependency impact | I129-IFR-002, 003 |
| API / data / config / workflow / compatibility | checked; PR immutable evidence boundaryはnormal fix後に維持 |
| error handling / failure diagnostics | I129-IFR-001; structured diagnostic自体はprivacy-safe |
| security / secret handling | checked; probe/logにproduction secret/source本文の外部送信なし |
| tests / validation adequacy | gaps correspond to I129-IFR-001/002/003 |
| exact-head CI / artifact | checked; CI #4717 success, artifact head SHA一致 |
| report / tracking / docs | I129-IFR-004 |
| regression / maintainability | I129-IFR-002/003 |
## Other reviewed points

- I128-NR-001 binary / invalid UTF-8 exclusionの基本Green casesはT610で通過。
- I128-NR-002 PR owner immutable evidence authorityはlocal-only/same-path regressionsともGreen。
- I128-NR-003 original I128-IMPL-001 Red chronologyは「unverified」と正確に記録されている。
- structured Global failure diagnosticはstage/error/code/category/countをsource-content-freeに出力する。
- PR current HEAD CIは別SHA runを代用せず、`8d09587e...` exact runだけを確認した。
- mergeは実施していない。

## Verdict

**fail**

blocking findings:

- I129-IFR-001 / High
- I129-IFR-002 / Medium
- I129-IFR-003 / Medium
- I129-IFR-004 / Low

本review chatでは修正実装を行わない。
実装担当がfindingごとにTDDで修正し、same independent reviewerによるfinding-limited closureが必要。
新しいimplementation HEADでは、product/test差分と各finding closure evidenceを再確認する。

## Evidence files

reviewed tree外に保存:

- `sibling-failure-probe.cjs` / stdout JSON
- `partial-render-probe.cjs` / stdout JSON
- `load-abort-probe.cjs` / stdout JSON
- `invalid-race-probe.cjs` / stdout JSON
- build/contracts/architecture/lint/T610/npm-test stdout/stderr
- `local-head.txt`
- `local-gate.result`

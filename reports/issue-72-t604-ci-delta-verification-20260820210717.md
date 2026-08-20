# T604 CI delta verification report

## タスク

- Issue: `#72`
- PR: `#73`
- task: `T604`
- mode: same independent reviewerによるCI delta限定verification
- source independent report: `reports/issue-72-t604-independent-final-review-20260820195834.md`
- source closure: `reports/issue-72-t604-independent-finding-closure-r2-20260820205209.md`
- CI follow-up: `reports/issue-72-t604-ci-followup-20260820210004.md`
- failed diagnostic run: `32366251062` / head `dc66e5ea98281a094c1dff20a3fc21d689cf4492`
- technical CI fix HEAD: `de3d9475c980338c983cb39603d7bc0756eebbbb`
- reviewed current/admin HEAD: `eb79b4525086a86f1213be9e87c35ae7f6cf9c65`

R2でclosedした`T604-IFR001`のstale/dead-owner recoveryに対するCI発見deltaだけを検証した。IFR002〜IFR007はclosed状態の維持可否だけを記録し、再reviewしていない。

## sub-agentを使う理由

同一independent reviewerがIFR001/R2 continuityを保つ限定deltaであり、依頼によりsub-agentは使用していない。

## 対象範囲

- valid unexpired descriptorについて、PIDがconfirmed-deadなら即時recoverし、sequential Extension Host startupを許すこと。
- valid live PIDはexpiry後もstealせず、liveness unknown/errorはfail closedであること。
- malformed、zero、truncated、future-invalid descriptorは`mtime + leaseMs`のbounded age gateを維持し、fresh partialを盗まないこと。
- recovery rename/compare protocolによるsuccessor safety、privacy-safe diagnostic、approved cooperative-process threat modelが回帰しないこと。
- deterministic local regressionとprovided `test:t604` 24/24、build/compile/typecheck/lint/architecture/diff-check Greenの評価。
- run `32366251062`のT506 phase2 failureをdeltaのcausal evidenceとして読むこと。

## 対象外

- 新規観点、新規finding、severity変更、全範囲review、IFR002〜IFR007の再判定。
- hostile ancestor/root syscall間swap、native `openat`、Windows handle-relative primitive。承認済みthreat model外のまま。
- test/CIの実行または待機、実装、tracking変更、git/PR変更、commit、push、merge。
- current HEADのexact-head CI merge gate。technical delta判定とは分離してheldとする。

## 実行コマンド

read-only inspectionだけを行い、testまたはCIは起動していない。

- `git rev-parse HEAD/de3d947`、`git log --oneline`、`git status --short`
- `git diff --name-status dc66e5e...de3d947`、対象source/testのread-only diff
- `gh run view 32366251062 --json ...`とfailed logのread-only inspection
- `Get-Content` / `Select-String`によるsource independent/closure report、CI follow-up、lock source、focused regressionの照合
- report記入後のHEAD、status、未記入トークン、見出し、whitespace/diff-check確認

repositoryに`tools/lint/`と`lint:md`がないためMarkdown wording checkerは`unsupported`。存在しないlint commandは実行していない。

## 対象ファイル

technical deltaの直接対象:

- `src/adapters/state-repository/storage-root-lock.ts`
- `test/unit/t604-storage-lock-cleanup.test.ts`

authority/evidenceとして確認:

- `reports/issue-72-t604-independent-final-review-20260820195834.md`
- `reports/issue-72-t604-independent-finding-closure-20260820202935.md`
- `reports/issue-72-t604-independent-finding-closure-r2-20260820205209.md`
- `reports/issue-72-t604-ci-followup-20260820210004.md`
- `handoffs/issue-72-t604-implementation-20260820103944.yaml`
- `tasks/tasks-status.md`
- `tasks/phases-status.md`

admin rangeはtechnical/current identityとheld stateの確認に限定し、内容の全範囲reviewは行っていない。

## 指摘事項

新規findingは追加していない。IFR001/R2 deltaを次の5 criterionで一括dispositionした。

| criterion | disposition | evidence |
| --- | --- | --- |
| confirmed-dead valid descriptorの即時recovery | checked_no_finding | `storage-root-lock.ts:217-229`は正常parseされたdescriptorをexpiryと無関係にliveness probeし、`false`のときrecoverする。unexpired injected-dead regressionとreal killed-child regressionが即時successor acquireをassertする。 |
| live/unknown ownerのfail-closed | checked_no_finding | valid live PIDはexpiredでも`recoverable=false`となりtimeoutする。probe rejectionはdeadへ変換されずouter failureとして伝播する。default probeも`ESRCH`だけをdeadとし、それ以外をlive/indeterminateとして扱う。 |
| partial/future-invalid bounded age gate | checked_no_finding | parse不能またはfuture-invalidは`partialIsAged = mtimeMs + leaseMs <= now`だけでrecoverする。zero、truncated、malformed、future-invalid matrixはfresh時timeout、aged後acquireをassertする。 |
| successor safety / privacy / threat model | checked_no_finding | rename後にrecovery inode bytesを元rawと比較し、renewed inodeをlock pathへ戻さない既存protocolは変更されていない。recovery後の`stale-recovered`とfailure/timeout diagnosticはkind + opaque operationIdのみで、owner/pathを追加していない。confirmed-dead cooperative processは再開・publishできず、R2 publication fenceを弱めない。 |
| diagnostic causeとlocal regression adequacy | checked_no_finding | run `32366251062`はhead `dc66e5e...`でT506 phase2 `t506-restore-context-b-unmark-global`が失敗し、T604 stepはskipped。CI follow-upのartifact記録はphase1 host終了後のunexpired descriptorによるstartup `StorageRootLockTimeoutError`を示す。deltaはこのcauseを直接扱い、provided focused resultは24/24。 |

**IFR001 continuity**

- source severity: High（変更なし）。
- R2 closure: `closed`。
- delta disposition: `pass`。dead PIDの早期recoveryは、old processが既に終了してpublication不能な場合だけである。live/unknown ownerの非奪取とlow-level publication fenceを維持するため、stale writer/newer publication protectionを再openしない。

## 結果

**Technical delta verdict**: `pass_with_held`

- IFR001: `closed`維持。
- IFR002: `closed`維持（delta非該当）。
- IFR003: `closed`維持（delta非該当）。
- IFR004: `closed`維持（delta非該当）。
- IFR005: `closed`維持（delta非該当）。
- IFR006: `closed`維持（delta非該当）。
- IFR007: `closed`維持（delta非該当）。
- open required finding: 0。
- severity reclassification: なし。
- new findings: なし。
- `held`: reviewed current/admin HEAD `eb79b4525086a86f1213be9e87c35ae7f6cf9c65`のmatching exact-head CI。merge gateとして親ownerのまま。
- `held`: Markdown focused/full lintはrepository wiring不在のため`unsupported`。passとは扱わない。
- `unexplored`: なし（CI delta限定scope内0）。対象外領域を新しいunexploredへ変換していない。
- validation assessment: provided `test:t604` 24/24とstatic validation Greenをdelta evidenceとして評価した。run `32366251062`は旧headのdiagnostic evidenceであり、current exact-head Greenとして扱っていない。reviewerはtest/CIを実行または待機していない。

**Report attestation**

- `report_attestation_allowed: true`
- previous attestation `dc66e5ea98281a094c1dff20a3fc21d689cf4492`は後続technical fixで無効のまま。
- technical verdictはreviewed current/admin HEAD `eb79b4525086a86f1213be9e87c35ae7f6cf9c65`へ付与する。technical CI fixは`de3d9475c980338c983cb39603d7bc0756eebbbb`。
- acceptance conditions: 親はまず`eb79b45...`に一致するrequired exact-head CI Greenを確認する。その後、事前予約済み本report pathだけを変更する単一administrative attestation commitを作成できる。first parentは`eb79b45...`、diffは本reportのみ、実装・design・workflow・configuration・tracking・handoff・他report変更なし、後続commitなしでなければならない。attestation SHAはcommit後にPR等のbranch外metadataへ記録し、report本文へ事前記入しない。条件外の後続Git commitはcompletionを無効化する。

## リスク

- exact-head CIは未取得のheld merge gateであり、local 24/24だけではmerge-readyにならない。
- PID reuseまたはliveness不確定時は保守的にownerをliveとして扱うため、誤ってstealはしないがtimeoutする可能性がある。
- malformed/future-invalid descriptorは意図どおりage gate後までrecoveryしないため、fresh partialの間はbounded waitが発生する。
- Markdown lintはrepository wiring不在で`unsupported`のため、Markdown wordingのautomated passは主張しない。
- 本reportはIFR001/R2 stale/dead-owner recovery deltaだけを検証し、他領域を再reviewまたは再保証しない。

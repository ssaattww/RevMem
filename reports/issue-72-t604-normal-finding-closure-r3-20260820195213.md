# T604 normal finding closure R3 report

## タスク

T604 / Issue #72 / PR #73 の同一normal reviewerによるfinding-limited closure R3。R2で`open`だったT604-R001 / R002 / R003 / R004 / R005 / R007 / R008だけを、承認済みIssue #72 comment `issuecomment-5354717971`とdesign §15のthreat modelをauthorityとして各`closed/open`判定した。

- branch: `task/t604-storage-lock-cleanup`
- technical fix: `5d296c6e078599b95bd595288ffd7d6cbcec2f0b`
- reviewed HEAD: `5d347db46a68fcf50902142ca816b914b27e7c8e`
- R1 closure: `reports/issue-72-t604-normal-finding-closure-20260820111448.md`
- R2 closure: `reports/issue-72-t604-normal-finding-closure-r2-20260820114018.md`
- R3 follow-up: `reports/issue-72-t604-normal-review-followup-r3-20260820193342.md`
- verdict: `pass_with_held`

R006 / R009はR2の`closed`を維持し、本R3で再reviewしていない。技術verdictはfix sourceと提供済みlocal evidenceへ適用する。

## sub-agentを使う理由

source normal reviewer自身が同じfinding lineageのR3 closureを担当した。利用者の指示に従い、追加sub-agentは使用していない。

## 対象範囲

R1 / R2 closureに残った7 findingのclosure condition、`fbc8216..5d296c6`のtechnical fix、`5d296c6..5d347db`のadministrative handoff、変更された直接箇所、同じdefect class用に追加されたproduction fixture、R3 follow-upのlocal evidenceを確認した。

承認済みthreat modelは、trusted VS Code storage root、協調RevMem process / window、crash / partial I/O、operation開始時に存在するlink / junction / reparse、およびoperation中に検出可能なidentity changeを対象とする。同じhostのmalicious actorによるancestorのsyscall間swapとnative `openat` / Windows handle-relative保証は明示的non-goalであり、R001 / R003をその非保証だけでopenにしていない。

新規観点、新規finding、severity reclassification、source scope外のsibling探索は行っていない。exact-head CIは利用者方針どおりmerge直前の外部gateへ分離した。

## 対象外

R006 / R009の再review、T604-R001〜R009以外、same-host malicious ancestor syscall間swap、native filesystem primitive、T605以降、独立final review、実装・test・workflow・design・tracking・handoff修正、test / CIの起動・再実行・待機、commit、push、PR / Issue / review操作、mergeである。

## 実行コマンド

reviewerは`git rev-parse`、`git status`、`git log / show / diff / --stat / --check`、`rg`、`Get-Content`だけを用いたread-only inspectionを実施した。test、build、lint、CIは起動・再実行・待機していない。

R3 follow-up由来のlocal evidenceは`npm run test:t604`のT604 19件とT506 2件、計21 / 21 pass、`npm run build`、`npm run compile:test`、`npm run typecheck:contracts`、`npm run lint`、architecture positive / negative成功である。本reviewerは再実行していない。

Markdown wording checkはtargetを本reportとしたが、`tools/lint/`、focused wiring、`lint:md`が存在しないためfocused / full / aggregateとも`unsupported`。passへ変換せずheldを維持する。

## 対象ファイル

finding closureへ直接対応する次のfix filesとevidenceを確認した。

- R001 / R002: `src/adapters/state-repository/storage-root-lock.ts`、lease / partial matrix / child-process fixtures。
- R003: design §15 threat model、root-confined atomic store / trusted guard、symlink / Windows junction外部sentinel fixture。
- R004 / R007: production startup migration、state repository、JSONL history、snapshot tracker / Node adapterを使うowned child-process startup / writer / killed lease / restart fixture、`package.json`、CI wiring。
- R005: `src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts`、production trackerのactive pointer / count / bytes / delete failure / restart fixture。
- R008: storage diagnostic type、operation feedback、startup / state / history / cache / snapshot production composition、pending flush / privacy fixture。
- authority / administrative evidence: design §15.2、R3 follow-up、handoff、tasks、phases。

## 指摘事項

### T604-R001 — High — `closed`

- source severity: `High`（preserved）
- closure evidence: acquire timeoutはmonotonic elapsed、live leaseはexpiry前に拒否される。renew / releaseは取得済みdescriptorへ作用しsuccessor pathをtruncate / deleteせず、recoveryは旧inodeだけを隔離する。owner tokenとdescriptor identityはoperation開始・終了および明示publication boundaryで再確認され、検出したlease lossは`StorageRootLeaseLostError`でfail closedになる。expiry / recovery / detached owner / child-process live refusalとrelease / kill recoveryがlocal Greenである。
- scope disposition: R2で要求したsyscall間完全atomic fenceは承認済みthreat modelを超える。協調processと検出可能なpublication boundaryというauthority内に未達条件は残らない。

### T604-R002 — High — `closed`

- source severity: `High`（preserved）
- closure evidence: leaseはprivate `.lock-pending-*` inodeへwrite / syncした後、hard-linkで共有`lock` pathへatomic publishする。write / sync / close failureはpending pathだけをcleanupし、successorの共有pathを削除しない。zero-byte、truncated、malformed、future-invalidはmtime + bounded leaseで回復し、完全取得後にkillしたchild leaseはexpiry前に拒否、expiry後に回復する。fault / corrupt / child-process matrixは提供済み21 / 21に含まれる。

### T604-R003 — High — `closed`

- source severity: `High`（preserved）
- closure evidence: state / history / startup / snapshot / cacheのNode mutationはcanonical root containment、ancestor `lstat`、physical directory `realpath`を通り、operation開始時に存在するsymlinkまたはWindows junctionとroot外解決をrejectする。production snapshot mutation fixtureはroot外sentinel不変を固定する。検出可能なidentity changeもphysical descendant照合でfail closedになる。
- scope disposition: native handle-relative APIでしか完全排除できないmalicious syscall間ancestor swapは承認済みnon-goalであり、scope内の既存link / junction / reparseと外部mutation防止に未達条件は残らない。

### T604-R004 — High — `closed`

- source severity: `High`（preserved）
- closure evidence: rootごとのstate、history、snapshot metadata startup migrationは一つのcross-process lease transactionに統合済み。R3 fixtureはproduction `runPersistenceStartupMigration`とproduction state save、JSONL append、`NonGitSnapshotTracker` + `NodeNonGitSnapshotStorage` writerを別々のowned Node child processで同じrootへ競合させる。killed leaseとpartial latest pointerの後にrestartし、newer state revision、history event、latest pointer、snapshot contentがcoherentに残ることを確認する。childは5秒boundとtemporary root cleanupを持ち、same-process queueだけに依存しない。

### T604-R005 — High — `closed`

- source severity: `High`（preserved）
- closure evidence: production Node `putAndCleanup`はgeneration publication、全latest pointer、protected generation、retention / count / byte plan、delete直前pointer確認を同じroot leaseで実施する。R3 fixtureは複数active generationがcount / aggregate-byte limitを超えても保持されること、pointer publicationとcleanupのinterleavingがdangling pointerを作らないことを固定する。cleanup delete failureはdurable publicationをreject / rollbackせずunreferenced generationを残し、restart後の同じproduction cleanup経路で再計画・削除を再試行してactive generationを保持する。

### T604-R007 — Medium — `closed`

- source severity: `Medium`（preserved）
- closure evidence: `test:t604`は既存CI専用stepへ配線されたまま、OS child lease、partial / corrupt lock、existing link / external sentinel、production child startup / state / history / snapshot writer、kill / restart、active pointer / count / bytes / delete failure / restart、T506 custom-storeを含む21 / 21 local Greenへ拡張された。production persistence競合は別Node processで、same-process queueを排除している。exact-head CIの実行結果は別held gateである。

### T604-R008 — Medium — `closed`

- source severity: `Medium`（preserved）
- closure evidence: lock diagnosticはpathやtokenを含まないopaque `operationId`を持ち、`OperationFeedback`は`operationId + kind`を一度だけ`Review Range` Output lifecycleへ記録する。startup、state、history、cache、snapshotは共通sinkへproduction wiring済み。focused fixtureはOutput host開始前のduplicate pending eventをflushし、active lifecycleで同scopeを再通知しても重複せず、別scopeのstale recoveryを記録し、scope、repository、path、secretをOutputへ出さないことを固定する。

## 結果

### Finding dispositions

| Finding | Severity | Disposition |
| --- | --- | --- |
| T604-R001 | High | `closed` |
| T604-R002 | High | `closed` |
| T604-R003 | High | `closed` |
| T604-R004 | High | `closed` |
| T604-R005 | High | `closed` |
| T604-R007 | Medium | `closed` |
| T604-R008 | Medium | `closed` |

severity reclassification / errataはない。T604-R006 HighとT604-R009 LowはR2の`closed`を維持し、本R3のfinding disposition対象には含めていない。

### Coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| R001 cooperative lease ownership / detectable fencing | `checked_no_finding` | monotonic/live refusal、descriptor-bound successor safety、loss fail-closed、approved scope |
| R002 crash / partial / corrupt acquire recovery | `checked_no_finding` | private pending publish、fault cleanup、partial matrix、kill recovery |
| R003 trusted-root existing link / reparse boundary | `checked_no_finding` | canonical / physical containment、static link rejection、external sentinel |
| R004 startup / writer cross-process ownership | `checked_no_finding` | production child startup / writer / killed lease / partial pointer / restart |
| R005 active snapshot / bounded cleanup failure contract | `checked_no_finding` | pointer / count / bytes、best-effort delete、restart replan |
| R007 focused production process / failure coverage | `checked_no_finding` | local 21 / 21、CI step wiring、owned bounded child processes |
| R008 privacy-safe once-per-scope diagnostics | `checked_no_finding` | operation dedupe、pending flush、production common sink、privacy assertion |

### Held / unexplored / unknown

- held: `H604-001` Markdown wording lint `unsupported`、`H604-002` T605〜T608の別task scope、`H604-003` reviewed HEAD一致CIのmerge直前外部gate。required findingとは混同しない。
- unexplored: なし。対象7 findingの変更後closure conditionは全件判定済み。新規観点とscope外siblingは利用者指示により探索していない。
- unknown: exact-head CIの結論。起動・待機禁止に従いlocal / source技術判定へ混入していない。
- not applicable: R006 / R009の再review、same-host malicious ancestor syscall間swap、native `openat` / Windows handle-relative guarantee、independent-final-review freeze / attestation、merge。

### Verdict

`pass_with_held`

R3対象のT604-R001 / R002 / R003 / R004 / R005 / R007 / R008は全件`closed`。R006 / R009もR2の`closed`を維持する。required findingとverdict-blocking unexplored areaはなく、Markdown lint unsupported、後続task、exact-head CIだけを明示heldとする。

## リスク

same-host malicious actorによるancestor syscall間swapとnative handle-relative guaranteeは承認済みthreat modelの外であり、本verdictはその防御を主張しない。trusted VS Code storage rootと協調RevMem process / window、crash / partial I/O、operation開始時のlink / reparseというT604 scopeへ限定される。

provided local 21 / 21と静的検証は評価したが、本reviewerは再実行していない。exact-head CIはmerge前held gateであり、未実行をsuccessへ変換していない。scope外探索を行っていないため、本reportは既存7 finding以外の新規品質保証ではない。

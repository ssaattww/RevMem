# T604 normal finding closure report

## タスク

T604 / Issue #72 / PR #73 のnormal review finding-limited closure verification。source reviewは`reports/issue-72-t604-normal-review-20260820105630.md`、follow-up evidenceは`reports/issue-72-t604-normal-review-followup-20260820110658.md`である。

- review mode: `fix_verification`
- reviewer: source normal reviewer Codex sub-agent `/root/t604_normal_review`
- source reviewed HEAD: `4ac8491172dffa7eb0e396f88c5040b035a900f8`
- fix reviewed implementation HEAD: `a256b49114c3cf6f73c0ee4d303593f09187ef8d`
- fix range: `4ac8491172dffa7eb0e396f88c5040b035a900f8..a256b49114c3cf6f73c0ee4d303593f09187ef8d`
- reserved report path: `reports/issue-72-t604-normal-finding-closure-20260820111448.md`
- persistence mode: `repository_file`
- report attestation allowed: `false`（通常review fix verificationのため`not_applicable`）
- verdict: `fail`

source finding identityとseverityは変更していない。技術verdictはfix reviewed implementation HEADだけに適用する。

## sub-agentを使う理由

source normal reviewer自身が同じfinding lineageのclosureを担当した。利用者の指示に従い、追加sub-agentは使用していない。

## 対象範囲

T604-R001〜R009のsource description、evidence、required actionだけを各`closed/open`で判定した。fix diff、変更された直接箇所、同じdefect class用に追加・配線されたtest、follow-up reportのlocal evidenceを確認した。

新規観点、新規finding、source scope外のsibling探索、severity reclassificationは行っていない。open判定ではsource findingの未充足closure条件だけを具体化した。

## 対象外

T604-R001〜R009以外の実装品質探索、T605以降、独立final review、実装・test・workflow・design・tracking・handoff修正、test / CI再実行または待機、commit、push、PR / Issue / review操作、mergeである。

## 実行コマンド

reviewerは`git rev-parse`、`git status`、`git diff / --stat / --check`、`git log`、`rg`、`Get-Content`、`gh pr view`だけを用いたread-only inspectionを実施した。test、build、lint、CIは起動・再実行・待機していない。

follow-up report由来のlocal evidenceは`npm run test:t604`でT604 7件とT506 custom-store 2件の計9件pass、build、compile:test、contracts typecheck、lint、architecture正負、diff check成功である。本reviewerは再実行していない。

fix HEAD一致CIは観測時点でpush run `32323948421`とpull_request run `32323950880`がいずれも`IN_PROGRESS`で、成功・失敗の結論はない。明示的に待機しないため、current-head CI successが必要なT604-R006のclosure evidenceには使用できない。

Markdown wording checkは`tools/lint/`、focused wiring、`lint:md`不在のためfocused / full / aggregateとも`unsupported`。passへ変換せずheldを維持する。

## 対象ファイル

source finding closureに対応するfix filesを確認した。

- R001 / R002 / R006: `src/adapters/state-repository/storage-root-lock.ts`、contracts、index、validated state repository、JSONL history store、T506 integration test。
- R003: persistence trusted guard、history、snapshot、cache mutation path、T604 test。
- R004: `src/adapters/persistence-startup-migration.ts`、snapshot migration path、production activation。
- R005: `src/application/non-git-snapshots/index.ts`、Node snapshot adapter、T604 test。
- R007: `test/unit/t604-storage-lock-cleanup.test.ts`、`package.json`、`.github/workflows/ci.yml`、T506 integration test。
- R008: state / history / cache / snapshot optionsと`src/extension.ts`、`src/t405-review-contexts-runtime.ts`、startup migration。
- R009: design §15.4、`Design/BreakingChanges.md`、route JSDoc、handoff、README、tasks、phases、follow-up report。

## 指摘事項

### T604-R001 — High — `open`

- source severity: `High`（preserved）
- verified progress: expiry判定は`expiresAt <= now`へ変更され、custom store用coordinatorが追加された。
- remaining closure condition: releaseは依然としてtokenをread後にpathを`rm`し、renewもtokenをread後に同じpathを`r+`でtruncateする。stale recoveryもrename後のcontent不一致時にpathへrenameし戻すため、source findingのsuccessor-safe ownership-conditional mutationを満たさない。renew failure / ownership lossはoperationへ伝播せず、writer fencingもない。timeoutもwall clock由来の`deadline`のままでmonotonic elapsedではない。release-vs-reacquire、renew-vs-recovery、複数recoverer、renew failure、clock rollbackのdeterministic multi-process evidenceもない。
- required for closure: source required actionどおり、successor lockへ作用しないrenew / release / recovery、lost-lease後のpublication停止、monotonic bounded timeoutを実装し、列挙済みinterleavingを固定する。

### T604-R002 — High — `open`

- source severity: `High`（preserved）
- verified progress: acquire自身のwrite / sync / close failureではbest-effort `rm`し、malformed lockはmtime + leaseでbounded stale判定する。malformed fixture 1件が追加された。
- remaining closure condition: source required actionが求めたprocess killおよびwrite / sync / close failure fixtureがない。zero / truncated / malformed / future-invalid lock matrixもなく、追加testは古いmtimeの`"{partial"` 1 caseだけである。lock publication自体は引き続き`wx`作成後に同じvisible fileへ直接writeする。
- required for closure: sourceに列挙したcrash / partial publicationとwrite / sync / close failureをdeterministicに作り、live ownerを奪わずlease後にrootが再利用できる証拠を追加する。

### T604-R003 — High — `open`

- source severity: `High`（preserved）
- verified progress: startup mutationへのroot lockは追加された。
- remaining closure condition: history append / quarantine / migrationとsnapshot put / delete / pointer write / quarantineは依然target pathへtrusted guardを通さない。cacheとstateが使うguardも`lstat`確認と後続`mkdir/open/rename/rm`が分離したTOCTOUのままで、path-safe primitiveへの集約がない。Windows junction / reparse、POSIX symlink、swap race、外部sentinel fixtureも追加されていない。
- required for closure: source required actionどおり、全Node mutationをreparse swap不能なroot-fenced primitiveへ通し、各platform boundary fixtureでroot外write / deleteがないことを固定する。

### T604-R004 — High — `open`

- source severity: `High`（preserved）
- verified progress: workspace / repository state migrationとhistory + snapshot metadata migrationが`withStorageRootLock`内へ移された。outer migration lock内のsnapshot metadata methodは再取得しないため、追加箇所に直接nested acquireはない。
- remaining closure condition: source required actionの別process競合fixtureがなく、startup state / history / snapshot migrationと通常save / append / setLatestがnewer publicationを失わない証拠、partial failure後のlast coherent read証拠がない。state migrationとhistory + snapshot migrationは別lock acquisitionに分割され、sourceが求めたroot単位のstartup read-plan-write全体としても固定されていない。
- required for closure: startup root migrationの所有境界を明示し、sourceに列挙した通常writerとの別process raceとpartial failure recoveryをRed / Greenで固定する。

### T604-R005 — High — `open`

- source severity: `High`（preserved）
- verified progress: Node snapshot `delete`は同じroot lock内でlatest pointer群を再読し、対象snapshotがactiveなら削除をskipする。
- remaining closure condition: production trackerのentries / retention / count / compressed-byte planと複数deleteは依然個別lockへ分割され、同一root-lock transactionではない。複数file pointer、count / byte overflow、pointer更新interleaving、delete failure、restartのfixtureもない。既存T604 testは1 pointerを逐次更新するcaseだけである。
- required for closure: source required actionどおり、active pointers、save中generation、retention、count、bytesのread-plan-deleteを一つのownership transactionとして固定し、列挙済みrace / failure matrixを追加する。

### T604-R006 — High — `open`

- source severity: `High`（preserved）
- verified progress: public `StorageRootLockCoordinator`とcustom store用in-process coordinatorが追加され、state / historyのcustom backendがhost rootへmkdirしない。`test:t604`へ既存T506 custom-store 2 testが含まれ、follow-up local evidenceではpassしている。
- remaining closure condition: source required actionはexisting T506 suite、Node real-filesystem multi-process suite、exact-head CI全stepのGreenを要求する。real-filesystem multi-process suiteは追加されず、fix HEADのCIは観測時点で進行中のため全step success evidenceがない。
- required for closure: Node実filesystem process境界の排他証拠を追加し、fix HEAD一致CI全stepの成功を取得する。

### T604-R007 — Medium — `open`

- source severity: `Medium`（preserved）
- verified progress: `test:t604`はCI専用stepへ配線され、malformed stale testとT506 custom-store testがfocused commandへ追加された。
- remaining closure condition: source required actionのreal multi-process matrix、same-process queueを排除したstate / history競合、lease ownership race、partial acquisition failure、reparse / external sentinel、startup race、snapshot pointer / count / byte、cleanup failure fixtureがない。T506追加分も1 processのshared controlled backend + in-process coordinatorでありOS process境界ではない。
- required for closure: source findingに列挙したproduction multi-process / failure / security matrixを追加し、CI必須stepで実行する。

### T604-R008 — Medium — `open`

- source severity: `Medium`（preserved）
- verified progress: state、history、cache、snapshot constructorへkind-only callbackを渡すproduction wiringが追加された。
- remaining closure condition: startup migrationの`withStorageRootLock`にはdiagnostic sinkが渡されない。追加sinkは`console.warn`であり、source required actionの`Output > Review Range` operation lifecycleへ一度だけ記録するcompositionではない。全operation種別のproduction wiring testもない。
- required for closure: startup migrationを含む共通sinkを既存Output lifecycleへcomposeし、timeout / failure / stale recoveryがpath、repository ID、source、tokenなしで一度だけ記録されるtestを追加する。

### T604-R009 — Low — `open`

- source severity: `Low`（preserved）
- verified progress: design §15.4はaccepted quarantine / reset contractへ更新され、route history / snapshot / lock JSDocとREADME / tasks / phasesのreview状態も更新された。新しいBreakingChanges entryを追加しない判断はsource reviewどおり維持された。
- remaining closure condition: handoffの`current_head`は引き続き`a32ae42e895a17be18173680effa4c537055157e`で、fix HEAD `a256b49114c3cf6f73c0ee4d303593f09187ef8d`をresume identityとして記録していない。`ci: not run`もfix HEADの外部CI進行状態と一致しない。
- required for closure: source required actionどおり、fix後のexact HEAD、CI結論、review / next-action状態をhandoff / trackingへ同期する。

## 結果

### Finding dispositions

| Finding | Severity | Disposition |
| --- | --- | --- |
| T604-R001 | High | `open` |
| T604-R002 | High | `open` |
| T604-R003 | High | `open` |
| T604-R004 | High | `open` |
| T604-R005 | High | `open` |
| T604-R006 | High | `open` |
| T604-R007 | Medium | `open` |
| T604-R008 | Medium | `open` |
| T604-R009 | Low | `open` |

severity reclassification / errataはない。

### Coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| R001 successor-safe lease ownership / fencing | `checked_finding` | partial progress、source race未解消 |
| R002 crash / partial / corrupt acquire recovery | `checked_finding` | malformed mtime recoveryのみ、required fixture不足 |
| R003 root / reparse / TOCTOU boundary | `checked_finding` | path-safe primitiveとfixtureなし |
| R004 startup / recovery lock ownership | `checked_finding` | lock追加、別process / partial failure proofなし |
| R005 active snapshot / bounded cleanup transaction | `checked_finding` | delete-time pointer check追加、full planは分割 |
| R006 custom store / Node process / current-head CI | `checked_finding` | custom code path local Green、Node processとCI結論なし |
| R007 focused / CI failure-security-race coverage | `checked_finding` | CI wiring追加、required matrix不足 |
| R008 privacy-safe production diagnostics | `checked_finding` |主要4 store wiring追加、startup / Output / tests不足 |
| R009 design / docs / handoff identity | `checked_finding` |design / JSDoc更新、handoff HEAD / CI不整合 |

### Held / unexplored / unknown

- held: `H604-001` Markdown wording lint `unsupported`と、`H604-002` T605〜T608の別task scopeをsource reviewどおり維持する。これらはopen findingsと混同しない。
- unexplored: なし。R001〜R009のclosure conditionは全件判定済み。新規観点は明示的scope外で探索していない。
- unknown: fix HEAD CIの最終結論だけ。待機禁止に従い観測時点の`IN_PROGRESS`をsuccessへ変換していない。
- not applicable: independent-final-review freeze / attestation、merge。

### Verdict

`fail`

T604-R001〜R009は全件`open`。source required actionを満たす追加fixとevidenceが必要である。次は同じnormal reviewerへ新規観点なしで、今回openとした各findingの残条件だけを再度closure verificationさせる。

## リスク

R001 / R003 / R005はsourceの中心correctness / security conditionが未解消で、local 9 passやCI wiringだけではacceptance evidenceにならない。R002 / R004 / R007は要求されたprocess / failure fixtureが不足し、R008はdiagnostic destinationとstartup coverageが未完了である。

R006のexact-head CIは進行中であり、成功を推測していない。R009のhandoff identityもfix HEADへ同期されていない。これらのopen判定は新規findingではなく、source required actionの未充足条件である。

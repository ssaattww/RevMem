# T604 independent final review report

## タスク

- Issue: `#72`
- PR: `#73`
- task: `T604`
- review type: fresh independent final review（one-pass）
- frozen review head: `6f779a95da44a2c72cbeae49fa4c0083b472e4aa`
- base: `main` / `96057f9edc95a8f38bfc01da39eae350c29e9c39`
- merge-base: `96057f9edc95a8f38bfc01da39eae350c29e9c39`
- authoritative threat model: Issue #72 の承認コメント `issuecomment-5354717971` および design §15

実装担当および normal reviewer から独立し、frozen HEAD を対象に一度だけ評価した。normal review の R001〜R009 と closure report は再判定材料として読んだが、normal review の再実行ではなく、base...HEAD 全変更と直接依存・consumer・production composition を独立に追跡した。

## sub-agentを使う理由

fresh independent final reviewer 自身が全観点を一巡する必要があり、依頼で sub-agent の使用が禁止されているため使用していない。

## 対象範囲

- `96057f9...6f779a9` の全 changed files 30 件。
- Issue #72 本文・承認コメント、PR #73 本文・head/base/state、design §15、Breaking Changes、README、handoff、tasks/phases、normal review・closure R001〜R009、package/CI wiring。
- lock の atomic acquire、live owner 非奪取、partial/corrupt/stale recovery、owner/lease/fencing、monotonic timeout、複数 process、failure cleanup。
- Context/Global/manifest CAS、history append、startup migration、snapshot/cache cleanup と同一 storage root transaction の整合、deadlock、nested lock、partial success。
- production child-process evidence、kill/restart、新しい publication の保護。
- snapshot active pointer、件数・圧縮 byte・retention、delete failure、restart convergence、history 非削除。
- privacy-safe operation-scope diagnostic の exactly-once と production composition。
- custom `AtomicTextFileStore`、後方互換性、public API、Windows/Node semantics。
- 承認済み threat model 内の security/privacy、design/BreakingChanges、tracking/report、exact-head CI。

脅威モデルは、信頼済み VS Code storage root 内の協調 RevMem process/window、crash、partial I/O、operation 開始時に存在する link/reparse を対象とした。既存 link/reparse の拒否、root 外 sentinel 非接触、検出可能な identity change の fail-closed を確認対象に含めた。

## 対象外

- 同一 host 上の悪意ある actor による ancestor/root の syscall 間 swap、native `openat`、Windows handle-relative rename 相当の保証。Issue 承認コメントと design §15 で明示的に対象外であり、finding にしていない。
- T605〜T608 の機能本体。T604 との契約接続だけを確認した。
- 実装、test/CI の起動または待機、commit、push、PR 操作、tracking 更新。read-only inspection と本予約 report の記入だけを行った。
- normal review の再実行および本 reviewer による再レビュー。

## 実行コマンド

read-only で次を実行した。test、build、lint、CI は起動していない。

- `git rev-parse HEAD`、`git merge-base`、`git status --short`、`git diff --name-status/--stat/--check base...HEAD`
- `git diff 96057f9...HEAD -- <全 changed file>`、`rg` / `Select-String` / `Get-Content` による source・test・design・report・tracking・workflow の相互追跡
- GitHub の Issue #72、承認コメント、PR #73、既存 exact-head check run/job/log の read-only inspection
- `package.json` script と `.github/workflows/ci.yml` の wiring、test file の静的 test 宣言数の確認
- report 記入後の `git rev-parse HEAD`、`git status --short`、未記入トークン検査、report diff check

Markdown wording checker 用の `tools/lint`、`lint:md`、集約 Markdown lint は repository に存在しないため、未存在コマンドを実行せず `unsupported` とした。

## 対象ファイル

base...HEAD の全 changed files:

- `.github/workflows/ci.yml`
- `README.md`
- `doc/design/vscode-review-range-tracker-design.md`
- `handoffs/issue-72-t604-implementation-20260820103944.yaml`
- `package.json`
- `reports/issue-72-t604-implementation-20260820103944.md`
- `reports/issue-72-t604-normal-finding-closure-20260820111448.md`
- `reports/issue-72-t604-normal-finding-closure-r2-20260820114018.md`
- `reports/issue-72-t604-normal-finding-closure-r3-20260820195213.md`
- `reports/issue-72-t604-normal-review-20260820105630.md`
- `reports/issue-72-t604-normal-review-followup-20260820110658.md`
- `reports/issue-72-t604-normal-review-followup-r2-20260820111829.md`
- `reports/issue-72-t604-normal-review-followup-r3-20260820193342.md`
- `src/adapters/github/node-github-pull-request-cache-storage.ts`
- `src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts`
- `src/adapters/persistence-startup-migration.ts`
- `src/adapters/state-repository/atomic-text-file-store.ts`
- `src/adapters/state-repository/contracts.ts`
- `src/adapters/state-repository/index.ts`
- `src/adapters/state-repository/jsonl-review-history-store.ts`
- `src/adapters/state-repository/storage-root-lock.ts`
- `src/adapters/state-repository/validated-file-system-review-state-repository.ts`
- `src/application/non-git-snapshots/index.ts`
- `src/application/operation-feedback/operation-feedback.ts`
- `src/extension.ts`
- `src/t305-extension.ts`
- `src/t405-review-contexts-runtime.ts`
- `tasks/phases-status.md`
- `tasks/tasks-status.md`
- `test/unit/t604-storage-lock-cleanup.test.ts`

直接依存・consumer・composition として、`file-system-review-state-repository.ts`、operation feedback の VS Code host、workspace provider の state/snapshot commit 経路、既存 T506 integration test、design structure test、package scripts と CI job ordering も追跡した。

## 指摘事項

全 criterion の disposition 完了後、次の finding を一括確定した。

**T604-IFR001 — High — lease loss 後の stale writer が publication でき、新しい publication を上書きし得る**

- origin: independent-final-review
- evidence: `storage-root-lock.ts:290-292` は callback の直前・直後だけ `assertOwned()` を行う。`validated-file-system-review-state-repository.ts:311-336` は lease を inner write に渡さず、`file-system-review-state-repository.ts:442-443,470` は Context、Global、manifest を lease assertion なしで順次 publish する。R3 の fencing test (`t604-storage-lock-cleanup.test.ts:205-214`) は最初の lock を release してから successor を取得し、失効中 publication を再現していない。
- impact: renewal failure または I/O stall で lease が expiry を越えた後、successor が recover/publish しても old writer が再開して state/cache/startup publication を行える。末尾 assertion は caller を失敗させるだけで、既に行われた stale publication を巻き戻さない。新しい state の消失または manifest と generation の混在が起こり得る。
- required action: 各不可逆 publication の直前に同じ lease/fencing token を検証し、low-level transaction に lease を伝播する。lease loss 中に successor publication を挟む deterministic test で old writer が一切 publish できないことを確認する。

**T604-IFR002 — High — snapshot generation、latest pointer、cleanup が一つの root transaction ではない**

- origin: independent-final-review
- evidence: `src/application/non-git-snapshots/index.ts:176-195` は `putAndCleanup()` 完了後に別呼び出しで `setLatest()` を行う。adapter 側も `node-non-git-snapshot-adapters.ts:161-173` と `:218-236` で別々に root lock を取得する。interleaving test (`t604-storage-lock-cleanup.test.ts:453` 付近) は `Promise.allSettled` 後、publication 成功時だけ pointer を検査し、この失敗を許容する。
- impact: 二つの lock の間に別 process の cleanup が入り、まだ pointer から参照されていない新 generation を削除できる。その後 `setLatest()` は missing generation で失敗する。workspace provider では state commit と旧 pointer invalidation 後のため、current snapshot evidence を失う partial success になる。
- required action: generation write、save-in-flight 保護、latest pointer publish、件数/byte/retention cleanup を adapter の単一 storage-root transaction に統合し、競合 save/cleanup でも current generation が常に publish・保持される test にする。

**T604-IFR003 — High — startup migration が corrupt snapshot wrapper で同一 root lock を nested acquire する**

- origin: independent-final-review
- evidence: `persistence-startup-migration.ts:163-175` は root lock 内で `migratePersistedMetadata()` を呼ぶ。snapshot `get()` は corrupt wrapper を検出すると `node-non-git-snapshot-adapters.ts:121-140` から public `quarantine()` を呼び、`:177-178` で同じ root lock を再取得する。外側 owner は renewal を続ける。既存 fixture は corrupt latest pointer 経路であり、corrupt wrapper 経路を覆わない。
- impact: inner acquire は live owner を奪えず timeout し、activation startup が quarantine/recovery せず失敗する。要求された corrupt recovery と failure cleanup を満たさない。
- required action: startup transaction の lease を snapshot migration/quarantine に伝播し、既取得 lock 内で再取得しない internal quarantine primitive を使う。corrupt wrapper を seed した production startup test で timeout せず quarantine・収束することを確認する。

**T604-IFR004 — High — custom `AtomicTextFileStore` の lock coordinator 契約が sibling consumer に伝播していない**

- origin: independent-final-review
- evidence: state と history は custom store の `StorageRootLockCoordinator` / in-process fallback を持つ (`validated-file-system-review-state-repository.ts:324-330`、`jsonl-review-history-store.ts:187-192`)。一方 cache は custom store option を持ちながら Node host lock を固定使用 (`node-github-pull-request-cache-storage.ts:24,267`)、snapshot も同様 (`node-non-git-snapshot-adapters.ts:88,105,146,167,178,220,241`)、startup も custom store option と Node host lock の組合せ (`persistence-startup-migration.ts:22,158,163`) で coordinator option がない。custom-store integration evidence は state/history に限られる。
- impact: virtual/alternate namespace の custom store でも無関係な host path を lock/guard し、backend write 前に失敗するか、実データを相互排他できない。R006 closure の後方互換性は変更された全 consumer では成立しない。
- required action: cache、snapshot、startup に同一 coordinator 契約を伝播するか、store が提供する root transaction abstraction に統一し、custom store で全 persistence family の同-root serialization と migration/cleanup を実証する。

**T604-IFR005 — Medium — terminal startup lock diagnostic が production Output host に到達しない**

- origin: independent-final-review
- evidence: `src/t305-extension.ts:76-83` は activation 冒頭で startup migration を `await` し、`registerGlobalUnderstandingRuntime` による operation feedback / `Review Range` Output host の composition は `:321` 以降である。startup が terminal failure を通知して throw すると、host 登録前に activation が終了する。unit evidence は queued diagnostic の後に host を必ず設定するため、この production failure path を覆わない。
- impact: operation-scope exactly-once 実装が queue に一度記録しても、ユーザーが必要とする terminal diagnostic は production で flush/reveal されない。
- required action: startup より前に activation-safe な Output host/feedback boundary を構成するか、startup failure 時にも host を確実に生成・flush する。production composition test で terminal failure が一度だけ表示されることを確認する。

**T604-IFR006 — Medium — permanent design の task ID が exact-head required CI を失敗させる**

- origin: independent-final-review
- evidence: `doc/design/vscode-review-range-tracker-design.md:695` に `T604` が 2 回含まれる。design structure contract は permanent design の `/T\d{3}/` を拒否する。frozen HEAD の既存 GitHub Actions run `32361533368`（push）と `32361536764`（pull_request）はともに unit test で `design-document-structure.test` 1 件が失敗し、539 pass / 1 fail。後続の dedicated T604、Git/GitHub、VS Code test は skipped。
- impact: required exact-head CI は red で merge gate を通過できず、永久 design の task 非依存契約にも違反する。
- required action: §15 を feature/contract 用語に書き換えて task ID を除去し、normal fix/review cycle 後の exact-head required CI を取得する。

**T604-IFR007 — Low — focused evidence の test 数と reviewed identity metadata が不整合**

- origin: independent-final-review
- evidence: `package.json` の `test:t604` は T604 file と T506 integration file を実行するが、静的宣言数はそれぞれ 17 と 2、合計 19。R3 closure、handoff、tasks は「T604 19 + T506 2 = 21」と記録し、PR 本文は「6 passed」と記録する。handoff の `current_head` / `next_request` は `6ff92fb...` だが、frozen/current review head は `6f779a9...`。current exact-head CI は focused step に到達していない。
- impact: closure と handoff を後続 reviewer が正確な検証 evidence / frozen identity として利用できず、再現性と auditability が低下する。
- required action: test 定義、実際の focused result、PR、handoff、tasks/report の count と exact commit identity を一致させ、実在する exact-head evidence のみを記録する。

## 結果

**Coverage disposition**

| criterion | disposition | rationale |
| --- | --- | --- |
| Issue/design/threat-model authority | checked_no_finding | 承認コメントと design §15 を authority とし、hostile syscall-between-check swap は対象外として分離した。 |
| base...HEAD 全 30 changed files | checked_finding | 全件を一巡。design/metadata は IFR006・IFR007。 |
| 直接依存・consumer・production composition | checked_finding | state transaction、snapshot application/provider、startup、feedback host、cache、custom store を追跡。IFR001〜IFR005。 |
| atomic acquire / live owner refusal / partial・corrupt・stale lock recovery | checked_no_finding | private pending file + hard-link publication、live owner refusal、malformed/stale recovery を確認。 |
| owner / lease / fencing / monotonic timeout | checked_finding | acquire/renew/release identity と monotonic wait は確認したが、publication fencing が IFR001。 |
| multiple process / child kill-restart / failure cleanup | checked_finding | real child process の acquire・kill・recovery evidence は確認。lease-loss publication と corrupt startup は IFR001・IFR003。 |
| Context/Global/manifest CAS と partial success | checked_finding | manifest-last は確認したが lease が low-level publication に届かず IFR001。 |
| history append / quarantine / indefinite retention | checked_no_finding | append serialization、future schema fail、corrupt quarantine、snapshot cleanup からの history 非削除を確認。 |
| startup migration / nested lock | checked_finding | 同 root 外側 transaction はあるが corrupt wrapper が nested acquire するため IFR003。 |
| snapshot pointer/count/bytes/delete failure/restart convergence | checked_finding | cleanup accounting と pointer 保護の基本は確認したが save transaction 分断が IFR002。 |
| cache cleanup / pointer-last publication | checked_finding | pointer-last と delete failure recovery は確認。lease/custom coordinator の横断欠陥は IFR001・IFR004。 |
| production newer-publication protection | checked_finding | state generation/CAS evidence はあるが lease loss 後 publication を防がず IFR001。 |
| privacy-safe diagnostic exactly-once | checked_finding | redaction/dedup/queue は確認したが terminal startup の production composition が IFR005。 |
| existing link/reparse refusal / root外 sentinel 非接触 / detectable identity change | checked_no_finding | 承認 threat model 内の guard、Windows junction/link evidence、fail-closed を確認。 |
| custom `AtomicTextFileStore` / backward compatibility / public API | checked_finding | additive optional API と state/history fallback は確認。cache/snapshot/startup の不整合が IFR004。 |
| Windows/Node semantics | checked_no_finding | pending file + `link` publish、`lstat`/`realpath` guard、Windows junction evidenceを threat model 内で確認。 |
| Breaking Changes | checked_no_finding | 現状の option/API は additive であり `Design/BreakingChanges.md` 追記必須の破壊的変更は認めない。 |
| README/tasks/phases/handoff/reports | checked_finding | scope/closure は読了。test count/head identity の不整合が IFR007。 |
| package/CI wiring | checked_finding | dedicated script/step は wiring 済みだが exact-head unit failure が IFR006。 |
| normal R001〜R009 closure evidence | checked_finding | 全 closure を再判定材料に使用。R006/R008/R009 相当の未閉鎖が IFR004/IFR001/IFR005 として独立に再発見された。 |

**Held と required finding の分離**

- `held`: exact-head CI merge gate。既存 run は frozen HEAD と一致するが 2 run とも failure。原因となる source/design defect 自体は held ではなく required finding `T604-IFR006`。
- `held`: Markdown wording/lint。repository に focused/full/aggregate Markdown lint wiring がなく `unsupported`。pass と主張しない。
- `held/not_applicable`: T605〜T608 の機能 validation と、承認 threat model 外の malicious syscall 間 ancestor swap/native primitive 保証。
- `unexplored`: なし（0）。

**既存 validation evidence の評価**

- local report の build/compile/typecheck/lint/architecture と `test:t604` 記録は確認したが、IFR007 の count/identity 不整合があるためそのまま独立 attestation には使わない。
- frozen HEAD の既存 exact-head CI では build、contract typecheck、architecture positive/negative、ESLint は pass。unit は 539 pass / 1 fail で、後続 test は skipped。
- reviewer は test/CI を起動または待機していない。

**Verdict**: `fail`

High 4 件、Medium 2 件、Low 1 件の required finding がある。T604 completion/merge-ready と判定できない。normal implementation/review cycle で全 finding を修正し、fresh exact-head validation を得た後、別の fresh independent final reviewer が全範囲を一度だけ再評価する必要がある。本 reviewer は再レビューしない。

**Report attestation**

- `report_attestation_allowed: false`
- 理由: verdict が `pass` / `pass_with_held` ではなく `fail` であり、required finding が未解消。
- 将来の allow 条件: IFR001〜IFR007 の normal closure、更新後 frozen HEAD の required CI green、Markdown lint は wiring が追加されれば green（追加されなければ unsupported/held を明示）、新しい independent final review が unexplored 0 で `pass` または妥当な `pass_with_held` を出すこと。

## リスク

- stale writer、分断された snapshot transaction、startup nested lock は、通常の成功系 evidence が green でも crash/lease-loss/複数 process の境界で state loss、current snapshot loss、activation failure を起こすため、merge 前に修正が必要。
- custom store の不整合は test double だけでなく将来の alternate persistence backend の排他契約を壊す。
- startup diagnostic の production composition 欠落は、まさに terminal failure 時にユーザー向け情報を失う。
- exact-head CI が red のままなので、現在の local closure report を merge evidence として扱えない。
- report metadata 不整合を残すと次回 reviewer が異なる commit/test 集合を評価する危険がある。

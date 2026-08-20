# T605 independent final review report

## タスク

T605 / Issue #74 / draft PR #75 の fresh independent final review。review mode は `independent final review`、reviewer は normal reviewer と実装者のいずれとも異なる `sol`（reasoning effort `high`）である。repository は `ssaattww/RevMem`、local review branch は `review/t605-independent`、PR branch は `task/t605-multi-root-remote-boundaries`。reviewed implementation HEAD は frozen `e5eb2caa851e7bf2439257e42ff883bbfcbf12cf`、base は `origin/main` の `64e47c590960a810a2439bd33f250ecbda9c41bf`、review range は `64e47c590960a810a2439bd33f250ecbda9c41bf...e5eb2caa851e7bf2439257e42ff883bbfcbf12cf`。local HEAD、remote PR head、指定 frozen HEAD は review 開始時に一致した。この technical verdict は reviewed implementation HEAD だけに適用する。

## sub-agentを使う理由

使わない。親の明示指示により sub-agent は禁止されており、この fresh reviewer が一度だけ全範囲を単独で検査した。実装、normal review、normal review fix、self-fix、test/build/lint/CI の再実行、CI の起動・待機、GitHub/PR/Issue/code/tracking/branch の変更、commit、push、merge は行っていない。

## 対象範囲

Authoritative source は親の review 指示、repository `AGENTS.md`、Issue #74、draft PR #75、`Design/BreakingChanges.md`、`doc/design/document-context-routing.md`、`doc/design/vscode-review-range-tracker-design.md`、tasks/phases、T605 implementation/normal/follow-up/closure reports と handoffs の順に照合した。base...frozen HEAD の全 32 changed filesを読み、document owner provider、workspace snapshot wrapper、startup migration、state/history/snapshot route、T405 Current Context/PR acquisition、T602 recovery、T603 migration、T604 lock/cleanup、package/CI consumerまで追跡した。

Criterion disposition は次のとおり。`pass` は review-worker の `checked_no_finding`、`fail` は `checked_finding`、`held` と `not-applicable` は同名 disposition に対応する。

| Criterion | Disposition | Evidence / result |
| --- | --- | --- |
| Reviewer independence / immutable target identity | `pass` | fresh reviewer、normal/implementation と別 identity、base/HEAD/range 一致。 |
| Issue / design conformance | `fail` | root removal lifecycle は T605-IFR-001、URI fail-closed は T605-IFR-002、authoritative persistence contract と CI は T605-IFR-003。 |
| Longest root / nested / same-name / outside root | `pass` | scheme・authority・canonical path による一意な最長一致と outside-root rejection を実装・fixtureで確認。 |
| Untitled / virtual / query / fragment boundaries | `fail` | helper 単体は fail-closed だが production Git owner と Current Context consumer に T605-IFR-002。 |
| Remote scheme / authority / workspace-side path semantics | `pass` | `extensionKind: ["workspace"]`、workspace-side `process.platform`、`vscode-remote` authority identity、workspace-side Git/fs adapterを維持。 |
| Multi-root add / remove / change / dispose | `fail` | reconcile は map entry を削除するが active-root stateを保持せず、in-flight/stale sessionが runtimeを再生成できる T605-IFR-001。 |
| Non-Git review state / snapshot / root storage isolation | `pass` | canonical workspace identityごとの `storageUri/workspaces/<hash>` route、typed snapshot commit、restart mappingを実経路まで確認。 |
| History isolation / snapshot-history recovery | `fail` | production route は root-scopedだが stale authoritative design/test と exact-head failureが T605-IFR-003。 |
| Same repository in multiple roots / Current Context / Git-PR source identity | `pass` | candidate key が repository root を保持し、ambiguous repository ID は active repositoryへ束縛し、不一致を拒否。 |
| Git/PR state in `globalStorageUri` | `pass` | Git、PR、external-file route と cache は既存 global routeを維持。 |
| T602 history-rewrite recovery | `pass` | registry が stable tracker capabilityを保持し、persisted provider registration/capture/recovery consumerと focused suiteを確認。 |
| T603 startup migration / corruption recovery | `pass` | `workspaces/<64-hex>` 列挙、repository ID hash照合、root lock下の state/history/snapshot migrationを確認。 |
| T604 lock / cleanup / privacy-safe diagnostics | `pass` | hashed rootごとの state/history/snapshot/lock routeと既存 positive/negative T604 evidenceを確認。threat model外の same-host malicious syscall swap/native primitiveは要求していない。 |
| Activation / restart / concrete composition | `fail` | initial/restart composition は通るが、removed-root in-flight commitの lifecycle gapが T605-IFR-001。 |
| Public API / data / storage / backward compatibility | `fail` | additive typed APIと BreakingChanges 記録は妥当だが、旧 `storageUri/history` を残す authoritative design conflictが T605-IFR-003。 |
| Failure handling / security / privacy / secret handling | `fail` | secret/log/privacy regressionはない。URI suffix/virtual boundaryの fail-closed gapのみ T605-IFR-002。 |
| Tests / package / workflow wiring | `fail` | T605 focused commandは存在するが lifecycle/URI/history regressionを閉じず、exact-head CIが T605-IFR-003 で失敗。 |
| Reports / handoffs / tasks / phases / README | `pass` | historical evidenceと frozen stateは追跡されている。current CI failureは本 reportで新たに明示する。 |
| Scope discipline / unrelated changes | `pass` | changed filesは T605実装、検証、design、tracking、review evidenceに限定。 |
| Regression / maintainability | `fail` | required findings 3件。 |
| Markdown wording gate | `held` | repo-local `tools/lint/`、`lint:md`、`cspell.config.jsonc` がなく focused/full とも `unsupported`。passへ変換しない。 |
| Future exact-head pull_request CI merge gate | `held` | findings修正後の新 frozen lifecycleと、許可される場合のattestation後 exact headで ownerが取得・判定する。現 frozen HEADのCI failure自体は T605-IFR-003。 |
| Remote SSH / Dev Containers / Codespaces service/network E2E | `not-applicable` | Issue #74 の明示対象外。 |
| T606以降 / T608 final acceptance / merge | `not-applicable` | Issue #74 と reviewer権限の対象外。 |

`unexplored: none`。すべての required criterion を `pass`、`fail`、`held`、`not-applicable` のいずれかへ処分した。

## 対象外

Remote SSH / Dev Containers / Codespaces サービス自体の起動・network E2E、T606以降、T608の初期版全体 acceptance、同じhost上の攻撃者によるsyscall間ancestor swap/native filesystem primitive、implementation/self-fix、CIの起動・待機、report以外のrepository write、commit/push/mergeは対象外。

## 実行コマンド

Read-only evidence取得として `git status --short --branch`、`git rev-parse`、`git branch --show-current`、`git log`、`git diff --name-status`、`git diff --stat`、file-scoped `git diff`、`Get-Content`、`rg`、`gh issue view 74 --repo ssaattww/RevMem`、`gh pr view 75 --repo ssaattww/RevMem`、`gh run view 32372770898 --json` / `--log-failed`、`gh run view 32372765809 --json` / `--log-failed` を使用した。test/build/typecheck/lint/architecture/diff-checkは再実行していない。

提供済み local evidence は `npm run test:t605` 62 passing、`npm run build`、`npm run compile:test`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check` success。これらを再利用した。frozen HEADに一致する pull_request CI `32372770898` と push CI `32372765809` は build、contract typecheck、architecture正負、lint、Unit tests、T602 focusedまで成功したが、T603 schema migration stepの `review-history-jsonl-store.test` が旧workspace history path expectationで失敗し、後続 T403〜T605、Git/GitHub、Extension Host stepsはskipped。したがって current-head CI は Green evidenceではない。

## 対象ファイル

Changed files全件: `.github/workflows/ci.yml`、`Design/BreakingChanges.md`、`README.md`、`doc/design/document-context-routing.md`、T605 handoff 3件、`package.json`、T605 report 6件、`src/adapters/document-review-state/document-review-state-session-provider.ts`、`reconciled-document-review-state-session-provider.ts`、`src/adapters/persistence-startup-migration.ts`、`src/adapters/state-repository/storage-router.ts`、workspace-review-state 4 files、workspace-identity 2 files、`src/extension.ts`、`src/t305-extension.ts`、`src/t405-review-contexts-runtime.ts`、`src/t405-root-scoped-candidate-identity.ts`、tasks/phases 2 files、`test/unit/ci-workflow-contract.test.ts`、`state-repository.test.ts`、`t605-multi-root-remote-boundaries.test.ts`。

直接依存 / consumerとして persisted/Git-context document providers、snapshot-tracking workspace provider、T601 snapshot tracker/storage、T602 recovery coordinator、T603 schema recovery/history migration、T604 storage lock/cleanup、state repository全 route consumer、JSONL history store、Current Context selection/runtime、T405 PR cache/acquisition/diff reader、T505 working-tree opener、package scripts、CI workflow、および関連 unit/integration/Extension Host wiringを確認した。

## 指摘事項

1. **T605-IFR-001 — severity: medium — origin: independent final review — location: `src/adapters/workspace-review-state/workspace-root-runtime-registry.ts:39-117`。** Description: registry は `reconcileWorkspaceRoots` で一時的な `active` setを作って既存 runtimeを削除するだけで、active root集合やroot generationを保持しない。`open`、`loadForDecoration`、`commitWithSnapshot` は常に `runtimeFor` を呼び、削除済みrootのdescriptorでも factoryからruntimeを再生成する。Impact: root removalがworkspace sessionのopen/commitと競合すると、disposed扱いにしたrootが再生成され、現在ならexternal ownerへ再解決すべきdocumentのworkspace state/snapshot commitがremoved rootへ成功し得る。root追加・削除・disposeを反映し、削除rootのruntimeを破棄するACとfail-closed contractを満たさない。Evidence: lines 77-94 のactive setはmethod終了後に失われ、lines 106-117 にactive membership checkがない。focused testはroot A/Bを`open`で直接生成し、reconcile後は`size`だけをassertし、removed rootのstale open/commit rejectionやconcrete `dispose`を実行しない。Required action: registryにcanonical active-root ownershipとgenerationを保持し、removed/inactive generationからのopen/load/commitをrejectする。root removalとin-flight open/mark/unmarkを競合させ、removed runtimeが再生成・publishされず、re-add時も旧sessionが流用されないproduction-chain regressionを追加する。

2. **T605-IFR-002 — severity: medium — origin: independent final review — location: `src/adapters/document-review-state/document-review-state-session-provider.ts:205-223,246-265,314-326`、`src/t305-extension.ts:188-241`。** Description: canonical document URI helperはquery/fragmentをrejectするが、`validateDescriptor`はそれを呼ばず、Git ownerを先に解決した場合はcanonical URI validationを一度も通らない。このため `file` / `vscode-remote` URIにqueryまたはfragmentがあるdocumentが同じ`fsPath`のGit stateへrouteされる。また Current Contextのworkspace-folder列挙は filesystem scheme/query/fragment eligibilityを検査せず、virtual rootをworkspace contextとして投影できる。Impact: Issue/designがfail-closedを要求するvirtual/suffix URIがproduction command/Current Context境界を迂回し、URI identityを失ったGit state操作または操作不能なworkspace candidateを作る。Evidence: Git branchはline 257でURI canonicalization前に入る一方、reject functionはexternal mappingまたはworkspace identityでしか使われない。T605 fixtureはpure membership helperだけを検査し、production owner router/Current Contextを通らない。Required action: production descriptor入口でfilesystem schemeとempty query/fragmentをGit inspection前に検証し、Current Contextも同じURI eligibility/membership ruleを共有する。Git repository内のsuffix URI、virtual workspace root、untitled、outside URIをproduction compositionでfail-closedにする回帰testを追加する。

3. **T605-IFR-003 — severity: medium — origin: independent final review / exact-head CI — location: `doc/design/vscode-review-range-tracker-design.md` §15.4、`test/unit/review-history-jsonl-store.test.ts:132-170`、`package.json:147`、CI runs `32372770898` / `32372765809`。** Description: root-scoped history layoutへ変更したのに、authoritative design §15.4 と既存 history regressionはなお `storageUri/history/events-YYYY-MM.jsonl` を要求する。T605 focused commandにもこの history suiteが含まれない。Impact: design sourcesが相互矛盾し、提供済み62-pass focused evidenceがhistory layout regressionを検出せず、frozen exact-head pull_request/push CIはT603 stepで失敗してT605を含む全後続gateをskipする。Evidence: production pathは実際に `storageUri/workspaces/<hash>/history/...` を返し、CI failure logもactual pathをその形で示す一方、test line 167はlegacy regexをassertする。Required action: master designとhistory regressionを承認済みroot-scoped layoutへ同期し、異なるworkspace ownerのhistory非混線をassertする。同suiteをT605 focused coverageへ含め、全 validation後にnormal fix verificationとfresh independent lifecycleをやり直す。

Required findings: 3（medium 3、high 0、low 0）。severity reclassification / errata: none。

## 結果

**Verdict: `fail`。** reviewed implementation HEAD `e5eb2caa851e7bf2439257e42ff883bbfcbf12cf` に required findings 3件がある。held は Markdown wording gate unsupported と、findings修正後の新 frozen/attestation exact-head pull_request CI merge gate。`unexplored: none`。

`report_attestation_allowed: false`。技術 verdict が `pass` / `pass_with_held` ではなく required finding が残るため、本reportを frozen HEAD直後のadministrative attestation commitとして受理してはならない。修正を行う場合は frozen stateを失効させ、normal fix verification、全 pre-freeze同期、新しいfresh independent final reviewを行う必要がある。将来 attestation が許可される条件は、単一commitが新 reviewed implementation HEADの直後にあり、first parentがそのHEADで、本予約report pathだけを変更し、他path変更と後続non-attestation commitがないこと。attestation SHAはcommit後にbranch外で記録する。

Reserved report path: `reports/issue-74-t605-independent-final-review-20260820221041.md`。mergeは許可しない。

## リスク

Remaining riskは、Issue対象外の実Remote service/network環境差、repo-local Markdown wording automation不在、およびcurrent exact-head CIでT603 failure後にskipされた後続workflow gates。これらのうちCIは finding修正後の新 lifecycleでGreenを取得するmerge gateとしてownerが解消する。review終了時の Git HEAD は `e5eb2caa851e7bf2439257e42ff883bbfcbf12cf` のまま。worktreeは予約reportだけがuntracked/modified対象で、他pathはcleanである。

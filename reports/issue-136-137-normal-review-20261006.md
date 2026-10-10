# Sub-agent実行レポート

## タスク

- 目的: Issues #136/#137 の実装を通常レビューし、要求・設計・変更範囲・validationに対する指摘を出す。
- タスク種別: 初回通常レビュー。
- 対象identity: `issue-136-137-refresh-and-safe-diagnostics`; reviewed implementation HEAD `479e27a9265f01be33ed1a1e6182edd56cdb6e44`; base `a479bf5cf2b35f342a8dab90dc886a19d8233520`。
- 要件: Issue #136共通refresh経路と失敗時のCurrent Context/PR Progress処理、Issue #137 operation/generationと相関した秘匿診断。
- 設計根拠: `doc/design/vscode-review-range-tracker-design.md` のCurrent Context / PR Progress節、[Issue #136設計コメント](https://github.com/ssaattww/RevMem/issues/136#issuecomment-6007647587)、[Issue #137設計コメント](https://github.com/ssaattww/RevMem/issues/137#issuecomment-6007653447)。

## sub-agentを使う理由

- 理由: 実装者と分離したレビューで複数runtime層の契約・回帰を確認するため。

## 対象範囲

- 対象: Current Context / Review Contextsの共通refresh coordinator、generation/supersession、selectionとfail-closed behavior、PR Progress計算/公開、diagnostic allowlistと相関、T405経路および関連テスト・設計・task tracking。
- 必須観点: Issue要件と設計、選択の維持/曖昧時のbranch/no-PR、refresh失敗、snapshot未取得/空/失敗、競合、privacy、operation terminal semantics、既存API互換、validation、文書とtrackingの整合。

## 対象外

- 対象外: 実機UI確認、Extension Host実行結果の推測、依存追加、認証/権限/環境変更、外部投稿、Issue/PR作成、push、merge、deploy。
- Extension HostはVS Code version resolverでhost起動前に失敗しており、device UIは未検証として保持する。

## Dispatch profile

<!-- This section is parent-owned. The child must not infer or rewrite hidden runtime state or authorization evidence. -->

- selection inputs (parent, pre-dispatch): task_kind=review; work_class=judgment_heavy; uncertainty=high; change_radius=cross_module; criticality=high (concurrency and privacy boundary); repetition=single; context_need=fresh.
- selection source (parent, pre-dispatch): `/workspace/CodexSkill/skills/sub-agent-task-manager/references/agent-profile-selection.md`。
- observed decomposability (parent, pre-dispatch): sequential_dependencies; shared coordinator, feedback boundary, and composition fixtures must be reviewed as one behavior path.
- decomposition policy / disposition (parent, pre-dispatch): forbidden / prohibited_by_review_lifecycle; one normal reviewer retains finding continuity.
- proposed profile (parent, pre-dispatch if applicable): none。
- approval status / evidence (parent): no expensive-profile approval required for Sol high。
- requested profile (parent, pre-dispatch): `gpt-6.1-sol`, reasoning `high`。
- agent role / default-role plan (parent, pre-dispatch): dedicated normal reviewer in the collaboration sub-agent runtime; no `agent_type` selector is exposed by its spawn tool.
- role config evidence / profile effect (parent, pre-dispatch): no workspace `.codex` agent configuration files are present; model and reasoning are explicit spawn overrides. Runtime role/application remains unobservable.
- planned runtime profile after known role constraints (parent, pre-dispatch): model `gpt-6.1-sol`, reasoning `high`; requested explicit override.
- applied profile (parent, post-runtime exact evidence only; null when unverified): null。
- application status (parent, post-runtime evidence only): `spawn_succeeded_profile_unverified`。
- runtime profile observability (parent, post-runtime): requested overrideとspawn成功のみを観測。runtimeがfinal model/reasoningを親へ返さないため、exact applied profileはunverified。
- reviewer continuity (parent, if applicable): initial normal reviewer; use same reviewer for any required fix verification while available。
- fork policy (parent): `fork_turns: "none"`; inspect current repository directly.
- reasons / constraints (parent): no nested Codex, `codex exec`, or agent-spawning; do not re-enter `development-orchestrator`; do not modify implementation files.

## 実行コマンド

- Parent validation: `npm run lint` (pass); `npm run compile:test` (pass); Issue #136/#137 tooling tests (2/2 pass); `npm run test:t305` (71/71 pass); `npm run test:t405` (85/85 pass); `npm run test:t606` (235/235 pass); `npm run test:t609` (92/92 pass); `git diff --check` (pass)。
- Extension Host: `npm run test:t609:extension-host` attempted before current review; runner stopped at VS Code version resolution before host startup; no pass claimed。
- Reviewer: review commands/evidenceを追記する。


### Reviewer commands and evidence (2026-10-06)

- Environment: runtime-local Linux container, Bash, `/workspace/RevMem`, Node `v24.19.0`; repository `ssaattww/RevMem`. Branch and HEAD observed before and after review: `issue-136-137-refresh-and-safe-diagnostics`, `479e27a9265f01be33ed1a1e6182edd56cdb6e44`. Source ownership: read-only implementation; only this report is writable. `git status --short` showed only this untracked report; no implementation drift occurred.
- `verification_capability: local_execution_available`: installed Node/TypeScript/ESLint executed successfully. Commit state: implementation committed; reviewer report pending parent persistence. Push/CI wait: not required for this local-only review; no PR or matching CI is supplied. No host/device result is inferred from unit tests.
- Instructions/context reads: `cat AGENTS.md`; `cat /workspace/CodexSkill/AGENTS.md`; `cat .agents/skills/work-context-manager/SKILL.md .agents/skills/review-worker/SKILL.md`; `cat reports/issue-136-137-normal-review-20261006.md`; `cat package.json`; source/test/design reads using `cat`, `sed -n`, and `nl -ba` at the finding locations and inspected paths below. The explicit reviewer assignment overrides the repository's generic development-orchestrator entry instruction.
- Discovery: `pwd`; `rg --files -g 'AGENTS.md' -g 'SKILL.md' -g '*136*' -g '*137*' -g '*review*20261006*'`; `git status --short`; `git branch --show-current`; `git rev-parse HEAD`; `git diff --stat a479bf5cf2b35f342a8dab90dc886a19d8233520 479e27a9265f01be33ed1a1e6182edd56cdb6e44`; `git diff --name-only` with the same full range. Entire 22-file diff inspected using `git diff a479bf5 479e27a -- src doc tasks` and `git diff a479bf5 479e27a -- test`, followed by focused reads to recover output truncation.
- Read-only GitHub calls: `github_fetch_issue` with `repository_full_name: ssaattww/RevMem`, `issue_number: 136` and `137`; `github_fetch_issue_comments` with `repo_full_name: ssaattww/RevMem`, `issue_number: 136` and `137`. All four succeeded; Issue bodies and exact design comments `6007647587` / `6007653447` were read. No GitHub write occurred.
- Dependency searches: `rg -n` for refresh helpers, preparation acceptance, list/diff registration, selection resolution, diagnostic formatting/sanitization, cancellation, and failure tests across `src` and the changed test files. `rg -n '"(no-matching-pr|ambiguous-pr-match|explicit-selection-kept|unique-pr-match)"' src` found declarations/allowlists only, no emitters (finding 006).
- Exploratory path corrections: initial `rg` used nonexistent `docs` (correct directory is `doc`); speculative reads of `pull-request-progress-diagnostics.ts`, `t405-current-pull-request-selection.ts`, `current-context-fallback.ts`, and `vscode-github-authentication-adapter.ts` failed because those names do not exist. Resolved actual paths via `rg --files`; these discovery errors are not validation failures or blockers.
- `npm run lint && ./node_modules/.bin/tsc -p tsconfig.test.json --noEmit && git diff --check a479bf5 479e27a`: exit 0. Lint and test-source typecheck passed; no compile artifacts were written by this command.
- Focused existing suites (exit 0; 78 tests, 78 pass):

```sh
node --test test/tooling/issue-136-refresh-coordinator.test.mjs test/tooling/issue-137-pr-progress-diagnostics.test.mjs test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/t405-pull-request-review-runtime.test.js test-dist/test/unit/t305-projection-refresh.test.js test-dist/test/unit/issue-90-diagnostics-and-cancellation.test.js
```

- Composition/compatibility/cancellation existing suites (exit 0; dot reporter printed 56 passing test dots):

```sh
node --test --test-reporter=dot test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/issue-84-pr85-review-closure-followup.test.js test-dist/test/unit/t609-review-contexts-cancellation-boundary.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t609-gate-wiring.test.js test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-ui.test.js
```

- Existing compiled inputs were bound to this source without filesystem writes: the following exact command emitted through an in-memory callback and compared every JavaScript output to `test-dist`. Exit 0, `emitSkipped=false`, `checkedJavaScript=416`, `mismatches=[]`. This establishes that probes and existing suites used outputs matching the current committed TypeScript source.

```sh
node <<'NODE'
const ts=require('typescript'), fs=require('node:fs'), cp=require('node:child_process');
const config=ts.getParsedCommandLineOfConfigFile('tsconfig.test.json',{},ts.sys);
const program=ts.createProgram(config.fileNames,config.options);
let checked=0; const mismatches=[];
const result=program.emit(undefined,(file,text)=>{if(file.endsWith('.js')){checked++;if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==text)mismatches.push(file)}});
console.log(JSON.stringify({emitSkipped:result.emitSkipped,checkedJavaScript:checked,mismatches}));
if(result.emitSkipped||mismatches.length)process.exitCode=1;
NODE
```

- Probe A: exact read-only inline Node command, exit 0. Assertions deliberately confirm defects; this is reproduction evidence, not passing product acceptance. Uses production coordinator and public production feedback exports with synthetic ports/values; does not modify source or add tests.

```sh
node <<'NODE'
const assert = require('node:assert/strict');
const { OperationFeedback, formatOperationLogEntry, queueOperationStartDetails, describePullRequestProgressFile } = require('./test-dist/src/application/operation-feedback/index.js');
const { CurrentContextRuntimeCoordinator } = require('./test-dist/src/ui/current-context/current-context-runtime-coordinator.js');
const host = logs => ({showBusy(){},clearBusy(){},appendLog(x){logs.push(x)},revealLog(){},isDetailedDiagnosticsEnabled(){return true}});
(async () => {
 const logs=[]; const feedback=new OperationFeedback(host(logs));
 queueOperationStartDetails('PR進捗を計算', [describePullRequestProgressFile({path:'private-fixture/secret.ts',totalLineCount:1,excluded:false})]);
 await feedback.run('PR進捗を計算', async c => feedback.reportPullRequestRefresh(c,{generation:1,trigger:'review-contexts-refresh',stage:'pr-progress',status:'succeeded',counts:{snapshotFiles:1}}));
 const rendered=logs.map(formatOperationLogEntry);
 assert(rendered.some(x=>x.includes('private-fixture/secret.ts')));
 assert(rendered.find(x=>x.includes('PR Progress refresh')).includes('ERROR'));
 assert(!rendered.find(x=>x.includes('PR Progress refresh')).includes('generation='));
 console.log('Diagnostic probe confirmed raw path leak and missing/mislabelled refresh payload:', rendered);
 const plain=[]; const p=new OperationFeedback({...host(plain),isDetailedDiagnosticsEnabled(){return false}});
 await p.run('Review Contextsを更新',async c=>p.reportPullRequestRefresh(c,{generation:1,trigger:'review-contexts-refresh',stage:'current-context',status:'started'}));
 assert.equal(plain[0].operationId,undefined); assert.equal(plain.at(-1).operationId,undefined);
 console.log('Default lifecycle probe:',plain.map(x=>({event:x.event,operationId:x.operationId})));
 let rejectOld, oldStarted; const oldGate=new Promise((_,reject)=>{rejectOld=reject}); const begun=new Promise(r=>{oldStarted=r});
 let selected; let tree='old'; let call=0;
 const coordinator=new CurrentContextRuntimeCoordinator({refresh:async()=>({snapshot:{context:{kind:++call===1?'branch':'pull-request',selection:{kind:call===1?'branch':'pull-request'}}},stale:false})},{setSelectedContext:x=>selected=x,refreshDependents:async c=>{if(c.generation===1){oldStarted();await oldGate;}else{tree='new-success'}},clearPullRequestProgress:()=>{tree='CLEARED'}});
 const first=coordinator.refreshFromReviewContexts(); await begun; await coordinator.refreshFromReviewContexts(); assert.equal(tree,'new-success'); rejectOld(new Error('old list failed')); await first; assert.equal(selected.kind,'pull-request'); assert.equal(tree,'CLEARED');
 console.log('Supersession probe: stale branch dependency failure cleared newer PR tree; selected kind=',selected.kind,'tree=',tree);
})().catch(e=>{console.error(e);process.exitCode=1});
NODE
```

- Probe A observed Output: `DETAIL op=1 PR進捗を計算 reason=included ... target=private-fixture/secret.ts`; a successful refresh was formatted as `ERROR op=1 PR Progress refresh` with no generation/stage/status/counts; default lifecycle IDs were `[started: undefined, refresh: 1, succeeded: undefined]`; stale branch failure left selected kind `pull-request` while its newer successful tree became `CLEARED`.
- Probe B: exact read-only command, exit 0. Loads real T405 source via its public registration API and real Current Context composition/runtime, with a minimal VS Code host stub. Repository listing failure is injected after a successful verified local branch acceptance; no host is launched and no network/storage is used.

```sh
node <<'NODE'
const assert=require('node:assert/strict'), Module=require('node:module');
const disposable={dispose(){}}; const providers=new Map(); const errors=[];
const vscode={EventEmitter:class {event=()=>disposable;fire(){}dispose(){}},TreeItem:class{},ThemeIcon:class{},TreeItemCollapsibleState:{None:0},StatusBarAlignment:{Left:1},workspace:{textDocuments:[],workspaceFolders:[],getConfiguration(){return {get(){return undefined}}}},authentication:{getSession:async()=>undefined},window:{createTreeView:()=>disposable,registerTreeDataProvider:(id,p)=>{providers.set(id,p);return disposable},createStatusBarItem:()=>({show(){},hide(){},dispose(){}}),onDidChangeActiveTextEditor:()=>disposable,showErrorMessage:async e=>errors.push(e)},commands:{registerCommand:()=>disposable}};
const load=Module._load;Module._load=function(request,...args){return request==='vscode'?vscode:load.call(this,request,...args)};
const {registerT405ReviewContextsRuntime}=require('./test-dist/src/composition/review-contexts/review-contexts-runtime.js');
const {registerCurrentContextRuntime}=require('./test-dist/src/ui/current-context/vscode-current-context-runtime.js');
const {CurrentContextRuntimeComposition,CurrentContextCandidateSelection}=require('./test-dist/src/ui/current-context/index.js');
Module._load=load;
(async()=>{
 let failure=false; let selection; let cleared=0;
 const branch={context:{kind:'branch',label:'checked-out',headRevision:'new-head',selection:{kind:'branch',repositoryId:'opaque',repositoryRoot:'/fixture',branchRef:'refs/heads/checked-out'}},progress:undefined};
 const context={subscriptions:[],globalStorageUri:{fsPath:'/unused'},storageUri:{fsPath:'/unused'},workspaceState:{get:(_,d)=>d}};
 const review=registerT405ReviewContextsRuntime({context,git:{},enumerateCurrentContexts:async()=>[],refreshDecorations:async()=>{},refreshCurrentContext:async()=>{},registerPullRequestReviewDiff:()=>{},getPullRequestReviewProgress:async()=>{},reviewStateRepository:{listRepositoryContexts:async()=>{if(failure)throw new Error('PR list acquisition failed');return []}},reviewHistoryRecorder:{}});
 await new Promise(r=>setImmediate(r));
 const composition=new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(),{enumerateCandidates:(s,c)=>review.augmentCurrentContextCandidates([branch],s,c),resolveFallback:async a=>a[0],requestSelection:async()=>undefined});
 const runtime=registerCurrentContextRuntime(context,{recompute:(s,c,o)=>composition.recompute(s,c,o),selectContext:async()=>branch},{setSelectedContext:s=>selection=s,refreshDependents:async()=>{},clearPullRequestProgress:()=>{cleared++}},e=>errors.push(e));
 await runtime.startupRefresh;assert.equal(selection.kind,'branch'); failure=true;
 await assert.rejects(()=>runtime.refreshFromReviewContexts({owner:{},id:1}));
 assert.equal(selection,undefined);assert.deepEqual(providers.get('reviewRange.currentContext').getChildren(),[]);
 console.log('Production acquisition failure probe: verified new branch discarded; Current Context items=0, selected=',selection,'PR clears=',cleared);
})();
NODE
```

- Probe B observed: `Current Context items=0`, `selected=undefined`, `PR clears=1`. This reproduces the early acquisition path missed by the new unit test, which supplies an already accepted branch and fails only its dependents.
- Probe C: exact read-only command, exit 0. Uses the production feedback/coordinator/dependent-refresh helper and a notifier equivalent to the production UI-only PR error callback.

```sh
node <<'NODE'
const assert=require('node:assert/strict');const {OperationFeedback,setActiveOperationFeedback,formatOperationLogEntry}=require('./test-dist/src/application/operation-feedback/index.js');const {CurrentContextRuntimeCoordinator}=require('./test-dist/src/ui/current-context/current-context-runtime-coordinator.js');const {refreshCurrentContextDependents}=require('./test-dist/src/application/review-context/projection-refresh.js');
(async()=>{const logs=[];const feedback=new OperationFeedback({showBusy(){},clearBusy(){},appendLog:x=>logs.push(x),revealLog(){}});setActiveOperationFeedback(feedback);let notified=0;const coordinator=new CurrentContextRuntimeCoordinator({refresh:async()=>({snapshot:{context:{kind:'pull-request'}},stale:false})},{refreshDependents:async c=>refreshCurrentContextDependents({refreshReviewContexts:async()=>{},refreshPullRequestProgress:async()=>{c.report('pr-progress','failed',{reasonCode:'refresh-failed'});throw new Error('progress failed')},refreshDecorations:async()=>{},refreshGlobal:async()=>{},reportPullRequestProgressError:async()=>{notified++}})});await feedback.run('Review Contextsを更新',c=>coordinator.refreshFromReviewContexts(undefined,c));setActiveOperationFeedback(undefined);assert.equal(notified,1);assert(logs.some(x=>x.pullRequestRefresh?.status==='failed'));assert.equal(logs.at(-1).event,'succeeded');console.log('Composed handled failure probe:',logs.map(formatOperationLogEntry));})().catch(e=>{console.error(e);process.exitCode=1});
NODE
```

- Probe C observed sequence: `START`; `REFRESH ... current-context status=started`; `REFRESH ... pr-progress status=failed reason=refresh-failed`; `REFRESH ... tree-publication status=succeeded`; `OK Review Contextsを更新`. Failure was notified once but not reflected in the operation terminal.
- Final integrity checks: `git rev-parse HEAD`, `git status --short`, `git diff --exit-code` (exit 0; tracked tree unchanged), `nl -ba tasks/tasks-status.md | sed -n '18,28p'`, and an inline Python read-only assertion of the ten preserved original headings, six finding headings, unchanged parent application-status field, and absence of trailing whitespace (passed). Only the assigned report is untracked/edited.

## 対象ファイル

- 変更または確認したファイル: `src/application/operation-feedback/operation-feedback.ts`; `src/application/review-context/projection-refresh.ts`; `src/composition/extension.ts`; `src/composition/pull-request/pull-request-review-runtime-base.ts`; `src/composition/pull-request/pull-request-review-runtime.ts`; `src/composition/review-contexts/review-contexts-runtime.ts`; `src/ui/current-context/current-context-runtime-coordinator.ts`; `src/ui/current-context/index.ts`; `src/ui/current-context/vscode-current-context-runtime.ts`; `src/ui/review-contexts/vscode-review-contexts-runtime.ts`; `test/tooling/issue-136-refresh-coordinator.test.mjs`; `test/tooling/issue-137-pr-progress-diagnostics.test.mjs`; `test/unit/current-context-ui.test.ts`; `test/unit/issue-84-pr85-review-closure-followup.test.ts`; `test/unit/t405-composition-regression.test.ts`; `test/unit/t405-github-lifecycle.test.ts`; `test/unit/t405-pull-request-review-runtime.test.ts`; `test/unit/t609-gate-wiring.test.ts`; `test/vscode/t609-suite/index.ts`; `doc/design/vscode-review-range-tracker-design.md`; `tasks/tasks-status.md`; `tasks/phases-status.md`。
- 設計/validationの確認先: `.agents/skills/` は `/workspace/CodexSkill/skills` を参照。RevMem/CodexSkillのAGENTS、既存Issueコメント、該当runtimeとproduction compositionも対象に含める。


- Additional direct dependencies inspected: `src/application/operation-feedback/index.ts`; `src/application/operation-feedback/issue-90-detailed-operation-feedback.ts`; `src/application/operation-feedback/pr-progress-diagnostics.ts`; `src/application/review-contexts/current-pull-request-context.ts`; `src/ui/current-context/current-context-ui-controller.ts`; `src/ui/current-context/current-context-runtime-composition.ts`; `src/ui/current-context/current-context-candidate-selection.ts`; `.github/workflows/ci.yml`; `package.json`; `tsconfig.test.json`; existing cancellation/selection/diagnostic regression suites listed above. Changed-file count is 22; all changed files received source/diff inspection. No production, test, design, tracking, dependency, configuration, or Skill file was modified.

## 指摘事項

- 初回レビュー後に記入。重大度順にidentity、場所、影響、根拠、必要対応を記録する。


### I136137-NR-001 — P1 — A superseded branch refresh clears the newer PR tree

- Origin: initial normal review at the stated immutable implementation HEAD.
- Location: `src/ui/current-context/current-context-runtime-coordinator.ts:82` (unconditional clear at line 83); production clear wiring `src/composition/extension.ts:807`.
- Requirement/design: Issue #136 design steps 1/6 and behavior test 6; canonical design §16.2 requires generation checks at completion and publication, so stale work cannot replace accepted newer state.
- Description/impact: generation 1 accepts a branch and awaits a list/dependent refresh. Generation 2 selects a PR and publishes successful progress. When generation 1's dependency rejects (including cancellation from the newer provider generation), the inner catch clears shared PR Progress before the outer catch checks supersession. The stale request resolves as superseded after erasing the newest tree, leaving a selected PR with no progress.
- Evidence: Probe A deterministically publishes `new-success` for generation 2, rejects the old dependency, and observes selected `pull-request` plus `tree=CLEARED`. The runtime clear invalidates the active PR generation and removes the contributed source through `refreshPullRequestProgressForSelection`. The new runtime race test exercises standalone PR snapshot replacement, not this composed cleanup race.
- Required action: check current generation/signal before any failure cleanup; propagate current-generation/identity checks or cancellation into list refresh, PR activation, and publication rather than using generation only to suppress log output. Ensure old failures/cancellations cannot clear or publish over newer state. Add actual shared-entry composition fixtures for delayed old success, failure and cancellation after newer PR success, including cross-entry Current Context/Review Contexts and explicit selection.

### I136137-NR-002 — P1 — Detailed PR diagnostics still disclose file paths

- Origin: initial normal review; defect remains in the newly accepted privacy scope and its direct dependencies.
- Location: `src/composition/pull-request/pull-request-review-runtime.ts:206` (`target: descriptor.filePath`), and line 289 (`describePullRequestProgressFile`); direct dependency `src/application/operation-feedback/pr-progress-diagnostics.ts:32`.
- Requirement/design: Issue #137 privacy requirement and accepted comment explicitly identify the existing arbitrary-target path as unsafe to reuse; canonical §16.2 forbids file names/paths in both normal and detailed PR logs.
- Description/impact: the new safe payload is additive. Production still reports raw content-read file paths and queues per-file path details. Detailed mode serializes `target` verbatim. With the new parent-context reuse, queued start details can also survive until a later standalone PR operation with the same label, retaining old private file names beyond the originating refresh.
- Evidence: Probe A uses public production diagnostic helper, queue, feedback subclass and formatter; Output contains `target=private-fixture/secret.ts`. `test/tooling/issue-137-pr-progress-diagnostics.test.mjs:47` constructs hostile strings but never passes those strings through acquisition/runtime/formatter inputs; it imports the base feedback implementation rather than the production index/subclass and cannot detect this leak. Existing Issue #90 detail behavior tests pass because they preserve the earlier path-bearing contract.
- Required action: remove/redact raw PR path targets from all read/queued/detailed paths; use the accepted allowlisted count/reason fields and operation-scoped opaque aliases as needed. Prevent stale queued details from escaping through later operations. Add privacy fixtures that actually inject repository/branch/URL/SHA/file/source/diff/exception values through production composition in diagnostics OFF and ON, including concurrent/shared-parent and queued-detail paths. Update earlier conflicting diagnostic tests to the accepted Issue #137 contract.

### I136137-NR-003 — P2 — Candidate acquisition failure discards the verified local branch

- Origin: initial normal review.
- Location: `src/ui/current-context/vscode-current-context-runtime.ts:126`; preceding acquisition `src/composition/review-contexts/review-contexts-runtime.ts:593` / line 597; branch preservation guard `src/ui/current-context/current-context-runtime-coordinator.ts:82`.
- Requirement/design: Issue #136 failure behavior test 7 and canonical §16.2 require clearing old PR progress while displaying the verified current branch and fixed failure reason after checkout/list failure; local review remains usable during GitHub failure.
- Description/impact: candidate enumeration already performs persisted-list/lifecycle/snapshot acquisition before the UI controller accepts any snapshot. Failure here occurs before `acceptedSnapshot` is set, so it cannot become `CurrentContextBranchRefreshError`. The runtime calls general `failClosed`, erasing Current Context and setting runtime selection undefined despite having a verified current local branch. The new branch-preservation case only works when failure occurs later in dependents; normal lifecycle failure follows the earlier route.
- Evidence: Probe B composes real public T405 registration/augmentation, Current Context composition and VS Code runtime with host stubs. A known current branch is accepted, then repository-list failure is injected in its next acquisition: tree items become zero and selected context becomes undefined. Inspection of `readSynchronizedRepository` shows unavailable GitHub lifecycle metadata also throws during the same augmentation stage. New branch unit test supplies an already accepted branch and never exercises this route.
- Required action: retain the current verified local owner/branch independently of PR acquisition and classify PR-list/lifecycle/snapshot failures early enough to publish branch plus a fixed failure reason while clearing old PR progress. Reserve complete identity clearing for unproven local identity. Add composed checkout/new-HEAD fixtures for list, lifecycle and selected-snapshot failure through both refresh entries; include same-identity re-read behavior and verify stale disclosure if any previous tree is retained.

### I136137-NR-004 — P2 — Production formatting loses lifecycle data and default terminals cannot be correlated

- Origin: initial normal review.
- Location: `src/application/operation-feedback/operation-feedback.ts:658` / line 669 (operation start/terminal entries lack IDs); direct production adapter `src/application/operation-feedback/issue-90-detailed-operation-feedback.ts:207` and line 95.
- Requirement/design: Issue #137 completion requires matching start through terminal without enabling detailed diagnostics; accepted design requires operation/generation correspondence and distinct lifecycle stages.
- Description/impact: in default mode only `refresh` records carry an operation ID; START/OK/ERROR/CANCEL entries do not. Concurrent operations with identical labels cannot be matched to their refresh generations. In detailed mode the wrapper marks refresh entries as detailed, so its old formatter consumes them, has no `refresh` case, emits `ERROR`, and discards the entire generation/trigger/stage/status/reason/count/duration payload. Enabling details removes the new diagnostic information and labels successful stages as errors.
- Evidence: Probe A records default IDs `[undefined, 1, undefined]` and detailed Output `ERROR op=1 PR Progress refresh` without `generation=`. Production exports the subclass/formatter through `index.ts`; the new tooling test imports the base module directly, bypassing the faulty production adapter.
- Required action: preserve and format safe refresh payloads through the actual exported feedback/VS Code Output path in both modes; emit stable owning operation IDs on starts, progress and every terminal regardless of detail setting, without overwriting explicit owner identity with an unrelated async scope. Add concurrent same-label production logging fixtures that prove each start/refresh/terminal association for success, failure, cancellation and supersession in both modes.

### I136137-NR-005 — P2 — Failed PR recalculation ends as successful operation/publication

- Origin: initial normal review.
- Location: `src/composition/extension.ts:837` / line 858; `src/application/review-context/projection-refresh.ts:103`; `src/composition/pull-request/pull-request-review-runtime-base.ts:747`; `src/application/operation-feedback/operation-feedback.ts:748`.
- Requirement/design: Issue #137 correlated failure terminals; Issue #136 accepted design says partial refresh failure is not success; canonical §16.2 distinguishes failed calculation/publication.
- Description/impact: selected PR activation now reuses the parent operation, so its thrown failure creates no independent failed lifecycle. The dependent-refresh helper catches it and calls the production UI-only error callback, then resolves. Reporting `pr-progress status=failed` does not mark the owner failed (`reportPullRequestRefresh` only marks cancelled/superseded). Coordinator consequently reports successful tree publication and the parent operation ends OK even though the PR tree was cleared and recalculation failed. This contradicts the purpose of diagnosing a missing PR tree.
- Evidence: Probe C composes the real helper/coordinator/feedback boundary and production-equivalent notification callback: one error notification, `pr-progress status=failed`, `tree-publication status=succeeded`, then terminal `OK`. Source inspection confirms production `reportPullRequestProgressError` only calls `showErrorMessage`.
- Required action: preserve failure isolation for document mutations while ensuring explicit shared refresh marks its owning operation failed and records actual failed/cleared publication outcome. Propagate a typed outcome or call the owning feedback failure boundary with the original context; do not derive success solely from a resolved dependency promise. Add actual parent-context PR activation failure fixtures through both refresh commands, checking one correct terminal and no spurious success publication; cover missing/failed snapshot and retry exhaustion.

### I136137-NR-006 — P2 — Selection causes and context/snapshot correspondence are absent

- Origin: initial normal review.
- Location: `src/composition/extension.ts:822`; direct selection resolver `src/application/review-contexts/current-pull-request-context.ts:17`; diagnostic shape `src/application/operation-feedback/operation-feedback.ts:59`.
- Requirement/design: Issue #136 behavior tests 3/4/8/9 and Issue #137 completion require distinguishing no match, ambiguity, no selection, unavailable/empty snapshot and tracing context selection through registration and projection. Accepted Issue #137 design includes decision provenance, operation-local anonymous identity correspondence, counts and phase durations.
- Description/impact: the selection resolver returns only context/undefined, losing whether it retained explicit choice, chose the sole match, found ambiguity, or found no match. Every branch/no-PR case becomes `no-selected-pr`; the declared `no-matching-pr`, `ambiguous-pr-match`, `explicit-selection-kept`, and `unique-pr-match` codes are never emitted. The real refresh does not emit repository-identity/diff-registration stages, anonymous context/snapshot aliases, candidate/registration/tree counts or per-stage durations, so it cannot identify which selection/snapshot stage caused the reported blank view. A manually submitted ambiguous diagnostic in a unit test does not establish production emission.
- Evidence: repository-wide exact-code search finds these four codes only in type/allowlist declarations. The extension emits only `no-selected-pr`, `snapshot-unavailable`, `no-pr-files` or generic failure/supersession in its production path. New tests submit synthetic decision/count/duration values directly rather than observing runtime-produced decisions.
- Required action: carry structured selection provenance and safe acquisition/registration/publication results through the shared coordinator; emit distinct accepted reasons and sufficient operation-scoped anonymous identity/count/timing data to follow selected context and immutable snapshot through actual publication or clear. Add composed fixtures observing emitted records for valid explicit selection with multiple candidates, ambiguous unselected PRs, unique/no-match, selected-but-unregistered snapshot, successful empty snapshot, acquisition failure and supersession. Treat acquisition before selection as observable stages rather than reporting only a final generic failure.

## 結果

- 初回通常レビュー結果を記入する。pass/pass_with_held/fail/incompleteのいずれかと、レビュー対象HEADを明記する。


### Initial normal review verdict

- **Verdict: fail.** Six required findings remain open: two P1 and four P2. Reviewed implementation HEAD: `479e27a9265f01be33ed1a1e6182edd56cdb6e44`; base: `a479bf5cf2b35f342a8dab90dc886a19d8233520`; diff range: `a479bf5cf2b35f342a8dab90dc886a19d8233520..479e27a9265f01be33ed1a1e6182edd56cdb6e44`.
- Review mode: initial normal review. Reviewer identity: `/root/issue_136_137_review`, independently delegated from implementation, one execution, no decomposition or nested agents. Initial independent-final-review HEAD/closure HEAD: not applicable. Severity reclassifications: none.
- Existing local validation is green but does not cover the demonstrated composed failures. Reviewer evidence: 78 selected tests pass, 56 further selected existing test dots pass, lint/typecheck pass, all 416 compiled JavaScript outputs match current source. Reproduction probes confirm failures, not acceptance success. Parent's broader local counts are preserved above as parent-provided evidence, not claimed as rerun by reviewer.
- Current-HEAD CI: not applicable to this authorized local-only review; no target PR/matching CI is provided, no push or CI wait was attempted. Full local equivalence including Extension Host: unavailable/held, not passed.

### Coverage dispositions

| Review criterion | Disposition | Evidence / limitation |
| --- | --- | --- |
| Requirement and accepted-design conformance | checked_finding | 001–006; both live Issue bodies/comments and canonical §16.2 inspected |
| Correctness and edge cases | checked_finding | Coordinator/production acquisition/feedback probes reproduce 001/003/005 |
| Explicit selection retention and current identity policy | checked_no_finding | Existing controller/candidate/store/resolver cases and composition suites; matching persisted choice remains scoped to repository/HEAD |
| Ambiguous/no-PR selection and reason distinction | checked_finding | Functional resolver preserves branch; diagnostic distinctions missing (006) |
| Stale generations, cancellation and supersession | checked_finding | 001; existing standalone runtime cancellation tests do not cover composed cleanup |
| Checkout/list/lifecycle failure and branch fallback | checked_finding | 003; clear-on-unproven-local-identity remains appropriate |
| Absent, empty, failed snapshot and tree publication | checked_finding | Shape guards inspected; missing provenance/failed terminal/publication (005/006); empty snapshot is distinct from missing registration in code |
| Cross-entry Current Context/Review Contexts composition | checked_finding | Shared routing/no recursion inspected; cleanup/failure gaps (001/003/005) |
| Entire diff, changed files and direct dependency effects | checked_finding | All 22 files inspected; exported diagnostic subclass/helpers expose 002/004 |
| Scope discipline and unrelated changes | checked_no_finding | No unrelated product implementation; duplicate Issue #123 tracking heading is a minor editorial risk below |
| API/data/config/workflow/compatibility | checked_no_finding | Optional `refreshListOnly`, retained public refresh methods, old-shape compatibility fixtures typecheck; no dependency/config/workflow change |
| Error handling and failure diagnostics | checked_finding | 003–006 |
| Security, secrets and privacy | checked_finding | 002; allowlisted new payload alone is safe, surrounding production detail path is not |
| Tests and validation adequacy | checked_finding | Tests pass, but 001–006 lack production regression fixtures; hostile values are not injected into the new privacy fixture |
| Current-HEAD CI evidence | not_applicable | Explicit local-only target; no PR/matching CI, no remote acceptance claimed |
| Reports, task tracking and documentation accuracy | checked_finding | Task claims contract coverage exceeds production coverage for 002/004/006; host/device held status accurately retained |
| Regression and maintainability | checked_finding | Two feedback formatters diverge; shared-generation cleanup/terminal result contracts need composition coverage |
| Actual Extension Host execution | held | Parent-owned: version resolution failed before startup; cannot infer host results from stubs |
| Physical-device checkout/reproduction/UI | held | Parent-owned I136-DEVICE-VERIFY; actual version/repository/branch/PR reproduction remains outstanding |

- Unexplored verdict-blocking criteria: none. Device/host routes are explicitly held rather than treated as covered acceptance. Network/auth/service behavior is inspected through existing local adapter/runtime suites; no live private PR/device exercise was authorized.

### Finding completeness / closure readiness

| Finding | Required action cells | Production path | Actual composition fixture | Focused validation | Disposition |
| --- | --- | --- | --- | --- | --- |
| 001 | Guard cleanup; carry current-generation/identity through dependent publication; delayed success/failure/cancel and cross-entry cases | Coordinator/dependent refresh/PR runtime | Existing standalone snapshot race insufficient; required fixture not implemented | Probe A confirms defect; existing tests green | open, not ready for closure |
| 002 | Remove path detail/queued leaks; inject hostile values in both modes/concurrent paths | PR runtime/detail helpers/exported feedback/Output | New base-payload privacy fixture insufficient | Probe A confirms leak | open, not ready for closure |
| 003 | Preserve proven local branch on early PR acquisition failure; clear old PR; fixed reason; both entries/same identity | T405 augmentation/Current Context composition/runtime | New late-dependent-failure fixture insufficient | Probe B confirms defect | open, not ready for closure |
| 004 | Default start/terminal IDs; detailed refresh payload preserved; explicit owner identity retained; concurrent terminals | Base feedback/exported subclass/formatter | Base-only tooling fixture insufficient | Probe A confirms default/detailed defects | open, not ready for closure |
| 005 | Failed explicit refresh owner terminal and accurate clear/publication; preserve mutation isolation; snapshot/retry cases | PR activation/dependent helper/coordinator/feedback | Parent-context activation failure fixture missing | Probe C confirms defect | open, not ready for closure |
| 006 | Carry selection provenance; actual reasons; safe alias/count/timing/registration/publication data; all decision cases | Resolver/T405/coordinator/extension diagnostic path | Manually injected reasons do not exercise decisions | Exact-code search confirms no emitters | open, not ready for closure |

- Next action: implementation owner addresses all six finding identities, adds production composition fixtures and focused evidence for every required-action cell, freezes a new implementation HEAD, and returns the completeness matrix to this same normal reviewer for fix verification. Preserve severities and reviewed identities; this report does not authorize implementation changes or closure by the reviewer.
- `reserved_report_paths`: [`reports/issue-136-137-normal-review-20261006.md`]; `report_attestation_allowed: false` (this is a normal-review report, not an independent-final-review administrative attestation). Report persistence remains parent-owned; no attestation identity is inferred and no merge is authorized.

## リスク

- Extension Host/device UIは未検証としてheld。Markdown用repository lint入口はなく、手動確認と`git diff --check`のみ。
- レビューで指摘がある場合は、findingごとに実装修正とfocused validation後、同一reviewerによるfix verificationを行う。


- Residual risks until fixes: a delayed superseded refresh can erase valid newer progress; detailed Output can disclose private file names; blank views can be logged as successful without distinguishing their selection/acquisition cause. Existing passing suites do not negate the reproduced defects.
- Host/device verification owner: parent task/I136-DEVICE-VERIFY. Host resolver failure is before startup, separate from passing local unit evidence and from real-device reproduction. Re-run those routes when available; no host or UI success is claimed here.
- Minor editorial observation: `tasks/tasks-status.md` now repeats the Issue #123 heading at lines 22/24. This has no demonstrated runtime effect; cleanup can accompany authorized tracking updates.
- No remaining tool/access blocker for the normal source review itself. Full host/device acceptance evidence remains held. No push, external message/comment, Issue/PR creation, dependency/environment/auth change, commit, merge or deployment occurred.


## Normal-review fix verification R1 — 2026-10-06

### Remaining findings first (original identities and severities retained)

- **I136137-NR-001 — P1 — remains open / partial fix.** The stale branch-failure cleanup at `src/ui/current-context/current-context-runtime-coordinator.ts:102` is now guarded and the original late-failure counterexample is addressed. The required current-generation contract still stops at that cleanup and diagnostic output. `CurrentContextRefreshContext` contains neither caller signal nor an `isCurrent` publication predicate; `src/composition/extension.ts:873` invokes the list provider without linking the owning generation, and the dependent helper (`src/application/review-context/projection-refresh.ts:88`) starts PR work after any resolved list refresh. The real provider can return successfully after suppressing its old publication (`src/ui/review-contexts/vscode-review-contexts-runtime.ts:211`). That old continuation then calls `src/composition/extension.ts:823` against the newly selected global context. Reviewer probe FV-A composes the actual provider, helper, selected-progress helper and PR runtime: generation 2 publishes one accepted binary-file node; generation 1 resumes its suppressed list publication, starts a fresh PR activation, and its failed persisted read clears generation 2's accepted files. Observed activation order `[2,1]`, selected kind `pull-request`, accepted file count `1 -> 0`. The submitted delayed-success fixture explicitly returns before attempting any old publication/activation and cannot detect this case (`test/tooling/issue-136-refresh-coordinator.test.mjs:101`). **Required action:** carry the owning signal/current-generation and immutable identity into dependency acquisition/activation/publication; check it after every awaited prerequisite and before PR activation, cleanup and publication; link provider cancellation to the shared owner. Replace the inert delayed-success fixture with the actual provider/PR-runtime composition and assert no stale PR work starts after newer success. Retain delayed failure/cancel and both-entry/selection sibling coverage. This is continuation of the original finding, not a severity change or new criterion.

- **I136137-NR-003 — P2 — remains open / partial fix.** The new enrichment fallback at `src/ui/current-context/current-context-runtime-composition.ts:19` retains local candidates, and Review Contexts-triggered dependent failure retains a verified branch. The preservation guard at `src/ui/current-context/current-context-runtime-coordinator.ts:101` still applies only to `review-contexts-refresh`. The same enrichment/list failure through the Current Context entry produces a plain failure; `src/ui/current-context/vscode-current-context-runtime.ts:126` calls general `failClosed` and discards the verified branch/selection. FV-B uses the actual Current Context runtime and fallback helper with the same failure: `runtime.refresh()` leaves selected context undefined and zero Current Context tree items; `runtime.refreshFromReviewContexts(...)` retains selected `branch`. **Required action:** preserve the verified local branch plus fixed PR-failure reason through both public entries, while clearing obsolete PR progress and retaining complete clearing for unproven local identity. Add actual T405/current-runtime fixtures for list/lifecycle/snapshot failure after checkout/new HEAD and same-identity reload, for both entries, rather than only a late dependent failure behind a synthetic controller.

- **I136137-NR-006 — P2 — remains open / partial fix.** Resolver provenance and default refresh propagation now exist. Explicit selection overwrites provenance with `("explicit-selection-kept", undefined)` at `src/ui/current-context/current-context-runtime-coordinator.ts:144`; `src/composition/extension.ts:842` consequently reports zero candidates even when the selected snapshot carries a candidate count of two. FV-C confirms count `0` for an explicit snapshot with count `2`. The explicit-selection path also omits the new repository-identity stage and never closes `current-context:started`; its observed stage sequence is only current-context started, selection succeeded, publication succeeded. Acquisition still precedes the synthetic list/registration stages, and hardcoded selection/snapshot ordinal `1` and selected-registration presence do not establish actual repository/context/snapshot registration/publication correspondence for all required states. `treeItems` is inferred from snapshot file count rather than accepted tree evidence. The submitted provenance fixture constructs snapshot metadata directly and reproduces the extension's emission in its callback, so it does not exercise the claimed resolver -> T405 -> accepted selection -> extension path (`test/tooling/issue-136-refresh-coordinator.test.mjs:217`). **Required action:** preserve actual selected-candidate count and decision provenance through explicit and recomputed selections; complete identity/acquisition/registration/progress/publication stages, timing, and safe correspondence from accepted production results. Add actual composition fixtures for explicit multiple candidates, unique, ambiguous, no-match, unregistered/empty/failed snapshot and supersession; observe real emitted records and counts without synthesizing the metadata/emitter in the fixture.

### Addressed findings and closure evidence

| Finding | Original severity | R1 disposition at H2 | Production / actual validation evidence |
| --- | --- | --- | --- |
| I136137-NR-002 | P1 | closed | `issue-90-detailed-operation-feedback.ts` drops target before activity/queue/log storage and allowlists queued PR reasons/phases. Production exported feedback tests inject hostile fields in OFF/ON; actual parent-owned `PullRequestReviewRuntime.activateProgress` file-read/queue fixture passes in T405. Earlier Issue #90 expectations now assert redacted targets. Raw paths remain supplied to the compatibility API but are absent from formatted diagnostics and stored detail projections. |
| I136137-NR-004 | P2 | closed | Base start/progress/handled failure/run terminal carry owner IDs; adapter prioritizes explicit IDs and routes `refresh` to the base safe formatter. FV-D adds reviewer-owned actual exported-feedback composition: four concurrent same-label success/failure/cancel/superseded operations in OFF and ON each have exactly one start and terminal with matching ID, retain refresh generations, and do not disclose raw exception text. |
| I136137-NR-005 | P2 | closed | Shared projection callback now records parent failure and rethrows after independently refreshing decorations/Global (`extension.ts:889` / `:897`); coordinator records failed publication. Submitted helper/coordinator/feedback fixture passes. FV-E also invokes the actual selected-progress helper and real PR activation with unavailable persisted snapshot through both refresh triggers: exactly one failed owner terminal, no successful terminal, failed tree publication, decorations=1 and Global=1. Existing T606 retry/failure and T405 runtime failure/isolation suites pass. |

- R1 closes the original defect behavior for 002/004/005. The full task remains rejected because 001/003/006 retain required actions. Initial findings/verdict at H1 above remain historical and unchanged. No severity reclassification, finding renumbering, independent-final-review pass, or implementation edit occurred.

### Completeness matrix assessment

- Supplied matrix: `reports/issue-136-137-review-fix-implementation-20261006.md` at H2. It has a row for each original finding, but is **partial / not ready for all-findings closure**: 001's delayed-success fixture omits actual downstream work; 003 omits the sibling Current Context runtime failure; 006 uses fabricated snapshot metadata/emission and lacks required actual state fixtures. The initial assertion that all required production fixtures/evidence exist is not supported. No all-findings closure is accepted. This normal fix-verification pass checks the supplied fixes and sibling defects; it is not an independent-final-review closure round.

| Finding | Required-action cells | Production path | Actual fixture / focused evidence | Readiness |
| --- | --- | --- | --- | --- |
| 001 P1 | Stale cleanup guard addressed; shared cancellation, post-prerequisite activation/publication guard and actual delayed-success case remain | Coordinator + extension + helper/provider + PR runtime | Submitted race tests green; FV-A reproduces remaining real PR-tree loss | partial/open |
| 002 P1 | Target storage/output redaction, safe queued PR detail and hostile value checks addressed | Exported detailed boundary + T405 runtime | T405 activation privacy fixture; OFF/ON queue/detail/failure tests | complete/closed |
| 003 P2 | Enrichment fallback and Review Contexts late failure addressed; Current Context entry, fixed-reason and actual acquisition siblings remain | Fallback + coordinator + actual current runtime | Submitted helper fixture green; FV-B proves entry asymmetry | partial/open |
| 004 P2 | IDs and formatter forwarding addressed | Base/exported feedback and formatter | Existing focused tests + FV-D four-outcome concurrent OFF/ON composition | complete/closed |
| 005 P2 | Parent failure, failed publication, independent dependent completion addressed | Extension failure callback + helper + coordinator + real PR activation | Existing fixture + FV-E both entries; T405/T606 failure regressions | complete/closed |
| 006 P2 | Resolver and recompute metadata addressed; explicit counts/stage completion and actual state/composition correspondence remain | Resolver -> T405 -> coordinator -> extension | Resolver unit cases green; FV-C explicit count defect; submitted metadata fixture insufficient | partial/open |

### Reviewed identity and bounded coverage

- Mode: normal-review fix verification; reviewer continuity `/root/issue_136_137_review` (same reviewer as H1, no implementation or delegated subreview).
- Reviewed implementation HEAD H2: `9d434c3b8a396d4cf5c1cd568caa0118904a28e8`. First parent H1: `479e27a9265f01be33ed1a1e6182edd56cdb6e44`. Branch: `issue-136-137-refresh-and-safe-diagnostics`.
- Fix range: `479e27a9265f01be33ed1a1e6182edd56cdb6e44..9d434c3b8a396d4cf5c1cd568caa0118904a28e8`. Accepted full range: `a479bf5cf2b35f342a8dab90dc886a19d8233520..9d434c3b8a396d4cf5c1cd568caa0118904a28e8`.
- All 19 fix-changed paths inspected, including reports/tracking and direct helper/runtime/formatter dependencies. Prior canonical design/Issue requirements and Skills remain the authority; no new criteria introduced. Source tree was clean at start, matching H2; after verification the only allowed delta is this appended report. Validation is runtime-local Bash at `/workspace/RevMem`, with the same installed dependencies. `verification_capability=local_execution_available`. No PR/matching CI is available or required for this local-only target; no push/CI wait occurred.

| R1 criterion | Disposition | Evidence |
| --- | --- | --- |
| Original requirements/design and fix completeness | checked_finding | 001/003/006 remain; 002/004/005 addressed |
| Correctness, stale/cancel generations, cross-entry publication | checked_finding | FV-A/FV-B; scope follows original findings |
| Selection, absent/empty/failed snapshot, diagnostic correspondence | checked_finding | FV-C and actual failure/empty-snapshot activation evidence; incomplete 006 fixtures |
| Privacy and operation IDs/terminal/error handling | checked_no_finding | Redaction fixtures and FV-D/FV-E; 002/004/005 closure |
| Changed files/direct dependencies/compatibility | checked_finding | Remaining propagation and trigger/provenance defects; old-shape compatibility typecheck green |
| Scope/configuration/workflow/dependency effects | checked_no_finding | No dependency/auth/workflow/config changes; target redaction affects all detail-target surfaces and existing suite expectations updated |
| Tests and completeness evidence | checked_finding | All run suites green; missing composed sibling fixtures identified in matrix |
| T405/T406 and earlier globalState failure | checked_no_finding | Reviewer-owned exact test-tail executions: 87/87 and 29/29; named T406 production seam passed |
| Tracking/report accuracy | checked_finding | Matrix overstates actual fixture completeness; no closure verdict claimed by implementation report |
| Current-HEAD CI | not_applicable | Local-only target, no PR/matching CI |
| Actual Extension Host | held | Parent-owned earlier version-resolution failure before host startup; not rerun |
| Physical device/UI reproduction | held | Parent-owned I136-DEVICE-VERIFY; no UI claim from stubs |

- Verdict-blocking unexplored areas: none in this bounded normal fix verification. Held items remain host/device, not a substitute for the open required findings.

### Reviewer commands and evidence at H2

- Identity/diff reads: `git status --short`; `git branch --show-current`; `git rev-parse HEAD`; `git show --no-patch --format='%H %P' HEAD`; `git diff --stat 479e27a9265f01be33ed1a1e6182edd56cdb6e44 9d434c3b8a396d4cf5c1cd568caa0118904a28e8`; `git diff --name-only` with that range; full `git diff 479e27a 9d434c3 -- src`, `-- test tasks`, and focused follow-up diffs/`cat`/`sed -n`/`nl -ba` to recover truncation and inspect all 19 paths. Both reports, current matrix and tracking entries were read. `rg --files` / `rg -n` inspected actual tree provider, activation/calculation and diagnostic definitions. One exploratory nonexistent `src/ui/pull-request-progress/...` glob was corrected to `src/ui/pr-progress/...`; no validation result was inferred from it.
- `npm run lint && ./node_modules/.bin/tsc -p tsconfig.test.json --noEmit && git diff --check 479e27a 9d434c3`: exit 0.
- In-memory emit binding (no generated output writes), exact command:

```sh
node <<'NODE'
const ts=require('typescript'),fs=require('node:fs');const config=ts.getParsedCommandLineOfConfigFile('tsconfig.test.json',{},ts.sys);const program=ts.createProgram(config.fileNames,config.options);let checked=0;const mismatches=[];const result=program.emit(undefined,(file,text)=>{if(file.endsWith('.js')){checked++;if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==text)mismatches.push(file)}});console.log(JSON.stringify({emitSkipped:result.emitSkipped,checkedJavaScript:checked,mismatches}));if(result.emitSkipped||mismatches.length)process.exitCode=1;
NODE
```

- Binding result: exit 0; `emitSkipped=false`, `checkedJavaScript=416`, `mismatches=[]`. Existing emitted code used by all runs matches H2 source. The suite commands below execute exactly the `package.json` Node test tails; compilation is replaced by the prior no-write typecheck/in-memory comparison to respect the report-only write boundary.

```sh
node <<'NODE'
const {spawnSync}=require('node:child_process');const scripts=require('./package.json').scripts;
for(const name of ['test:t405','test:t406','test:t305']){
 const command=scripts[name].replace(/^npm run compile:test && /,'');console.log('COMMAND '+name+': '+command);
 const r=spawnSync(command,{shell:true,encoding:'utf8',maxBuffer:8*1024*1024});console.log('EXIT '+r.status);
 if(r.status!==0)console.log(r.stdout,r.stderr);else console.log(r.stdout.trim().split('\n').slice(-9).join('\n'));
 if(r.status!==0)process.exitCode=1;
}
NODE
```

- Exit 0 for each: T405 **87/87**, T406 **29/29**, T305 **71/71**. T406 stdout explicitly reports `T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation` as passing. The earlier globalState assertion failure did not reproduce on H2; this is a successful rerun result, not an inferred correction of historical evidence.

```sh
node <<'NODE'
const {spawnSync}=require('node:child_process');const scripts=require('./package.json').scripts;for(const name of ['test:t606','test:t609']){const command=scripts[name].replace(/^npm run compile:test && /,'');console.log('COMMAND '+name+': '+command);const r=spawnSync(command,{shell:true,encoding:'utf8',maxBuffer:12*1024*1024});console.log('EXIT '+r.status);if(r.status!==0)console.log(r.stdout,r.stderr);else console.log(r.stdout.trim().split('\n').slice(-9).join('\n'));if(r.status!==0)process.exitCode=1;}
NODE
```

- Exit 0 each: T606 **235/235**, T609 **92/92**. No Extension Host command executed.

```sh
node --test test/tooling/issue-136-refresh-coordinator.test.mjs test/tooling/issue-137-pr-progress-diagnostics.test.mjs test-dist/test/unit/issue-90-diagnostics-and-cancellation.test.js
```

- Focused result: exit 0, **18/18**. The separate actual PR runtime privacy fixture is included in the T405 run. Passing synthetic races/provenance tests do not refute the reviewer probes below.

### Exact reviewer probes

All probes are inline, use only existing dependencies and synthetic fixture identities, and write no files. Exit 0 means their assertions confirmed the stated behavior. Runtime/host stubs are local unit composition evidence, not Extension Host/device evidence.

**FV-A — actual provider/shared helper/PR runtime, remaining 001:**

```sh
node <<'NODE'
const assert=require('node:assert/strict'),Module=require('node:module');const original=Module._load;Module._load=function(r,...a){return r==='vscode'?{EventEmitter:class{event=()=>({dispose(){}});fire(){}dispose(){}}}:original.call(this,r,...a)};const {ReviewContextsTreeProvider}=require('./test-dist/src/ui/review-contexts/vscode-review-contexts-runtime.js');Module._load=original;
const {CurrentContextRuntimeCoordinator}=require('./test-dist/src/ui/current-context/current-context-runtime-coordinator.js');const {refreshCurrentContextDependents,refreshSelectedPullRequestProgress}=require('./test-dist/src/application/review-context/projection-refresh.js');const {PullRequestReviewRuntime}=require('./test-dist/src/composition/pull-request/pull-request-review-runtime.js');const {ReviewFileExclusionPolicy}=require('./test-dist/src/core/file-exclusion/index.js');const {REVIEW_RANGE_SCHEMA_VERSION:v}=require('./test-dist/src/core/contracts/index.js');
(async()=>{const a='a'.repeat(40),b='b'.repeat(40);const persisted={schemaVersion:v,contextState:{schemaVersion:v,contextId:'opaque-pr',kind:'pull-request',repositoryId:'opaque',displayName:'PR',pullRequest:{host:'github.com',owner:'fixture',repository:'fixture',number:52,state:'open',baseSha:a,headSha:b},files:{},createdAt:'2026-10-06T00:00:00Z',updatedAt:'2026-10-06T00:00:00Z'},globalState:{schemaVersion:v,repositoryId:'opaque',currentRevisionId:b,files:{},updatedAt:'2026-10-06T00:00:00Z'}};let failRead=false;const runtime=new PullRequestReviewRuntime({repository:{load:async()=>failRead?undefined:structuredClone(persisted)},requestHistory:async()=>{},diffHost:{parseUri:x=>x,openDiff:async()=>{}},getExclusionPolicy:()=>new ReviewFileExclusionPolicy({userGlobs:[]})});runtime.register({repositoryId:'opaque',repositoryRoot:'/fixture',fileSystemPathSemantics:'posix',snapshot:{contextId:'opaque-pr',baseSha:a,headSha:b,originalDiffId:a+'..'+b,files:[{fileId:'opaque-file',oldPath:'fixture.bin',newPath:'fixture.bin',status:'binary',additions:0,deletions:0,hunks:[]}]},readTextContent:async()=>({kind:'found',content:''})});
let releaseOld,enteredOld;const gate=new Promise(r=>releaseOld=r),entered=new Promise(r=>enteredOld=r);let publishes=0;const list=new ReviewContextsTreeProvider({load:async()=>[],publishLoaded:async()=>{if(++publishes===1){enteredOld();await gate}return []}});let selected;const starts=[];const coordinator=new CurrentContextRuntimeCoordinator({refresh:async()=>({snapshot:{context:{kind:'branch',label:'old',selection:{kind:'branch'}}},stale:false}),selectContext:async()=>({context:{kind:'pull-request',label:'#52',selection:{kind:'pull-request',contextId:'opaque-pr'}},progress:undefined})},{setSelectedContext:s=>selected=s,refreshDependents:async c=>{let failure;await refreshCurrentContextDependents({refreshReviewContexts:()=>list.refresh(c.feedbackContext),refreshPullRequestProgress:async()=>{starts.push(c.generation);await refreshSelectedPullRequestProgress({contextId:selected.contextId,source:runtime.progress,feedbackContext:c.feedbackContext,activateProgress:(id,ctx)=>runtime.activateProgress(id,ctx),clearProgress:()=>runtime.clearProgress(),setSource:()=>{},refreshTree:()=>{}})},refreshDecorations:async()=>{},refreshGlobal:async()=>{},reportPullRequestProgressError:async e=>{failure=e}});if(failure)throw failure}});
const old=coordinator.refreshFromReviewContexts();await entered;await coordinator.selectContext();assert.equal(runtime.progress.getEffectiveProgress().files.length,1);failRead=true;releaseOld();await old;assert.equal(runtime.progress.getEffectiveProgress().files.length,0);assert.equal(selected.kind,'pull-request');console.log('NR-001 ACTUAL PR runtime: stale generation activated after newer success and cleared accepted tree:',JSON.stringify({starts,files:runtime.progress.getEffectiveProgress().files.length,selected:selected.kind}));})().catch(e=>{console.error(e);process.exitCode=1});
NODE
```

- FV-A exit 0; output `{"starts":[2,1],"files":0,"selected":"pull-request"}` after asserting one accepted file before releasing the old publication. Before this corrected probe, an exploratory empty-snapshot variant exited 1 because it incorrectly expected `progress.getChildren()` to become `[]` on clear; this provider always retains five root categories. The corrected binary-file fixture observes `getEffectiveProgress().files`, so the failed assertion is a probe-assumption correction, not a product finding. A prior valid empty-snapshot activation command confirmed five categories. A simpler provider/helper probe also confirmed activation order `[2,1]` and a stale-cleared marker; FV-A replaces that marker with actual runtime file-tree evidence.

**FV-B — actual Current Context runtime entry asymmetry, remaining 003:**

```sh
node <<'NODE'
const assert=require('node:assert/strict'),Module=require('node:module');const d={dispose(){}};const providers=new Map();const fake={EventEmitter:class{event=()=>d;fire(){}dispose(){}},TreeItem:class{},ThemeIcon:class{},TreeItemCollapsibleState:{None:0},StatusBarAlignment:{Left:1},window:{createTreeView:()=>d,registerTreeDataProvider:(id,p)=>{providers.set(id,p);return d},createStatusBarItem:()=>({show(){},hide(){},dispose(){}}),onDidChangeActiveTextEditor:()=>d},commands:{registerCommand:()=>d}};const load=Module._load;Module._load=function(r,...a){return r==='vscode'?fake:load.call(this,r,...a)};const {registerCurrentContextRuntime}=require('./test-dist/src/ui/current-context/vscode-current-context-runtime.js');Module._load=load;const {augmentCurrentContextCandidatesWithBranchFallback}=require('./test-dist/src/ui/current-context/current-context-runtime-composition.js');
(async()=>{let fail=false,selected;const branch={context:{kind:'branch',label:'checked-out',headRevision:'verified-new-head',selection:{kind:'branch',repositoryId:'opaque',repositoryRoot:'/fixture',branchRef:'refs/heads/checked-out'}},progress:undefined};const runtime=registerCurrentContextRuntime({subscriptions:[]},{recompute:async()=>{const c=await augmentCurrentContextCandidatesWithBranchFallback([branch],async()=>{if(fail)throw new Error('PR enrichment failed');return [branch]});return c[0]},selectContext:async()=>branch},{setSelectedContext:s=>selected=s,refreshDependents:async()=>{if(fail)throw new Error('PR list failed')},clearPullRequestProgress:()=>{}},()=>{});await runtime.startupRefresh;fail=true;await runtime.refresh();assert.equal(selected,undefined);assert.deepEqual(providers.get('reviewRange.currentContext').getChildren(),[]);console.log('NR-003: Current Context refresh discarded verified branch, selected=',selected);await assert.rejects(()=>runtime.refreshFromReviewContexts({owner:{},id:1}));assert.equal(selected.kind,'branch');console.log('NR-003: same failure via Review Contexts retained branch, selected=',selected.kind)})().catch(e=>{console.error(e);process.exitCode=1});
NODE
```

- FV-B exit 0; observed Current Context `selected=undefined`, then same failure through Review Contexts `selected=branch`.

**FV-C — explicit snapshot provenance/count, remaining 006:**

```sh
node <<'NODE'
const assert=require('node:assert/strict');const {OperationFeedback}=require('./test-dist/src/application/operation-feedback/index.js');const {CurrentContextRuntimeCoordinator}=require('./test-dist/src/ui/current-context/current-context-runtime-coordinator.js');(async()=>{const logs=[];const f=new OperationFeedback({showBusy(){},clearBusy(){},appendLog:x=>logs.push(x),revealLog(){}});const s={context:{kind:'pull-request',label:'#52',pullRequestCandidateCount:2,selectionReason:'explicit-selection-kept',selection:{kind:'pull-request'}}};let p;const c=new CurrentContextRuntimeCoordinator({selectContext:async()=>s},{refreshDependents:async ctx=>{p=ctx.selectionProvenance();ctx.report('pr-selection','succeeded',{reasonCode:p.reason,counts:{pullRequestCandidates:p.candidateCount??0}})}});await f.run('Current Contextを選択',ctx=>c.selectContext(undefined,ctx));const x=logs.find(x=>x.pullRequestRefresh?.stage==='pr-selection');assert.equal(x.pullRequestRefresh.counts.pullRequestCandidates,0);console.log('NR-006: explicit choice with actual 2 candidates reports',x.pullRequestRefresh.counts);console.log('NR-006: operation stages:',logs.filter(x=>x.pullRequestRefresh).map(x=>x.pullRequestRefresh.stage+':'+x.pullRequestRefresh.status))})().catch(e=>{console.error(e);process.exitCode=1});
NODE
```

- FV-C exit 0; count `0` despite accepted snapshot count `2`; stages `current-context:started`, `pr-selection:succeeded`, `tree-publication:succeeded`. This is a coordinator provenance-loss proof with a valid input snapshot, not a claim that the full resolver/T405 fixture is covered.

**FV-D — actual production exported feedback, addressed 004:**

```sh
node <<'NODE'
const assert=require('node:assert/strict');const {OperationFeedback,formatOperationLogEntry,OperationCancelledError}=require('./test-dist/src/application/operation-feedback/index.js');
(async()=>{for(const detailed of [false,true]){const logs=[];const feedback=new OperationFeedback({isDetailedDiagnosticsEnabled:()=>detailed,showBusy(){},clearBusy(){},appendLog:x=>logs.push(x),revealLog(){}});let release;const gate=new Promise(r=>release=r);const work=['success','failure','cancelled','superseded'].map((kind,i)=>feedback.run('Review Contextsを更新',async ctx=>{feedback.reportPullRequestRefresh(ctx,{generation:i+1,trigger:'review-contexts-refresh',stage:'current-context',status:'started'});await gate;if(kind==='failure')throw new Error('synthetic private exception');if(kind==='cancelled')throw new OperationCancelledError();if(kind==='superseded')feedback.reportPullRequestRefresh(ctx,{generation:i+1,trigger:'review-contexts-refresh',stage:'current-context',status:'superseded',reasonCode:'superseded'});}));release();await Promise.allSettled(work);for(let id=1;id<=4;id++){const own=logs.filter(x=>x.operationId===id);assert.equal(own.filter(x=>x.event==='started').length,1);assert.equal(own.filter(x=>['succeeded','failed','cancelled'].includes(x.event)).length,1);assert(own.some(x=>x.event==='refresh'));}const rendered=logs.map(formatOperationLogEntry).join('\n');assert(rendered.includes('generation=4'));assert(!rendered.includes('synthetic private exception'));console.log('NR-004 BOTH MODES concurrency:',JSON.stringify({detailed,terminals:logs.filter(x=>['succeeded','failed','cancelled'].includes(x.event)).map(x=>[x.operationId,x.event])}));}})().catch(e=>{console.error(e);process.exitCode=1});
NODE
```

- FV-D exit 0; OFF and ON each yield terminals `[[1,"succeeded"],[2,"failed"],[3,"cancelled"],[4,"cancelled"]]`, matching each start and refresh owner ID.

**FV-E — real PR activation failure through both triggers, addressed 005:**

```sh
node <<'NODE'
const assert=require('node:assert/strict');const {OperationFeedback,reportActiveOperationFailure}=require('./test-dist/src/application/operation-feedback/index.js');const {CurrentContextRuntimeCoordinator,CurrentContextUiController}=require('./test-dist/src/ui/current-context/index.js');const {refreshCurrentContextDependents,refreshSelectedPullRequestProgress}=require('./test-dist/src/application/review-context/projection-refresh.js');const {PullRequestReviewRuntime}=require('./test-dist/src/composition/pull-request/pull-request-review-runtime.js');const {ReviewFileExclusionPolicy}=require('./test-dist/src/core/file-exclusion/index.js');
(async()=>{for(const entry of ['current-context-refresh','review-contexts-refresh']){const logs=[];const f=new OperationFeedback({showBusy(){},clearBusy(){},appendLog:x=>logs.push(x),revealLog(){}});const a='a'.repeat(40),b='b'.repeat(40);const r=new PullRequestReviewRuntime({repository:{load:async()=>undefined},requestHistory:async()=>{},diffHost:{parseUri:x=>x,openDiff:async()=>{}},getExclusionPolicy:()=>new ReviewFileExclusionPolicy({userGlobs:[]})});r.register({repositoryId:'opaque',repositoryRoot:'/fixture',fileSystemPathSemantics:'posix',snapshot:{contextId:'opaque-pr',baseSha:a,headSha:b,originalDiffId:a+'..'+b,files:[]},readTextContent:async()=>({kind:'found',content:''})});const snap={context:{kind:'pull-request',label:'#52',selection:{kind:'pull-request',contextId:'opaque-pr'}},progress:undefined};const controller=new CurrentContextUiController({setCurrentContext(){},setStatusBar(){},clearCurrentContext(){},clearStatusBar(){}},{recompute:async()=>snap,selectContext:async()=>snap});let dec=0,global=0;const c=new CurrentContextRuntimeCoordinator(controller,{refreshDependents:async ctx=>{let failure;await refreshCurrentContextDependents({refreshReviewContexts:async()=>{},refreshPullRequestProgress:async()=>{ctx.report('pr-progress','started');try{await refreshSelectedPullRequestProgress({contextId:'opaque-pr',source:r.progress,feedbackContext:ctx.feedbackContext,activateProgress:(id,p)=>r.activateProgress(id,p),clearProgress:()=>r.clearProgress(),setSource:()=>{},refreshTree:()=>{}})}catch(e){ctx.report('pr-progress','failed',{reasonCode:'refresh-failed'});throw e}},refreshDecorations:async()=>{dec++},refreshGlobal:async()=>{global++},reportPullRequestProgressError:e=>{failure=e;reportActiveOperationFailure('PR進捗を再計算',e,ctx.feedbackContext)}});if(failure){ctx.report('tree-publication','failed',{reasonCode:'refresh-failed'});throw failure}}});await assert.rejects(f.run('Review Contextsを更新',ctx=>c.refresh(undefined,ctx,{allowInteraction:false},entry)),/Persisted pull-request/);assert.equal(logs.filter(x=>x.event==='failed').length,1);assert.equal(logs.filter(x=>x.event==='succeeded').length,0);assert.equal(dec,1);assert.equal(global,1);assert(logs.some(x=>x.pullRequestRefresh?.stage==='tree-publication'&&x.pullRequestRefresh.status==='failed'));console.log('NR-005 actual PR runtime failure:',JSON.stringify({entry,failedTerminals:1,succeededTerminals:0,dec,global}));}})().catch(e=>{console.error(e);process.exitCode=1});
NODE
```

- FV-E exit 0; both triggers produce `{failedTerminals:1,succeededTerminals:0,dec:1,global:1}`. The callback uses the same report/rethrow composition now inspected in the extension; the extension itself is not claimed to have run in a host.

### R1 outcome, risks, and next action

- **Verdict: fail at H2 `9d434c3b8a396d4cf5c1cd568caa0118904a28e8`.** Remaining required findings: 001 P1, 003 P2, 006 P2. Closed at H2: 002 P1, 004 P2, 005 P2. Reviewer-owned T405/T406/T305/T606/T609 and focused runs all pass; no broader host/full-equivalence or CI result is claimed.
- Risks: suppressed old list work can still invalidate a newer accepted PR tree; Current Context refresh still removes a proven branch on PR-only failure; explicit selection and stage/correspondence diagnostics still misdescribe runtime state. Host/device remain held separately.
- Next action: implementation owner completes the remaining original required-action cells and actual fixtures, updates the matrix accurately, freezes a new target HEAD, then requests same-reviewer fix verification. Retain all original IDs/severities and this H1/H2 history. No push/PR/Issue/merge/deploy/environment/dependency/auth changes are authorized by this report.
- Allowed persistence: only this append to the pre-existing normal-review report. `report_attestation_allowed=false`; no independent-final-review identity or administrative attestation is inferred. Parent owns further report/tracking persistence.

## R2 reviewer outcome recovery (parent-supplied lifecycle facts, 2026-10-06)

This append restores the outcome facts supplied by parent `/root` during the fresh implementation handoff. The earlier R2 append was accidentally removed during workspace restoration. This is an evidence-source disclosure, not a new review performed by the implementation worker; missing original R2 command outputs are not reconstructed.

- Same reviewer: `/root/issue_136_137_review`; R2 reviewed HEAD: `efe6730b6a3357df48a4ef4eb0725945e8a28f56`. Current workspace remains on H2 `9d434c3b8a396d4cf5c1cd568caa0118904a28e8` plus retained dirty work; no checkout/reset/reflog recovery was performed.
- R2 outcome: NR-003 (P2) closed after a reviewer-owned actual 12-case matrix: list/lifecycle/snapshot failure × same/new HEAD or branch × Current Context/Review Contexts entries. NR-002 (P1), NR-004 (P2), and NR-005 (P2) retain their prior closed status.
- NR-001 (P1) remained open: an already-running old PR calculation can publish after owner cancellation or newer explicit selection; both triggers reproduced. The remaining action is to link cancellation through running calculation, preserve newer immutable identity/tree, and fence every late publication/cleanup.
- NR-006 (P2) remained open: recompute omitted the Current Context terminal and repository-identity start/duration; acquisition/registration/progress/publication correspondence and actual emitted-record cases (unique, ambiguous, no-match, selected-unregistered, empty/failed snapshot, supersession) were incomplete.
- New implementation evidence is appended to `reports/issue-136-137-r2-regressions-20261006.md`. It applies to its recorded current dirty content and subsequent review-target commit. Closure of NR-001/006 remains with the same reviewer. This implementation worker does not issue a verdict.

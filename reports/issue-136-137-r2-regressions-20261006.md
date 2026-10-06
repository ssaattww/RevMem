# Sub-agent実行レポート

## タスク

- 目的: H2 reviewed HEAD `9d434c3b8a396d4cf5c1cd568caa0118904a28e8` で未解決のNR-001/003/006に対する実構成回帰testを追加し、H2 source treeでRedを確認する。
- 作業方式: TDD test authoring / Red evidence only。製品sourceは変更しない。
- Branch: `issue-136-137-refresh-and-safe-diagnostics`。既存H2 review reportとtask trackingの親変更を保持する。

## sub-agentを使う理由

- TDD SkillはRed/Greenに使うtest authoring/executionをsub-agent経由とする。3 findingsのproduction composition fixtureを独立して構成する。

## 対象範囲

- NR-001: actual ReviewContextsTreeProvider + shared dependent helper + PullRequestReviewRuntimeで、old list completion後にstale PR activation/clearが発生しないよう検出するfixture。
- NR-003: actual Current Context runtime entryでPR-only acquisition error後もverified branchが表示・選択保持されるか検出するfixture。
- NR-006: actual explicit selection pathでsnapshot candidate countとidentity stageを記録するか検出するfixture。
- Red実行結果と実行source identityを記録する。

## 対象外

- 製品source修正、既存修正のrebase/reset/stash、dependency/environment/auth/config changes、PR/Issue/外部投稿、push、merge、deploy、Extension Host/device UI。

## Dispatch profile

- Parent-owned; complete from dispatch evidence before report completion.

## 実行コマンド

- `npm run compile:test`: exit 0。H2製品sourceと今回のT405 unit test変更を再コンパイル。
- `node --test --test-name-pattern='R2 NR-001|R2 NR-003' test/tooling/issue-136-refresh-coordinator.test.mjs`: exit 1、pass 0 / fail 2。
- `node --test --test-name-pattern='T406 executes|R2 NR-006' test-dist/test/unit/t405-composition-regression.test.js`: exit 1、pass 0 / fail 2（NR-006 subtest 1件の失敗と、その親testの集計失敗）。
- Redの完全なstdout/stderrとsource fingerprintを残すため、上記2 narrow commandsを同一source treeで各1回再実行。同じ意図したassertionでRed。結果を下記に全文保持。
- Green / broad regression / lint / build / Extension Hostは今回実行していない。

## 対象ファイル

- `test/tooling/issue-136-refresh-coordinator.test.mjs`: 不十分なdelayed-success fixtureを実ReviewContextsTreeProvider/shared helper/selected-progress helper/PullRequestReviewRuntimeに置換。NR-003実Current Context runtime両入口のfixture追加。共通fixtureはsynthetic binary-file snapshotと永続state readを使用。
- `test/unit/t405-composition-regression.test.ts`: 既存実T405構成testのreal two-PR redetection直後へNR-006 subtest追加。T405 augmentation -> selection composition -> controller acceptance -> coordinator/dependency pathで実candidate数とdiagnosticsを観測。
- `reports/issue-136-137-r2-regressions-20261006.md`: 本報告のみ。親所有Dispatch profileを保持。本childによるsrc / normal-review report / tasks / Design / 設定変更なし。

## 指摘事項

- I136137-NR-001 (P1): 実list providerの古い`publishLoaded`を遅延し、新しい明示PR選択で実progress files=1を確認。その後古いpublicationを解放するとprovider自体はgeneration fenceにより成功returnするが、helperがPR activationを始める。activation `[2,1]`、accepted files `0`。期待は`[2]` / `1`。仮のowner伝播port `refreshContext: context` をhelper inputへ渡しているがH2は使用しない。親の製品APIへこのfixture wiringを合わせる必要がある。
- I136137-NR-003 (P2): actual registerCurrentContextRuntime、T405 branch fallback、実PR progress clearを組合せ、同じPR acquisition/dependent failureを両入口へ送る。Current Context入口でselectedKind undefined / items=[]、Review Contexts入口ではbranch/表示保持。両入口で実PR files=0、clear=1。期待は両入口ともbranch/表示保持。
- I136137-NR-006 (P2): actual T405 resolver/augmentation/revalidationから受け入れたsnapshotはcandidateCount=2 / reason explicit-selection-kept（先行assertion成功）。coordinatorが渡すprovenanceはcandidateCount欠落、実feedbackにrepository-identity/current-context succeeded欠落、相関false。fixtureはmetadataを捏造せず、diagnostic emit callbackも複製していない。
- 以上は初期normal reviewer `/root/issue_136_137_review` のH2 R1残件をRedで固定した証拠。独立review/closureの判定ではない。

## 結果

- 3 findingsで意図したRed成立。新規NR001/003テストの合計2件失敗、NR006は1 subtest失敗（親失敗も含むrunner集計は2件）。テスト失敗3件を4つの独立不具合と数えない。
- Red実行時のProduct sourceはH2 `9d434c3b8a396d4cf5c1cd568caa0118904a28e8`。test変更は未コミット。旧T405引継ぎテストの重複追加/取り込みなし。
- 次の作業: 親が3件を製品sourceで修正し、今回のfixtureをGreen、必要回帰を実行し、同一reviewerにfix verificationを依頼する。完全なsource fingerprint / commit対応は親が改めて記録する。
- 変更内容の自己review verdict、findings closure、新commit、push、CI、mergeは行っていない。

## リスク

- H2の修正報告はこのR2がGreenになる前の暫定的な回帰coverageを記述している。NR-001/003/006のclosure判断は同じnormal reviewerに委ねる。

## 検証source identityと完全な実行出力

- Execution: runtime_local / tools.exec_command / bash / `/workspace/RevMem` / Node v24.19.0。
- verification_capability: `local_execution_available`。既存依存物と`npm run compile:test`によるH2 source再コンパイルを使用。
- Product baseline/technical HEAD: `9d434c3b8a396d4cf5c1cd568caa0118904a28e8`。`git diff -- src package.json package-lock.json tsconfig.test.json tsconfig.json` は空。製品source変更なし。
- source_fingerprint: SHA-256 `99f7f66f0f0bcccae36fc55014f7837b7f129ac28778634f3779c92b37440979`。path順の全srcにpackage/lock/tsconfig2件/test2件を記載順で追加したJSON `{path,sha256}` manifest（222 files）のdigest。範囲は全`src/**/*`、package/lock/tsconfig2件、今回のtest2件。
- Test hashes: `test/tooling/issue-136-refresh-coordinator.test.mjs` = `12c128077a36661e114e9755a59cedaf9cf4c01909eacc837cb66653592ab3ff`, `test/unit/t405-composition-regression.test.ts` = `46edb9a629f92a5cd1a936e76e6e16ddab4aee043565b19bfd6da33bb1e5bfde`。
- 含むdirty inputs: 今回のtest2件。除外: 親所有normal review report / tasks台帳 / 本報告（製品実行へ影響しない）。`test-dist`はcompile:testの生成物、commit候補sourceの一部ではない。
- commit: `commit_pending`（testは未コミット）。push/CI: `not_required`。本結果は上記H2+test変更source treeへのRedであり、将来commitへのGreenではない。

### 保存実行: `node --test '--test-name-pattern=R2 NR-001|R2 NR-003' test/tooling/issue-136-refresh-coordinator.test.mjs`

- Exit: 1。

stdout（全文）:

```text
✖ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (56.461148ms)
✖ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (35.219652ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 264.381057

✖ failing tests:

test at test/tooling/issue-136-refresh-coordinator.test.mjs:133:1
✖ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (56.461148ms)
  AssertionError [ERR_ASSERTION]: suppressed stale list completion must not start PR work or erase accepted newer files
  + actual - expected

    {
  +   acceptedFiles: 0,
  -   acceptedFiles: 1,
      activations: [
        2,
  +     1
      ]
    }

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:188:12)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: { activations: [ 2, 1 ], acceptedFiles: 0 },
    expected: { activations: [ 2 ], acceptedFiles: 1 },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at test/tooling/issue-136-refresh-coordinator.test.mjs:324:1
✖ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (35.219652ms)
  AssertionError [ERR_ASSERTION]: both public entries must retain proven branch while clearing obsolete PR progress
  + actual - expected

    [
      {
        clears: 1,
        entry: 'current-context-refresh',
        files: 0,
  +     items: [],
  +     selectedKind: undefined
  -     items: [
  -       'Branch: checked-out'
  -     ],
  -     selectedKind: 'branch'
      },
      {
        clears: 1,
        entry: 'review-contexts-refresh',
        files: 0,

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:365:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: [ { entry: 'current-context-refresh', selectedKind: undefined, items: [], files: 0, clears: 1 }, { entry: 'review-contexts-refresh', selectedKind: 'branch', items: [Array], files: 0, clears: 1 } ],
    expected: [ { entry: 'current-context-refresh', selectedKind: 'branch', items: [Array], files: 0, clears: 1 }, { entry: 'review-contexts-refresh', selectedKind: 'branch', items: [Array], files: 0, clears: 1 } ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

stderr（全文）:

```text
```

### 保存実行: `node --test '--test-name-pattern=T406 executes|R2 NR-006' test-dist/test/unit/t405-composition-regression.test.js`

- Exit: 1。

stdout（全文）:

```text
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (99.975429ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3363.310351ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3540.6591

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:627:17
✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (99.975429ms)
  AssertionError [ERR_ASSERTION]: explicit selection must retain two real PR candidates and complete correlated identity/context stages
  + actual - expected

    {
  +   contextCompletion: undefined,
  +   identityStatus: undefined,
  -   contextCompletion: 'succeeded',
  -   identityStatus: 'succeeded',
      provenance: {
  -     candidateCount: 2,
        reason: 'explicit-selection-kept'
      },
  +   sameGeneration: false,
  +   sameOwner: false
  -   sameGeneration: true,
  -   sameOwner: true
    }

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:664:30)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:627:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: { provenance: { reason: 'explicit-selection-kept' }, identityStatus: undefined, contextCompletion: undefined, sameOwner: false, sameGeneration: false },
    expected: { provenance: { reason: 'explicit-selection-kept', candidateCount: 2 }, identityStatus: 'succeeded', contextCompletion: 'succeeded', sameOwner: true, sameGeneration: true },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

stderr（全文）:

```text
```


## compile:test診断記録

- Command: `npm run compile:test`、exit 0。このコンパイルはH2+上記test source treeを対象とする。toolから得たcombined output全文（stdout/stderr別保存はこのコマンドには行っていない）:

```text
> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

## 未確認・境界

- NR-003は実Current Context entry + T405-compatible fallback boundaryの証拠であり、実GitHub lifecycle/list/snapshot取得それぞれのfailure injectionやcheckout変更はこのfixtureでは追加していない。親による必要回帰/同担当reviewのcoverage確認が残る。
- NR-006は実T405 candidate producerから実selection経路を通すが、VS Code extension本体activate/Output channelは起動していない。実feedback recordsはcoordinatorがemitしたもの。extension-specific registration/progress tree countsの全finding required-action cellsをこのfixtureで検証済みとは主張しない。
- NR-001は実Provider/shared dependent helper/実PR Runtimeのaccepted effective filesを確認。device UI描画そのものは対象外。
- 保持: 初期NR001〜006のID/severity、親所有H2 R1 report/台帳変更。秘密値は読み出さず、fixtureの固定値のみを用いた。
- Persistence: repository_file。reserved path: `reports/issue-136-137-r2-regressions-20261006.md`。commit統合は親所有。mergeは境界外。

- Report完成中に親が製品修正を開始し、`src/application/review-context/projection-refresh.ts`、`src/composition/extension.ts`、`src/ui/current-context/current-context-runtime-coordinator.ts` がdirtyになった。上記保存実行はこれらの修正開始前にH2 sourceで完了しており、後続親source treeへこのRed実行結果を読み替えない。

## R2修正後Green・対象回帰検証

- 検証role: 同じTDD sub-agentによるtest executionのみ。Red部分を保持した（追記前report SHA-256 `def3898a4d62b26cbfec22465704e3e16d201b5f79f317cb50569795bbd06063`）。source/test編集・commit・push・mergeなし。
- 実行環境: runtime_local、bash、`/workspace/RevMem`、Node v24.19.0、npm 11.9.0。verification_capability=`local_execution_available`。
- baseline/technical HEAD=`9d434c3b8a396d4cf5c1cd568caa0118904a28e8`、branch=`issue-136-137-refresh-and-safe-diagnostics`。親所有修正source/testを含むdirty treeの検証であり、H2 commit内容自体のGreenではない。commit状態=`commit_pending`、push/CI=`not_required`、full local equivalence gate=`not_started`（指定affected suiteのみ）。
- initial source_fingerprint=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666`。path順のJSON `{path,sha256}` manifest 430 filesのSHA-256。全`src/**/*`、`test/**/*`、`tools/**/*`、`Design/**/*`、`.github/**/*`、package/lock、全tsconfig、eslint設定を含む。
- dirty paths（開始時）:

```text
 M reports/issue-136-137-normal-review-20261006.md
 M src/application/review-context/projection-refresh.ts
 M src/composition/extension.ts
 M src/ui/current-context/current-context-runtime-coordinator.ts
 M tasks/phases-status.md
 M tasks/tasks-status.md
 M test/tooling/issue-136-refresh-coordinator.test.mjs
 M test/unit/t405-composition-regression.test.ts
?? reports/issue-136-137-r2-regressions-20261006.md
```

- 含むdirty inputs: `src/application/review-context/projection-refresh.ts`, `src/composition/extension.ts`, `src/ui/current-context/current-context-runtime-coordinator.ts`, `test/tooling/issue-136-refresh-coordinator.test.mjs`, `test/unit/t405-composition-regression.test.ts`。
- fingerprint除外dirty inputs: `reports/issue-136-137-normal-review-20261006.md`, `tasks/phases-status.md`, `tasks/tasks-status.md`, `reports/issue-136-137-r2-regressions-20261006.md`。報告/進捗台帳は実装source inputsから除外。`test-dist`は各compile:testが生成する出力。
- 対象要件: NR-001 actual provider/shared helper/PR-runtime stale continuation、NR-003 actual runtime両入口branch保持、NR-006 actual T405 explicit candidate provenance/identity lifecycle。coverage closureは同normal reviewer所有。

### Green/回帰実行: `npm run compile:test`

- UTC開始: `2026-10-06T17:18:01.207071+00:00`。baseline HEAD=`9d434c3b8a396d4cf5c1cd568caa0118904a28e8`。source fingerprint before=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666` / after=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666`、一致=True。
- exit=0、counts={}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### Green/回帰実行: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js`

- UTC開始: `2026-10-06T17:18:13.746897+00:00`。baseline HEAD=`9d434c3b8a396d4cf5c1cd568caa0118904a28e8`。source fingerprint before=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666` / after=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666`、一致=True。
- exit=1、counts={"tests": 12, "pass": 10, "fail": 2, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (5.719132ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (155.699168ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (85.619012ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3311.641189ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (2.806387ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.942406ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (27.672256ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.013574ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (3.03004ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (8.097246ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (2.895146ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (12.319918ms)
ℹ tests 12
ℹ suites 0
ℹ pass 10
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3659.228182

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:627:17
✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (85.619012ms)
  AssertionError [ERR_ASSERTION]: explicit selection must retain two real PR candidates and complete correlated identity/context stages
  + actual - expected

    {
      contextCompletion: 'succeeded',
  +   identityStatus: 'started',
  -   identityStatus: 'succeeded',
      provenance: {
        candidateCount: 2,
        reason: 'explicit-selection-kept'
      },
      sameGeneration: true,

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:664:30)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:627:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: { provenance: { reason: 'explicit-selection-kept', candidateCount: 2 }, identityStatus: 'started', contextCompletion: 'succeeded', sameOwner: true, sameGeneration: true },
    expected: { provenance: { reason: 'explicit-selection-kept', candidateCount: 2 }, identityStatus: 'succeeded', contextCompletion: 'succeeded', sameOwner: true, sameGeneration: true },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

stderr（全文）:

```text
```

### Green/回帰実行: `npm run test:t305`

- UTC開始: `2026-10-06T17:18:17.518508+00:00`。baseline HEAD=`9d434c3b8a396d4cf5c1cd568caa0118904a28e8`。source fingerprint before=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666` / after=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666`、一致=True。
- exit=1、counts={"tests": 71, "pass": 70, "fail": 1, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t305
> npm run compile:test && node --test test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/t305-validation-wiring.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (3.786877ms)
✔ pull request, branch, and workspace labels are projected consistently (0.28247ms)
✔ branch selection identity remains stable when HEAD advances (0.231845ms)
✔ select applies the authoritative selected snapshot (0.586254ms)
✖ runtime coordinator refreshes dependents after selected UI is applied (2.007117ms)
✔ selected context identity is applied to the review runtime before decorations refresh (0.301451ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (0.439547ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (0.359872ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (0.532104ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (0.44149ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.212755ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.196657ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.387397ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.649798ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (1.026407ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (166.627544ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (0.66131ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.378892ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.166581ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (0.466482ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (0.406612ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.407296ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (0.413955ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.538691ms)
✔ refresh ignores stale asynchronous snapshots (0.27633ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.180883ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (4.627251ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.383696ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.293317ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (1.175264ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (1.826892ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (1.329207ms)
✔ Global layer toggle does not refresh dependents when persistence fails (1.237267ms)
✔ Global refresh clears stale presentation when the current recalculation fails (1.294716ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (0.510175ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (1.469928ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.518433ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (23.852789ms)
✔ T505-R001 retains immutable open-document evidence after save and close (141.02965ms)
✔ T505-R001 wires change, save, and close events to Global evidence refresh (2.399794ms)
✔ T505-R002 keeps individually valid snapshots when only their combined size exceeds the per-snapshot limit (10.846048ms)
✔ T505-R002 rejects aggregate limits below the per-snapshot limit and never publishes a removed latest snapshot (5.237348ms)
✔ T505-R003 reuses the shared last-valid exclusion policy after an invalid setting (14.776246ms)
✔ T505-R004 invalid snapshot settings fall back without throwing and the manifest caps safe integers (1.301615ms)
✔ T505-R006 focused validation executes the review-finding suite exactly once (1.66324ms)
✔ T505-R007 follow-up handoff uses the required schema v3 top-level packet and preserves the original payload (2.184194ms)
✔ T505-R005 requesting a debounced refresh immediately invalidates the in-flight generation (0.92821ms)
✔ PR69-R001 Global snapshot pins a working-tree open target to the producing owner (8.441879ms)
✔ PR69-R001 PR Global snapshot pins immutable HEAD identity even when the file is absent locally (9.755296ms)
✔ PR69-R001 stale Global nodes reject directly while the registered command owns generic error reporting (16.085314ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (126.053743ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (2.142273ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.809569ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (1.223628ms)
✔ reports start and success while keeping the busy status visible until completion (2.556541ms)
✔ restores the previous operation status after a nested operation finishes (0.708176ms)
✔ logs and reveals failures before rethrowing them (1.538745ms)
✔ records a swallowed diagnostic failure without changing active status (0.655845ms)
✔ formats one-line Output entries without exposing a stack trace (0.45903ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.645971ms)
✔ T405 contributes Review Contexts activation, commands, and menus (12.01889ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (2.450787ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (2.451071ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (10.521038ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (2.226511ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (2.64005ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (3.703778ms)
✔ T305 preserves every pre-existing unit suite exactly once while adding its focused suites (32.428485ms)
✔ Issue #84 registers the selected PR runtime before PR Progress refresh (0.503002ms)
✔ T305 contributes the Review Range activity container, views, and commands (11.986149ms)
✔ T305 default and focused commands execute the same behavior suites (3.873042ms)
ℹ tests 71
ℹ suites 0
ℹ pass 70
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 724.123343

✖ failing tests:

test at test-dist/test/unit/current-context-ui.test.js:130:25
✖ runtime coordinator refreshes dependents after selected UI is applied (2.007117ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    [
      'tree:Workspace: chosen',
      'status:$(folder) chosen',
  -   'dependents'
    ]

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/current-context-ui.test.js:145:22)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ 'tree:Workspace: chosen', 'status:$(folder) chosen' ],
    expected: [ 'tree:Workspace: chosen', 'status:$(folder) chosen', 'dependents' ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### Green/回帰実行: `npm run test:t405`

- UTC開始: `2026-10-06T17:18:31.187546+00:00`。baseline HEAD=`9d434c3b8a396d4cf5c1cd568caa0118904a28e8`。source fingerprint before=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666` / after=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666`、一致=True。
- exit=1、counts={"tests": 88, "pass": 86, "fail": 2, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t405
> npm run compile:test && node --test test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-storage.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-pull-request-review-runtime.test.js test-dist/test/unit/t405-review-followup.test.js test-dist/test/unit/t405-revision-evidence.test.js test-dist/test/unit/t405-selected-pr-session.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T405 contributes Review Contexts activation, commands, and menus (14.093314ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (7.165188ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (3.032007ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (5.377195ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (2.855838ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (3.369993ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (7.40469ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (82.084593ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (3.508232ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.716809ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.771444ms)
✔ reports start and success while keeping the busy status visible until completion (2.68581ms)
✔ restores the previous operation status after a nested operation finishes (0.770286ms)
✔ logs and reveals failures before rethrowing them (1.315093ms)
✔ records a swallowed diagnostic failure without changing active status (0.51856ms)
✔ formats one-line Output entries without exposing a stack trace (0.714553ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (1.005968ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (62.027494ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (3.216885ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (3.974595ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (6.204629ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (1.086016ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (25.258225ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (2.377247ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (1.329264ms)
✔ PR runtime command snapshot survives immutable PR A-to-B-to-A store restoration with hashes (46.141206ms)
✔ R405-3 saved/closed PR opens through the canonical T302 review-range-diff identity (4.91919ms)
✔ R405-3 Review Contexts canonical original/modified commands persist mark and unmark (16.762947ms)
✔ PR runtime command fails closed before commit when persisted hashes do not match authoritative HEAD content (2.384907ms)
✔ PR mutation no-op, cancellation, and failed commit publish neither snapshots nor history (2.245696ms)
✔ R405-5 PR runtime exposes T304 progress for Review Contexts (3.69695ms)
✔ Issue #137 actual T405 PR activation never emits acquired file paths in detailed Output (23.315164ms)
✔ Issue #136 keeps the newest PR Progress refresh when an older read finishes later (5.116892ms)
✔ R405-3 binary PR changes are not opened as text review diffs (0.909902ms)
✔ Issue #59 PR full scan reads complete current-side files once and reuses immutable revision caches (1.677027ms)
✔ PR69-R001 Global PR open uses the exact immutable HEAD document and rejects a superseded head (1.4481ms)
✔ PR Progress original-side selection projects unchanged lines and retains original-only lines atomically (2.778421ms)
✔ PR Progress command rejects an old diff URI pair after BASE or HEAD changes (1.51993ms)
✔ production command routing validates the active immutable diff URI pair before mutation (3.657256ms)
✔ PR runtime persists mark and unmark for added content without a terminal newline (5.155828ms)
✔ PR runtime persists mark and unmark for added LF-terminated content (5.085459ms)
✔ PR runtime persists mark and unmark for deleted content without a terminal newline (2.723345ms)
✔ PR runtime persists mark and unmark for deleted LF-terminated content (2.302477ms)
✔ PR runtime persists mark and unmark for replacement with terminal newlines (2.263339ms)
✔ PR runtime persists mark and unmark for replacement that adds a terminal newline (2.149789ms)
✔ PR runtime persists mark and unmark for replacement that removes a terminal newline (2.038424ms)
✔ PR runtime preserves empty existing files and CRLF content through body-derived line contracts (4.426147ms)
✔ PR runtime treats a terminal display line as outside Git content (1.117315ms)
✔ PR runtime leaves bare CR display fragments outside one-line Git replacements (1.382025ms)
✔ PR runtime rejects truncated, mismatched, and inconsistent local Git hunk evidence before mutation (3.804276ms)
✔ PR runtime hydrates complete legacy-redacted cache hunks and rejects tampered or incomplete evidence (6.764681ms)
✔ PR runtime block mode links both sides while a later side-mode operation stays on the operated side (3.475947ms)
✔ PR runtime block mode expands an original replacement selection to modified Context and Global (1.724736ms)
✔ PR runtime does not read selection mode or open state for an empty selection (1.2557ms)
✔ PR runtime block mark from original commits when only the target revision Global snapshot changes (3.326001ms)
✔ PR runtime block unmark from original commits when only the target revision Global snapshot changes (4.362485ms)
✔ PR runtime block mark from modified commits when only the target revision Global snapshot changes (2.990479ms)
✔ PR runtime block unmark from modified commits when only the target revision Global snapshot changes (3.747304ms)
✔ PR runtime rejects a re-registered comparison while a pending state load is resumed (2.653024ms)
✔ PR runtime rejects old rename URIs and keeps an active command scoped to its PR (3.17905ms)
✔ PR runtime keeps actual repository state atomic through write and CAS failures, restart, and a history failure (280.907094ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (3.958461ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (133.098991ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (86.378185ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3184.130007ms)
✔ R60-001 immutable PR HEAD remains authoritative when the working-tree candidate set omits the file (1.011248ms)
✔ R60-001 Global promotes immutable PR HEAD evidence even when the working tree no longer contains that path (23.346134ms)
✔ R60-003 superseded owner revisions evict retained Global evidence instead of reviving it later (20.267634ms)
✔ R60-002 breaking-change policy supersedes rev4 Global semantics with opened-only and immutable-PR rules (1.491597ms)
✔ PR85-IFR-004 production Review Contexts completion counts stay monotonic across two PRs, retry, and repositories (345.177823ms)
✔ PR85-NR-003 selected PR Progress reports file counts through the production Tree path on immutable-cache hits (5.796567ms)
✔ R405-4 presentation hide applies to current PR, branch, and workspace without deleting state (0.566047ms)
✔ R405-5 Review Contexts projects T304-compatible PR progress (0.201822ms)
✔ R405-5 progress formatter covers zero, partial, and complete PR states (0.118434ms)
✔ T405-IFR-2 keeps cache origin, freshness, and last successful update in the View projection (0.34242ms)
✔ R405-5 Review Contexts Tree renders projected progress to users (2.676782ms)
✔ R405-7 pull-request Current Context identity is stable across rediscovery and not label-derived (0.370903ms)
✔ R405-7/R405-8 current PR is inferred only from persisted open state at the local HEAD (0.154915ms)
✔ R405-7 multiple current-head PRs retain the PR explicitly chosen by redetection (0.223327ms)
✔ Issue #137 selection provenance distinguishes explicit, unique, ambiguous, and missing matches (0.13733ms)
✔ T406-R001 explicit branch selection suppresses one saved open PR at the same immutable HEAD (0.055125ms)
✔ R405-7 redetection persists and reloads explicit current PR identity (3.976114ms)
✔ R405-6/R405-9 remove the dead closed-layer setting and document connected Review Contexts (6.102184ms)
✔ R405-1 revision evidence supplies exact diff and old/new text for tracked files (7.599168ms)
✔ base-only PR transition does not invent a head diff (0.410978ms)
✔ PR evidence loader supplies unchanged Global-only target evidence to the immutable mapper (8.609268ms)
✔ R405-7 selected PR owns normal-editor command and decoration sessions without branch initialization (4.487403ms)
✔ selected PR rejects a foreign repository or stale head without creating state (1.66373ms)
ℹ tests 88
ℹ suites 0
ℹ pass 86
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4090.455538

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:627:17
✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (86.378185ms)
  AssertionError [ERR_ASSERTION]: explicit selection must retain two real PR candidates and complete correlated identity/context stages
  + actual - expected

    {
      contextCompletion: 'succeeded',
  +   identityStatus: 'started',
  -   identityStatus: 'succeeded',
      provenance: {
        candidateCount: 2,
        reason: 'explicit-selection-kept'
      },
      sameGeneration: true,

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:664:30)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:627:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: { provenance: { reason: 'explicit-selection-kept', candidateCount: 2 }, identityStatus: 'started', contextCompletion: 'succeeded', sameOwner: true, sameGeneration: true },
    expected: { provenance: { reason: 'explicit-selection-kept', candidateCount: 2 }, identityStatus: 'succeeded', contextCompletion: 'succeeded', sameOwner: true, sameGeneration: true },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### Green/回帰実行: `npm run test:t406`

- UTC開始: `2026-10-06T17:18:47.101517+00:00`。baseline HEAD=`9d434c3b8a396d4cf5c1cd568caa0118904a28e8`。source fingerprint before=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666` / after=`64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666`、一致=True。
- exit=1、counts={"tests": 30, "pass": 28, "fail": 2, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t406
> npm run compile:test && node --test test-dist/test/integration/mock-github.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-composition-regression.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (88.811998ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (2.309959ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (18.46049ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (4.220493ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (0.707096ms)
✔ GitHub adapter attempts a public API request without authentication (5.74484ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (59.907302ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (3.575751ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (2.231319ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (0.477847ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.502294ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.175795ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.145654ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.135073ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (39.329947ms)
✔ local Git diff is the first successful acquisition source (2.210669ms)
✔ GitHub PR files patch is used after local Git is unavailable (1.003746ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (1.606643ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (0.774142ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.448669ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.473803ms)
✔ remote metadata from a different comparison is rejected before content reads (0.317237ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (1.61933ms)
✔ invalid revision input is rejected before invoking local Git (1.048714ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (2.138962ms)
✔ malformed remote file identity fails closed without reading repository contents (0.97076ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (5.943438ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (268.892502ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (81.4999ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3738.7246ms)
ℹ tests 30
ℹ suites 0
ℹ pass 28
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4217.713745

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:627:17
✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (81.4999ms)
  AssertionError [ERR_ASSERTION]: explicit selection must retain two real PR candidates and complete correlated identity/context stages
  + actual - expected

    {
      contextCompletion: 'succeeded',
  +   identityStatus: 'started',
  -   identityStatus: 'succeeded',
      provenance: {
        candidateCount: 2,
        reason: 'explicit-selection-kept'
      },
      sameGeneration: true,

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:664:30)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:627:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: { provenance: { reason: 'explicit-selection-kept', candidateCount: 2 }, identityStatus: 'started', contextCompletion: 'succeeded', sameOwner: true, sameGeneration: true },
    expected: { provenance: { reason: 'explicit-selection-kept', candidateCount: 2 }, identityStatus: 'succeeded', contextCompletion: 'succeeded', sameOwner: true, sameGeneration: true },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 初回修正候補検証の中断と残件

- 完了: compile:test exit0、focused exit1（10/12）、T305 exit1（70/71）、T405 exit1（86/88）、T406 exit1（28/30）。全完了commandのsource fingerprint before/afterは `64319ac298ed945644202ff6fa3283240410ed3afc9cb32bd56723ff8ad2b666` で一致。
- NR001/003新回帰は成功。NR006は候補数2・context completion・owner/generation相関を確認できたが、fixtureが最初のidentity startedを選んで成功recordとの比較に失敗。親がterminal status=succeeded selectorを修正する。
- T305は別の既存回帰失敗: `runtime coordinator refreshes dependents after selected UI is applied` の期待 `[tree:Workspace: chosen,status:$(folder) chosen,dependents]` に対し、actualは前2件のみ。親へ報告済み。
- 親からT305/T405後pauseの指示が届いた時点で、連続runnerが既にT406を起動していた。T406の完全な終了結果は上記に保存。その後T606はcompile開始時点で当該runner process treeだけを停止した（runner exit137）。T606 suiteのstdout/stderr/exit/countsは回収できず、aborted/incomplete扱い。成功として数えない。
- T609/tooling未実行。この指紋への初回検証は完了扱いにしない。親の修正後に新fingerprintでfocusedおよび必要回帰を再実行する。
- 中断時もsource/testを書き換えていない。Red部分は追記のみで保持。

## R2修正後検証 第2回（legacy dependent互換・identity terminal観測修正後）

- 前回Red/第1回post-fix失敗outcomesを改変せず追記。追記前全文SHA-256=fd649e6e8b373fe333c0a97f181233d93263468be627c64c7fad3ba198164e34。
- baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8。source/testはparent-owned修正、dirty tree、commit_pending。source/test/環境を本childは変更しない。
- source_fingerprint=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675（430 files）。前回と同じ範囲/algorithm: path順JSON path+sha256 manifest、src/test/tools/Design/.github/全tsconfig/package+lock/ESLint設定。
- execution: runtime_local / bash / /workspace/RevMem / local_execution_available。affected suite検証、full local equivalence gate/CI/Extension Host/device UIは対象外。
- 開始時dirty paths:

```text
 M reports/issue-136-137-normal-review-20261006.md
 M src/application/review-context/projection-refresh.ts
 M src/composition/extension.ts
 M src/ui/current-context/current-context-runtime-coordinator.ts
 M tasks/phases-status.md
 M tasks/tasks-status.md
 M test/tooling/issue-136-refresh-coordinator.test.mjs
 M test/unit/t405-composition-regression.test.ts
?? reports/issue-136-137-r2-regressions-20261006.md
```

- 含むdirty inputs: src/application/review-context/projection-refresh.ts, src/composition/extension.ts, src/ui/current-context/current-context-runtime-coordinator.ts, test/tooling/issue-136-refresh-coordinator.test.mjs, test/unit/t405-composition-regression.test.ts。
- 除外dirty inputs: reports/issue-136-137-normal-review-20261006.md, tasks/phases-status.md, tasks/tasks-status.md, reports/issue-136-137-r2-regressions-20261006.md（報告/進捗台帳）。test-distはcompile:testの生成物。

### 第2回実行: npm run compile:test

- UTC開始=2026-10-06T17:20:56.942856+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675 / after=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675。
- exit=0、counts={}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第2回実行: node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js

- UTC開始=2026-10-06T17:21:12.951551+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675 / after=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675。
- exit=0、counts={"tests": 12, "pass": 12, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (3.384072ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (110.574472ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (77.370065ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (2824.013935ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (5.077852ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.476606ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (37.30311ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (0.918584ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (1.038134ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (2.017041ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.599274ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (11.086184ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3083.508871
```

stderr（全文）:

```text
```

### 第2回実行: npm run test:t305

- UTC開始=2026-10-06T17:21:25.771327+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675 / after=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675。
- exit=0、counts={"tests": 71, "pass": 71, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t305
> npm run compile:test && node --test test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/t305-validation-wiring.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (4.65813ms)
✔ pull request, branch, and workspace labels are projected consistently (0.941007ms)
✔ branch selection identity remains stable when HEAD advances (0.307641ms)
✔ select applies the authoritative selected snapshot (0.925299ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.468348ms)
✔ selected context identity is applied to the review runtime before decorations refresh (1.21208ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (0.604274ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (1.058605ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (0.666747ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (0.819149ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.874797ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.355146ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.349488ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.35852ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (0.966055ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (308.282926ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (1.302905ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.392306ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.237259ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (0.419232ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (0.464912ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.451757ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (0.462361ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (6.403977ms)
✔ refresh ignores stale asynchronous snapshots (0.223967ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.257834ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (3.631935ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.407217ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.589917ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (0.739875ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (0.489157ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (0.44993ms)
✔ Global layer toggle does not refresh dependents when persistence fails (1.178106ms)
✔ Global refresh clears stale presentation when the current recalculation fails (0.719777ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (1.364365ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (0.85448ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.704375ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (16.901164ms)
✔ T505-R001 retains immutable open-document evidence after save and close (197.468196ms)
✔ T505-R001 wires change, save, and close events to Global evidence refresh (3.533019ms)
✔ T505-R002 keeps individually valid snapshots when only their combined size exceeds the per-snapshot limit (11.915928ms)
✔ T505-R002 rejects aggregate limits below the per-snapshot limit and never publishes a removed latest snapshot (40.625031ms)
✔ T505-R003 reuses the shared last-valid exclusion policy after an invalid setting (25.958701ms)
✔ T505-R004 invalid snapshot settings fall back without throwing and the manifest caps safe integers (2.794833ms)
✔ T505-R006 focused validation executes the review-finding suite exactly once (4.193098ms)
✔ T505-R007 follow-up handoff uses the required schema v3 top-level packet and preserves the original payload (6.059283ms)
✔ T505-R005 requesting a debounced refresh immediately invalidates the in-flight generation (7.669438ms)
✔ PR69-R001 Global snapshot pins a working-tree open target to the producing owner (19.691163ms)
✔ PR69-R001 PR Global snapshot pins immutable HEAD identity even when the file is absent locally (7.328556ms)
✔ PR69-R001 stale Global nodes reject directly while the registered command owns generic error reporting (11.775642ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (50.971411ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (1.54532ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (1.938791ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.595518ms)
✔ reports start and success while keeping the busy status visible until completion (5.017777ms)
✔ restores the previous operation status after a nested operation finishes (4.486101ms)
✔ logs and reveals failures before rethrowing them (0.56172ms)
✔ records a swallowed diagnostic failure without changing active status (0.600854ms)
✔ formats one-line Output entries without exposing a stack trace (0.831443ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.665744ms)
✔ T405 contributes Review Contexts activation, commands, and menus (6.003636ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (1.159418ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (1.639364ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (6.501607ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (5.145886ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (1.739999ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (3.823859ms)
✔ T305 preserves every pre-existing unit suite exactly once while adding its focused suites (1.460719ms)
✔ Issue #84 registers the selected PR runtime before PR Progress refresh (0.656309ms)
✔ T305 contributes the Review Range activity container, views, and commands (14.343621ms)
✔ T305 default and focused commands execute the same behavior suites (7.682386ms)
ℹ tests 71
ℹ suites 0
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 684.835946
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第2回実行: npm run test:t405

- UTC開始=2026-10-06T17:21:42.852213+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675 / after=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675。
- exit=0、counts={"tests": 88, "pass": 88, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t405
> npm run compile:test && node --test test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-storage.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-pull-request-review-runtime.test.js test-dist/test/unit/t405-review-followup.test.js test-dist/test/unit/t405-revision-evidence.test.js test-dist/test/unit/t405-selected-pr-session.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T405 contributes Review Contexts activation, commands, and menus (13.373048ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (6.047532ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (3.93472ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (8.819392ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (12.980482ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (8.382496ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (2.785501ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (110.704412ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (9.75628ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.501454ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.535438ms)
✔ reports start and success while keeping the busy status visible until completion (1.945408ms)
✔ restores the previous operation status after a nested operation finishes (0.646527ms)
✔ logs and reveals failures before rethrowing them (0.987465ms)
✔ records a swallowed diagnostic failure without changing active status (0.7033ms)
✔ formats one-line Output entries without exposing a stack trace (0.66715ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.552023ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (39.633946ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (3.293542ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (4.303631ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (6.583668ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (1.032167ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (28.835322ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (2.55853ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (1.398649ms)
✔ PR runtime command snapshot survives immutable PR A-to-B-to-A store restoration with hashes (38.935422ms)
✔ R405-3 saved/closed PR opens through the canonical T302 review-range-diff identity (0.993724ms)
✔ R405-3 Review Contexts canonical original/modified commands persist mark and unmark (9.822343ms)
✔ PR runtime command fails closed before commit when persisted hashes do not match authoritative HEAD content (1.73117ms)
✔ PR mutation no-op, cancellation, and failed commit publish neither snapshots nor history (2.10188ms)
✔ R405-5 PR runtime exposes T304 progress for Review Contexts (2.29828ms)
✔ Issue #137 actual T405 PR activation never emits acquired file paths in detailed Output (11.174995ms)
✔ Issue #136 keeps the newest PR Progress refresh when an older read finishes later (3.003441ms)
✔ R405-3 binary PR changes are not opened as text review diffs (0.925257ms)
✔ Issue #59 PR full scan reads complete current-side files once and reuses immutable revision caches (0.867665ms)
✔ PR69-R001 Global PR open uses the exact immutable HEAD document and rejects a superseded head (1.393106ms)
✔ PR Progress original-side selection projects unchanged lines and retains original-only lines atomically (2.003792ms)
✔ PR Progress command rejects an old diff URI pair after BASE or HEAD changes (1.424881ms)
✔ production command routing validates the active immutable diff URI pair before mutation (5.278656ms)
✔ PR runtime persists mark and unmark for added content without a terminal newline (3.620233ms)
✔ PR runtime persists mark and unmark for added LF-terminated content (1.365457ms)
✔ PR runtime persists mark and unmark for deleted content without a terminal newline (2.23619ms)
✔ PR runtime persists mark and unmark for deleted LF-terminated content (1.877516ms)
✔ PR runtime persists mark and unmark for replacement with terminal newlines (2.917972ms)
✔ PR runtime persists mark and unmark for replacement that adds a terminal newline (1.893706ms)
✔ PR runtime persists mark and unmark for replacement that removes a terminal newline (1.44668ms)
✔ PR runtime preserves empty existing files and CRLF content through body-derived line contracts (4.009139ms)
✔ PR runtime treats a terminal display line as outside Git content (0.958325ms)
✔ PR runtime leaves bare CR display fragments outside one-line Git replacements (3.046483ms)
✔ PR runtime rejects truncated, mismatched, and inconsistent local Git hunk evidence before mutation (2.561296ms)
✔ PR runtime hydrates complete legacy-redacted cache hunks and rejects tampered or incomplete evidence (2.564808ms)
✔ PR runtime block mode links both sides while a later side-mode operation stays on the operated side (3.869439ms)
✔ PR runtime block mode expands an original replacement selection to modified Context and Global (1.900807ms)
✔ PR runtime does not read selection mode or open state for an empty selection (0.626556ms)
✔ PR runtime block mark from original commits when only the target revision Global snapshot changes (2.176488ms)
✔ PR runtime block unmark from original commits when only the target revision Global snapshot changes (2.394994ms)
✔ PR runtime block mark from modified commits when only the target revision Global snapshot changes (2.109224ms)
✔ PR runtime block unmark from modified commits when only the target revision Global snapshot changes (14.659394ms)
✔ PR runtime rejects a re-registered comparison while a pending state load is resumed (2.733395ms)
✔ PR runtime rejects old rename URIs and keeps an active command scoped to its PR (2.118652ms)
✔ PR runtime keeps actual repository state atomic through write and CAS failures, restart, and a history failure (406.905487ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (5.581697ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (244.310745ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (63.303012ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3080.208098ms)
✔ R60-001 immutable PR HEAD remains authoritative when the working-tree candidate set omits the file (0.892903ms)
✔ R60-001 Global promotes immutable PR HEAD evidence even when the working tree no longer contains that path (42.683249ms)
✔ R60-003 superseded owner revisions evict retained Global evidence instead of reviving it later (19.66069ms)
✔ R60-002 breaking-change policy supersedes rev4 Global semantics with opened-only and immutable-PR rules (1.316371ms)
✔ PR85-IFR-004 production Review Contexts completion counts stay monotonic across two PRs, retry, and repositories (307.275867ms)
✔ PR85-NR-003 selected PR Progress reports file counts through the production Tree path on immutable-cache hits (6.330605ms)
✔ R405-4 presentation hide applies to current PR, branch, and workspace without deleting state (0.524701ms)
✔ R405-5 Review Contexts projects T304-compatible PR progress (0.357806ms)
✔ R405-5 progress formatter covers zero, partial, and complete PR states (0.358533ms)
✔ T405-IFR-2 keeps cache origin, freshness, and last successful update in the View projection (0.272874ms)
✔ R405-5 Review Contexts Tree renders projected progress to users (2.553798ms)
✔ R405-7 pull-request Current Context identity is stable across rediscovery and not label-derived (0.285998ms)
✔ R405-7/R405-8 current PR is inferred only from persisted open state at the local HEAD (0.179781ms)
✔ R405-7 multiple current-head PRs retain the PR explicitly chosen by redetection (0.086741ms)
✔ Issue #137 selection provenance distinguishes explicit, unique, ambiguous, and missing matches (0.194955ms)
✔ T406-R001 explicit branch selection suppresses one saved open PR at the same immutable HEAD (0.079863ms)
✔ R405-7 redetection persists and reloads explicit current PR identity (5.567307ms)
✔ R405-6/R405-9 remove the dead closed-layer setting and document connected Review Contexts (1.522478ms)
✔ R405-1 revision evidence supplies exact diff and old/new text for tracked files (6.47562ms)
✔ base-only PR transition does not invent a head diff (1.786208ms)
✔ PR evidence loader supplies unchanged Global-only target evidence to the immutable mapper (8.944374ms)
✔ R405-7 selected PR owns normal-editor command and decoration sessions without branch initialization (5.751825ms)
✔ selected PR rejects a foreign repository or stale head without creating state (2.442704ms)
ℹ tests 88
ℹ suites 0
ℹ pass 88
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4188.95902
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第2回実行: npm run test:t406

- UTC開始=2026-10-06T17:22:08.023952+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675 / after=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675。
- exit=0、counts={"tests": 30, "pass": 30, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t406
> npm run compile:test && node --test test-dist/test/integration/mock-github.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-composition-regression.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (120.519254ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (3.955956ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (25.998353ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (5.795903ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (1.711267ms)
✔ GitHub adapter attempts a public API request without authentication (10.99735ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (38.279221ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (4.880546ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (4.039792ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (1.212516ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.701028ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.400684ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.71656ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.357323ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (37.96761ms)
✔ local Git diff is the first successful acquisition source (4.491897ms)
✔ GitHub PR files patch is used after local Git is unavailable (1.119941ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (1.859939ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (1.399681ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.625377ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.601998ms)
✔ remote metadata from a different comparison is rejected before content reads (0.227554ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (1.234735ms)
✔ invalid revision input is rejected before invoking local Git (1.199778ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (1.882689ms)
✔ malformed remote file identity fails closed without reading repository contents (0.701721ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (4.335373ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (212.443716ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (78.173412ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (2952.844891ms)
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3353.089646
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第2回実行: npm run test:t606

- UTC開始=2026-10-06T17:22:32.632273+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675 / after=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675。
- exit=0、counts={"tests": 236, "pass": 236, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t606
> npm run compile:test && node --test test-dist/test/unit/t606-failure-policy-retry-diagnostics.test.js test-dist/test/unit/t606-production-failure-matrix.test.js test-dist/test/unit/t606-r6-production-matrix.test.js test-dist/test/unit/t606-r6-real-composition.test.js test-dist/test/unit/t606-r5-production-activation.test.js test-dist/test/unit/local-git-adapter.test.js test-dist/test/integration/t302-review-followup.integration.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/state-repository.test.js test-dist/test/unit/debounced-review-state-repository.test.js test-dist/test/unit/normal-editor-review-command-registration.test.js test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/global-understanding-ui.test.js test-dist/test/unit/t505-global-understanding-source.test.js test-dist/test/unit/github-pull-request-cache.test.js test-dist/test/integration/mock-github.test.js test-dist/test/unit/t604-storage-lock-cleanup.test.js test-dist/test/unit/t605-multi-root-remote-boundaries.test.js test-dist/test/unit/ci-workflow-contract.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (87.358486ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (2.921589ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (19.713733ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (3.618125ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (0.880683ms)
✔ GitHub adapter attempts a public API request without authentication (6.142697ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (40.452212ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (3.964196ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (4.064236ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (0.664741ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.609496ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.625471ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.298499ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.28128ms)
✔ review diff URI round-trip preserves filesystem path semantics (4.393194ms)
✔ review diff URI rejects moving refs and non-canonical repository paths (1.186515ms)
✔ POSIX review diff URI preserves tab, newline, and backslash filename characters (0.59582ms)
✔ Windows review diff URI rejects backslash and control characters (0.633291ms)
✔ fatal revision lookup exit 128 is preserved instead of reported as missing (0.952467ms)
✔ fatal file lookup exit 128 is preserved instead of reported as missing (0.556029ms)
✔ moving refs are rejected before immutable Git content lookup (115.992091ms)
✔ POSIX Git content lookup supports tab, newline, and backslash filenames (115.379042ms)
✔ POSIX Git content lookup supports a filename made only of a newline (109.42058ms)
✔ Git content lookup reads UTF-8 text immediately below and above 4 MiB (356.661818ms)
✔ non-UTF-8 Git blob is rejected deterministically without replacement characters (181.793271ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (42.86026ms)
✔ local Git diff is the first successful acquisition source (2.756575ms)
✔ GitHub PR files patch is used after local Git is unavailable (1.742239ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (1.482189ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (1.119196ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.283021ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.342348ms)
✔ remote metadata from a different comparison is rejected before content reads (0.315973ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (2.08875ms)
✔ invalid revision input is rejected before invoking local Git (1.27485ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (2.876201ms)
✔ malformed remote file identity fails closed without reading repository contents (0.55773ms)
✔ unit and focused suites execute the integrated design contract (16.630626ms)
✔ document line contract coverage is runnable directly and through the required unit suite (3.979679ms)
✔ unit, npm test, focused CI execute the complete T304 tree contract (8.793334ms)
✔ temporary Git suite executes the T207 history integration scenario (2.83848ms)
✔ T502 focused coverage is runnable locally and included in the default unit suite (1.055816ms)
✔ CI executes positive and negative architecture gates with diagnostic logs (1.124184ms)
✔ CI executes the canonical T502 focused command (1.173031ms)
✔ T505 focused coverage executes each dedicated suite once and is required by CI (2.123089ms)
✔ CI diagnostics preserve stdout, stderr, combined logs, and result metadata (1.192548ms)
✔ T506 integration and Extension Host acceptance are exposed as one required focused CI command (1.677263ms)
✔ T406 GitHub failure and recovery integration is exposed by package and CI (1.095985ms)
✔ T605 multi-root and remote workspace boundary coverage is exposed by package and CI (2.332066ms)
✔ T606 focused failure-policy coverage is exposed by package and CI (1.432756ms)
✔ T607 performance workloads remain local-only and never gate CI (1.497348ms)
✔ CI publishes a branch-version-and-HEAD-named VSIX and tracked source archive only after pull-request success (0.986659ms)
✔ required unit gate runs the Issue #90 runtime routing suite before success artifacts (3.546573ms)
✔ required unit gate reaches the Issue #92 PR Progress context-menu contract before success artifacts (1.826132ms)
✔ required CI gates exclude timing-sensitive suites and use deadline-free Extension Host waits (6.541309ms)
✔ required gates keep the T606 wall-clock timeout fixture local-only (4.957713ms)
✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (4.990047ms)
✔ pull request, branch, and workspace labels are projected consistently (0.693337ms)
✔ branch selection identity remains stable when HEAD advances (0.636595ms)
✔ select applies the authoritative selected snapshot (0.424412ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.671209ms)
✔ selected context identity is applied to the review runtime before decorations refresh (0.858784ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (0.412693ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (0.745196ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (1.600368ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (1.20138ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.148266ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.357142ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.333068ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.322642ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (1.48978ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (187.48665ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (0.621819ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.322088ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.157142ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (0.418465ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (1.167946ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.398631ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (0.591536ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.899438ms)
✔ refresh ignores stale asynchronous snapshots (0.379922ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.244195ms)
✔ multiple background saves are coalesced and persist only the newest complete snapshot (6.371824ms)
✔ storage kinds remain isolated even when repository and context IDs are identical (0.492529ms)
✔ a confirmation transaction flushes pending background state and commits without waiting for the debounce timer (0.383319ms)
✔ external-file confirmation flushes the external pending state before commit (0.672269ms)
✔ dispose flushes a pending save immediately for Extension Host deactivation (1.485016ms)
✔ dispose waits for an immediate commit queued behind an in-flight load (0.606356ms)
✔ dispose waits for an in-flight owner-wide Global load (11.195981ms)
✔ owner-wide Global load serializes a different context commit (1.184565ms)
✔ Git Global load serializes a pull-request save for the same repository (0.83756ms)
✔ all callers observe a debounced persistence failure instead of receiving a false success (1.551603ms)
✔ live GitHub acquisition stores metadata and a source-redacted diff with explicit timestamps (4.73215ms)
✔ rate-limit failure uses an exact cached PR and marks expired data stale (1.258364ms)
✔ network failure uses an unexpired exact cache and marks it fresh (0.579126ms)
✔ patch fallback followed by network failure still uses an exact cache (1.016205ms)
✔ non-offline API failures do not substitute cached data (0.761433ms)
✔ mixed offline-eligible and API failures do not substitute cached data (1.027889ms)
✔ cache entries are bound to the exact context, repository, PR, base, and head identity (0.465699ms)
✔ filesystem cache publishes metadata and redacted diff through one generation pointer (60.655321ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (4.077379ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.325347ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.270419ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (0.2774ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (0.22741ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (0.371184ms)
✔ Global layer toggle does not refresh dependents when persistence fails (0.57289ms)
✔ Global refresh clears stale presentation when the current recalculation fails (0.644151ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (0.371319ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (1.342473ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.189942ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (11.259007ms)
✔ Node local Git path normalization propagates stat permission errors unchanged (2.197411ms)
✔ Node local Git path normalization retains only an exact candidate stat ENOENT (0.366891ms)
✔ Node local Git path identity is unavailable when either realpath lookup fails (0.261805ms)
✔ repository inspection uses argument arrays and returns normalized Git identity (12.2429ms)
✔ remote normalization unifies common GitHub URL forms without credentials (0.646134ms)
✔ fork remotes remain distinct repository identities (0.8724ms)
✔ a repository without remotes receives a stable root-derived identity (1.574479ms)
✔ Issue #57 keeps local Git context usable when a listed remote URL cannot be resolved (0.68634ms)
✔ detached HEAD is distinguished while retaining the exact HEAD object (0.828445ms)
✔ Git executable absence and non-repositories are separate outcomes (0.817424ms)
✔ merge-base and object existence use bounded argument-array commands (0.469987ms)
✔ revision arguments that could be parsed as options are rejected (0.425203ms)
✔ registerNormalEditorReviewCommands registers the four designed command IDs (4.482133ms)
✔ registered commands delegate only when an active normal editor exists (1.249484ms)
✔ registered commands reject missing and diff editors without invoking state commands (0.402853ms)
✔ registered commands report a privacy-safe handler failure through the UI host (0.849449ms)
✔ handler failure is recorded as failed operation before the UI host reports it (2.368391ms)
✔ Test-mode command failure is captured by operation and rejects with the original error without waiting for UI (1.153711ms)
✔ applied production handlers await one automatic decoration refresh (0.822141ms)
✔ Test-mode public command settles after state application without an automatic decoration refresh (4.019885ms)
✔ T405 contributes Review Contexts activation, commands, and menus (15.062305ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (16.776105ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (3.735571ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (8.102476ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (3.076632ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (4.383845ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (1.588593ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (6.081003ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.382323ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.920931ms)
✔ reports start and success while keeping the busy status visible until completion (2.288007ms)
✔ restores the previous operation status after a nested operation finishes (0.764338ms)
✔ logs and reveals failures before rethrowing them (2.185916ms)
✔ records a swallowed diagnostic failure without changing active status (0.470228ms)
✔ formats one-line Output entries without exposing a stack trace (0.629107ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (1.088188ms)
✔ routing separates Git and PR state from non-Git workspace state (8.859106ms)
✔ workspace routing requires ExtensionContext.storageUri (0.780391ms)
✔ repository save commits manifest last and reloads the same context and Global state (68.256559ms)
✔ repository manifest preserves other contexts while atomically advancing one context (180.696802ms)
✔ non-Git state uses workspace-state.json and never writes under globalStorageUri (12.33133ms)
✔ a failed repository manifest replacement preserves disk and memory state (41.660452ms)
✔ a failed workspace replacement preserves disk and memory state (14.885964ms)
✔ schema mismatch is rejected and reported during load (5.3927ms)
✔ save validates manifest, context, Global, target identity before any write (20.964729ms)
✔ concurrent saves retain both context references in the repository manifest (56.143724ms)
✔ save accepts the exact target and context kind mapping (26.102707ms)
✔ save rejects non-matching target and context kinds (19.953281ms)
✔ NodeAtomicTextFileStore replaces a file without leaving temporary files (3.264237ms)
✔ storage-root containment follows the host path semantics without weakening escape rejection (0.529961ms)
✔ NodeAtomicTextFileStore rejects an outside sibling and a symbolic link or junction (4.635515ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (5.446499ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (185.64029ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (144.39176ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3679.949813ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (44.136956ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (3.028396ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (4.004582ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (8.327519ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (1.107432ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (34.4714ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (7.158007ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (0.927839ms)
✔ T505 source keeps unopened file contents out of the line denominator while preserving path diagnostics (98.319016ms)
✔ Issue #59 uses only previously opened files for Global line progress and reports unopened files separately (38.99516ms)
✔ Issue #59 PR full HEAD scan is promoted to opened Global evidence (28.989634ms)
✔ T604 refuses a live root lock without exposing owner or path diagnostics (28.221924ms)
✔ T604 immediately recovers an unexpired lease only when its owner is confirmed dead (16.011222ms)
✔ T604 never steals an expired descriptor from a live cooperative owner (15.504198ms)
✔ T604 recovers a bounded stale malformed lock without taking a live valid lease (13.823164ms)
✔ T604 bounds fresh zero, truncated, malformed, and future-invalid partial recovery before aging (26.448342ms)
✔ T604 deduplicates pending privacy-safe diagnostics by operation scope (1.877948ms)
✔ T604 fences a detached owner before it can publish after a successor recovery (7.349816ms)
✔ T604 rejects a dead owner's real state publication after a successor publishes newer Context, Global, and manifest (39.49934ms)
✔ T604 cleans an owned partial lease after write, sync, or close acquisition failure (35.474128ms)
✔ T604 uses an owned OS child-process lease and releases it for a successor (443.246769ms)
✔ T604 immediately recovers a killed child lease before its bounded expiry (176.305232ms)
✔ T604 rejects a root-confined snapshot mutation through a symlink or Windows junction (19.993456ms)
✔ T604 retains independent-window Contexts and Global publication under concurrent writes (61.088483ms)
✔ T604 atomically appends independent-window history events (45.934105ms)
✔ T604 cache cleanup retains the published generation and removes superseded immutable files (67.532828ms)
✔ T604 serializes state, history, cache, snapshot cleanup, and startup migration through one explicit custom-store coordinator (65.902085ms)
✔ T604 snapshot cleanup retains a referenced generation and removes expired unreferenced entries (37.644952ms)
✔ T604 snapshot cleanup preserves every active pointer while bounding an unreferenced generation (63.088074ms)
✔ T604 runs production startup recovery against real child writers and restarts from the newer coherent state (393.718291ms)
✔ T604 keeps active snapshots above count and byte limits, publishes through cleanup failure, and converges after restart (111.316271ms)
✔ T604 flushes a terminal startup lock failure through the production feedback composition exactly once (0.703285ms)
✔ T605 chooses exactly the longest matching multi-root URI and preserves remote authority (5.151143ms)
✔ T605 fails closed for URI boundaries and separates workspace storage roots (2.064852ms)
✔ T605 root registry retains typed snapshot and Git-rewrite capabilities (0.988821ms)
✔ T605 IFR001 rejects delayed open, load, and commit from a removed and re-added root generation (1.87672ms)
✔ T605 IFR002 applies one URI eligibility boundary before descriptor routing (1.868115ms)
✔ T605 keeps same-repository roots distinct for Current Context and PR acquisition (0.826801ms)
✔ T605 concrete root composition commits snapshots through reconciliation and survives root-scoped restart (390.826508ms)
✔ T606 classifies retryable, permanent, stale, authentication, and validation failures without raw messages (3.262453ms)
✔ T606 retries only retryable faults with a bounded cancellable sequence (2.463986ms)
✔ T606 never retries authentication, validation, stale, or partial-side-effect failures (0.8533ms)
✔ T606 emits one bounded single-line redacted ERROR and always clears activity (6.582589ms)
✔ T606 makes a handled inner failure terminal exactly once for its shared operation (1.697381ms)
✔ T606 keeps independent concurrent production operations as separate lifecycles (1.076451ms)
✔ T606 joins an actual storage diagnostic to its explicit owner context without a duplicate terminal (2.004004ms)
✔ T606 Review Contexts runtime fences a superseded source publication (18.775739ms)
✔ T606 Review Contexts provider aborts an old root load and never publishes its distinct stale item (1.002348ms)
✔ T606 retries only an actual Review Contexts pure-read runtime operation (26.100784ms)
✔ T606 runs Review Contexts commands through the production registration: read retries, mutations do not (27.66853ms)
✔ T606 passes one explicit feedback context through the production Review Contexts read boundary (2.482227ms)
✔ T606 runs Git executable-missing, nonzero, corruption, and safe.directory outcomes through the LocalGitAdapter boundary (8.080797ms)
✔ T606 preserves the last published repository state when the production persistence adapter sees ENOSPC or EACCES during flush/replace (25.181884ms)
✔ T606 R5 invokes the registered Current Context command through its production composition and records supersede as a typed terminal (18.579543ms)
✔ T606 R5 invokes the registered Global open command with one generic UI error and one redacted terminal (14.184238ms)
✔ T606 R6 Current Context production runtime cross-supersedes refresh/select with one signal owner and one typed terminal (22.747715ms)
✔ T606 R7 absorbs a failed old-root load and preserves the fresh-root stale/unknown transition (10.372929ms)
✔ T606 R7 cache publish mutation records a terminal failure, rethrows to its boundary, and starts no post-mutation refresh (4.634864ms)
✔ T606 R6 cache retries acquisition only, publishes once, and never retries a publish failure (2.194877ms)
✔ T606 IFR001 propagates an actual cache write failure instead of projecting live not-cached success (0.437712ms)
✔ T606 IFR002 fences a pending Node cache write after abort and returns a typed cancellation (2.477485ms)
✔ T606 IFR003 runs the production Global layer toggle through one redacted terminal lifecycle (3.876466ms)
✔ T606 IFR001 republishes the post-cache-publish tree snapshot and fails closed when publication reports failure (0.577675ms)
✔ T606 IFR003 Global open throws once to the shared redacted UI boundary without a raw-error callback (2.607011ms)
✔ T606 IFR003 PR Progress carries its owner and abort signal to pending content I/O, then emits one terminal per cancelled, failed, and successful refresh (11.1766ms)
✔ T606 IFR002 retries only transient result unions through Current Context's cache read port and keeps permanent causes single-attempt (81.414337ms)
✔ T606 IFR002 real T305-to-T405 composition retries only transient acquisition, aborts deep cache I/O, and fences stale publication (304.365275ms)
✔ T305 contributes the Review Range activity container, views, and commands (9.698626ms)
✔ T305 default and focused commands execute the same behavior suites (2.849804ms)
ℹ tests 236
ℹ suites 0
ℹ pass 236
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5354.08836
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第2回実行: npm run test:t609

- UTC開始=2026-10-06T17:22:57.762457+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675 / after=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675。
- exit=0、counts={"tests": 92, "pass": 92, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t609
> npm run compile:test && node --test test-dist/test/unit/t609-repository-resolution.test.js test-dist/test/unit/t609-review-contexts-repository.test.js test-dist/test/unit/t609-revision-mapping-encoding.test.js test-dist/test/unit/t609-normal-review-followup.test.js test-dist/test/unit/t609-review-contexts-cancellation-boundary.test.js test-dist/test/unit/t609-t405-encoding-composition.test.js test-dist/test/unit/t609-test-review-state-dependent-queue.test.js test-dist/test/unit/t609-gate-wiring.test.js test-dist/test/unit/t609-host-rename-decoration-composition.test.js test-dist/test/unit/review-diff-content-provider.test.js test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/history-rewrite-git-context-integration.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T609 read-only document provider recovers when the actual Git inspection cwd was deleted (175.584867ms)
✔ T609 document decoration recovery propagates noncandidate stat failures (1.926773ms)
✔ Git provider restores each mixed target snapshot layer in one CAS (20.266892ms)
✔ Git provider rejects an invalid present target snapshot without fallback CAS or history (2.509451ms)
✔ Git provider rejects an unreadable present target snapshot without fallback CAS or history (2.077782ms)
✔ Git provider does not publish mixed snapshot state or history after a CAS conflict (6.145749ms)
✔ Git provider records an unresolved mapping event after a conservative missing-object clear (3.329023ms)
✔ Git provider records binary mapping as unresolved instead of a successful remap (13.738001ms)
✔ document sessions map branch commits and isolate branch and detached contexts (5.244439ms)
✔ T609-NR-005 records a generic unresolved history reason for a failed current-revision text refresh (3.195878ms)
✔ document routing recalculates the current Git snapshot when an opened encoding hint changes (3.965779ms)
✔ T609 production Git document session clears a same-revision encoding transition without changing an unrelated BOM file (4.04091ms)
✔ T609-NR-002 aggregates all reopened document hints across mapping and an encoding change (11.200976ms)
✔ document routing follows the stable file ID after a rename (3.485962ms)
✔ new branch initialization maps owner-wide Global state through the debounced repository (126.433188ms)
✔ new branch initialization preserves a concurrent Global update while mapping (183.45001ms)
✔ a poll started at B preserves foreground revision C after its mapping completes (112.270358ms)
✔ document routing distinguishes a renamed file from a new file at its old path (4.262631ms)
✔ document routing excludes a binary rename while routing a new text file at its old path (3.474806ms)
✔ document routing maps an ambiguous rename and copy graph without reusing its source ID (4.178059ms)
✔ Git revision mapper preserves SHA-only reviewed ranges through saved snapshots when the old object is gone (52.565673ms)
✔ Git revision mapper follows one snapshot-backed rename and retains the stable file identity (34.10319ms)
✔ Git revision mapper fails closed when multiple current paths match one saved snapshot (23.159677ms)
✔ Git revision mapper clears a shared file when direct Context and recovered Global disagree (12.786737ms)
✔ T609-NR-003 keeps recoverable files when an opened encoded catalog file is unreadable (13.704359ms)
✔ review diff URI round-trips context, file, semantics, side, source, and revision (7.450998ms)
✔ review diff URIs from different contexts never collide (1.13612ms)
✔ review diff URI decoding rejects non-canonical or malformed inputs deterministically (1.202552ms)
✔ review diff URI encoding rejects invalid descriptor fields (0.631316ms)
✔ content provider restores original and modified revision content (0.749263ms)
✔ content provider reports unavailable and invalid-encoding outcomes with stable codes (0.798144ms)
✔ local Git adapter reads exact streamed text content at a commit (1.053166ms)
✔ local Git adapter accepts an opened Shift-JIS hint only through the VS Code decode boundary (0.873899ms)
✔ local Git adapter isolates unsupported opened encoding instead of accepting decoder fallback text (0.508671ms)
✔ local Git adapter distinguishes missing commits and missing files (0.451382ms)
✔ local Git adapter rejects moving revisions and unsafe repository paths (0.411287ms)
✔ local Git adapter preserves unexpected Git failures (0.45296ms)
✔ T609 gate wires every focused unit suite once and keeps the Extension Host phase separate (18.289089ms)
✔ T609 CI gate invokes the package-owned unit and Extension Host commands once (2.183721ms)
✔ T609 runner prepares both Git fixtures before the Host launches and the Host suite only consumes them (4.497591ms)
✔ T609 multi-root workspace fixture preserves the single-root whitespace and EOL mapping settings exactly once (2.570517ms)
✔ T609 Host fixture separates active-editor lifecycle, command persistence, visible refresh, and Global completion (1.769261ms)
✔ T609 runner owns a 300-second deadline for the single-root phase (4.276096ms)
✔ T609 phase ownership keeps mixed encoding in single-root and repository cancellation in multi-root (25.155778ms)
✔ T609 contract fixtures compile legacy mapping and Review Context runtime shapes once through the focused gate (5.049938ms)
✔ T609 single-root reuses its no-active Current Context selection without an active-editor refresh (3.182536ms)
✔ T609 Host waits for the single handled startup Current Context refresh before its public no-active-editor command (6.656549ms)
✔ T609 multi-root Current Context commands retain their public path without local settle-time wrappers (5.398346ms)
✔ T609 multi-root Review Contexts keeps its public commands and snapshots under the owned phase deadline (2.486148ms)
✔ T609 multi-root Current Context selection clears mapped editors before the public commands (8.072247ms)
✔ T609 Host reaches normal-editor review through its public command (2.537652ms)
✔ T609 runner seeds persisted mapping state before Host activation through production storage (10.838087ms)
✔ T609 mapped Git-transition fixture keeps only per-file-operation deadlines without an overall mapping deadline (1.875898ms)
✔ T609 production activation does not retain the obsolete Test-only mapping seed (1.820223ms)
✔ T609 single-root uses public mixed-encoding marks after startup settlement without making background Test fakes a command gate (2.463226ms)
✔ T609 production composition passes the shared validated mapping settings to Git revision mapping (4.91169ms)
✔ T609 restart reobserves only its active UTF-8 BOM hint without Current Context or Global refresh (2.310166ms)
✔ T609 Host observes actual VS Code URI safety and persisted encoding mapping without Test mutation seams (3.63546ms)
✔ T609 mixed-encoding composition observes persisted Shift-JIS state at every public boundary (1.546036ms)
✔ T609 persisted Git snapshot reads the Current Context owner without mutating state (1.577658ms)
✔ T609 virtual URI boundary commands use the owned single-root deadline (2.269144ms)
✔ T609 live encoding transition re-decodes the open document without waiting for model disposal (1.004095ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":34018,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791307393028.json"}}
✔ T609 deterministic Git fixture commits the raw EOL-only transition used by mapper regressions (265.310898ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":34168,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791307394663.json"}}
✔ T609 production rename decoration composition settles concurrent visible and explicit refreshes (1621.154142ms)
✔ T609-NR-008 maps only boolean configuration values for Git and live-edit composition (2.478143ms)
✔ T609-NR-004 never selects the first repository when no-active-editor has multiple candidates (1.037795ms)
✔ T609-NR-004 keeps the accepted Current Context when the ambiguous-root Quick Pick is cancelled (0.741653ms)
✔ T609 resolves a Git workspace without an active Git editor in deterministic source order (4.230645ms)
✔ T609 deduplicates a repository and fails closed for unsafe candidates (2.620372ms)
✔ T609 does not accept a disjoint known-root inspection without canonical identity (1.024303ms)
✔ T609 accepts a disjoint known-root alias only when canonical identities match (0.812416ms)
✔ T609 keeps strict known-root matching for absolute and Windows case-varied paths (1.424702ms)
✔ T609 skips only a candidate-specific stat ENOENT and propagates other failures (4.131058ms)
✔ T609 propagates structured non-Error ENOENT rejection values unchanged (3.953397ms)
✔ T609 compares Windows candidate stat paths without case or separator sensitivity (0.691773ms)
✔ T609 rethrows non-Error rejection values unchanged (0.625205ms)
✔ T609 does not accept a stale known-root inspection that resolves to its parent (0.620281ms)
✔ T609 applies the deepest known boundary separately to each document (0.898104ms)
✔ T609 rejects query, fragment, and mismatched authority before T305 or T405 can use a URI filesystem path (0.618905ms)
✔ T609-NR-004 preserves the existing provider projection for multi-root Quick Pick cancel and stale cancellation (2.856156ms)
✔ T609-NR-004 cancel and stale typed outcomes run one command without terminal reporting, clear, or post-cancel refresh (37.224155ms)
✔ T609 Review Contexts resolves the sole opened Git workspace without an active editor (3.690487ms)
✔ T609 Review Contexts fails closed when multiple roots are cancelled (0.838594ms)
✔ T609 isolates one unsupported encoded file while Context and Global map the other file (32.584697ms)
✔ T609-NR-005 retains a privacy-safe unresolved reason when a current-revision text refresh fails (1.670539ms)
✔ T609 preserves a restart-unopened encoded identity only when the new immutable blob exists but cannot be decoded (12.943272ms)
✔ T609 clears only the changed same-revision encoding intervals while preserving unrelated Context and Global state (2.38592ms)
✔ T609 inherits an opened encoding hint only for a unique rename (7.137641ms)
✔ T609 does not carry an opened hint from a copy or a new file back to its source (3.455796ms)
✔ T609-NR-001 maps an opened Shift-JIS file through the actual T405 new-PR Global composition (552.55868ms)
✔ T609 Test dependent queue names every background dependent and does not make the public command wait (2.51746ms)
✔ T609 Test dependent queue aborts stale fakes and contains their rejection during disposal (0.646591ms)
ℹ tests 92
ℹ suites 0
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2597.67699
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第2回実行: npm run test:tooling

- UTC開始=2026-10-06T17:23:22.834683+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675 / after=e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675。
- exit=0、counts={"tests": 25, "pass": 25, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:tooling
> node --test test/tooling/*.test.mjs

✔ CI builds the PR HEAD and fetches history before resolving the main branch point (1.150014ms)
✔ CI uses the resolved version in the VSIX and filenames without modifying tracked manifests (0.377598ms)
✔ new regression tests and packaging diagnostics are wired into the required gate (1.120765ms)
✔ failure diagnostics distinguish the tested checkout from the workflow event identity (0.431593ms)
✔ uses the main release at the branch point and exactly seven PR HEAD digits (172.129416ms)
✔ later main releases and unrelated tags do not change the fork version (181.653401ms)
✔ ignores unversioned tags and supports annotated release tags (168.888053ms)
✔ without a reachable release tag reads the branch-point manifest, not PR or current main (162.659488ms)
✔ preserves leading zeroes in a numeric seven-digit hash (2.162557ms)
✔ does not derive identity from GITHUB_SHA or run number (133.138261ms)
✔ rejects packaging a checkout different from the supplied PR HEAD (116.456862ms)
✔ rejects malformed or unavailable SHA inputs without emitting a version (188.891997ms)
✔ rejects invalid branch-point versions and disconnected history (185.318006ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (6.977808ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.617008ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (31.713597ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.634324ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (1.759104ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (3.974816ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (2.935453ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (8.256309ms)
✔ Issue #137 correlates a safe PR Progress lifecycle without serializing private input values (6.226545ms)
✔ production modules use responsibility names, not task-number filenames (7.591233ms)
✔ runtime composition and reusable policies are placed in their owning folders (0.56207ms)
✔ the extension entry point targets the renamed production composition (2.221906ms)
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1438.158848
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第2回結果・sourceとcommit対応

| Command | Exit | Pass / Total | Fail |
| --- | --- | --- | --- |
| npm run compile:test | 0 | compilation successful | — |
| node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js | 0 | 12 / 12 | 0 |
| npm run test:t305 | 0 | 71 / 71 | 0 |
| npm run test:t405 | 0 | 88 / 88 | 0 |
| npm run test:t406 | 0 | 30 / 30 | 0 |
| npm run test:t606 | 0 | 236 / 236 | 0 |
| npm run test:t609 | 0 | 92 / 92 | 0 |
| npm run test:tooling | 0 | 25 / 25 | 0 |

- 全commandで実行前後source fingerprintは `e3ae9f8b4b4812fb3312fa4254bb3f0406151f0cc152cba3fed1d839fc956675` と一致。対象はbaseline `9d434c3b8a396d4cf5c1cd568caa0118904a28e8` + 親修正dirty source/test tree。
- Red前半全文と第1回outcomesを含む第2回以前全文をSHA-256で保持確認（True）。失敗/中断の履歴は改変していない。
- NR001/003/006の今回の回帰fixturesはGreen。既存legacy dependent behaviorもT305でGreen。通常reviewerのrequired-action completeness/closure verdictは本test executionでは行わない。
- suite間に同じtestsが含まれるため成功数を足して独立test数とはしない。
- 未作成review-target commitへ成功を読み替えない。親はcommit時に以下source/test内容と検証treeの一致を確認してからcommit対応を記録する。報告/task台帳の後続更新は検証した製品sourceとは別に記録する。

今回検証したdirty source/test content SHA-256:

- src/application/review-context/projection-refresh.ts: aa1b040b079fb1bc8fa667a80ee51c211cf3145e85564d953679701989416a50
- src/composition/extension.ts: d1e3cb199e8ae8b00827330600f9985218488dcbe14a0bb2863fee6a1d374cc6
- src/ui/current-context/current-context-runtime-coordinator.ts: 8201846f8d74e0b70ea829fe2310fbec1f0fb330b3c7f6429f21b2e819f524cb
- test/tooling/issue-136-refresh-coordinator.test.mjs: ea0cae292dc46754dea5e227d313f2e16d115aa444c554f68a24882cca22867a
- test/unit/t405-composition-regression.test.ts: 9438bb6d6065dd1ea4b97d0acd53507c2c9e469348f41c8628b52b046528e616

- 本child編集は指定報告への追記のみ、commitなし。次action: 親がreview-target commit統合後、同normal reviewer `/root/issue_136_137_review` のfix verificationへ返す。CI/Extension Host/device UI/mergeは対象外で未実行。

## R2最終検証 第3回（fixture clone式lint修正後）

- 前回全文を保持、追記前SHA-256=e3ba5218a86403679cbf87af66cea2e8ef342474a09567183ea5d095fd7a2e48。
- baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、source_fingerprint=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733（430 files、前回と同じmanifest範囲/algorithm）。親がclone式をJSON roundtripへ変更したため第2回の指紋を今回候補への成功と読み替えず再実行。
- runtime_local / bash / /workspace/RevMem / local_execution_available。source/test編集なし、commit_pending。今回許可されたlint/build/compile/focused/affected suitesのみ。Extension Host・npm test・CI・mergeなし。
- 開始時dirty paths:

```text
 M reports/issue-136-137-normal-review-20261006.md
 M src/application/review-context/projection-refresh.ts
 M src/composition/extension.ts
 M src/ui/current-context/current-context-runtime-coordinator.ts
 M tasks/phases-status.md
 M tasks/tasks-status.md
 M test/tooling/issue-136-refresh-coordinator.test.mjs
 M test/unit/t405-composition-regression.test.ts
?? reports/issue-136-137-r2-regressions-20261006.md
```

- 含むdirty inputs: src/application/review-context/projection-refresh.ts, src/composition/extension.ts, src/ui/current-context/current-context-runtime-coordinator.ts, test/tooling/issue-136-refresh-coordinator.test.mjs, test/unit/t405-composition-regression.test.ts。
- 除外dirty inputs: reports/issue-136-137-normal-review-20261006.md, tasks/phases-status.md, tasks/tasks-status.md, reports/issue-136-137-r2-regressions-20261006.md。reports/tasksはmanifest外、dist/test-distはcompiler生成物。

### 第3回最終検証実行: npm run lint

- UTC開始=2026-10-06T17:25:29.878744+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre lint
> eslint src test --max-warnings=0

```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第3回最終検証実行: npm run build

- UTC開始=2026-10-06T17:25:41.803965+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre build
> npm run compile


> review-range-tracker@0.0.1-pre compile
> tsc -p tsconfig.json

```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第3回最終検証実行: npm run compile:test

- UTC開始=2026-10-06T17:25:51.722902+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第3回最終検証実行: node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js

- UTC開始=2026-10-06T17:26:16.723261+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={"tests": 12, "pass": 12, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (6.421822ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (122.34386ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (145.41221ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (5226.267918ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (5.315384ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.871204ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (40.628333ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.077691ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (3.268252ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (4.517434ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (1.467585ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (12.950614ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5605.968622
```

stderr（全文）:

```text
```

### 第3回最終検証実行: npm run test:t305

- UTC開始=2026-10-06T17:26:26.653394+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={"tests": 71, "pass": 71, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t305
> npm run compile:test && node --test test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/t305-validation-wiring.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (3.923873ms)
✔ pull request, branch, and workspace labels are projected consistently (1.264358ms)
✔ branch selection identity remains stable when HEAD advances (0.33946ms)
✔ select applies the authoritative selected snapshot (0.727311ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.644623ms)
✔ selected context identity is applied to the review runtime before decorations refresh (0.570235ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (0.535251ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (3.614965ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (1.057513ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (0.794973ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.588801ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.27009ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.296459ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.834349ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (1.172488ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (178.487059ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (0.883199ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.327501ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.225365ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (0.566633ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (0.977444ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.922281ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (0.472027ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.61195ms)
✔ refresh ignores stale asynchronous snapshots (0.205626ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.168762ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (5.030041ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.383492ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (1.851427ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (0.452967ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (0.495863ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (0.676806ms)
✔ Global layer toggle does not refresh dependents when persistence fails (1.232336ms)
✔ Global refresh clears stale presentation when the current recalculation fails (1.134626ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (1.016776ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (0.648298ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.248559ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (16.533629ms)
✔ T505-R001 retains immutable open-document evidence after save and close (56.638916ms)
✔ T505-R001 wires change, save, and close events to Global evidence refresh (1.390888ms)
✔ T505-R002 keeps individually valid snapshots when only their combined size exceeds the per-snapshot limit (10.364962ms)
✔ T505-R002 rejects aggregate limits below the per-snapshot limit and never publishes a removed latest snapshot (3.267903ms)
✔ T505-R003 reuses the shared last-valid exclusion policy after an invalid setting (12.08777ms)
✔ T505-R004 invalid snapshot settings fall back without throwing and the manifest caps safe integers (1.066537ms)
✔ T505-R006 focused validation executes the review-finding suite exactly once (0.995649ms)
✔ T505-R007 follow-up handoff uses the required schema v3 top-level packet and preserves the original payload (1.178365ms)
✔ T505-R005 requesting a debounced refresh immediately invalidates the in-flight generation (0.392825ms)
✔ PR69-R001 Global snapshot pins a working-tree open target to the producing owner (11.181973ms)
✔ PR69-R001 PR Global snapshot pins immutable HEAD identity even when the file is absent locally (8.443044ms)
✔ PR69-R001 stale Global nodes reject directly while the registered command owns generic error reporting (12.243654ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (146.288583ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (1.104664ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.351651ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.5229ms)
✔ reports start and success while keeping the busy status visible until completion (1.396228ms)
✔ restores the previous operation status after a nested operation finishes (0.295584ms)
✔ logs and reveals failures before rethrowing them (0.49648ms)
✔ records a swallowed diagnostic failure without changing active status (0.483197ms)
✔ formats one-line Output entries without exposing a stack trace (0.362169ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.280396ms)
✔ T405 contributes Review Contexts activation, commands, and menus (13.641614ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (1.425997ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (4.274238ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (5.31883ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (2.214494ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (1.948404ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (1.2682ms)
✔ T305 preserves every pre-existing unit suite exactly once while adding its focused suites (1.064844ms)
✔ Issue #84 registers the selected PR runtime before PR Progress refresh (0.374342ms)
✔ T305 contributes the Review Range activity container, views, and commands (16.032079ms)
✔ T305 default and focused commands execute the same behavior suites (5.314368ms)
ℹ tests 71
ℹ suites 0
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 507.777816
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第3回最終検証実行: npm run test:t405

- UTC開始=2026-10-06T17:26:44.855496+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={"tests": 88, "pass": 88, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t405
> npm run compile:test && node --test test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-storage.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-pull-request-review-runtime.test.js test-dist/test/unit/t405-review-followup.test.js test-dist/test/unit/t405-revision-evidence.test.js test-dist/test/unit/t405-selected-pr-session.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T405 contributes Review Contexts activation, commands, and menus (15.105244ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (8.21191ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (3.658373ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (5.773963ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (5.277241ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (8.988878ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (1.955141ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (111.30283ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (2.487105ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.22609ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (1.135979ms)
✔ reports start and success while keeping the busy status visible until completion (1.739388ms)
✔ restores the previous operation status after a nested operation finishes (1.165785ms)
✔ logs and reveals failures before rethrowing them (1.66314ms)
✔ records a swallowed diagnostic failure without changing active status (0.399124ms)
✔ formats one-line Output entries without exposing a stack trace (0.609802ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.523482ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (106.189266ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (2.015778ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (3.797483ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (4.069103ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (0.956565ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (28.890933ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (4.923152ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (0.597129ms)
✔ PR runtime command snapshot survives immutable PR A-to-B-to-A store restoration with hashes (44.647823ms)
✔ R405-3 saved/closed PR opens through the canonical T302 review-range-diff identity (1.309087ms)
✔ R405-3 Review Contexts canonical original/modified commands persist mark and unmark (15.159837ms)
✔ PR runtime command fails closed before commit when persisted hashes do not match authoritative HEAD content (5.024465ms)
✔ PR mutation no-op, cancellation, and failed commit publish neither snapshots nor history (2.871488ms)
✔ R405-5 PR runtime exposes T304 progress for Review Contexts (4.597749ms)
✔ Issue #137 actual T405 PR activation never emits acquired file paths in detailed Output (23.053261ms)
✔ Issue #136 keeps the newest PR Progress refresh when an older read finishes later (4.196391ms)
✔ R405-3 binary PR changes are not opened as text review diffs (1.124167ms)
✔ Issue #59 PR full scan reads complete current-side files once and reuses immutable revision caches (1.979639ms)
✔ PR69-R001 Global PR open uses the exact immutable HEAD document and rejects a superseded head (1.451671ms)
✔ PR Progress original-side selection projects unchanged lines and retains original-only lines atomically (2.862751ms)
✔ PR Progress command rejects an old diff URI pair after BASE or HEAD changes (2.632132ms)
✔ production command routing validates the active immutable diff URI pair before mutation (6.336308ms)
✔ PR runtime persists mark and unmark for added content without a terminal newline (6.935237ms)
✔ PR runtime persists mark and unmark for added LF-terminated content (2.574455ms)
✔ PR runtime persists mark and unmark for deleted content without a terminal newline (3.291578ms)
✔ PR runtime persists mark and unmark for deleted LF-terminated content (2.472492ms)
✔ PR runtime persists mark and unmark for replacement with terminal newlines (4.352203ms)
✔ PR runtime persists mark and unmark for replacement that adds a terminal newline (3.220333ms)
✔ PR runtime persists mark and unmark for replacement that removes a terminal newline (2.7786ms)
✔ PR runtime preserves empty existing files and CRLF content through body-derived line contracts (5.997474ms)
✔ PR runtime treats a terminal display line as outside Git content (1.202638ms)
✔ PR runtime leaves bare CR display fragments outside one-line Git replacements (2.5415ms)
✔ PR runtime rejects truncated, mismatched, and inconsistent local Git hunk evidence before mutation (3.685834ms)
✔ PR runtime hydrates complete legacy-redacted cache hunks and rejects tampered or incomplete evidence (5.018739ms)
✔ PR runtime block mode links both sides while a later side-mode operation stays on the operated side (3.503926ms)
✔ PR runtime block mode expands an original replacement selection to modified Context and Global (5.543664ms)
✔ PR runtime does not read selection mode or open state for an empty selection (0.723406ms)
✔ PR runtime block mark from original commits when only the target revision Global snapshot changes (4.038853ms)
✔ PR runtime block unmark from original commits when only the target revision Global snapshot changes (7.135805ms)
✔ PR runtime block mark from modified commits when only the target revision Global snapshot changes (4.559373ms)
✔ PR runtime block unmark from modified commits when only the target revision Global snapshot changes (5.476873ms)
✔ PR runtime rejects a re-registered comparison while a pending state load is resumed (1.374435ms)
✔ PR runtime rejects old rename URIs and keeps an active command scoped to its PR (1.651296ms)
✔ PR runtime keeps actual repository state atomic through write and CAS failures, restart, and a history failure (453.712421ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (8.481976ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (155.747654ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (89.537349ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3526.639625ms)
✔ R60-001 immutable PR HEAD remains authoritative when the working-tree candidate set omits the file (1.238384ms)
✔ R60-001 Global promotes immutable PR HEAD evidence even when the working tree no longer contains that path (20.472279ms)
✔ R60-003 superseded owner revisions evict retained Global evidence instead of reviving it later (20.723722ms)
✔ R60-002 breaking-change policy supersedes rev4 Global semantics with opened-only and immutable-PR rules (0.839782ms)
✔ PR85-IFR-004 production Review Contexts completion counts stay monotonic across two PRs, retry, and repositories (334.169448ms)
✔ PR85-NR-003 selected PR Progress reports file counts through the production Tree path on immutable-cache hits (9.897621ms)
✔ R405-4 presentation hide applies to current PR, branch, and workspace without deleting state (0.901787ms)
✔ R405-5 Review Contexts projects T304-compatible PR progress (0.338475ms)
✔ R405-5 progress formatter covers zero, partial, and complete PR states (0.184884ms)
✔ T405-IFR-2 keeps cache origin, freshness, and last successful update in the View projection (0.177865ms)
✔ R405-5 Review Contexts Tree renders projected progress to users (1.580378ms)
✔ R405-7 pull-request Current Context identity is stable across rediscovery and not label-derived (0.561483ms)
✔ R405-7/R405-8 current PR is inferred only from persisted open state at the local HEAD (0.145248ms)
✔ R405-7 multiple current-head PRs retain the PR explicitly chosen by redetection (0.072685ms)
✔ Issue #137 selection provenance distinguishes explicit, unique, ambiguous, and missing matches (0.16142ms)
✔ T406-R001 explicit branch selection suppresses one saved open PR at the same immutable HEAD (0.063802ms)
✔ R405-7 redetection persists and reloads explicit current PR identity (3.246266ms)
✔ R405-6/R405-9 remove the dead closed-layer setting and document connected Review Contexts (2.655027ms)
✔ R405-1 revision evidence supplies exact diff and old/new text for tracked files (5.345481ms)
✔ base-only PR transition does not invent a head diff (3.845847ms)
✔ PR evidence loader supplies unchanged Global-only target evidence to the immutable mapper (11.085856ms)
✔ R405-7 selected PR owns normal-editor command and decoration sessions without branch initialization (5.1978ms)
✔ selected PR rejects a foreign repository or stale head without creating state (1.110497ms)
ℹ tests 88
ℹ suites 0
ℹ pass 88
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4522.798839
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第3回最終検証実行: npm run test:t406

- UTC開始=2026-10-06T17:27:09.137665+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={"tests": 30, "pass": 30, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t406
> npm run compile:test && node --test test-dist/test/integration/mock-github.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-composition-regression.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (77.714359ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (1.976121ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (17.006226ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (3.498827ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (0.795637ms)
✔ GitHub adapter attempts a public API request without authentication (6.163722ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (26.198487ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (4.959761ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (2.278916ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (0.537261ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.436807ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.172846ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.223727ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.332083ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (37.410749ms)
✔ local Git diff is the first successful acquisition source (1.986086ms)
✔ GitHub PR files patch is used after local Git is unavailable (1.173558ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (1.800339ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (0.825897ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.505061ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.765968ms)
✔ remote metadata from a different comparison is rejected before content reads (0.867977ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (1.404139ms)
✔ invalid revision input is rejected before invoking local Git (0.802081ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (1.708094ms)
✔ malformed remote file identity fails closed without reading repository contents (0.393826ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (4.195294ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (168.834431ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (77.705685ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3624.163766ms)
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4024.51279
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第3回最終検証実行: npm run test:t606

- UTC開始=2026-10-06T17:27:32.806422+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={"tests": 236, "pass": 236, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t606
> npm run compile:test && node --test test-dist/test/unit/t606-failure-policy-retry-diagnostics.test.js test-dist/test/unit/t606-production-failure-matrix.test.js test-dist/test/unit/t606-r6-production-matrix.test.js test-dist/test/unit/t606-r6-real-composition.test.js test-dist/test/unit/t606-r5-production-activation.test.js test-dist/test/unit/local-git-adapter.test.js test-dist/test/integration/t302-review-followup.integration.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/state-repository.test.js test-dist/test/unit/debounced-review-state-repository.test.js test-dist/test/unit/normal-editor-review-command-registration.test.js test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/global-understanding-ui.test.js test-dist/test/unit/t505-global-understanding-source.test.js test-dist/test/unit/github-pull-request-cache.test.js test-dist/test/integration/mock-github.test.js test-dist/test/unit/t604-storage-lock-cleanup.test.js test-dist/test/unit/t605-multi-root-remote-boundaries.test.js test-dist/test/unit/ci-workflow-contract.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (82.510945ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (2.567719ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (26.182444ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (7.818737ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (0.790354ms)
✔ GitHub adapter attempts a public API request without authentication (6.409949ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (29.835254ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (8.750269ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (6.684201ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (0.787759ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.637301ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.348085ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.442094ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (1.013718ms)
✔ review diff URI round-trip preserves filesystem path semantics (5.573341ms)
✔ review diff URI rejects moving refs and non-canonical repository paths (1.597516ms)
✔ POSIX review diff URI preserves tab, newline, and backslash filename characters (1.016483ms)
✔ Windows review diff URI rejects backslash and control characters (0.954562ms)
✔ fatal revision lookup exit 128 is preserved instead of reported as missing (0.922838ms)
✔ fatal file lookup exit 128 is preserved instead of reported as missing (0.57065ms)
✔ moving refs are rejected before immutable Git content lookup (179.185884ms)
✔ POSIX Git content lookup supports tab, newline, and backslash filenames (173.870571ms)
✔ POSIX Git content lookup supports a filename made only of a newline (120.065066ms)
✔ Git content lookup reads UTF-8 text immediately below and above 4 MiB (408.582322ms)
✔ non-UTF-8 Git blob is rejected deterministically without replacement characters (220.217197ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (55.486537ms)
✔ local Git diff is the first successful acquisition source (10.564455ms)
✔ GitHub PR files patch is used after local Git is unavailable (7.462934ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (2.779769ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (2.834036ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.901901ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (1.729899ms)
✔ remote metadata from a different comparison is rejected before content reads (0.270268ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (4.009877ms)
✔ invalid revision input is rejected before invoking local Git (2.931075ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (8.105872ms)
✔ malformed remote file identity fails closed without reading repository contents (1.004894ms)
✔ unit and focused suites execute the integrated design contract (33.109663ms)
✔ document line contract coverage is runnable directly and through the required unit suite (5.222538ms)
✔ unit, npm test, focused CI execute the complete T304 tree contract (7.339764ms)
✔ temporary Git suite executes the T207 history integration scenario (1.653021ms)
✔ T502 focused coverage is runnable locally and included in the default unit suite (4.943114ms)
✔ CI executes positive and negative architecture gates with diagnostic logs (1.042613ms)
✔ CI executes the canonical T502 focused command (2.379401ms)
✔ T505 focused coverage executes each dedicated suite once and is required by CI (5.602481ms)
✔ CI diagnostics preserve stdout, stderr, combined logs, and result metadata (1.88167ms)
✔ T506 integration and Extension Host acceptance are exposed as one required focused CI command (3.991068ms)
✔ T406 GitHub failure and recovery integration is exposed by package and CI (4.228501ms)
✔ T605 multi-root and remote workspace boundary coverage is exposed by package and CI (2.274258ms)
✔ T606 focused failure-policy coverage is exposed by package and CI (1.39807ms)
✔ T607 performance workloads remain local-only and never gate CI (5.639052ms)
✔ CI publishes a branch-version-and-HEAD-named VSIX and tracked source archive only after pull-request success (2.090716ms)
✔ required unit gate runs the Issue #90 runtime routing suite before success artifacts (1.285475ms)
✔ required unit gate reaches the Issue #92 PR Progress context-menu contract before success artifacts (0.938724ms)
✔ required CI gates exclude timing-sensitive suites and use deadline-free Extension Host waits (5.031438ms)
✔ required gates keep the T606 wall-clock timeout fixture local-only (1.473748ms)
✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (3.669852ms)
✔ pull request, branch, and workspace labels are projected consistently (0.341878ms)
✔ branch selection identity remains stable when HEAD advances (0.365559ms)
✔ select applies the authoritative selected snapshot (2.506246ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.787623ms)
✔ selected context identity is applied to the review runtime before decorations refresh (1.539136ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (0.79154ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (2.512218ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (1.771362ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (2.539884ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.228445ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.228236ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.59463ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.581141ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (1.225037ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (197.067517ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (1.828736ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.659539ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.375382ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (1.050952ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (0.709832ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.703746ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (0.868907ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.667436ms)
✔ refresh ignores stale asynchronous snapshots (0.263971ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.342024ms)
✔ multiple background saves are coalesced and persist only the newest complete snapshot (2.450828ms)
✔ storage kinds remain isolated even when repository and context IDs are identical (0.653698ms)
✔ a confirmation transaction flushes pending background state and commits without waiting for the debounce timer (0.417528ms)
✔ external-file confirmation flushes the external pending state before commit (0.377229ms)
✔ dispose flushes a pending save immediately for Extension Host deactivation (3.301799ms)
✔ dispose waits for an immediate commit queued behind an in-flight load (9.692444ms)
✔ dispose waits for an in-flight owner-wide Global load (8.383856ms)
✔ owner-wide Global load serializes a different context commit (1.510886ms)
✔ Git Global load serializes a pull-request save for the same repository (1.552978ms)
✔ all callers observe a debounced persistence failure instead of receiving a false success (2.700618ms)
✔ live GitHub acquisition stores metadata and a source-redacted diff with explicit timestamps (5.933551ms)
✔ rate-limit failure uses an exact cached PR and marks expired data stale (1.882765ms)
✔ network failure uses an unexpired exact cache and marks it fresh (0.7301ms)
✔ patch fallback followed by network failure still uses an exact cache (3.51289ms)
✔ non-offline API failures do not substitute cached data (0.481351ms)
✔ mixed offline-eligible and API failures do not substitute cached data (0.867968ms)
✔ cache entries are bound to the exact context, repository, PR, base, and head identity (0.727637ms)
✔ filesystem cache publishes metadata and redacted diff through one generation pointer (107.355367ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (2.592385ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.588266ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.643346ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (0.367546ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (0.484475ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (0.540534ms)
✔ Global layer toggle does not refresh dependents when persistence fails (0.647379ms)
✔ Global refresh clears stale presentation when the current recalculation fails (0.772908ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (0.493152ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (0.761759ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.31632ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (12.547809ms)
✔ Node local Git path normalization propagates stat permission errors unchanged (2.421345ms)
✔ Node local Git path normalization retains only an exact candidate stat ENOENT (0.294681ms)
✔ Node local Git path identity is unavailable when either realpath lookup fails (0.266769ms)
✔ repository inspection uses argument arrays and returns normalized Git identity (14.738172ms)
✔ remote normalization unifies common GitHub URL forms without credentials (0.778464ms)
✔ fork remotes remain distinct repository identities (1.1903ms)
✔ a repository without remotes receives a stable root-derived identity (1.880503ms)
✔ Issue #57 keeps local Git context usable when a listed remote URL cannot be resolved (0.690931ms)
✔ detached HEAD is distinguished while retaining the exact HEAD object (4.150538ms)
✔ Git executable absence and non-repositories are separate outcomes (0.727618ms)
✔ merge-base and object existence use bounded argument-array commands (2.992019ms)
✔ revision arguments that could be parsed as options are rejected (0.289248ms)
✔ registerNormalEditorReviewCommands registers the four designed command IDs (2.333285ms)
✔ registered commands delegate only when an active normal editor exists (1.182666ms)
✔ registered commands reject missing and diff editors without invoking state commands (0.465613ms)
✔ registered commands report a privacy-safe handler failure through the UI host (0.616525ms)
✔ handler failure is recorded as failed operation before the UI host reports it (3.585024ms)
✔ Test-mode command failure is captured by operation and rejects with the original error without waiting for UI (1.007436ms)
✔ applied production handlers await one automatic decoration refresh (4.994001ms)
✔ Test-mode public command settles after state application without an automatic decoration refresh (6.857367ms)
✔ T405 contributes Review Contexts activation, commands, and menus (12.546743ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (5.208451ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (12.254387ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (20.343377ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (2.662006ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (4.890686ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (1.323275ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (2.684845ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.237227ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.601854ms)
✔ reports start and success while keeping the busy status visible until completion (1.879469ms)
✔ restores the previous operation status after a nested operation finishes (0.412292ms)
✔ logs and reveals failures before rethrowing them (0.860035ms)
✔ records a swallowed diagnostic failure without changing active status (0.673598ms)
✔ formats one-line Output entries without exposing a stack trace (0.731646ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.519897ms)
✔ routing separates Git and PR state from non-Git workspace state (9.889413ms)
✔ workspace routing requires ExtensionContext.storageUri (2.056866ms)
✔ repository save commits manifest last and reloads the same context and Global state (77.836681ms)
✔ repository manifest preserves other contexts while atomically advancing one context (79.201265ms)
✔ non-Git state uses workspace-state.json and never writes under globalStorageUri (21.198001ms)
✔ a failed repository manifest replacement preserves disk and memory state (29.605615ms)
✔ a failed workspace replacement preserves disk and memory state (26.357423ms)
✔ schema mismatch is rejected and reported during load (7.83303ms)
✔ save validates manifest, context, Global, target identity before any write (6.279737ms)
✔ concurrent saves retain both context references in the repository manifest (41.771914ms)
✔ save accepts the exact target and context kind mapping (24.920052ms)
✔ save rejects non-matching target and context kinds (16.346607ms)
✔ NodeAtomicTextFileStore replaces a file without leaving temporary files (4.729093ms)
✔ storage-root containment follows the host path semantics without weakening escape rejection (0.766671ms)
✔ NodeAtomicTextFileStore rejects an outside sibling and a symbolic link or junction (9.486397ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (4.322385ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (203.872023ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (144.430604ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (4620.533265ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (33.926999ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (2.729482ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (6.273974ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (5.53698ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (0.780942ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (30.323061ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (2.503235ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (1.001469ms)
✔ T505 source keeps unopened file contents out of the line denominator while preserving path diagnostics (122.477468ms)
✔ Issue #59 uses only previously opened files for Global line progress and reports unopened files separately (55.528975ms)
✔ Issue #59 PR full HEAD scan is promoted to opened Global evidence (39.10904ms)
✔ T604 refuses a live root lock without exposing owner or path diagnostics (46.156237ms)
✔ T604 immediately recovers an unexpired lease only when its owner is confirmed dead (18.991143ms)
✔ T604 never steals an expired descriptor from a live cooperative owner (14.245611ms)
✔ T604 recovers a bounded stale malformed lock without taking a live valid lease (29.805113ms)
✔ T604 bounds fresh zero, truncated, malformed, and future-invalid partial recovery before aging (85.556667ms)
✔ T604 deduplicates pending privacy-safe diagnostics by operation scope (2.984458ms)
✔ T604 fences a detached owner before it can publish after a successor recovery (13.587492ms)
✔ T604 rejects a dead owner's real state publication after a successor publishes newer Context, Global, and manifest (122.468924ms)
✔ T604 cleans an owned partial lease after write, sync, or close acquisition failure (46.983151ms)
✔ T604 uses an owned OS child-process lease and releases it for a successor (639.926873ms)
✔ T604 immediately recovers a killed child lease before its bounded expiry (267.403054ms)
✔ T604 rejects a root-confined snapshot mutation through a symlink or Windows junction (5.367495ms)
✔ T604 retains independent-window Contexts and Global publication under concurrent writes (57.214365ms)
✔ T604 atomically appends independent-window history events (15.088679ms)
✔ T604 cache cleanup retains the published generation and removes superseded immutable files (66.033093ms)
✔ T604 serializes state, history, cache, snapshot cleanup, and startup migration through one explicit custom-store coordinator (60.837758ms)
✔ T604 snapshot cleanup retains a referenced generation and removes expired unreferenced entries (41.613006ms)
✔ T604 snapshot cleanup preserves every active pointer while bounding an unreferenced generation (75.49368ms)
✔ T604 runs production startup recovery against real child writers and restarts from the newer coherent state (545.632548ms)
✔ T604 keeps active snapshots above count and byte limits, publishes through cleanup failure, and converges after restart (233.10626ms)
✔ T604 flushes a terminal startup lock failure through the production feedback composition exactly once (1.425256ms)
✔ T605 chooses exactly the longest matching multi-root URI and preserves remote authority (6.636157ms)
✔ T605 fails closed for URI boundaries and separates workspace storage roots (29.914834ms)
✔ T605 root registry retains typed snapshot and Git-rewrite capabilities (0.901062ms)
✔ T605 IFR001 rejects delayed open, load, and commit from a removed and re-added root generation (2.484588ms)
✔ T605 IFR002 applies one URI eligibility boundary before descriptor routing (4.857108ms)
✔ T605 keeps same-repository roots distinct for Current Context and PR acquisition (0.325647ms)
✔ T605 concrete root composition commits snapshots through reconciliation and survives root-scoped restart (649.142905ms)
✔ T606 classifies retryable, permanent, stale, authentication, and validation failures without raw messages (4.804485ms)
✔ T606 retries only retryable faults with a bounded cancellable sequence (4.140629ms)
✔ T606 never retries authentication, validation, stale, or partial-side-effect failures (5.193566ms)
✔ T606 emits one bounded single-line redacted ERROR and always clears activity (6.865587ms)
✔ T606 makes a handled inner failure terminal exactly once for its shared operation (1.962514ms)
✔ T606 keeps independent concurrent production operations as separate lifecycles (2.853075ms)
✔ T606 joins an actual storage diagnostic to its explicit owner context without a duplicate terminal (2.784852ms)
✔ T606 Review Contexts runtime fences a superseded source publication (24.499778ms)
✔ T606 Review Contexts provider aborts an old root load and never publishes its distinct stale item (1.392618ms)
✔ T606 retries only an actual Review Contexts pure-read runtime operation (26.920047ms)
✔ T606 runs Review Contexts commands through the production registration: read retries, mutations do not (45.811346ms)
✔ T606 passes one explicit feedback context through the production Review Contexts read boundary (8.158471ms)
✔ T606 runs Git executable-missing, nonzero, corruption, and safe.directory outcomes through the LocalGitAdapter boundary (5.852617ms)
✔ T606 preserves the last published repository state when the production persistence adapter sees ENOSPC or EACCES during flush/replace (31.897798ms)
✔ T606 R5 invokes the registered Current Context command through its production composition and records supersede as a typed terminal (20.398667ms)
✔ T606 R5 invokes the registered Global open command with one generic UI error and one redacted terminal (11.097386ms)
✔ T606 R6 Current Context production runtime cross-supersedes refresh/select with one signal owner and one typed terminal (17.595795ms)
✔ T606 R7 absorbs a failed old-root load and preserves the fresh-root stale/unknown transition (7.75586ms)
✔ T606 R7 cache publish mutation records a terminal failure, rethrows to its boundary, and starts no post-mutation refresh (7.932109ms)
✔ T606 R6 cache retries acquisition only, publishes once, and never retries a publish failure (5.695795ms)
✔ T606 IFR001 propagates an actual cache write failure instead of projecting live not-cached success (0.640975ms)
✔ T606 IFR002 fences a pending Node cache write after abort and returns a typed cancellation (10.074268ms)
✔ T606 IFR003 runs the production Global layer toggle through one redacted terminal lifecycle (5.93039ms)
✔ T606 IFR001 republishes the post-cache-publish tree snapshot and fails closed when publication reports failure (1.314361ms)
✔ T606 IFR003 Global open throws once to the shared redacted UI boundary without a raw-error callback (3.113346ms)
✔ T606 IFR003 PR Progress carries its owner and abort signal to pending content I/O, then emits one terminal per cancelled, failed, and successful refresh (12.707116ms)
✔ T606 IFR002 retries only transient result unions through Current Context's cache read port and keeps permanent causes single-attempt (79.489044ms)
✔ T606 IFR002 real T305-to-T405 composition retries only transient acquisition, aborts deep cache I/O, and fences stale publication (348.690072ms)
✔ T305 contributes the Review Range activity container, views, and commands (13.407046ms)
✔ T305 default and focused commands execute the same behavior suites (3.890153ms)
ℹ tests 236
ℹ suites 0
ℹ pass 236
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6265.140631
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第3回最終検証実行: npm run test:t609

- UTC開始=2026-10-06T17:27:57.918374+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={"tests": 92, "pass": 92, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:t609
> npm run compile:test && node --test test-dist/test/unit/t609-repository-resolution.test.js test-dist/test/unit/t609-review-contexts-repository.test.js test-dist/test/unit/t609-revision-mapping-encoding.test.js test-dist/test/unit/t609-normal-review-followup.test.js test-dist/test/unit/t609-review-contexts-cancellation-boundary.test.js test-dist/test/unit/t609-t405-encoding-composition.test.js test-dist/test/unit/t609-test-review-state-dependent-queue.test.js test-dist/test/unit/t609-gate-wiring.test.js test-dist/test/unit/t609-host-rename-decoration-composition.test.js test-dist/test/unit/review-diff-content-provider.test.js test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/history-rewrite-git-context-integration.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T609 read-only document provider recovers when the actual Git inspection cwd was deleted (352.870823ms)
✔ T609 document decoration recovery propagates noncandidate stat failures (18.928914ms)
✔ Git provider restores each mixed target snapshot layer in one CAS (159.749261ms)
✔ Git provider rejects an invalid present target snapshot without fallback CAS or history (13.022709ms)
✔ Git provider rejects an unreadable present target snapshot without fallback CAS or history (12.339196ms)
✔ Git provider does not publish mixed snapshot state or history after a CAS conflict (41.687724ms)
✔ Git provider records an unresolved mapping event after a conservative missing-object clear (14.627653ms)
✔ Git provider records binary mapping as unresolved instead of a successful remap (21.859403ms)
✔ document sessions map branch commits and isolate branch and detached contexts (8.218934ms)
✔ T609-NR-005 records a generic unresolved history reason for a failed current-revision text refresh (10.49772ms)
✔ document routing recalculates the current Git snapshot when an opened encoding hint changes (11.289243ms)
✔ T609 production Git document session clears a same-revision encoding transition without changing an unrelated BOM file (9.932395ms)
✔ T609-NR-002 aggregates all reopened document hints across mapping and an encoding change (25.645603ms)
✔ document routing follows the stable file ID after a rename (8.13474ms)
✔ new branch initialization maps owner-wide Global state through the debounced repository (438.902549ms)
✔ new branch initialization preserves a concurrent Global update while mapping (957.483104ms)
✔ a poll started at B preserves foreground revision C after its mapping completes (325.542855ms)
✔ document routing distinguishes a renamed file from a new file at its old path (14.812377ms)
✔ document routing excludes a binary rename while routing a new text file at its old path (11.600721ms)
✔ document routing maps an ambiguous rename and copy graph without reusing its source ID (6.961268ms)
✔ Git revision mapper preserves SHA-only reviewed ranges through saved snapshots when the old object is gone (207.696566ms)
✔ Git revision mapper follows one snapshot-backed rename and retains the stable file identity (64.201746ms)
✔ Git revision mapper fails closed when multiple current paths match one saved snapshot (36.782595ms)
✔ Git revision mapper clears a shared file when direct Context and recovered Global disagree (26.116217ms)
✔ T609-NR-003 keeps recoverable files when an opened encoded catalog file is unreadable (43.811231ms)
✔ review diff URI round-trips context, file, semantics, side, source, and revision (7.374245ms)
✔ review diff URIs from different contexts never collide (1.301975ms)
✔ review diff URI decoding rejects non-canonical or malformed inputs deterministically (1.512634ms)
✔ review diff URI encoding rejects invalid descriptor fields (2.613854ms)
✔ content provider restores original and modified revision content (3.589812ms)
✔ content provider reports unavailable and invalid-encoding outcomes with stable codes (1.238419ms)
✔ local Git adapter reads exact streamed text content at a commit (1.528641ms)
✔ local Git adapter accepts an opened Shift-JIS hint only through the VS Code decode boundary (1.871754ms)
✔ local Git adapter isolates unsupported opened encoding instead of accepting decoder fallback text (0.775512ms)
✔ local Git adapter distinguishes missing commits and missing files (4.671148ms)
✔ local Git adapter rejects moving revisions and unsafe repository paths (0.469779ms)
✔ local Git adapter preserves unexpected Git failures (0.65702ms)
✔ T609 gate wires every focused unit suite once and keeps the Extension Host phase separate (59.553883ms)
✔ T609 CI gate invokes the package-owned unit and Extension Host commands once (3.229653ms)
✔ T609 runner prepares both Git fixtures before the Host launches and the Host suite only consumes them (6.097567ms)
✔ T609 multi-root workspace fixture preserves the single-root whitespace and EOL mapping settings exactly once (5.624013ms)
✔ T609 Host fixture separates active-editor lifecycle, command persistence, visible refresh, and Global completion (1.477768ms)
✔ T609 runner owns a 300-second deadline for the single-root phase (2.646184ms)
✔ T609 phase ownership keeps mixed encoding in single-root and repository cancellation in multi-root (5.653118ms)
✔ T609 contract fixtures compile legacy mapping and Review Context runtime shapes once through the focused gate (5.763056ms)
✔ T609 single-root reuses its no-active Current Context selection without an active-editor refresh (4.098209ms)
✔ T609 Host waits for the single handled startup Current Context refresh before its public no-active-editor command (3.048099ms)
✔ T609 multi-root Current Context commands retain their public path without local settle-time wrappers (10.13108ms)
✔ T609 multi-root Review Contexts keeps its public commands and snapshots under the owned phase deadline (11.510096ms)
✔ T609 multi-root Current Context selection clears mapped editors before the public commands (1.62802ms)
✔ T609 Host reaches normal-editor review through its public command (1.240831ms)
✔ T609 runner seeds persisted mapping state before Host activation through production storage (1.347595ms)
✔ T609 mapped Git-transition fixture keeps only per-file-operation deadlines without an overall mapping deadline (1.901114ms)
✔ T609 production activation does not retain the obsolete Test-only mapping seed (8.593677ms)
✔ T609 single-root uses public mixed-encoding marks after startup settlement without making background Test fakes a command gate (5.291322ms)
✔ T609 production composition passes the shared validated mapping settings to Git revision mapping (19.537529ms)
✔ T609 restart reobserves only its active UTF-8 BOM hint without Current Context or Global refresh (2.949927ms)
✔ T609 Host observes actual VS Code URI safety and persisted encoding mapping without Test mutation seams (16.660742ms)
✔ T609 mixed-encoding composition observes persisted Shift-JIS state at every public boundary (6.334693ms)
✔ T609 persisted Git snapshot reads the Current Context owner without mutating state (3.325926ms)
✔ T609 virtual URI boundary commands use the owned single-root deadline (2.484349ms)
✔ T609 live encoding transition re-decodes the open document without waiting for model disposal (2.166046ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":37174,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791307697853.json"}}
✔ T609 deterministic Git fixture commits the raw EOL-only transition used by mapper regressions (501.085686ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":37321,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791307699747.json"}}
✔ T609 production rename decoration composition settles concurrent visible and explicit refreshes (1891.250094ms)
✔ T609-NR-008 maps only boolean configuration values for Git and live-edit composition (2.12624ms)
✔ T609-NR-004 never selects the first repository when no-active-editor has multiple candidates (0.750885ms)
✔ T609-NR-004 keeps the accepted Current Context when the ambiguous-root Quick Pick is cancelled (0.268473ms)
✔ T609 resolves a Git workspace without an active Git editor in deterministic source order (4.791459ms)
✔ T609 deduplicates a repository and fails closed for unsafe candidates (10.735942ms)
✔ T609 does not accept a disjoint known-root inspection without canonical identity (0.894508ms)
✔ T609 accepts a disjoint known-root alias only when canonical identities match (10.803533ms)
✔ T609 keeps strict known-root matching for absolute and Windows case-varied paths (3.553161ms)
✔ T609 skips only a candidate-specific stat ENOENT and propagates other failures (10.786097ms)
✔ T609 propagates structured non-Error ENOENT rejection values unchanged (0.456845ms)
✔ T609 compares Windows candidate stat paths without case or separator sensitivity (15.024993ms)
✔ T609 rethrows non-Error rejection values unchanged (3.297291ms)
✔ T609 does not accept a stale known-root inspection that resolves to its parent (2.798069ms)
✔ T609 applies the deepest known boundary separately to each document (0.566611ms)
✔ T609 rejects query, fragment, and mismatched authority before T305 or T405 can use a URI filesystem path (5.484223ms)
✔ T609-NR-004 preserves the existing provider projection for multi-root Quick Pick cancel and stale cancellation (5.962141ms)
✔ T609-NR-004 cancel and stale typed outcomes run one command without terminal reporting, clear, or post-cancel refresh (106.320837ms)
✔ T609 Review Contexts resolves the sole opened Git workspace without an active editor (29.863588ms)
✔ T609 Review Contexts fails closed when multiple roots are cancelled (19.332049ms)
✔ T609 isolates one unsupported encoded file while Context and Global map the other file (51.156696ms)
✔ T609-NR-005 retains a privacy-safe unresolved reason when a current-revision text refresh fails (5.190853ms)
✔ T609 preserves a restart-unopened encoded identity only when the new immutable blob exists but cannot be decoded (13.245168ms)
✔ T609 clears only the changed same-revision encoding intervals while preserving unrelated Context and Global state (1.978442ms)
✔ T609 inherits an opened encoding hint only for a unique rename (6.669417ms)
✔ T609 does not carry an opened hint from a copy or a new file back to its source (7.248622ms)
✔ T609-NR-001 maps an opened Shift-JIS file through the actual T405 new-PR Global composition (395.741037ms)
✔ T609 Test dependent queue names every background dependent and does not make the public command wait (3.144137ms)
✔ T609 Test dependent queue aborts stale fakes and contains their rejection during disposal (1.639313ms)
ℹ tests 92
ℹ suites 0
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3321.949989
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第3回最終検証実行: npm run test:tooling

- UTC開始=2026-10-06T17:28:23.352677+00:00、baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8、before=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733 / after=abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733。
- exit=0、counts={"tests": 25, "pass": 25, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}。

stdout（全文）:

```text

> review-range-tracker@0.0.1-pre test:tooling
> node --test test/tooling/*.test.mjs

✔ CI builds the PR HEAD and fetches history before resolving the main branch point (1.393246ms)
✔ CI uses the resolved version in the VSIX and filenames without modifying tracked manifests (0.246334ms)
✔ new regression tests and packaging diagnostics are wired into the required gate (0.345246ms)
✔ failure diagnostics distinguish the tested checkout from the workflow event identity (1.637345ms)
✔ uses the main release at the branch point and exactly seven PR HEAD digits (168.287012ms)
✔ later main releases and unrelated tags do not change the fork version (182.726622ms)
✔ ignores unversioned tags and supports annotated release tags (215.76368ms)
✔ without a reachable release tag reads the branch-point manifest, not PR or current main (205.26037ms)
✔ preserves leading zeroes in a numeric seven-digit hash (2.908922ms)
✔ does not derive identity from GITHUB_SHA or run number (155.977152ms)
✔ rejects packaging a checkout different from the supplied PR HEAD (132.79603ms)
✔ rejects malformed or unavailable SHA inputs without emitting a version (248.174882ms)
✔ rejects invalid branch-point versions and disconnected history (214.739659ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (3.8295ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (1.025712ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (32.605014ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.455903ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (1.072169ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (3.602045ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.780218ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (9.858952ms)
✔ Issue #137 correlates a safe PR Progress lifecycle without serializing private input values (3.933611ms)
✔ production modules use responsibility names, not task-number filenames (10.937629ms)
✔ runtime composition and reusable policies are placed in their owning folders (0.440985ms)
✔ the extension entry point targets the renamed production composition (2.122158ms)
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1664.318416
```

stderr（全文）:

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

### 第3回最終検証結果

| Command | Exit | Pass / Total | Fail |
| --- | --- | --- | --- |
| npm run lint | 0 | lint successful | — |
| npm run build | 0 | compilation successful | — |
| npm run compile:test | 0 | test compilation successful | — |
| node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js | 0 | 12 / 12 | 0 |
| npm run test:t305 | 0 | 71 / 71 | 0 |
| npm run test:t405 | 0 | 88 / 88 | 0 |
| npm run test:t406 | 0 | 30 / 30 | 0 |
| npm run test:t606 | 0 | 236 / 236 | 0 |
| npm run test:t609 | 0 | 92 / 92 | 0 |
| npm run test:tooling | 0 | 25 / 25 | 0 |

- 全10commandで実行前後のsource指紋は `abbc0ae44a6c632db351ed221d11fa56237cac435d4e72cb6c2fd83edc743733`、一致。baseline HEADはH2 `9d434c3b8a396d4cf5c1cd568caa0118904a28e8` + 未コミット親修正。
- 第3回以前のRed/失敗/成功の全文prefix SHA-256一致を確認（True）。過去検証を改変せず保持。
- 検証失敗・実行阻害なし。suite間test重複あり、合計を独立test数として数えない。Extension Host/device UI/npm test/full local equivalence gate/CIは実行していない。
- 検証したdirty source/test hashes（親がcommit content対応を確認するため）:

- src/application/review-context/projection-refresh.ts: aa1b040b079fb1bc8fa667a80ee51c211cf3145e85564d953679701989416a50
- src/composition/extension.ts: d1e3cb199e8ae8b00827330600f9985218488dcbe14a0bb2863fee6a1d374cc6
- src/ui/current-context/current-context-runtime-coordinator.ts: 8201846f8d74e0b70ea829fe2310fbec1f0fb330b3c7f6429f21b2e819f524cb
- test/tooling/issue-136-refresh-coordinator.test.mjs: f2c9c307e16cc99e6f31894a510d43f405ca53474f76007719b04e2faff42985
- test/unit/t405-composition-regression.test.ts: 9438bb6d6065dd1ea4b97d0acd53507c2c9e469348f41c8628b52b046528e616

- source/test編集とcommitは本childで行わず、指定report追記のみ。将来のcommit SHAへの成功読み替えはせず、親がこれらの内容一致を確認してcommit対応を記録する。次action: review-target commitを同normal reviewer `/root/issue_136_137_review` のfix verificationへ返す。closureはreviewer所有。


### Fresh implementation worker sibling-red

- UTC: 2026-10-06T18:03:43.514266+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test '--test-name-pattern=R2 NR-001 owning|R2 NR-001 selected|R2 NR-001 actual' test/tooling/issue-136-refresh-coordinator.test.mjs`
- Exit: 1; counts={"tests": "3", "pass": "0", "fail": "3", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=29545532291dc47fb66a668fd09b72caf4df45d2ac4c9bb6b262a3e924889068; after=29545532291dc47fb66a668fd09b72caf4df45d2ac4c9bb6b262a3e924889068.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/sibling-red.manifest.json.

stdout (full):

```text
✖ R2 NR-001 owning cancellation reaches the actual list provider before publication (19.466103ms)
✖ R2 NR-001 selected progress helper fences its finally publication after supersession (10.207889ms)
✖ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (2.977298ms)
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 172.674877

✖ failing tests:

test at test/tooling/issue-136-refresh-coordinator.test.mjs:103:1
✖ R2 NR-001 owning cancellation reaches the actual list provider before publication (19.466103ms)
  AssertionError [ERR_ASSERTION]: owner cancellation must reach deep list acquisition

  false !== true

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:121:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/tooling/issue-136-refresh-coordinator.test.mjs:126:1
✖ R2 NR-001 selected progress helper fences its finally publication after supersession (10.207889ms)
  AssertionError [ERR_ASSERTION]: old completion must not redraw the newer tree

  2 !== 1

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:140:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/tooling/issue-136-refresh-coordinator.test.mjs:143:1
✖ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (2.977298ms)
  AssertionError [ERR_ASSERTION]: cancelled owner must not accept a PR snapshot
  + actual - expected

  + 'fulfilled'
  - 'rejected'

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:154:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'fulfilled',
    expected: 'rejected',
    operator: 'strictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### Fresh implementation worker sibling-green

- UTC: 2026-10-06T18:04:28.571627+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test '--test-name-pattern=R2 NR-001 owning|R2 NR-001 selected|R2 NR-001 actual' test/tooling/issue-136-refresh-coordinator.test.mjs`
- Exit: 1; counts={"tests": "3", "pass": "0", "fail": "3", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f8107230f1a35ea524c2f2c81892f30e379dbe96e0f9eb4b1d053255919e65eb; after=f8107230f1a35ea524c2f2c81892f30e379dbe96e0f9eb4b1d053255919e65eb.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/sibling-green.manifest.json.

stdout (full):

```text
✖ R2 NR-001 owning cancellation reaches the actual list provider before publication (32.443979ms)
✖ R2 NR-001 selected progress helper fences its finally publication after supersession (53.64989ms)
✖ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (5.848782ms)
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 429.614428

✖ failing tests:

test at test/tooling/issue-136-refresh-coordinator.test.mjs:103:1
✖ R2 NR-001 owning cancellation reaches the actual list provider before publication (32.443979ms)
  AssertionError [ERR_ASSERTION]: owner cancellation must reach deep list acquisition

  false !== true

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:121:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/tooling/issue-136-refresh-coordinator.test.mjs:126:1
✖ R2 NR-001 selected progress helper fences its finally publication after supersession (53.64989ms)
  AssertionError [ERR_ASSERTION]: old completion must not redraw the newer tree

  2 !== 1

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:140:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/tooling/issue-136-refresh-coordinator.test.mjs:143:1
✖ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (5.848782ms)
  AssertionError [ERR_ASSERTION]: cancelled owner must not accept a PR snapshot
  + actual - expected

  + 'fulfilled'
  - 'rejected'

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:154:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'fulfilled',
    expected: 'rejected',
    operator: 'strictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### Fresh implementation worker owner-compile

- UTC: 2026-10-06T18:04:08.702142+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=f8107230f1a35ea524c2f2c81892f30e379dbe96e0f9eb4b1d053255919e65eb; after=f8107230f1a35ea524c2f2c81892f30e379dbe96e0f9eb4b1d053255919e65eb.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/owner-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker sibling-green-compiled

- UTC: 2026-10-06T18:04:48.343512+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test '--test-name-pattern=R2 NR-001 owning|R2 NR-001 selected|R2 NR-001 actual' test/tooling/issue-136-refresh-coordinator.test.mjs`
- Exit: 0; counts={"tests": "3", "pass": "3", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f8107230f1a35ea524c2f2c81892f30e379dbe96e0f9eb4b1d053255919e65eb; after=f8107230f1a35ea524c2f2c81892f30e379dbe96e0f9eb4b1d053255919e65eb.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/sibling-green-compiled.manifest.json.

stdout (full):

```text
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (13.018055ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (8.136637ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (1.564782ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 142.75467
```

stderr (full):

```text
```


### Fresh implementation worker diagnostics-red-compile

- UTC: 2026-10-06T18:06:28.886914+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=f67bfb8b57c4421e759e3bcc4ef502e3b5e9277f6dfb621c83f96c9c35b3f1e0; after=f67bfb8b57c4421e759e3bcc4ef502e3b5e9277f6dfb621c83f96c9c35b3f1e0.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/diagnostics-red-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker diagnostics-red

- UTC: 2026-10-06T18:06:57.590602+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test '--test-name-pattern=T406 executes|R2 NR-006' test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 1; counts={"tests": "2", "pass": "0", "fail": "2", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f67bfb8b57c4421e759e3bcc4ef502e3b5e9277f6dfb621c83f96c9c35b3f1e0; after=f67bfb8b57c4421e759e3bcc4ef502e3b5e9277f6dfb621c83f96c9c35b3f1e0.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/diagnostics-red.manifest.json.

stdout (full):

```text
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (141.196106ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3923.005759ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4136.407826

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:628:17
✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (141.196106ms)
  AssertionError [ERR_ASSERTION]: pr-selection must start
      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:695:34)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:628:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### Fresh implementation worker same-snapshot-red

- UTC: 2026-10-06T18:07:28.617474+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test '--test-name-pattern=R2 NR-001 old same-snapshot' test/tooling/issue-136-refresh-coordinator.test.mjs`
- Exit: 1; counts={"tests": "1", "pass": "0", "fail": "1", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=eebd1bf9be50eaa36b975597965813165c8289fbc3c01b32cc14d62d21bb4129; after=eebd1bf9be50eaa36b975597965813165c8289fbc3c01b32cc14d62d21bb4129.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/same-snapshot-red.manifest.json.

stdout (full):

```text
✖ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (22.374913ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 148.695566

✖ failing tests:

test at test/tooling/issue-136-refresh-coordinator.test.mjs:158:1
✖ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (22.374913ms)
  AssertionError [ERR_ASSERTION]: obsolete wrapper cleanup must preserve accepted newer snapshot

  0 !== 1

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:172:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### Fresh implementation worker recompute-red-compile

- UTC: 2026-10-06T18:07:45.360615+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=4180ae38a0e05d01abf06f3c5b6a8250b613fc1a352f2967e1dbdd351060b881; after=4180ae38a0e05d01abf06f3c5b6a8250b613fc1a352f2967e1dbdd351060b881.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/recompute-red-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker recompute-red

- UTC: 2026-10-06T18:08:22.093469+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test '--test-name-pattern=T406 executes|R2 NR-006' test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 1; counts={"tests": "3", "pass": "0", "fail": "3", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=4180ae38a0e05d01abf06f3c5b6a8250b613fc1a352f2967e1dbdd351060b881; after=4180ae38a0e05d01abf06f3c5b6a8250b613fc1a352f2967e1dbdd351060b881.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/recompute-red.manifest.json.

stdout (full):

```text
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✖ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (30.08558ms)
  ✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (115.423848ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (5211.97138ms)
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5385.722737

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:628:17
✖ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (30.08558ms)
  AssertionError [ERR_ASSERTION]: repository-identity recompute must start
      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:643:34)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:628:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at test-dist/test/unit/t405-composition-regression.test.js:648:17
✖ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (115.423848ms)
  AssertionError [ERR_ASSERTION]: pr-selection must start
      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:715:34)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:648:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### Fresh implementation worker complete-compile

- UTC: 2026-10-06T18:10:20.161731+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=0fa20719cc96fdee9bc1738b42632fb6f4439bafaa80e721819978620a6b3e29; after=0fa20719cc96fdee9bc1738b42632fb6f4439bafaa80e721819978620a6b3e29.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/complete-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker complete-focused-green

- UTC: 2026-10-06T18:10:38.459699+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 0; counts={"tests": "17", "pass": "17", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=0fa20719cc96fdee9bc1738b42632fb6f4439bafaa80e721819978620a6b3e29; after=0fa20719cc96fdee9bc1738b42632fb6f4439bafaa80e721819978620a6b3e29.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/complete-focused-green.manifest.json.

stdout (full):

```text
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (9.470151ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (131.18569ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (36.241459ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (176.359807ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (4256.901058ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (2.925222ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (12.941941ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (10.74102ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (2.314174ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (5.84578ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.965766ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (3.712017ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.004851ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (1.335558ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (2.67728ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.899865ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (8.540216ms)
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4633.594906
```

stderr (full):

```text
```


### Fresh implementation worker matrix-compile

- UTC: 2026-10-06T18:12:01.470971+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 2; counts={}; source before=93dd6a06a883b141e8b20133d0a25f9376f1c23459739325050efc0824d5c4d1; after=93dd6a06a883b141e8b20133d0a25f9376f1c23459739325050efc0824d5c4d1.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/matrix-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

test/unit/t405-composition-regression.test.ts(833,13): error TS2741: Property 'commit' is missing in type '{ load: () => Promise<undefined>; }' but required in type 'PullRequestReviewRuntimeRepository'.
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker matrix-focused

- UTC: 2026-10-06T18:12:25.270709+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test '--test-name-pattern=T406 executes|R2 NR-006' test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 1; counts={"tests": "4", "pass": "2", "fail": "2", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=93dd6a06a883b141e8b20133d0a25f9376f1c23459739325050efc0824d5c4d1; after=93dd6a06a883b141e8b20133d0a25f9376f1c23459739325050efc0824d5c4d1.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/matrix-focused.manifest.json.

stdout (full):

```text
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (36.654823ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (219.538349ms)
  ✖ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (450.289663ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3671.007647ms)
ℹ tests 4
ℹ suites 0
ℹ pass 2
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3831.830802

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:727:17
✖ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (450.289663ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  1 !== 0

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:800:42)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:727:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### Fresh implementation worker corrected-matrix-compile

- UTC: 2026-10-06T18:13:19.041003+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=abb6c12d27bad3ea1a1f77d24fa2049731f4553cb75c340fa601cf7c24679ae2; after=abb6c12d27bad3ea1a1f77d24fa2049731f4553cb75c340fa601cf7c24679ae2.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/corrected-matrix-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker corrected-matrix-focused

- UTC: 2026-10-06T18:13:51.402770+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 1; counts={"tests": "19", "pass": "17", "fail": "2", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=abb6c12d27bad3ea1a1f77d24fa2049731f4553cb75c340fa601cf7c24679ae2; after=abb6c12d27bad3ea1a1f77d24fa2049731f4553cb75c340fa601cf7c24679ae2.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/corrected-matrix-focused.manifest.json.

stdout (full):

```text
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (9.21068ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (133.072757ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (61.901958ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (280.495739ms)
  ✖ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (560.985795ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (5686.083778ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (2.61979ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (19.869429ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (16.831194ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (1.278371ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (12.45326ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (19.653765ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (1.321143ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (3.002545ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.19044ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (1.407749ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (1.242754ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.813364ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (5.368023ms)
ℹ tests 19
ℹ suites 0
ℹ pass 17
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6047.443124

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:727:17
✖ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (560.985795ms)
  AssertionError [ERR_ASSERTION]: empty/current-context-refresh accepted tree count

  1 !== 0

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:802:42)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:727:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### Fresh implementation worker empty-comparison-compile

- UTC: 2026-10-06T18:15:40.673067+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=ace17e2297c788f835900345af0568c7d71499a587346a7eb6e13193e4350eee; after=ace17e2297c788f835900345af0568c7d71499a587346a7eb6e13193e4350eee.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/empty-comparison-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker empty-comparison-focused

- UTC: 2026-10-06T18:16:21.007968+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 0; counts={"tests": "19", "pass": "19", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=ace17e2297c788f835900345af0568c7d71499a587346a7eb6e13193e4350eee; after=ace17e2297c788f835900345af0568c7d71499a587346a7eb6e13193e4350eee.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/empty-comparison-focused.manifest.json.

stdout (full):

```text
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (10.646365ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (270.482977ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (62.719281ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (379.139266ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (2521.892568ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (12785.702668ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (11.596803ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (12.541643ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (12.223701ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (1.217541ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (4.125925ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (11.661485ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.642655ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (1.935729ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (0.725975ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (0.917128ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (0.819109ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.368866ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (5.647839ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13312.370552
```

stderr (full):

```text
```


### Fresh implementation worker publication-red-compile

- UTC: 2026-10-06T18:16:54.929023+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=505757e64d66c556a5dc99514e3aa6a2a64ac90374134e9f3dcb24b38acc179e; after=505757e64d66c556a5dc99514e3aa6a2a64ac90374134e9f3dcb24b38acc179e.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/publication-red-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker publication-red

- UTC: 2026-10-06T18:17:42.640891+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test '--test-name-pattern=T406 executes|R2 NR-006' test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 1; counts={"tests": "4", "pass": "2", "fail": "2", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=505757e64d66c556a5dc99514e3aa6a2a64ac90374134e9f3dcb24b38acc179e; after=505757e64d66c556a5dc99514e3aa6a2a64ac90374134e9f3dcb24b38acc179e.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/publication-red.manifest.json.

stdout (full):

```text
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (32.666499ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (184.403043ms)
  ✖ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (170.471825ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (3754.466934ms)
ℹ tests 4
ℹ suites 0
ℹ pass 2
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3929.125353

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:727:17
✖ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (170.471825ms)
  AssertionError [ERR_ASSERTION]: unique/current-context-refresh final publication uses accepted tree evidence

  undefined !== 1

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:817:42)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:727:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### Fresh implementation worker accepted-identity-red

- UTC: 2026-10-06T18:18:33.300204+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test '--test-name-pattern=R2 NR-001 a registered BASE' test/tooling/issue-136-refresh-coordinator.test.mjs`
- Exit: 1; counts={"tests": "1", "pass": "0", "fail": "1", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=ceba81fc0f92d5412aff8c91ead002223e5f2caaf7463826c58044be24d37c72; after=ceba81fc0f92d5412aff8c91ead002223e5f2caaf7463826c58044be24d37c72.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/accepted-identity-red.manifest.json.

stdout (full):

```text
✖ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (11.892597ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 180.180492

✖ failing tests:

test at test/tooling/issue-136-refresh-coordinator.test.mjs:228:1
✖ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (11.892597ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at async TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:247:3)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: undefined,
    operator: 'rejects',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### Fresh implementation worker final-compile

- UTC: 2026-10-06T18:19:10.459256+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=63d12a1fd638248cb1f3364e78a5aa819418c7ff497cddd64b863f793715a816; after=63d12a1fd638248cb1f3364e78a5aa819418c7ff497cddd64b863f793715a816.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-focused-green

- UTC: 2026-10-06T18:19:52.871095+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 0; counts={"tests": "20", "pass": "20", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=63d12a1fd638248cb1f3364e78a5aa819418c7ff497cddd64b863f793715a816; after=63d12a1fd638248cb1f3364e78a5aa819418c7ff497cddd64b863f793715a816.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-focused-green.manifest.json.

stdout (full):

```text
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (5.003505ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (124.909812ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (27.346006ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (165.229801ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (837.501774ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (4062.619029ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (2.565865ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (10.174329ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (14.288201ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (1.252497ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (3.672133ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (12.87386ms)
✔ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (1.968734ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.728514ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (3.670282ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.19722ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (1.045242ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (1.365826ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.530035ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (4.794755ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4341.884739
```

stderr (full):

```text
```


### Fresh implementation worker final-lint

- UTC: 2026-10-06T18:20:36.892868+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run lint`
- Exit: 1; counts={}; source before=63d12a1fd638248cb1f3364e78a5aa819418c7ff497cddd64b863f793715a816; after=63d12a1fd638248cb1f3364e78a5aa819418c7ff497cddd64b863f793715a816.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-lint.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre lint
> eslint src test --max-warnings=0


/workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs
   75:22  error  'AbortController' is not defined  no-undef
  117:21  error  'AbortController' is not defined  no-undef
  150:21  error  'AbortController' is not defined  no-undef
  168:68  error  'AbortController' is not defined  no-undef
  171:62  error  'AbortController' is not defined  no-undef

✖ 5 problems (5 errors, 0 warnings)

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker lint-corrected-focused

- UTC: 2026-10-06T18:21:10.805604+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 0; counts={"tests": "20", "pass": "20", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221; after=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/lint-corrected-focused.manifest.json.

stdout (full):

```text
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (6.537586ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (164.978003ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (27.351093ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (169.683108ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1149.369729ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (5004.122343ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (5.217741ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (16.386646ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (18.971387ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (1.519642ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (8.843208ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (13.484378ms)
✔ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (2.152244ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.581075ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (4.094045ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (0.97093ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (1.101401ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (1.154479ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.694091ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (6.253015ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5369.038732
```

stderr (full):

```text
```


### Fresh implementation worker final-lint

- UTC: 2026-10-06T18:21:27.080197+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run lint`
- Exit: 0; counts={}; source before=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221; after=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-lint.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre lint
> eslint src test --max-warnings=0

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-build

- UTC: 2026-10-06T18:21:38.228848+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run build`
- Exit: 0; counts={}; source before=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221; after=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-build.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre build
> npm run compile


> review-range-tracker@0.0.1-pre compile
> tsc -p tsconfig.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-t305

- UTC: 2026-10-06T18:21:49.759183+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t305`
- Exit: 0; counts={"tests": "71", "pass": "71", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221; after=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t305.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t305
> npm run compile:test && node --test test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/t305-validation-wiring.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (4.73884ms)
✔ pull request, branch, and workspace labels are projected consistently (0.347341ms)
✔ branch selection identity remains stable when HEAD advances (0.416988ms)
✔ select applies the authoritative selected snapshot (0.544563ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.629049ms)
✔ selected context identity is applied to the review runtime before decorations refresh (0.595632ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (0.872508ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (0.75516ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (0.806566ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (0.762361ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.373215ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.266903ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.467921ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.487918ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (1.06272ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (168.769823ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (0.920072ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.456294ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.307382ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (0.604485ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (0.606808ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.486966ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (1.030345ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.742277ms)
✔ refresh ignores stale asynchronous snapshots (0.216719ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.183649ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (3.851753ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.422416ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.196275ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (1.404371ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (0.424451ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (1.454635ms)
✔ Global layer toggle does not refresh dependents when persistence fails (1.277853ms)
✔ Global refresh clears stale presentation when the current recalculation fails (1.364995ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (0.582467ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (0.811339ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.335597ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (19.550015ms)
✔ T505-R001 retains immutable open-document evidence after save and close (83.150162ms)
✔ T505-R001 wires change, save, and close events to Global evidence refresh (3.090623ms)
✔ T505-R002 keeps individually valid snapshots when only their combined size exceeds the per-snapshot limit (5.91819ms)
✔ T505-R002 rejects aggregate limits below the per-snapshot limit and never publishes a removed latest snapshot (2.972845ms)
✔ T505-R003 reuses the shared last-valid exclusion policy after an invalid setting (15.321318ms)
✔ T505-R004 invalid snapshot settings fall back without throwing and the manifest caps safe integers (0.963644ms)
✔ T505-R006 focused validation executes the review-finding suite exactly once (1.353309ms)
✔ T505-R007 follow-up handoff uses the required schema v3 top-level packet and preserves the original payload (1.428128ms)
✔ T505-R005 requesting a debounced refresh immediately invalidates the in-flight generation (0.559402ms)
✔ PR69-R001 Global snapshot pins a working-tree open target to the producing owner (29.769534ms)
✔ PR69-R001 PR Global snapshot pins immutable HEAD identity even when the file is absent locally (16.183589ms)
✔ PR69-R001 stale Global nodes reject directly while the registered command owns generic error reporting (16.447223ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (44.728245ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (0.741562ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.200991ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.402304ms)
✔ reports start and success while keeping the busy status visible until completion (1.096427ms)
✔ restores the previous operation status after a nested operation finishes (0.332731ms)
✔ logs and reveals failures before rethrowing them (0.582973ms)
✔ records a swallowed diagnostic failure without changing active status (0.25065ms)
✔ formats one-line Output entries without exposing a stack trace (0.501207ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.303217ms)
✔ T405 contributes Review Contexts activation, commands, and menus (5.510713ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (2.757509ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (1.568561ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (2.66653ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (2.027997ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (1.724267ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (1.346071ms)
✔ T305 preserves every pre-existing unit suite exactly once while adding its focused suites (1.499857ms)
✔ Issue #84 registers the selected PR runtime before PR Progress refresh (0.613466ms)
✔ T305 contributes the Review Range activity container, views, and commands (10.81091ms)
✔ T305 default and focused commands execute the same behavior suites (3.018637ms)
ℹ tests 71
ℹ suites 0
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 462.108641
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


## Fresh implementation source/test hash manifests

Hashes below are actual SHA-256 content hashes. The aggregate fingerprints in execution entries cover all src/test inputs and package/TypeScript configs; these tables preserve every changed executable input in this handoff for each distinct source state. Generated output and administrative reports/task Markdown are excluded. Missing files had not yet been created in that source state.

### Source state `19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221`

Commands/manifests: final-build, final-lint, final-t305, lint-corrected-focused.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 5c7996ee1134de231608360ca59402db9d58840d7e66a281a9eb6c9ef3de7213 |
| src/composition/extension.ts | 94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 487a5f55f5f1e2dcfddabf832a28118577f426f0e2cfc5bd616296c496b176df |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | 32a97ccff689ea0f393be8a26a263fe4f550adfea9deaace65b8fa20ea655a34 |
| test/unit/t405-composition-regression.test.ts | 363240abfbfec02f521869c2ec9948440704058ae8de3a4d4e040c5507e7dfaf |

### Source state `63d12a1fd638248cb1f3364e78a5aa819418c7ff497cddd64b863f793715a816`

Commands/manifests: final-compile, final-focused-green.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 5c7996ee1134de231608360ca59402db9d58840d7e66a281a9eb6c9ef3de7213 |
| src/composition/extension.ts | 94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 487a5f55f5f1e2dcfddabf832a28118577f426f0e2cfc5bd616296c496b176df |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | fa176633cbfac4ce543676f92088cecdf26cbe513e0bae5c93c0a8042baf5a71 |
| test/unit/t405-composition-regression.test.ts | 363240abfbfec02f521869c2ec9948440704058ae8de3a4d4e040c5507e7dfaf |

### Source state `ceba81fc0f92d5412aff8c91ead002223e5f2caaf7463826c58044be24d37c72`

Commands/manifests: accepted-identity-red.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 8db983239c4b1836247e0a8d4f9f972c992b378534dc77d75a6ef28cc0c94681 |
| src/composition/extension.ts | 94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 22f554debac06ce9bc3c8777d4fdf143002f6f0d07c962a29b1cde9e84326edd |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | fa176633cbfac4ce543676f92088cecdf26cbe513e0bae5c93c0a8042baf5a71 |
| test/unit/t405-composition-regression.test.ts | 363240abfbfec02f521869c2ec9948440704058ae8de3a4d4e040c5507e7dfaf |

### Source state `505757e64d66c556a5dc99514e3aa6a2a64ac90374134e9f3dcb24b38acc179e`

Commands/manifests: publication-red, publication-red-compile.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 8db983239c4b1836247e0a8d4f9f972c992b378534dc77d75a6ef28cc0c94681 |
| src/composition/extension.ts | 94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 22f554debac06ce9bc3c8777d4fdf143002f6f0d07c962a29b1cde9e84326edd |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | b2650a4456bf85f1f7df5ddf325bd1d5c072147c74448c28aa1ad187602f50c7 |
| test/unit/t405-composition-regression.test.ts | 363240abfbfec02f521869c2ec9948440704058ae8de3a4d4e040c5507e7dfaf |

### Source state `ace17e2297c788f835900345af0568c7d71499a587346a7eb6e13193e4350eee`

Commands/manifests: empty-comparison-compile, empty-comparison-focused.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 8db983239c4b1836247e0a8d4f9f972c992b378534dc77d75a6ef28cc0c94681 |
| src/composition/extension.ts | 94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 22f554debac06ce9bc3c8777d4fdf143002f6f0d07c962a29b1cde9e84326edd |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | b2650a4456bf85f1f7df5ddf325bd1d5c072147c74448c28aa1ad187602f50c7 |
| test/unit/t405-composition-regression.test.ts | 2bd655f6a7135c90ff51518f7599a5448491a58fd48096d4d835aff93a7b42ff |

### Source state `abb6c12d27bad3ea1a1f77d24fa2049731f4553cb75c340fa601cf7c24679ae2`

Commands/manifests: corrected-matrix-compile, corrected-matrix-focused.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 8db983239c4b1836247e0a8d4f9f972c992b378534dc77d75a6ef28cc0c94681 |
| src/composition/extension.ts | 94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 22f554debac06ce9bc3c8777d4fdf143002f6f0d07c962a29b1cde9e84326edd |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | b2650a4456bf85f1f7df5ddf325bd1d5c072147c74448c28aa1ad187602f50c7 |
| test/unit/t405-composition-regression.test.ts | c7fdbec88adec35019ad1d381adc097b535174af1a4743a2b5b518c03d6db8e9 |

### Source state `93dd6a06a883b141e8b20133d0a25f9376f1c23459739325050efc0824d5c4d1`

Commands/manifests: matrix-compile, matrix-focused.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 8db983239c4b1836247e0a8d4f9f972c992b378534dc77d75a6ef28cc0c94681 |
| src/composition/extension.ts | 94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 22f554debac06ce9bc3c8777d4fdf143002f6f0d07c962a29b1cde9e84326edd |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | c35a0b72c2d6f58404f5d71609489983116811bc3f9bfeb7e1c7a0db6708ddd5 |
| test/unit/t405-composition-regression.test.ts | ff1e278de45a7b3eec90f3de88967a6cb95017dd5a5894a312bfa75dbfdbd86c |

### Source state `0fa20719cc96fdee9bc1738b42632fb6f4439bafaa80e721819978620a6b3e29`

Commands/manifests: complete-compile, complete-focused-green.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 8db983239c4b1836247e0a8d4f9f972c992b378534dc77d75a6ef28cc0c94681 |
| src/composition/extension.ts | 94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 22f554debac06ce9bc3c8777d4fdf143002f6f0d07c962a29b1cde9e84326edd |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | c35a0b72c2d6f58404f5d71609489983116811bc3f9bfeb7e1c7a0db6708ddd5 |
| test/unit/t405-composition-regression.test.ts | 8a9500c95ab9180229ab34d562ce2e2db463c237021fc2d4c4256e150bff0197 |

### Source state `4180ae38a0e05d01abf06f3c5b6a8250b613fc1a352f2967e1dbdd351060b881`

Commands/manifests: recompute-red, recompute-red-compile.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 2ff0967c479a41d91b766cf2437855c44380b2064f33cedcf4b58e21d6453681 |
| src/composition/extension.ts | 99db52944a4a65492ebf298d79f2b7c4df9ec15d94dfaec1beb4d7e1740c9062 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 851a960d449f0e83342cada2615c998528639b4d653b2af3cbd6372ce85d566a |
| src/ui/current-context/current-context-runtime-coordinator.ts | 3b2b08992b5c94c3f516fad1632a072b61651bb4898c166c11060e8897f3bab2 |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | 4209068bab95a14070b02e6d0186288c892f4b762efa626a9a1e9144bbb0fbb9 |
| test/unit/t405-composition-regression.test.ts | 8a9500c95ab9180229ab34d562ce2e2db463c237021fc2d4c4256e150bff0197 |

### Source state `eebd1bf9be50eaa36b975597965813165c8289fbc3c01b32cc14d62d21bb4129`

Commands/manifests: same-snapshot-red.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 2ff0967c479a41d91b766cf2437855c44380b2064f33cedcf4b58e21d6453681 |
| src/composition/extension.ts | 99db52944a4a65492ebf298d79f2b7c4df9ec15d94dfaec1beb4d7e1740c9062 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 851a960d449f0e83342cada2615c998528639b4d653b2af3cbd6372ce85d566a |
| src/ui/current-context/current-context-runtime-coordinator.ts | 3b2b08992b5c94c3f516fad1632a072b61651bb4898c166c11060e8897f3bab2 |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | 4209068bab95a14070b02e6d0186288c892f4b762efa626a9a1e9144bbb0fbb9 |
| test/unit/t405-composition-regression.test.ts | 251472f7ee96c7a0d7c3ea3b851aca6b2b229863e17be27b30bedf02d4e04796 |

### Source state `f67bfb8b57c4421e759e3bcc4ef502e3b5e9277f6dfb621c83f96c9c35b3f1e0`

Commands/manifests: diagnostics-red, diagnostics-red-compile.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 2ff0967c479a41d91b766cf2437855c44380b2064f33cedcf4b58e21d6453681 |
| src/composition/extension.ts | 99db52944a4a65492ebf298d79f2b7c4df9ec15d94dfaec1beb4d7e1740c9062 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 851a960d449f0e83342cada2615c998528639b4d653b2af3cbd6372ce85d566a |
| src/ui/current-context/current-context-runtime-coordinator.ts | 3b2b08992b5c94c3f516fad1632a072b61651bb4898c166c11060e8897f3bab2 |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | 35c5833ccea59dc5e6dd8dc24bcf09f9fcbad0dd878f51f996825c646cc43626 |
| test/unit/t405-composition-regression.test.ts | 251472f7ee96c7a0d7c3ea3b851aca6b2b229863e17be27b30bedf02d4e04796 |

### Source state `f8107230f1a35ea524c2f2c81892f30e379dbe96e0f9eb4b1d053255919e65eb`

Commands/manifests: owner-compile, sibling-green, sibling-green-compiled.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | not present |
| src/composition/extension.ts | d1e3cb199e8ae8b00827330600f9985218488dcbe14a0bb2863fee6a1d374cc6 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 851a960d449f0e83342cada2615c998528639b4d653b2af3cbd6372ce85d566a |
| src/ui/current-context/current-context-runtime-coordinator.ts | 3b2b08992b5c94c3f516fad1632a072b61651bb4898c166c11060e8897f3bab2 |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | 35c5833ccea59dc5e6dd8dc24bcf09f9fcbad0dd878f51f996825c646cc43626 |
| test/unit/t405-composition-regression.test.ts | 9438bb6d6065dd1ea4b97d0acd53507c2c9e469348f41c8628b52b046528e616 |

### Source state `29545532291dc47fb66a668fd09b72caf4df45d2ac4c9bb6b262a3e924889068`

Commands/manifests: sibling-red.

| Input | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | aa1b040b079fb1bc8fa667a80ee51c211cf3145e85564d953679701989416a50 |
| src/composition/current-context/current-context-pull-request-views.ts | not present |
| src/composition/extension.ts | d1e3cb199e8ae8b00827330600f9985218488dcbe14a0bb2863fee6a1d374cc6 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | bb60939d0e25e184ad9e913c0b07d6380b1d44477b50220457389fbe0583fbc8 |
| src/composition/pull-request/pull-request-review-runtime.ts | d5f4807795d0fc84f9abac5f0508c5a894fe9fa3d85195277361b065fe2a7e57 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 8201846f8d74e0b70ea829fe2310fbec1f0fb330b3c7f6429f21b2e819f524cb |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | ed2409e579d9ea62ce2acaa989f8e8c9ce81a459004bb1466d458349d4925bff |
| test/tooling/issue-136-refresh-coordinator.test.mjs | 35c5833ccea59dc5e6dd8dc24bcf09f9fcbad0dd878f51f996825c646cc43626 |
| test/unit/t405-composition-regression.test.ts | 9438bb6d6065dd1ea4b97d0acd53507c2c9e469348f41c8628b52b046528e616 |

## Evidence corrections and scope of claims

- `sibling-green` was invoked before `owner-compile` completed. Its generated modules still represented the preceding source, so that failure is retained as an attempted run, **not** as current-source Red or Green. `sibling-green-compiled` followed completed successful compilation and passed 3/3.
- `matrix-compile` failed with TS2741 because a test fixture omitted the required repository `commit` method. `matrix-focused` ran emitted files from that unsuccessful compilation; it is an attempted fixture diagnosis, **not** valid compiled-source Red/Green. Both outputs are preserved.
- `corrected-matrix-focused` failed because the supposedly empty PR actually had one file in its real local Git diff. This was a fixture expectation error. The fixture now seeds an identical BASE/HEAD comparison through the real filesystem state repository, then lets real T405/Git acquisition produce the empty snapshot. `empty-comparison-focused` passed 19/19. No synthetic diagnostic records or empty diff snapshots are emitted by the tests.
- The first `final-lint` attempt failed on five `.mjs` `AbortController` global references. Replacing them with `globalThis.AbortController` changed test content only; the failed lint output remains above. `lint-corrected-focused` passed 20/20 on the final content fingerprint.
- Valid new product Red evidence: owning provider cancellation 0/3; old same-snapshot wrapper cleanup 0/1; actual T405 stage lifecycle 0/3 (two failed children plus parent); actual publication counts 2/4 (one failed child plus parent); accepted BASE replacement 0/1. Parent test aggregation is not counted as an additional independent defect.
- Prior reports are historical evidence. Their statements about child ownership, Red-only work, no source changes, no commit, or earlier candidate identity are superseded for this fresh implementation lifecycle by the append below. Prior outputs have been retained rather than rewritten.


### Fresh implementation worker final-t405

- UTC: 2026-10-06T18:22:03.755320+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t405`
- Exit: 0; counts={"tests": "90", "pass": "90", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221; after=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t405.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t405
> npm run compile:test && node --test test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-storage.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-pull-request-review-runtime.test.js test-dist/test/unit/t405-review-followup.test.js test-dist/test/unit/t405-revision-evidence.test.js test-dist/test/unit/t405-selected-pr-session.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T405 contributes Review Contexts activation, commands, and menus (13.340133ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (6.303057ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (7.782975ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (10.156439ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (5.090932ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (3.532025ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (2.881252ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (145.616845ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (3.07358ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.261336ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.479123ms)
✔ reports start and success while keeping the busy status visible until completion (1.41799ms)
✔ restores the previous operation status after a nested operation finishes (0.903902ms)
✔ logs and reveals failures before rethrowing them (0.911844ms)
✔ records a swallowed diagnostic failure without changing active status (0.487722ms)
✔ formats one-line Output entries without exposing a stack trace (1.443961ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.426665ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (53.106149ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (1.798906ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (5.702412ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (5.192096ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (1.264179ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (25.182617ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (1.820058ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (0.877671ms)
✔ PR runtime command snapshot survives immutable PR A-to-B-to-A store restoration with hashes (52.249598ms)
✔ R405-3 saved/closed PR opens through the canonical T302 review-range-diff identity (2.476805ms)
✔ R405-3 Review Contexts canonical original/modified commands persist mark and unmark (24.270341ms)
✔ PR runtime command fails closed before commit when persisted hashes do not match authoritative HEAD content (2.39428ms)
✔ PR mutation no-op, cancellation, and failed commit publish neither snapshots nor history (2.759201ms)
✔ R405-5 PR runtime exposes T304 progress for Review Contexts (3.566945ms)
✔ Issue #137 actual T405 PR activation never emits acquired file paths in detailed Output (19.808498ms)
✔ Issue #136 keeps the newest PR Progress refresh when an older read finishes later (4.610046ms)
✔ R405-3 binary PR changes are not opened as text review diffs (3.656593ms)
✔ Issue #59 PR full scan reads complete current-side files once and reuses immutable revision caches (2.578893ms)
✔ PR69-R001 Global PR open uses the exact immutable HEAD document and rejects a superseded head (2.294944ms)
✔ PR Progress original-side selection projects unchanged lines and retains original-only lines atomically (3.482383ms)
✔ PR Progress command rejects an old diff URI pair after BASE or HEAD changes (2.108808ms)
✔ production command routing validates the active immutable diff URI pair before mutation (12.504251ms)
✔ PR runtime persists mark and unmark for added content without a terminal newline (6.487698ms)
✔ PR runtime persists mark and unmark for added LF-terminated content (3.226999ms)
✔ PR runtime persists mark and unmark for deleted content without a terminal newline (3.930635ms)
✔ PR runtime persists mark and unmark for deleted LF-terminated content (2.537542ms)
✔ PR runtime persists mark and unmark for replacement with terminal newlines (2.600773ms)
✔ PR runtime persists mark and unmark for replacement that adds a terminal newline (3.268891ms)
✔ PR runtime persists mark and unmark for replacement that removes a terminal newline (3.281463ms)
✔ PR runtime preserves empty existing files and CRLF content through body-derived line contracts (7.389908ms)
✔ PR runtime treats a terminal display line as outside Git content (1.25867ms)
✔ PR runtime leaves bare CR display fragments outside one-line Git replacements (3.936937ms)
✔ PR runtime rejects truncated, mismatched, and inconsistent local Git hunk evidence before mutation (3.676883ms)
✔ PR runtime hydrates complete legacy-redacted cache hunks and rejects tampered or incomplete evidence (4.595982ms)
✔ PR runtime block mode links both sides while a later side-mode operation stays on the operated side (3.424893ms)
✔ PR runtime block mode expands an original replacement selection to modified Context and Global (1.622197ms)
✔ PR runtime does not read selection mode or open state for an empty selection (0.588801ms)
✔ PR runtime block mark from original commits when only the target revision Global snapshot changes (3.085334ms)
✔ PR runtime block unmark from original commits when only the target revision Global snapshot changes (3.284011ms)
✔ PR runtime block mark from modified commits when only the target revision Global snapshot changes (3.22393ms)
✔ PR runtime block unmark from modified commits when only the target revision Global snapshot changes (4.648873ms)
✔ PR runtime rejects a re-registered comparison while a pending state load is resumed (1.525453ms)
✔ PR runtime rejects old rename URIs and keeps an active command scoped to its PR (1.620748ms)
✔ PR runtime keeps actual repository state atomic through write and CAS failures, restart, and a history failure (285.975145ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (7.698817ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (192.555973ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (34.929573ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (185.974309ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1042.277054ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (6013.940541ms)
✔ R60-001 immutable PR HEAD remains authoritative when the working-tree candidate set omits the file (1.144478ms)
✔ R60-001 Global promotes immutable PR HEAD evidence even when the working tree no longer contains that path (21.541809ms)
✔ R60-003 superseded owner revisions evict retained Global evidence instead of reviving it later (14.320823ms)
✔ R60-002 breaking-change policy supersedes rev4 Global semantics with opened-only and immutable-PR rules (1.636023ms)
✔ PR85-IFR-004 production Review Contexts completion counts stay monotonic across two PRs, retry, and repositories (289.008659ms)
✔ PR85-NR-003 selected PR Progress reports file counts through the production Tree path on immutable-cache hits (3.753645ms)
✔ R405-4 presentation hide applies to current PR, branch, and workspace without deleting state (1.136864ms)
✔ R405-5 Review Contexts projects T304-compatible PR progress (0.244129ms)
✔ R405-5 progress formatter covers zero, partial, and complete PR states (0.136369ms)
✔ T405-IFR-2 keeps cache origin, freshness, and last successful update in the View projection (0.219799ms)
✔ R405-5 Review Contexts Tree renders projected progress to users (6.442334ms)
✔ R405-7 pull-request Current Context identity is stable across rediscovery and not label-derived (0.432722ms)
✔ R405-7/R405-8 current PR is inferred only from persisted open state at the local HEAD (0.158584ms)
✔ R405-7 multiple current-head PRs retain the PR explicitly chosen by redetection (0.074167ms)
✔ Issue #137 selection provenance distinguishes explicit, unique, ambiguous, and missing matches (0.113674ms)
✔ T406-R001 explicit branch selection suppresses one saved open PR at the same immutable HEAD (0.240195ms)
✔ R405-7 redetection persists and reloads explicit current PR identity (2.254194ms)
✔ R405-6/R405-9 remove the dead closed-layer setting and document connected Review Contexts (1.589243ms)
✔ R405-1 revision evidence supplies exact diff and old/new text for tracked files (6.908242ms)
✔ base-only PR transition does not invent a head diff (0.425282ms)
✔ PR evidence loader supplies unchanged Global-only target evidence to the immutable mapper (13.18688ms)
✔ R405-7 selected PR owns normal-editor command and decoration sessions without branch initialization (5.329925ms)
✔ selected PR rejects a foreign repository or stale head without creating state (1.590936ms)
ℹ tests 90
ℹ suites 0
ℹ pass 90
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7119.356371
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-t406

- UTC: 2026-10-06T18:22:26.564669+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t406`
- Exit: 0; counts={"tests": "32", "pass": "32", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221; after=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t406.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t406
> npm run compile:test && node --test test-dist/test/integration/mock-github.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-composition-regression.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (102.002384ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (3.501288ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (28.024858ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (5.254792ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (1.520669ms)
✔ GitHub adapter attempts a public API request without authentication (14.140797ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (52.648068ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (6.780665ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (4.31619ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (1.006184ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.823448ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.393786ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.256034ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.217903ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (49.452964ms)
✔ local Git diff is the first successful acquisition source (3.509697ms)
✔ GitHub PR files patch is used after local Git is unavailable (1.073703ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (1.35794ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (0.886167ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.419155ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.50118ms)
✔ remote metadata from a different comparison is rejected before content reads (0.431713ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (1.806757ms)
✔ invalid revision input is rejected before invoking local Git (0.919419ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (1.997047ms)
✔ malformed remote file identity fails closed without reading repository contents (1.256899ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (12.565346ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (186.013682ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (57.764446ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (257.720094ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1957.486357ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (8241.00581ms)
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8655.599776
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-t606

- UTC: 2026-10-06T18:22:53.731028+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t606`
- Exit: 0; counts={"tests": "238", "pass": "238", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221; after=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t606.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t606
> npm run compile:test && node --test test-dist/test/unit/t606-failure-policy-retry-diagnostics.test.js test-dist/test/unit/t606-production-failure-matrix.test.js test-dist/test/unit/t606-r6-production-matrix.test.js test-dist/test/unit/t606-r6-real-composition.test.js test-dist/test/unit/t606-r5-production-activation.test.js test-dist/test/unit/local-git-adapter.test.js test-dist/test/integration/t302-review-followup.integration.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/state-repository.test.js test-dist/test/unit/debounced-review-state-repository.test.js test-dist/test/unit/normal-editor-review-command-registration.test.js test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/global-understanding-ui.test.js test-dist/test/unit/t505-global-understanding-source.test.js test-dist/test/unit/github-pull-request-cache.test.js test-dist/test/integration/mock-github.test.js test-dist/test/unit/t604-storage-lock-cleanup.test.js test-dist/test/unit/t605-multi-root-remote-boundaries.test.js test-dist/test/unit/ci-workflow-contract.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (82.464922ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (2.715653ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (19.570283ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (4.263368ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (1.20265ms)
✔ GitHub adapter attempts a public API request without authentication (9.324112ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (32.440075ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (3.900479ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (3.144963ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (1.117464ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.652624ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.323119ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.226922ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.286347ms)
✔ review diff URI round-trip preserves filesystem path semantics (3.085553ms)
✔ review diff URI rejects moving refs and non-canonical repository paths (1.025446ms)
✔ POSIX review diff URI preserves tab, newline, and backslash filename characters (0.472651ms)
✔ Windows review diff URI rejects backslash and control characters (4.011971ms)
✔ fatal revision lookup exit 128 is preserved instead of reported as missing (0.93637ms)
✔ fatal file lookup exit 128 is preserved instead of reported as missing (0.423274ms)
✔ moving refs are rejected before immutable Git content lookup (99.609346ms)
✔ POSIX Git content lookup supports tab, newline, and backslash filenames (151.862676ms)
✔ POSIX Git content lookup supports a filename made only of a newline (142.91157ms)
✔ Git content lookup reads UTF-8 text immediately below and above 4 MiB (368.54003ms)
✔ non-UTF-8 Git blob is rejected deterministically without replacement characters (108.401818ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (60.120661ms)
✔ local Git diff is the first successful acquisition source (2.898474ms)
✔ GitHub PR files patch is used after local Git is unavailable (0.928034ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (1.583754ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (0.931996ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.627173ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.753437ms)
✔ remote metadata from a different comparison is rejected before content reads (0.499541ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (3.291018ms)
✔ invalid revision input is rejected before invoking local Git (1.015237ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (3.668378ms)
✔ malformed remote file identity fails closed without reading repository contents (0.980782ms)
✔ unit and focused suites execute the integrated design contract (30.452135ms)
✔ document line contract coverage is runnable directly and through the required unit suite (8.695344ms)
✔ unit, npm test, focused CI execute the complete T304 tree contract (2.848365ms)
✔ temporary Git suite executes the T207 history integration scenario (3.778295ms)
✔ T502 focused coverage is runnable locally and included in the default unit suite (1.354128ms)
✔ CI executes positive and negative architecture gates with diagnostic logs (0.882657ms)
✔ CI executes the canonical T502 focused command (1.021074ms)
✔ T505 focused coverage executes each dedicated suite once and is required by CI (2.19112ms)
✔ CI diagnostics preserve stdout, stderr, combined logs, and result metadata (1.388926ms)
✔ T506 integration and Extension Host acceptance are exposed as one required focused CI command (2.48588ms)
✔ T406 GitHub failure and recovery integration is exposed by package and CI (1.449084ms)
✔ T605 multi-root and remote workspace boundary coverage is exposed by package and CI (3.021082ms)
✔ T606 focused failure-policy coverage is exposed by package and CI (1.652422ms)
✔ T607 performance workloads remain local-only and never gate CI (1.280976ms)
✔ CI publishes a branch-version-and-HEAD-named VSIX and tracked source archive only after pull-request success (6.808509ms)
✔ required unit gate runs the Issue #90 runtime routing suite before success artifacts (2.343957ms)
✔ required unit gate reaches the Issue #92 PR Progress context-menu contract before success artifacts (1.279353ms)
✔ required CI gates exclude timing-sensitive suites and use deadline-free Extension Host waits (8.910479ms)
✔ required gates keep the T606 wall-clock timeout fixture local-only (1.805656ms)
✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (4.693779ms)
✔ pull request, branch, and workspace labels are projected consistently (0.465345ms)
✔ branch selection identity remains stable when HEAD advances (0.417808ms)
✔ select applies the authoritative selected snapshot (0.551673ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.691702ms)
✔ selected context identity is applied to the review runtime before decorations refresh (0.508822ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (1.129882ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (0.948026ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (1.007224ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (0.884878ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.213998ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.327717ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.400728ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.668085ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (1.235518ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (197.149136ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (0.7689ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.559911ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.187296ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (0.448386ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (0.490577ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.384579ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (0.599047ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.434148ms)
✔ refresh ignores stale asynchronous snapshots (0.182176ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.183141ms)
✔ multiple background saves are coalesced and persist only the newest complete snapshot (3.235526ms)
✔ storage kinds remain isolated even when repository and context IDs are identical (0.556977ms)
✔ a confirmation transaction flushes pending background state and commits without waiting for the debounce timer (0.796042ms)
✔ external-file confirmation flushes the external pending state before commit (0.587716ms)
✔ dispose flushes a pending save immediately for Extension Host deactivation (1.315569ms)
✔ dispose waits for an immediate commit queued behind an in-flight load (0.8085ms)
✔ dispose waits for an in-flight owner-wide Global load (13.821641ms)
✔ owner-wide Global load serializes a different context commit (1.334616ms)
✔ Git Global load serializes a pull-request save for the same repository (1.947483ms)
✔ all callers observe a debounced persistence failure instead of receiving a false success (1.05483ms)
✔ live GitHub acquisition stores metadata and a source-redacted diff with explicit timestamps (4.820089ms)
✔ rate-limit failure uses an exact cached PR and marks expired data stale (1.199344ms)
✔ network failure uses an unexpired exact cache and marks it fresh (0.490761ms)
✔ patch fallback followed by network failure still uses an exact cache (0.678667ms)
✔ non-offline API failures do not substitute cached data (0.83357ms)
✔ mixed offline-eligible and API failures do not substitute cached data (0.599732ms)
✔ cache entries are bound to the exact context, repository, PR, base, and head identity (0.593099ms)
✔ filesystem cache publishes metadata and redacted diff through one generation pointer (60.898359ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (2.397575ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.441401ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.279119ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (0.406119ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (0.543744ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (0.322355ms)
✔ Global layer toggle does not refresh dependents when persistence fails (0.733263ms)
✔ Global refresh clears stale presentation when the current recalculation fails (0.83586ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (1.676596ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (0.556358ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.195386ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (10.444711ms)
✔ Node local Git path normalization propagates stat permission errors unchanged (2.13213ms)
✔ Node local Git path normalization retains only an exact candidate stat ENOENT (0.740642ms)
✔ Node local Git path identity is unavailable when either realpath lookup fails (0.476637ms)
✔ repository inspection uses argument arrays and returns normalized Git identity (18.715145ms)
✔ remote normalization unifies common GitHub URL forms without credentials (0.661892ms)
✔ fork remotes remain distinct repository identities (1.04182ms)
✔ a repository without remotes receives a stable root-derived identity (1.74361ms)
✔ Issue #57 keeps local Git context usable when a listed remote URL cannot be resolved (0.502186ms)
✔ detached HEAD is distinguished while retaining the exact HEAD object (0.5085ms)
✔ Git executable absence and non-repositories are separate outcomes (0.630636ms)
✔ merge-base and object existence use bounded argument-array commands (0.757173ms)
✔ revision arguments that could be parsed as options are rejected (0.283741ms)
✔ registerNormalEditorReviewCommands registers the four designed command IDs (3.12732ms)
✔ registered commands delegate only when an active normal editor exists (1.421673ms)
✔ registered commands reject missing and diff editors without invoking state commands (0.583808ms)
✔ registered commands report a privacy-safe handler failure through the UI host (0.933394ms)
✔ handler failure is recorded as failed operation before the UI host reports it (2.853875ms)
✔ Test-mode command failure is captured by operation and rejects with the original error without waiting for UI (1.071296ms)
✔ applied production handlers await one automatic decoration refresh (0.648176ms)
✔ Test-mode public command settles after state application without an automatic decoration refresh (2.643968ms)
✔ T405 contributes Review Contexts activation, commands, and menus (8.934563ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (4.75209ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (2.710924ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (4.577223ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (9.619862ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (3.018163ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (2.551189ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (3.619243ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.319045ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.511138ms)
✔ reports start and success while keeping the busy status visible until completion (3.45342ms)
✔ restores the previous operation status after a nested operation finishes (1.414125ms)
✔ logs and reveals failures before rethrowing them (2.108023ms)
✔ records a swallowed diagnostic failure without changing active status (1.665915ms)
✔ formats one-line Output entries without exposing a stack trace (1.359311ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.658071ms)
✔ routing separates Git and PR state from non-Git workspace state (7.514355ms)
✔ workspace routing requires ExtensionContext.storageUri (1.359374ms)
✔ repository save commits manifest last and reloads the same context and Global state (56.035479ms)
✔ repository manifest preserves other contexts while atomically advancing one context (94.365976ms)
✔ non-Git state uses workspace-state.json and never writes under globalStorageUri (15.826087ms)
✔ a failed repository manifest replacement preserves disk and memory state (35.839615ms)
✔ a failed workspace replacement preserves disk and memory state (22.712835ms)
✔ schema mismatch is rejected and reported during load (11.028406ms)
✔ save validates manifest, context, Global, target identity before any write (7.551665ms)
✔ concurrent saves retain both context references in the repository manifest (98.948453ms)
✔ save accepts the exact target and context kind mapping (98.825141ms)
✔ save rejects non-matching target and context kinds (30.641949ms)
✔ NodeAtomicTextFileStore replaces a file without leaving temporary files (8.36492ms)
✔ storage-root containment follows the host path semantics without weakening escape rejection (2.891673ms)
✔ NodeAtomicTextFileStore rejects an outside sibling and a symbolic link or junction (14.91477ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (6.868653ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (239.523404ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (39.074816ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (223.548642ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1429.621649ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (6552.768928ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (42.131791ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (2.625793ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (4.302913ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (6.707361ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (1.545271ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (42.443087ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (17.202286ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (0.782586ms)
✔ T505 source keeps unopened file contents out of the line denominator while preserving path diagnostics (106.237308ms)
✔ Issue #59 uses only previously opened files for Global line progress and reports unopened files separately (52.439728ms)
✔ Issue #59 PR full HEAD scan is promoted to opened Global evidence (24.462932ms)
✔ T604 refuses a live root lock without exposing owner or path diagnostics (39.418614ms)
✔ T604 immediately recovers an unexpired lease only when its owner is confirmed dead (32.569195ms)
✔ T604 never steals an expired descriptor from a live cooperative owner (14.834783ms)
✔ T604 recovers a bounded stale malformed lock without taking a live valid lease (7.996675ms)
✔ T604 bounds fresh zero, truncated, malformed, and future-invalid partial recovery before aging (30.479391ms)
✔ T604 deduplicates pending privacy-safe diagnostics by operation scope (2.407803ms)
✔ T604 fences a detached owner before it can publish after a successor recovery (14.174867ms)
✔ T604 rejects a dead owner's real state publication after a successor publishes newer Context, Global, and manifest (34.045623ms)
✔ T604 cleans an owned partial lease after write, sync, or close acquisition failure (12.389492ms)
✔ T604 uses an owned OS child-process lease and releases it for a successor (621.42143ms)
✔ T604 immediately recovers a killed child lease before its bounded expiry (213.010531ms)
✔ T604 rejects a root-confined snapshot mutation through a symlink or Windows junction (11.973399ms)
✔ T604 retains independent-window Contexts and Global publication under concurrent writes (73.16851ms)
✔ T604 atomically appends independent-window history events (12.251048ms)
✔ T604 cache cleanup retains the published generation and removes superseded immutable files (82.677001ms)
✔ T604 serializes state, history, cache, snapshot cleanup, and startup migration through one explicit custom-store coordinator (105.414352ms)
✔ T604 snapshot cleanup retains a referenced generation and removes expired unreferenced entries (69.870798ms)
✔ T604 snapshot cleanup preserves every active pointer while bounding an unreferenced generation (108.446268ms)
✔ T604 runs production startup recovery against real child writers and restarts from the newer coherent state (401.343685ms)
✔ T604 keeps active snapshots above count and byte limits, publishes through cleanup failure, and converges after restart (150.011595ms)
✔ T604 flushes a terminal startup lock failure through the production feedback composition exactly once (1.607733ms)
✔ T605 chooses exactly the longest matching multi-root URI and preserves remote authority (6.448287ms)
✔ T605 fails closed for URI boundaries and separates workspace storage roots (7.755614ms)
✔ T605 root registry retains typed snapshot and Git-rewrite capabilities (0.770712ms)
✔ T605 IFR001 rejects delayed open, load, and commit from a removed and re-added root generation (3.119877ms)
✔ T605 IFR002 applies one URI eligibility boundary before descriptor routing (2.748024ms)
✔ T605 keeps same-repository roots distinct for Current Context and PR acquisition (0.417088ms)
✔ T605 concrete root composition commits snapshots through reconciliation and survives root-scoped restart (604.338527ms)
✔ T606 classifies retryable, permanent, stale, authentication, and validation failures without raw messages (3.590172ms)
✔ T606 retries only retryable faults with a bounded cancellable sequence (3.285934ms)
✔ T606 never retries authentication, validation, stale, or partial-side-effect failures (1.002802ms)
✔ T606 emits one bounded single-line redacted ERROR and always clears activity (3.320225ms)
✔ T606 makes a handled inner failure terminal exactly once for its shared operation (1.435235ms)
✔ T606 keeps independent concurrent production operations as separate lifecycles (0.905947ms)
✔ T606 joins an actual storage diagnostic to its explicit owner context without a duplicate terminal (0.974428ms)
✔ T606 Review Contexts runtime fences a superseded source publication (20.868914ms)
✔ T606 Review Contexts provider aborts an old root load and never publishes its distinct stale item (1.628371ms)
✔ T606 retries only an actual Review Contexts pure-read runtime operation (27.778334ms)
✔ T606 runs Review Contexts commands through the production registration: read retries, mutations do not (26.939499ms)
✔ T606 passes one explicit feedback context through the production Review Contexts read boundary (2.436021ms)
✔ T606 runs Git executable-missing, nonzero, corruption, and safe.directory outcomes through the LocalGitAdapter boundary (9.29195ms)
✔ T606 preserves the last published repository state when the production persistence adapter sees ENOSPC or EACCES during flush/replace (23.224033ms)
✔ T606 R5 invokes the registered Current Context command through its production composition and records supersede as a typed terminal (16.810382ms)
✔ T606 R5 invokes the registered Global open command with one generic UI error and one redacted terminal (11.431626ms)
✔ T606 R6 Current Context production runtime cross-supersedes refresh/select with one signal owner and one typed terminal (17.587058ms)
✔ T606 R7 absorbs a failed old-root load and preserves the fresh-root stale/unknown transition (8.854176ms)
✔ T606 R7 cache publish mutation records a terminal failure, rethrows to its boundary, and starts no post-mutation refresh (4.56707ms)
✔ T606 R6 cache retries acquisition only, publishes once, and never retries a publish failure (2.210068ms)
✔ T606 IFR001 propagates an actual cache write failure instead of projecting live not-cached success (0.444666ms)
✔ T606 IFR002 fences a pending Node cache write after abort and returns a typed cancellation (2.911351ms)
✔ T606 IFR003 runs the production Global layer toggle through one redacted terminal lifecycle (4.428305ms)
✔ T606 IFR001 republishes the post-cache-publish tree snapshot and fails closed when publication reports failure (0.719047ms)
✔ T606 IFR003 Global open throws once to the shared redacted UI boundary without a raw-error callback (2.515975ms)
✔ T606 IFR003 PR Progress carries its owner and abort signal to pending content I/O, then emits one terminal per cancelled, failed, and successful refresh (18.58541ms)
✔ T606 IFR002 retries only transient result unions through Current Context's cache read port and keeps permanent causes single-attempt (82.262747ms)
✔ T606 IFR002 real T305-to-T405 composition retries only transient acquisition, aborts deep cache I/O, and fences stale publication (352.053245ms)
✔ T305 contributes the Review Range activity container, views, and commands (6.26556ms)
✔ T305 default and focused commands execute the same behavior suites (3.547165ms)
ℹ tests 238
ℹ suites 0
ℹ pass 238
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8140.262435
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-t609

- UTC: 2026-10-06T18:23:17.498768+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t609`
- Exit: 0; counts={"tests": "92", "pass": "92", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221; after=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t609.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t609
> npm run compile:test && node --test test-dist/test/unit/t609-repository-resolution.test.js test-dist/test/unit/t609-review-contexts-repository.test.js test-dist/test/unit/t609-revision-mapping-encoding.test.js test-dist/test/unit/t609-normal-review-followup.test.js test-dist/test/unit/t609-review-contexts-cancellation-boundary.test.js test-dist/test/unit/t609-t405-encoding-composition.test.js test-dist/test/unit/t609-test-review-state-dependent-queue.test.js test-dist/test/unit/t609-gate-wiring.test.js test-dist/test/unit/t609-host-rename-decoration-composition.test.js test-dist/test/unit/review-diff-content-provider.test.js test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/history-rewrite-git-context-integration.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T609 read-only document provider recovers when the actual Git inspection cwd was deleted (92.001674ms)
✔ T609 document decoration recovery propagates noncandidate stat failures (3.014196ms)
✔ Git provider restores each mixed target snapshot layer in one CAS (35.680555ms)
✔ Git provider rejects an invalid present target snapshot without fallback CAS or history (3.383285ms)
✔ Git provider rejects an unreadable present target snapshot without fallback CAS or history (2.661618ms)
✔ Git provider does not publish mixed snapshot state or history after a CAS conflict (9.010838ms)
✔ Git provider records an unresolved mapping event after a conservative missing-object clear (4.689466ms)
✔ Git provider records binary mapping as unresolved instead of a successful remap (6.873423ms)
✔ document sessions map branch commits and isolate branch and detached contexts (5.516828ms)
✔ T609-NR-005 records a generic unresolved history reason for a failed current-revision text refresh (3.027262ms)
✔ document routing recalculates the current Git snapshot when an opened encoding hint changes (7.56652ms)
✔ T609 production Git document session clears a same-revision encoding transition without changing an unrelated BOM file (8.900795ms)
✔ T609-NR-002 aggregates all reopened document hints across mapping and an encoding change (16.704045ms)
✔ document routing follows the stable file ID after a rename (5.307496ms)
✔ new branch initialization maps owner-wide Global state through the debounced repository (181.745709ms)
✔ new branch initialization preserves a concurrent Global update while mapping (314.204939ms)
✔ a poll started at B preserves foreground revision C after its mapping completes (178.046746ms)
✔ document routing distinguishes a renamed file from a new file at its old path (8.971057ms)
✔ document routing excludes a binary rename while routing a new text file at its old path (7.12183ms)
✔ document routing maps an ambiguous rename and copy graph without reusing its source ID (6.764077ms)
✔ Git revision mapper preserves SHA-only reviewed ranges through saved snapshots when the old object is gone (32.402204ms)
✔ Git revision mapper follows one snapshot-backed rename and retains the stable file identity (10.321401ms)
✔ Git revision mapper fails closed when multiple current paths match one saved snapshot (9.195315ms)
✔ Git revision mapper clears a shared file when direct Context and recovered Global disagree (10.713103ms)
✔ T609-NR-003 keeps recoverable files when an opened encoded catalog file is unreadable (7.68758ms)
✔ review diff URI round-trips context, file, semantics, side, source, and revision (6.036704ms)
✔ review diff URIs from different contexts never collide (1.827755ms)
✔ review diff URI decoding rejects non-canonical or malformed inputs deterministically (2.118121ms)
✔ review diff URI encoding rejects invalid descriptor fields (0.576599ms)
✔ content provider restores original and modified revision content (2.407284ms)
✔ content provider reports unavailable and invalid-encoding outcomes with stable codes (5.356494ms)
✔ local Git adapter reads exact streamed text content at a commit (2.973429ms)
✔ local Git adapter accepts an opened Shift-JIS hint only through the VS Code decode boundary (0.908263ms)
✔ local Git adapter isolates unsupported opened encoding instead of accepting decoder fallback text (0.719865ms)
✔ local Git adapter distinguishes missing commits and missing files (1.626673ms)
✔ local Git adapter rejects moving revisions and unsafe repository paths (0.566218ms)
✔ local Git adapter preserves unexpected Git failures (0.899952ms)
✔ T609 gate wires every focused unit suite once and keeps the Extension Host phase separate (25.261501ms)
✔ T609 CI gate invokes the package-owned unit and Extension Host commands once (3.361512ms)
✔ T609 runner prepares both Git fixtures before the Host launches and the Host suite only consumes them (3.19788ms)
✔ T609 multi-root workspace fixture preserves the single-root whitespace and EOL mapping settings exactly once (2.522325ms)
✔ T609 Host fixture separates active-editor lifecycle, command persistence, visible refresh, and Global completion (1.675224ms)
✔ T609 runner owns a 300-second deadline for the single-root phase (2.565459ms)
✔ T609 phase ownership keeps mixed encoding in single-root and repository cancellation in multi-root (3.854098ms)
✔ T609 contract fixtures compile legacy mapping and Review Context runtime shapes once through the focused gate (2.383388ms)
✔ T609 single-root reuses its no-active Current Context selection without an active-editor refresh (1.909577ms)
✔ T609 Host waits for the single handled startup Current Context refresh before its public no-active-editor command (2.773228ms)
✔ T609 multi-root Current Context commands retain their public path without local settle-time wrappers (2.785937ms)
✔ T609 multi-root Review Contexts keeps its public commands and snapshots under the owned phase deadline (1.522942ms)
✔ T609 multi-root Current Context selection clears mapped editors before the public commands (1.05014ms)
✔ T609 Host reaches normal-editor review through its public command (0.903054ms)
✔ T609 runner seeds persisted mapping state before Host activation through production storage (1.398807ms)
✔ T609 mapped Git-transition fixture keeps only per-file-operation deadlines without an overall mapping deadline (1.301468ms)
✔ T609 production activation does not retain the obsolete Test-only mapping seed (1.752085ms)
✔ T609 single-root uses public mixed-encoding marks after startup settlement without making background Test fakes a command gate (2.88231ms)
✔ T609 production composition passes the shared validated mapping settings to Git revision mapping (3.768978ms)
✔ T609 restart reobserves only its active UTF-8 BOM hint without Current Context or Global refresh (2.736458ms)
✔ T609 Host observes actual VS Code URI safety and persisted encoding mapping without Test mutation seams (4.036686ms)
✔ T609 mixed-encoding composition observes persisted Shift-JIS state at every public boundary (1.35189ms)
✔ T609 persisted Git snapshot reads the Current Context owner without mutating state (4.065781ms)
✔ T609 virtual URI boundary commands use the owned single-root deadline (2.030901ms)
✔ T609 live encoding transition re-decodes the open document without waiting for model disposal (1.31369ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":49438,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791311012327.json"}}
✔ T609 deterministic Git fixture commits the raw EOL-only transition used by mapper regressions (227.331931ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":49602,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791311013072.json"}}
✔ T609 production rename decoration composition settles concurrent visible and explicit refreshes (740.971637ms)
✔ T609-NR-008 maps only boolean configuration values for Git and live-edit composition (1.756036ms)
✔ T609-NR-004 never selects the first repository when no-active-editor has multiple candidates (0.877683ms)
✔ T609-NR-004 keeps the accepted Current Context when the ambiguous-root Quick Pick is cancelled (0.27695ms)
✔ T609 resolves a Git workspace without an active Git editor in deterministic source order (3.635683ms)
✔ T609 deduplicates a repository and fails closed for unsafe candidates (5.564029ms)
✔ T609 does not accept a disjoint known-root inspection without canonical identity (0.435549ms)
✔ T609 accepts a disjoint known-root alias only when canonical identities match (0.519437ms)
✔ T609 keeps strict known-root matching for absolute and Windows case-varied paths (1.153066ms)
✔ T609 skips only a candidate-specific stat ENOENT and propagates other failures (1.679969ms)
✔ T609 propagates structured non-Error ENOENT rejection values unchanged (0.308541ms)
✔ T609 compares Windows candidate stat paths without case or separator sensitivity (0.630078ms)
✔ T609 rethrows non-Error rejection values unchanged (0.430203ms)
✔ T609 does not accept a stale known-root inspection that resolves to its parent (0.812328ms)
✔ T609 applies the deepest known boundary separately to each document (1.041955ms)
✔ T609 rejects query, fragment, and mismatched authority before T305 or T405 can use a URI filesystem path (0.719935ms)
✔ T609-NR-004 preserves the existing provider projection for multi-root Quick Pick cancel and stale cancellation (5.586528ms)
✔ T609-NR-004 cancel and stale typed outcomes run one command without terminal reporting, clear, or post-cancel refresh (41.070055ms)
✔ T609 Review Contexts resolves the sole opened Git workspace without an active editor (3.423075ms)
✔ T609 Review Contexts fails closed when multiple roots are cancelled (0.823345ms)
✔ T609 isolates one unsupported encoded file while Context and Global map the other file (21.501079ms)
✔ T609-NR-005 retains a privacy-safe unresolved reason when a current-revision text refresh fails (2.945586ms)
✔ T609 preserves a restart-unopened encoded identity only when the new immutable blob exists but cannot be decoded (8.50302ms)
✔ T609 clears only the changed same-revision encoding intervals while preserving unrelated Context and Global state (2.642133ms)
✔ T609 inherits an opened encoding hint only for a unique rename (5.520263ms)
✔ T609 does not carry an opened hint from a copy or a new file back to its source (7.867797ms)
✔ T609-NR-001 maps an opened Shift-JIS file through the actual T405 new-PR Global composition (161.634169ms)
✔ T609 Test dependent queue names every background dependent and does not make the public command wait (4.059621ms)
✔ T609 Test dependent queue aborts stale fakes and contains their rejection during disposal (0.488895ms)
ℹ tests 92
ℹ suites 0
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1399.546437
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-i116

- UTC: 2026-10-06T18:23:33.248941+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:i116`
- Exit: 1; counts={"tests": "29", "pass": "28", "fail": "1", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221; after=19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-i116.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:i116
> npm run compile:test && node --test test-dist/test/unit/issue-116-current-context-refresh.test.js test-dist/test/unit/t609-repository-resolution.test.js test-dist/test/unit/t305-projection-refresh.test.js test-dist/test/unit/review-contexts-runtime-wiring.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ Issue #116 shares duplicate start paths and a returned canonical root within one Current Context generation (3.652694ms)
✔ Issue #116 does not infer an unexamined descendant from another returned root (0.634831ms)
✔ Issue #116 shares active, opened, visible and workspace fallback inspections in one production session (0.444224ms)
✖ Issue #116 reuses accepted Current Context PR preparation for only the immediately dependent Review Contexts refresh (283.303236ms)
✔ Issue #116 discards a failed Current Context preparation and a later generation acquires fresh state (166.975268ms)
✔ T405 contributes Review Contexts activation, commands, and menus (15.06508ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (11.781738ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (3.900768ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (6.185471ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (10.407309ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (4.087537ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (2.151607ms)
✔ PR68-R003 source switch never publishes the previous PR snapshot under the new PR source (2.142519ms)
✔ PR68-R004 PR Progress failure cannot block new-owner decoration Global or Review Contexts refresh (0.495012ms)
✔ PR68-R004 successful edit-state mutation keeps its success when only PR projection refresh fails (0.239906ms)
✔ T610-NR-006 decoration failure cannot block open-document Global reconciliation (0.711657ms)
✔ Issue #84 Review Contexts registers the selected PR before PR Progress starts (0.325667ms)
✔ T609 resolves a Git workspace without an active Git editor in deterministic source order (4.078241ms)
✔ T609 deduplicates a repository and fails closed for unsafe candidates (1.499026ms)
✔ T609 does not accept a disjoint known-root inspection without canonical identity (0.663616ms)
✔ T609 accepts a disjoint known-root alias only when canonical identities match (0.740526ms)
✔ T609 keeps strict known-root matching for absolute and Windows case-varied paths (3.338173ms)
✔ T609 skips only a candidate-specific stat ENOENT and propagates other failures (1.557459ms)
✔ T609 propagates structured non-Error ENOENT rejection values unchanged (0.397166ms)
✔ T609 compares Windows candidate stat paths without case or separator sensitivity (0.474271ms)
✔ T609 rethrows non-Error rejection values unchanged (0.532147ms)
✔ T609 does not accept a stale known-root inspection that resolves to its parent (0.516547ms)
✔ T609 applies the deepest known boundary separately to each document (0.930014ms)
✔ T609 rejects query, fragment, and mismatched authority before T305 or T405 can use a URI filesystem path (0.984188ms)
ℹ tests 29
ℹ suites 0
ℹ pass 28
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 671.946325

✖ failing tests:

test at test-dist/test/unit/issue-116-current-context-refresh.test.js:92:25
✖ Issue #116 reuses accepted Current Context PR preparation for only the immediately dependent Review Contexts refresh (283.303236ms)
  AssertionError [ERR_ASSERTION]: an independent Review Contexts refresh must acquire fresh state
  + actual - expected

    {
  +   diffRuntime: 0,
  +   lifecycle: 0,
  +   localCandidates: 0,
  +   progress: 0,
  +   repositoryContexts: 0
  -   diffRuntime: 1,
  -   lifecycle: 1,
  -   localCandidates: 1,
  -   progress: 1,
  -   repositoryContexts: 1
    }

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/issue-116-current-context-refresh.test.js:141:26)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: { localCandidates: 0, repositoryContexts: 0, lifecycle: 0, diffRuntime: 0, progress: 0 },
    expected: { localCandidates: 1, repositoryContexts: 1, lifecycle: 1, diffRuntime: 1, progress: 1 },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker fixture-ports-compile

- UTC: 2026-10-06T18:25:13.959897+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/fixture-ports-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-fixture-focused

- UTC: 2026-10-06T18:25:52.081803+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/issue-116-current-context-refresh.test.js`
- Exit: 0; counts={"tests": "25", "pass": "25", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-fixture-focused.manifest.json.

stdout (full):

```text
✔ Issue #116 shares duplicate start paths and a returned canonical root within one Current Context generation (3.288558ms)
✔ Issue #116 does not infer an unexamined descendant from another returned root (0.606405ms)
✔ Issue #116 shares active, opened, visible and workspace fallback inspections in one production session (0.518922ms)
✔ Issue #116 reuses accepted Current Context PR preparation for only the immediately dependent Review Contexts refresh (346.998449ms)
✔ Issue #116 discards a failed Current Context preparation and a later generation acquires fresh state (177.380022ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (3.519435ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (155.51854ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (24.809157ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (182.364425ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1094.124378ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (4965.461405ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (4.134201ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (16.813363ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (14.227661ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (1.645321ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (5.713663ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (16.467497ms)
✔ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (2.181297ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.943071ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (3.271365ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (0.968129ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (0.842226ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (1.492081ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.966546ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (6.179919ms)
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5350.079374
```

stderr (full):

```text
```


### Fresh implementation worker final-lint

- UTC: 2026-10-06T18:26:18.276963+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run lint`
- Exit: 0; counts={}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-lint.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre lint
> eslint src test --max-warnings=0

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-build

- UTC: 2026-10-06T18:26:28.045086+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run build`
- Exit: 0; counts={}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-build.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre build
> npm run compile


> review-range-tracker@0.0.1-pre compile
> tsc -p tsconfig.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-t305

- UTC: 2026-10-06T18:26:33.923366+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t305`
- Exit: 0; counts={"tests": "71", "pass": "71", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t305.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t305
> npm run compile:test && node --test test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/t305-validation-wiring.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (6.814801ms)
✔ pull request, branch, and workspace labels are projected consistently (0.687771ms)
✔ branch selection identity remains stable when HEAD advances (0.645074ms)
✔ select applies the authoritative selected snapshot (0.870415ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.803452ms)
✔ selected context identity is applied to the review runtime before decorations refresh (0.874971ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (1.619973ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (2.761428ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (5.090002ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (1.050283ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.653475ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (1.163515ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.337477ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (1.434561ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (1.33955ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (181.173376ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (2.573913ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.683133ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.854292ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (0.678192ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (2.451019ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (1.031308ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (0.882985ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.786134ms)
✔ refresh ignores stale asynchronous snapshots (0.404283ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.421522ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (5.831952ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.521677ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.498726ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (0.566971ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (0.631049ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (0.538913ms)
✔ Global layer toggle does not refresh dependents when persistence fails (1.379204ms)
✔ Global refresh clears stale presentation when the current recalculation fails (1.207046ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (0.50946ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (1.262077ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.317043ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (15.204907ms)
✔ T505-R001 retains immutable open-document evidence after save and close (74.740597ms)
✔ T505-R001 wires change, save, and close events to Global evidence refresh (1.73787ms)
✔ T505-R002 keeps individually valid snapshots when only their combined size exceeds the per-snapshot limit (10.24374ms)
✔ T505-R002 rejects aggregate limits below the per-snapshot limit and never publishes a removed latest snapshot (10.797207ms)
✔ T505-R003 reuses the shared last-valid exclusion policy after an invalid setting (16.100935ms)
✔ T505-R004 invalid snapshot settings fall back without throwing and the manifest caps safe integers (1.480627ms)
✔ T505-R006 focused validation executes the review-finding suite exactly once (1.312879ms)
✔ T505-R007 follow-up handoff uses the required schema v3 top-level packet and preserves the original payload (1.387608ms)
✔ T505-R005 requesting a debounced refresh immediately invalidates the in-flight generation (0.537778ms)
✔ PR69-R001 Global snapshot pins a working-tree open target to the producing owner (16.861958ms)
✔ PR69-R001 PR Global snapshot pins immutable HEAD identity even when the file is absent locally (18.050913ms)
✔ PR69-R001 stale Global nodes reject directly while the registered command owns generic error reporting (12.284934ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (77.337815ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (0.8329ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.151645ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.634697ms)
✔ reports start and success while keeping the busy status visible until completion (1.179647ms)
✔ restores the previous operation status after a nested operation finishes (0.330007ms)
✔ logs and reveals failures before rethrowing them (0.513123ms)
✔ records a swallowed diagnostic failure without changing active status (0.207263ms)
✔ formats one-line Output entries without exposing a stack trace (0.701948ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.447071ms)
✔ T405 contributes Review Contexts activation, commands, and menus (6.798062ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (2.261081ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (1.951282ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (3.476775ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (1.858949ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (1.590416ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (1.503165ms)
✔ T305 preserves every pre-existing unit suite exactly once while adding its focused suites (1.409459ms)
✔ Issue #84 registers the selected PR runtime before PR Progress refresh (0.73504ms)
✔ T305 contributes the Review Range activity container, views, and commands (7.09546ms)
✔ T305 default and focused commands execute the same behavior suites (4.288218ms)
ℹ tests 71
ℹ suites 0
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 598.931234
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-t405

- UTC: 2026-10-06T18:26:54.314056+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t405`
- Exit: 0; counts={"tests": "90", "pass": "90", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t405.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t405
> npm run compile:test && node --test test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-storage.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-pull-request-review-runtime.test.js test-dist/test/unit/t405-review-followup.test.js test-dist/test/unit/t405-revision-evidence.test.js test-dist/test/unit/t405-selected-pr-session.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T405 contributes Review Contexts activation, commands, and menus (17.082254ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (6.198545ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (4.348026ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (6.296343ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (6.050212ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (5.44601ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (3.424781ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (487.851322ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (3.460025ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.413299ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.666744ms)
✔ reports start and success while keeping the busy status visible until completion (4.457215ms)
✔ restores the previous operation status after a nested operation finishes (0.48385ms)
✔ logs and reveals failures before rethrowing them (10.38499ms)
✔ records a swallowed diagnostic failure without changing active status (0.515092ms)
✔ formats one-line Output entries without exposing a stack trace (0.688192ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.419514ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (41.277535ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (2.913378ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (5.587212ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (7.613618ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (1.308723ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (24.798859ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (2.328551ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (0.92256ms)
✔ PR runtime command snapshot survives immutable PR A-to-B-to-A store restoration with hashes (45.639935ms)
✔ R405-3 saved/closed PR opens through the canonical T302 review-range-diff identity (1.511165ms)
✔ R405-3 Review Contexts canonical original/modified commands persist mark and unmark (21.330828ms)
✔ PR runtime command fails closed before commit when persisted hashes do not match authoritative HEAD content (2.339904ms)
✔ PR mutation no-op, cancellation, and failed commit publish neither snapshots nor history (3.440592ms)
✔ R405-5 PR runtime exposes T304 progress for Review Contexts (3.744548ms)
✔ Issue #137 actual T405 PR activation never emits acquired file paths in detailed Output (13.677232ms)
✔ Issue #136 keeps the newest PR Progress refresh when an older read finishes later (2.584305ms)
✔ R405-3 binary PR changes are not opened as text review diffs (0.623005ms)
✔ Issue #59 PR full scan reads complete current-side files once and reuses immutable revision caches (2.472125ms)
✔ PR69-R001 Global PR open uses the exact immutable HEAD document and rejects a superseded head (0.998544ms)
✔ PR Progress original-side selection projects unchanged lines and retains original-only lines atomically (1.772465ms)
✔ PR Progress command rejects an old diff URI pair after BASE or HEAD changes (0.99181ms)
✔ production command routing validates the active immutable diff URI pair before mutation (3.138673ms)
✔ PR runtime persists mark and unmark for added content without a terminal newline (5.06349ms)
✔ PR runtime persists mark and unmark for added LF-terminated content (2.321701ms)
✔ PR runtime persists mark and unmark for deleted content without a terminal newline (3.38216ms)
✔ PR runtime persists mark and unmark for deleted LF-terminated content (1.486377ms)
✔ PR runtime persists mark and unmark for replacement with terminal newlines (1.767926ms)
✔ PR runtime persists mark and unmark for replacement that adds a terminal newline (1.858389ms)
✔ PR runtime persists mark and unmark for replacement that removes a terminal newline (1.789969ms)
✔ PR runtime preserves empty existing files and CRLF content through body-derived line contracts (4.033833ms)
✔ PR runtime treats a terminal display line as outside Git content (2.633896ms)
✔ PR runtime leaves bare CR display fragments outside one-line Git replacements (1.11742ms)
✔ PR runtime rejects truncated, mismatched, and inconsistent local Git hunk evidence before mutation (3.650068ms)
✔ PR runtime hydrates complete legacy-redacted cache hunks and rejects tampered or incomplete evidence (5.876838ms)
✔ PR runtime block mode links both sides while a later side-mode operation stays on the operated side (3.868862ms)
✔ PR runtime block mode expands an original replacement selection to modified Context and Global (1.200478ms)
✔ PR runtime does not read selection mode or open state for an empty selection (0.422033ms)
✔ PR runtime block mark from original commits when only the target revision Global snapshot changes (3.950988ms)
✔ PR runtime block unmark from original commits when only the target revision Global snapshot changes (4.849268ms)
✔ PR runtime block mark from modified commits when only the target revision Global snapshot changes (1.883545ms)
✔ PR runtime block unmark from modified commits when only the target revision Global snapshot changes (2.536899ms)
✔ PR runtime rejects a re-registered comparison while a pending state load is resumed (1.681023ms)
✔ PR runtime rejects old rename URIs and keeps an active command scoped to its PR (1.613074ms)
✔ PR runtime keeps actual repository state atomic through write and CAS failures, restart, and a history failure (197.133841ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (5.783745ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (145.136877ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (32.076476ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (183.656861ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1050.977607ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (4811.588184ms)
✔ R60-001 immutable PR HEAD remains authoritative when the working-tree candidate set omits the file (1.593377ms)
✔ R60-001 Global promotes immutable PR HEAD evidence even when the working tree no longer contains that path (27.71692ms)
✔ R60-003 superseded owner revisions evict retained Global evidence instead of reviving it later (22.483502ms)
✔ R60-002 breaking-change policy supersedes rev4 Global semantics with opened-only and immutable-PR rules (1.739251ms)
✔ PR85-IFR-004 production Review Contexts completion counts stay monotonic across two PRs, retry, and repositories (307.465258ms)
✔ PR85-NR-003 selected PR Progress reports file counts through the production Tree path on immutable-cache hits (2.614189ms)
✔ R405-4 presentation hide applies to current PR, branch, and workspace without deleting state (0.580569ms)
✔ R405-5 Review Contexts projects T304-compatible PR progress (0.214129ms)
✔ R405-5 progress formatter covers zero, partial, and complete PR states (0.131202ms)
✔ T405-IFR-2 keeps cache origin, freshness, and last successful update in the View projection (0.229729ms)
✔ R405-5 Review Contexts Tree renders projected progress to users (1.317914ms)
✔ R405-7 pull-request Current Context identity is stable across rediscovery and not label-derived (0.262275ms)
✔ R405-7/R405-8 current PR is inferred only from persisted open state at the local HEAD (0.1756ms)
✔ R405-7 multiple current-head PRs retain the PR explicitly chosen by redetection (0.08384ms)
✔ Issue #137 selection provenance distinguishes explicit, unique, ambiguous, and missing matches (0.118098ms)
✔ T406-R001 explicit branch selection suppresses one saved open PR at the same immutable HEAD (0.060322ms)
✔ R405-7 redetection persists and reloads explicit current PR identity (2.99593ms)
✔ R405-6/R405-9 remove the dead closed-layer setting and document connected Review Contexts (2.234849ms)
✔ R405-1 revision evidence supplies exact diff and old/new text for tracked files (8.226978ms)
✔ base-only PR transition does not invent a head diff (0.403794ms)
✔ PR evidence loader supplies unchanged Global-only target evidence to the immutable mapper (9.634861ms)
✔ R405-7 selected PR owns normal-editor command and decoration sessions without branch initialization (3.342423ms)
✔ selected PR rejects a foreign repository or stale head without creating state (2.10602ms)
ℹ tests 90
ℹ suites 0
ℹ pass 90
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6562.111478
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker report-whitespace-audit

- UTC: 2026-10-06T18:27:33.637628+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `git diff --no-index --check /dev/null reports/issue-136-137-r2-regressions-20261006.md`
- Exit: 3; counts={}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/report-whitespace-audit.manifest.json.

stdout (full):

```text
reports/issue-136-137-r2-regressions-20261006.md:2636: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2638: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2653: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2655: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2671: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2674: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2720: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2722: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2737: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2739: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2755: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2758: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2932: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:2934: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:3172: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:3174: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:3266: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:3268: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:3418: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:3420: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:4737: trailing whitespace.
+
reports/issue-136-137-r2-regressions-20261006.md:4750: trailing whitespace.
+
```

stderr (full):

```text
```


### Fresh implementation worker final-t406

- UTC: 2026-10-06T18:27:14.608196+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t406`
- Exit: 0; counts={"tests": "32", "pass": "32", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t406.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t406
> npm run compile:test && node --test test-dist/test/integration/mock-github.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-composition-regression.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (73.463937ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (2.610411ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (22.530074ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (4.524422ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (1.947712ms)
✔ GitHub adapter attempts a public API request without authentication (8.684805ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (31.556031ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (4.012281ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (3.352092ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (0.902224ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.712856ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.29111ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.417661ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.249438ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (32.426741ms)
✔ local Git diff is the first successful acquisition source (2.378175ms)
✔ GitHub PR files patch is used after local Git is unavailable (1.099158ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (1.449421ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (0.876309ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.374873ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.296281ms)
✔ remote metadata from a different comparison is rejected before content reads (0.205704ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (1.412029ms)
✔ invalid revision input is rejected before invoking local Git (0.691186ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (1.95112ms)
✔ malformed remote file identity fails closed without reading repository contents (0.387658ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (5.817497ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (168.745848ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (23.116412ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (180.916085ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1378.997762ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (6285.762728ms)
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6680.537985
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-source-diff-check

- UTC: 2026-10-06T18:28:01.962712+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `git diff --check -- src test tasks reports/issue-136-137-normal-review-20261006.md`
- Exit: 0; counts={}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-source-diff-check.manifest.json.

stdout (full):

```text
```

stderr (full):

```text
```


### Fresh implementation worker final-t606

- UTC: 2026-10-06T18:27:35.323696+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t606`
- Exit: 0; counts={"tests": "238", "pass": "238", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t606.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t606
> npm run compile:test && node --test test-dist/test/unit/t606-failure-policy-retry-diagnostics.test.js test-dist/test/unit/t606-production-failure-matrix.test.js test-dist/test/unit/t606-r6-production-matrix.test.js test-dist/test/unit/t606-r6-real-composition.test.js test-dist/test/unit/t606-r5-production-activation.test.js test-dist/test/unit/local-git-adapter.test.js test-dist/test/integration/t302-review-followup.integration.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/state-repository.test.js test-dist/test/unit/debounced-review-state-repository.test.js test-dist/test/unit/normal-editor-review-command-registration.test.js test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/global-understanding-ui.test.js test-dist/test/unit/t505-global-understanding-source.test.js test-dist/test/unit/github-pull-request-cache.test.js test-dist/test/integration/mock-github.test.js test-dist/test/unit/t604-storage-lock-cleanup.test.js test-dist/test/unit/t605-multi-root-remote-boundaries.test.js test-dist/test/unit/ci-workflow-contract.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (86.533601ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (3.068369ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (24.535846ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (5.135966ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (1.234241ms)
✔ GitHub adapter attempts a public API request without authentication (7.012553ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (30.893595ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (5.823794ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (7.501539ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (0.94925ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.66133ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.284378ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.624192ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.381589ms)
✔ review diff URI round-trip preserves filesystem path semantics (3.167177ms)
✔ review diff URI rejects moving refs and non-canonical repository paths (0.956875ms)
✔ POSIX review diff URI preserves tab, newline, and backslash filename characters (0.467929ms)
✔ Windows review diff URI rejects backslash and control characters (0.410307ms)
✔ fatal revision lookup exit 128 is preserved instead of reported as missing (0.677172ms)
✔ fatal file lookup exit 128 is preserved instead of reported as missing (0.460126ms)
✔ moving refs are rejected before immutable Git content lookup (152.241071ms)
✔ POSIX Git content lookup supports tab, newline, and backslash filenames (120.238478ms)
✔ POSIX Git content lookup supports a filename made only of a newline (114.832096ms)
✔ Git content lookup reads UTF-8 text immediately below and above 4 MiB (383.29327ms)
✔ non-UTF-8 Git blob is rejected deterministically without replacement characters (123.355019ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (45.679525ms)
✔ local Git diff is the first successful acquisition source (3.81061ms)
✔ GitHub PR files patch is used after local Git is unavailable (1.960988ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (4.448231ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (0.946793ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.548538ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.693657ms)
✔ remote metadata from a different comparison is rejected before content reads (0.397887ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (1.538764ms)
✔ invalid revision input is rejected before invoking local Git (0.992211ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (1.914293ms)
✔ malformed remote file identity fails closed without reading repository contents (0.545153ms)
✔ unit and focused suites execute the integrated design contract (18.463822ms)
✔ document line contract coverage is runnable directly and through the required unit suite (4.012111ms)
✔ unit, npm test, focused CI execute the complete T304 tree contract (2.304966ms)
✔ temporary Git suite executes the T207 history integration scenario (0.811964ms)
✔ T502 focused coverage is runnable locally and included in the default unit suite (1.756091ms)
✔ CI executes positive and negative architecture gates with diagnostic logs (1.498268ms)
✔ CI executes the canonical T502 focused command (0.947388ms)
✔ T505 focused coverage executes each dedicated suite once and is required by CI (2.101668ms)
✔ CI diagnostics preserve stdout, stderr, combined logs, and result metadata (1.419517ms)
✔ T506 integration and Extension Host acceptance are exposed as one required focused CI command (2.182463ms)
✔ T406 GitHub failure and recovery integration is exposed by package and CI (1.589958ms)
✔ T605 multi-root and remote workspace boundary coverage is exposed by package and CI (2.656494ms)
✔ T606 focused failure-policy coverage is exposed by package and CI (1.20627ms)
✔ T607 performance workloads remain local-only and never gate CI (1.116867ms)
✔ CI publishes a branch-version-and-HEAD-named VSIX and tracked source archive only after pull-request success (1.254154ms)
✔ required unit gate runs the Issue #90 runtime routing suite before success artifacts (1.342573ms)
✔ required unit gate reaches the Issue #92 PR Progress context-menu contract before success artifacts (1.527854ms)
✔ required CI gates exclude timing-sensitive suites and use deadline-free Extension Host waits (4.25574ms)
✔ required gates keep the T606 wall-clock timeout fixture local-only (1.653014ms)
✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (3.795725ms)
✔ pull request, branch, and workspace labels are projected consistently (0.669277ms)
✔ branch selection identity remains stable when HEAD advances (0.483902ms)
✔ select applies the authoritative selected snapshot (0.562921ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.81903ms)
✔ selected context identity is applied to the review runtime before decorations refresh (0.54362ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (0.684998ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (0.70765ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (0.893661ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (0.505259ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.467288ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.329755ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.268081ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.44213ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (1.159327ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (153.533001ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (0.911233ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.403979ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.272746ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (0.82926ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (0.666479ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.49737ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (0.581302ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.719488ms)
✔ refresh ignores stale asynchronous snapshots (0.342494ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.201367ms)
✔ multiple background saves are coalesced and persist only the newest complete snapshot (2.904172ms)
✔ storage kinds remain isolated even when repository and context IDs are identical (0.494514ms)
✔ a confirmation transaction flushes pending background state and commits without waiting for the debounce timer (0.643086ms)
✔ external-file confirmation flushes the external pending state before commit (0.753042ms)
✔ dispose flushes a pending save immediately for Extension Host deactivation (1.341363ms)
✔ dispose waits for an immediate commit queued behind an in-flight load (1.669185ms)
✔ dispose waits for an in-flight owner-wide Global load (8.552848ms)
✔ owner-wide Global load serializes a different context commit (1.378129ms)
✔ Git Global load serializes a pull-request save for the same repository (1.732384ms)
✔ all callers observe a debounced persistence failure instead of receiving a false success (0.994718ms)
✔ live GitHub acquisition stores metadata and a source-redacted diff with explicit timestamps (5.46599ms)
✔ rate-limit failure uses an exact cached PR and marks expired data stale (1.177037ms)
✔ network failure uses an unexpired exact cache and marks it fresh (0.638385ms)
✔ patch fallback followed by network failure still uses an exact cache (0.668112ms)
✔ non-offline API failures do not substitute cached data (0.450297ms)
✔ mixed offline-eligible and API failures do not substitute cached data (0.453386ms)
✔ cache entries are bound to the exact context, repository, PR, base, and head identity (0.425982ms)
✔ filesystem cache publishes metadata and redacted diff through one generation pointer (64.403239ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (3.022502ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.951829ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.254304ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (0.399941ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (0.243749ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (0.26445ms)
✔ Global layer toggle does not refresh dependents when persistence fails (0.84041ms)
✔ Global refresh clears stale presentation when the current recalculation fails (0.880096ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (0.408005ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (0.533306ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.638902ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (15.138655ms)
✔ Node local Git path normalization propagates stat permission errors unchanged (2.77525ms)
✔ Node local Git path normalization retains only an exact candidate stat ENOENT (0.464328ms)
✔ Node local Git path identity is unavailable when either realpath lookup fails (0.246718ms)
✔ repository inspection uses argument arrays and returns normalized Git identity (16.229245ms)
✔ remote normalization unifies common GitHub URL forms without credentials (0.573403ms)
✔ fork remotes remain distinct repository identities (0.970933ms)
✔ a repository without remotes receives a stable root-derived identity (1.381414ms)
✔ Issue #57 keeps local Git context usable when a listed remote URL cannot be resolved (0.505802ms)
✔ detached HEAD is distinguished while retaining the exact HEAD object (0.671304ms)
✔ Git executable absence and non-repositories are separate outcomes (0.634055ms)
✔ merge-base and object existence use bounded argument-array commands (0.773435ms)
✔ revision arguments that could be parsed as options are rejected (0.267978ms)
✔ registerNormalEditorReviewCommands registers the four designed command IDs (5.730503ms)
✔ registered commands delegate only when an active normal editor exists (0.937265ms)
✔ registered commands reject missing and diff editors without invoking state commands (0.377258ms)
✔ registered commands report a privacy-safe handler failure through the UI host (0.435427ms)
✔ handler failure is recorded as failed operation before the UI host reports it (2.051481ms)
✔ Test-mode command failure is captured by operation and rejects with the original error without waiting for UI (0.84243ms)
✔ applied production handlers await one automatic decoration refresh (0.574546ms)
✔ Test-mode public command settles after state application without an automatic decoration refresh (0.33968ms)
✔ T405 contributes Review Contexts activation, commands, and menus (12.12158ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (5.084756ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (8.265544ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (8.329118ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (3.782256ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (3.429442ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (4.670001ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (2.960151ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.33462ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.940148ms)
✔ reports start and success while keeping the busy status visible until completion (2.909693ms)
✔ restores the previous operation status after a nested operation finishes (0.562337ms)
✔ logs and reveals failures before rethrowing them (2.99385ms)
✔ records a swallowed diagnostic failure without changing active status (0.524713ms)
✔ formats one-line Output entries without exposing a stack trace (0.869733ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (3.106334ms)
✔ routing separates Git and PR state from non-Git workspace state (10.240826ms)
✔ workspace routing requires ExtensionContext.storageUri (1.226397ms)
✔ repository save commits manifest last and reloads the same context and Global state (87.524926ms)
✔ repository manifest preserves other contexts while atomically advancing one context (125.28065ms)
✔ non-Git state uses workspace-state.json and never writes under globalStorageUri (26.631433ms)
✔ a failed repository manifest replacement preserves disk and memory state (32.503491ms)
✔ a failed workspace replacement preserves disk and memory state (13.093065ms)
✔ schema mismatch is rejected and reported during load (6.176442ms)
✔ save validates manifest, context, Global, target identity before any write (7.130432ms)
✔ concurrent saves retain both context references in the repository manifest (69.869016ms)
✔ save accepts the exact target and context kind mapping (29.123719ms)
✔ save rejects non-matching target and context kinds (15.043694ms)
✔ NodeAtomicTextFileStore replaces a file without leaving temporary files (9.315905ms)
✔ storage-root containment follows the host path semantics without weakening escape rejection (0.53709ms)
✔ NodeAtomicTextFileStore rejects an outside sibling and a symbolic link or junction (6.46056ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (10.743085ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (229.307034ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (37.185171ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (294.639927ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (2024.157433ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (6871.818125ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (29.010741ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (2.148863ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (2.386431ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (4.74027ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (1.07793ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (21.687396ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (2.162863ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (0.803745ms)
✔ T505 source keeps unopened file contents out of the line denominator while preserving path diagnostics (150.33181ms)
✔ Issue #59 uses only previously opened files for Global line progress and reports unopened files separately (46.017741ms)
✔ Issue #59 PR full HEAD scan is promoted to opened Global evidence (30.527777ms)
✔ T604 refuses a live root lock without exposing owner or path diagnostics (44.58971ms)
✔ T604 immediately recovers an unexpired lease only when its owner is confirmed dead (13.519643ms)
✔ T604 never steals an expired descriptor from a live cooperative owner (14.408426ms)
✔ T604 recovers a bounded stale malformed lock without taking a live valid lease (35.021385ms)
✔ T604 bounds fresh zero, truncated, malformed, and future-invalid partial recovery before aging (66.37342ms)
✔ T604 deduplicates pending privacy-safe diagnostics by operation scope (3.268547ms)
✔ T604 fences a detached owner before it can publish after a successor recovery (25.67654ms)
✔ T604 rejects a dead owner's real state publication after a successor publishes newer Context, Global, and manifest (52.001908ms)
✔ T604 cleans an owned partial lease after write, sync, or close acquisition failure (40.314407ms)
✔ T604 uses an owned OS child-process lease and releases it for a successor (483.345475ms)
✔ T604 immediately recovers a killed child lease before its bounded expiry (260.561161ms)
✔ T604 rejects a root-confined snapshot mutation through a symlink or Windows junction (25.202681ms)
✔ T604 retains independent-window Contexts and Global publication under concurrent writes (51.064977ms)
✔ T604 atomically appends independent-window history events (17.881624ms)
✔ T604 cache cleanup retains the published generation and removes superseded immutable files (40.264717ms)
✔ T604 serializes state, history, cache, snapshot cleanup, and startup migration through one explicit custom-store coordinator (235.02541ms)
✔ T604 snapshot cleanup retains a referenced generation and removes expired unreferenced entries (51.423999ms)
✔ T604 snapshot cleanup preserves every active pointer while bounding an unreferenced generation (123.721509ms)
✔ T604 runs production startup recovery against real child writers and restarts from the newer coherent state (381.003959ms)
✔ T604 keeps active snapshots above count and byte limits, publishes through cleanup failure, and converges after restart (189.28629ms)
✔ T604 flushes a terminal startup lock failure through the production feedback composition exactly once (1.176669ms)
✔ T605 chooses exactly the longest matching multi-root URI and preserves remote authority (11.166231ms)
✔ T605 fails closed for URI boundaries and separates workspace storage roots (3.687889ms)
✔ T605 root registry retains typed snapshot and Git-rewrite capabilities (0.636683ms)
✔ T605 IFR001 rejects delayed open, load, and commit from a removed and re-added root generation (1.502515ms)
✔ T605 IFR002 applies one URI eligibility boundary before descriptor routing (2.429233ms)
✔ T605 keeps same-repository roots distinct for Current Context and PR acquisition (0.43648ms)
✔ T605 concrete root composition commits snapshots through reconciliation and survives root-scoped restart (381.99078ms)
✔ T606 classifies retryable, permanent, stale, authentication, and validation failures without raw messages (2.840713ms)
✔ T606 retries only retryable faults with a bounded cancellable sequence (2.706142ms)
✔ T606 never retries authentication, validation, stale, or partial-side-effect failures (0.89234ms)
✔ T606 emits one bounded single-line redacted ERROR and always clears activity (2.318968ms)
✔ T606 makes a handled inner failure terminal exactly once for its shared operation (0.897585ms)
✔ T606 keeps independent concurrent production operations as separate lifecycles (0.610157ms)
✔ T606 joins an actual storage diagnostic to its explicit owner context without a duplicate terminal (0.529242ms)
✔ T606 Review Contexts runtime fences a superseded source publication (18.245183ms)
✔ T606 Review Contexts provider aborts an old root load and never publishes its distinct stale item (1.90459ms)
✔ T606 retries only an actual Review Contexts pure-read runtime operation (27.115564ms)
✔ T606 runs Review Contexts commands through the production registration: read retries, mutations do not (30.573927ms)
✔ T606 passes one explicit feedback context through the production Review Contexts read boundary (5.575608ms)
✔ T606 runs Git executable-missing, nonzero, corruption, and safe.directory outcomes through the LocalGitAdapter boundary (3.846966ms)
✔ T606 preserves the last published repository state when the production persistence adapter sees ENOSPC or EACCES during flush/replace (16.651967ms)
✔ T606 R5 invokes the registered Current Context command through its production composition and records supersede as a typed terminal (10.953575ms)
✔ T606 R5 invokes the registered Global open command with one generic UI error and one redacted terminal (27.86086ms)
✔ T606 R6 Current Context production runtime cross-supersedes refresh/select with one signal owner and one typed terminal (13.046858ms)
✔ T606 R7 absorbs a failed old-root load and preserves the fresh-root stale/unknown transition (9.420135ms)
✔ T606 R7 cache publish mutation records a terminal failure, rethrows to its boundary, and starts no post-mutation refresh (4.829964ms)
✔ T606 R6 cache retries acquisition only, publishes once, and never retries a publish failure (1.673668ms)
✔ T606 IFR001 propagates an actual cache write failure instead of projecting live not-cached success (1.87403ms)
✔ T606 IFR002 fences a pending Node cache write after abort and returns a typed cancellation (6.275884ms)
✔ T606 IFR003 runs the production Global layer toggle through one redacted terminal lifecycle (3.910006ms)
✔ T606 IFR001 republishes the post-cache-publish tree snapshot and fails closed when publication reports failure (0.838047ms)
✔ T606 IFR003 Global open throws once to the shared redacted UI boundary without a raw-error callback (2.084478ms)
✔ T606 IFR003 PR Progress carries its owner and abort signal to pending content I/O, then emits one terminal per cancelled, failed, and successful refresh (10.102256ms)
✔ T606 IFR002 retries only transient result unions through Current Context's cache read port and keeps permanent causes single-attempt (77.863795ms)
✔ T606 IFR002 real T305-to-T405 composition retries only transient acquisition, aborts deep cache I/O, and fences stale publication (292.38813ms)
✔ T305 contributes the Review Range activity container, views, and commands (8.644534ms)
✔ T305 default and focused commands execute the same behavior suites (2.100526ms)
ℹ tests 238
ℹ suites 0
ℹ pass 238
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8582.885425
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-t609

- UTC: 2026-10-06T18:28:03.531048+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:t609`
- Exit: 0; counts={"tests": "92", "pass": "92", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-t609.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t609
> npm run compile:test && node --test test-dist/test/unit/t609-repository-resolution.test.js test-dist/test/unit/t609-review-contexts-repository.test.js test-dist/test/unit/t609-revision-mapping-encoding.test.js test-dist/test/unit/t609-normal-review-followup.test.js test-dist/test/unit/t609-review-contexts-cancellation-boundary.test.js test-dist/test/unit/t609-t405-encoding-composition.test.js test-dist/test/unit/t609-test-review-state-dependent-queue.test.js test-dist/test/unit/t609-gate-wiring.test.js test-dist/test/unit/t609-host-rename-decoration-composition.test.js test-dist/test/unit/review-diff-content-provider.test.js test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/history-rewrite-git-context-integration.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T609 read-only document provider recovers when the actual Git inspection cwd was deleted (100.063497ms)
✔ T609 document decoration recovery propagates noncandidate stat failures (1.860037ms)
✔ Git provider restores each mixed target snapshot layer in one CAS (21.112175ms)
✔ Git provider rejects an invalid present target snapshot without fallback CAS or history (2.171918ms)
✔ Git provider rejects an unreadable present target snapshot without fallback CAS or history (2.195982ms)
✔ Git provider does not publish mixed snapshot state or history after a CAS conflict (4.99194ms)
✔ Git provider records an unresolved mapping event after a conservative missing-object clear (2.719439ms)
✔ Git provider records binary mapping as unresolved instead of a successful remap (4.250182ms)
✔ document sessions map branch commits and isolate branch and detached contexts (4.307105ms)
✔ T609-NR-005 records a generic unresolved history reason for a failed current-revision text refresh (2.2753ms)
✔ document routing recalculates the current Git snapshot when an opened encoding hint changes (4.618829ms)
✔ T609 production Git document session clears a same-revision encoding transition without changing an unrelated BOM file (3.57445ms)
✔ T609-NR-002 aggregates all reopened document hints across mapping and an encoding change (7.930785ms)
✔ document routing follows the stable file ID after a rename (4.189249ms)
✔ new branch initialization maps owner-wide Global state through the debounced repository (175.703877ms)
✔ new branch initialization preserves a concurrent Global update while mapping (210.679609ms)
✔ a poll started at B preserves foreground revision C after its mapping completes (262.466089ms)
✔ document routing distinguishes a renamed file from a new file at its old path (7.976802ms)
✔ document routing excludes a binary rename while routing a new text file at its old path (20.085437ms)
✔ document routing maps an ambiguous rename and copy graph without reusing its source ID (19.513555ms)
✔ Git revision mapper preserves SHA-only reviewed ranges through saved snapshots when the old object is gone (30.846521ms)
✔ Git revision mapper follows one snapshot-backed rename and retains the stable file identity (6.688062ms)
✔ Git revision mapper fails closed when multiple current paths match one saved snapshot (8.182055ms)
✔ Git revision mapper clears a shared file when direct Context and recovered Global disagree (8.003011ms)
✔ T609-NR-003 keeps recoverable files when an opened encoded catalog file is unreadable (14.528016ms)
✔ review diff URI round-trips context, file, semantics, side, source, and revision (3.33432ms)
✔ review diff URIs from different contexts never collide (0.645127ms)
✔ review diff URI decoding rejects non-canonical or malformed inputs deterministically (0.952449ms)
✔ review diff URI encoding rejects invalid descriptor fields (0.312522ms)
✔ content provider restores original and modified revision content (0.841429ms)
✔ content provider reports unavailable and invalid-encoding outcomes with stable codes (0.954186ms)
✔ local Git adapter reads exact streamed text content at a commit (1.022279ms)
✔ local Git adapter accepts an opened Shift-JIS hint only through the VS Code decode boundary (0.49908ms)
✔ local Git adapter isolates unsupported opened encoding instead of accepting decoder fallback text (0.477138ms)
✔ local Git adapter distinguishes missing commits and missing files (0.588555ms)
✔ local Git adapter rejects moving revisions and unsafe repository paths (0.293033ms)
✔ local Git adapter preserves unexpected Git failures (0.375659ms)
✔ T609 gate wires every focused unit suite once and keeps the Extension Host phase separate (16.829469ms)
✔ T609 CI gate invokes the package-owned unit and Extension Host commands once (2.190276ms)
✔ T609 runner prepares both Git fixtures before the Host launches and the Host suite only consumes them (2.199022ms)
✔ T609 multi-root workspace fixture preserves the single-root whitespace and EOL mapping settings exactly once (1.696025ms)
✔ T609 Host fixture separates active-editor lifecycle, command persistence, visible refresh, and Global completion (2.013484ms)
✔ T609 runner owns a 300-second deadline for the single-root phase (1.066221ms)
✔ T609 phase ownership keeps mixed encoding in single-root and repository cancellation in multi-root (3.239288ms)
✔ T609 contract fixtures compile legacy mapping and Review Context runtime shapes once through the focused gate (1.817098ms)
✔ T609 single-root reuses its no-active Current Context selection without an active-editor refresh (2.049045ms)
✔ T609 Host waits for the single handled startup Current Context refresh before its public no-active-editor command (2.951961ms)
✔ T609 multi-root Current Context commands retain their public path without local settle-time wrappers (4.274263ms)
✔ T609 multi-root Review Contexts keeps its public commands and snapshots under the owned phase deadline (1.3838ms)
✔ T609 multi-root Current Context selection clears mapped editors before the public commands (2.123817ms)
✔ T609 Host reaches normal-editor review through its public command (1.116243ms)
✔ T609 runner seeds persisted mapping state before Host activation through production storage (2.168606ms)
✔ T609 mapped Git-transition fixture keeps only per-file-operation deadlines without an overall mapping deadline (1.840279ms)
✔ T609 production activation does not retain the obsolete Test-only mapping seed (1.581296ms)
✔ T609 single-root uses public mixed-encoding marks after startup settlement without making background Test fakes a command gate (4.756148ms)
✔ T609 production composition passes the shared validated mapping settings to Git revision mapping (5.875637ms)
✔ T609 restart reobserves only its active UTF-8 BOM hint without Current Context or Global refresh (3.178114ms)
✔ T609 Host observes actual VS Code URI safety and persisted encoding mapping without Test mutation seams (2.738964ms)
✔ T609 mixed-encoding composition observes persisted Shift-JIS state at every public boundary (1.775849ms)
✔ T609 persisted Git snapshot reads the Current Context owner without mutating state (1.42319ms)
✔ T609 virtual URI boundary commands use the owned single-root deadline (2.01479ms)
✔ T609 live encoding transition re-decodes the open document without waiting for model disposal (1.063981ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":52806,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791311295530.json"}}
✔ T609 deterministic Git fixture commits the raw EOL-only transition used by mapper regressions (174.776451ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":52960,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791311296220.json"}}
✔ T609 production rename decoration composition settles concurrent visible and explicit refreshes (688.339599ms)
✔ T609-NR-008 maps only boolean configuration values for Git and live-edit composition (2.488128ms)
✔ T609-NR-004 never selects the first repository when no-active-editor has multiple candidates (0.722358ms)
✔ T609-NR-004 keeps the accepted Current Context when the ambiguous-root Quick Pick is cancelled (0.471233ms)
✔ T609 resolves a Git workspace without an active Git editor in deterministic source order (6.196922ms)
✔ T609 deduplicates a repository and fails closed for unsafe candidates (4.019359ms)
✔ T609 does not accept a disjoint known-root inspection without canonical identity (0.642365ms)
✔ T609 accepts a disjoint known-root alias only when canonical identities match (1.030682ms)
✔ T609 keeps strict known-root matching for absolute and Windows case-varied paths (1.001056ms)
✔ T609 skips only a candidate-specific stat ENOENT and propagates other failures (2.102566ms)
✔ T609 propagates structured non-Error ENOENT rejection values unchanged (0.410686ms)
✔ T609 compares Windows candidate stat paths without case or separator sensitivity (0.58283ms)
✔ T609 rethrows non-Error rejection values unchanged (0.492105ms)
✔ T609 does not accept a stale known-root inspection that resolves to its parent (0.56956ms)
✔ T609 applies the deepest known boundary separately to each document (0.938894ms)
✔ T609 rejects query, fragment, and mismatched authority before T305 or T405 can use a URI filesystem path (0.63662ms)
✔ T609-NR-004 preserves the existing provider projection for multi-root Quick Pick cancel and stale cancellation (3.781928ms)
✔ T609-NR-004 cancel and stale typed outcomes run one command without terminal reporting, clear, or post-cancel refresh (35.19913ms)
✔ T609 Review Contexts resolves the sole opened Git workspace without an active editor (2.508284ms)
✔ T609 Review Contexts fails closed when multiple roots are cancelled (1.177127ms)
✔ T609 isolates one unsupported encoded file while Context and Global map the other file (18.36922ms)
✔ T609-NR-005 retains a privacy-safe unresolved reason when a current-revision text refresh fails (1.543073ms)
✔ T609 preserves a restart-unopened encoded identity only when the new immutable blob exists but cannot be decoded (6.101416ms)
✔ T609 clears only the changed same-revision encoding intervals while preserving unrelated Context and Global state (2.639337ms)
✔ T609 inherits an opened encoding hint only for a unique rename (3.78636ms)
✔ T609 does not carry an opened hint from a copy or a new file back to its source (4.341765ms)
✔ T609-NR-001 maps an opened Shift-JIS file through the actual T405 new-PR Global composition (218.806189ms)
✔ T609 Test dependent queue names every background dependent and does not make the public command wait (1.929018ms)
✔ T609 Test dependent queue aborts stale fakes and contains their rejection during disposal (0.566655ms)
ℹ tests 92
ℹ suites 0
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1249.937418
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-i116

- UTC: 2026-10-06T18:28:16.382555+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:i116`
- Exit: 0; counts={"tests": "29", "pass": "29", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-i116.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:i116
> npm run compile:test && node --test test-dist/test/unit/issue-116-current-context-refresh.test.js test-dist/test/unit/t609-repository-resolution.test.js test-dist/test/unit/t305-projection-refresh.test.js test-dist/test/unit/review-contexts-runtime-wiring.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ Issue #116 shares duplicate start paths and a returned canonical root within one Current Context generation (3.164084ms)
✔ Issue #116 does not infer an unexamined descendant from another returned root (0.35046ms)
✔ Issue #116 shares active, opened, visible and workspace fallback inspections in one production session (0.565298ms)
✔ Issue #116 reuses accepted Current Context PR preparation for only the immediately dependent Review Contexts refresh (274.83787ms)
✔ Issue #116 discards a failed Current Context preparation and a later generation acquires fresh state (168.53936ms)
✔ T405 contributes Review Contexts activation, commands, and menus (12.768239ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (5.141006ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (3.557253ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (10.613832ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (3.165187ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (4.194986ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (1.626865ms)
✔ PR68-R003 source switch never publishes the previous PR snapshot under the new PR source (2.477867ms)
✔ PR68-R004 PR Progress failure cannot block new-owner decoration Global or Review Contexts refresh (0.439437ms)
✔ PR68-R004 successful edit-state mutation keeps its success when only PR projection refresh fails (0.41723ms)
✔ T610-NR-006 decoration failure cannot block open-document Global reconciliation (0.805801ms)
✔ Issue #84 Review Contexts registers the selected PR before PR Progress starts (0.328414ms)
✔ T609 resolves a Git workspace without an active Git editor in deterministic source order (3.477007ms)
✔ T609 deduplicates a repository and fails closed for unsafe candidates (1.713999ms)
✔ T609 does not accept a disjoint known-root inspection without canonical identity (0.288625ms)
✔ T609 accepts a disjoint known-root alias only when canonical identities match (0.742283ms)
✔ T609 keeps strict known-root matching for absolute and Windows case-varied paths (1.386925ms)
✔ T609 skips only a candidate-specific stat ENOENT and propagates other failures (1.77306ms)
✔ T609 propagates structured non-Error ENOENT rejection values unchanged (0.477086ms)
✔ T609 compares Windows candidate stat paths without case or separator sensitivity (0.695355ms)
✔ T609 rethrows non-Error rejection values unchanged (0.827572ms)
✔ T609 does not accept a stale known-root inspection that resolves to its parent (1.105624ms)
✔ T609 applies the deepest known boundary separately to each document (0.924208ms)
✔ T609 rejects query, fragment, and mismatched authority before T305 or T405 can use a URI filesystem path (0.568163ms)
ℹ tests 29
ℹ suites 0
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 595.415321
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-tooling

- UTC: 2026-10-06T18:28:30.806342+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run test:tooling`
- Exit: 0; counts={"tests": "31", "pass": "31", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-tooling.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:tooling
> node --test test/tooling/*.test.mjs

✔ CI builds the PR HEAD and fetches history before resolving the main branch point (1.589331ms)
✔ CI uses the resolved version in the VSIX and filenames without modifying tracked manifests (0.533248ms)
✔ new regression tests and packaging diagnostics are wired into the required gate (0.414478ms)
✔ failure diagnostics distinguish the tested checkout from the workflow event identity (0.363375ms)
✔ uses the main release at the branch point and exactly seven PR HEAD digits (205.768155ms)
✔ later main releases and unrelated tags do not change the fork version (170.560734ms)
✔ ignores unversioned tags and supports annotated release tags (164.445129ms)
✔ without a reachable release tag reads the branch-point manifest, not PR or current main (168.048317ms)
✔ preserves leading zeroes in a numeric seven-digit hash (4.02269ms)
✔ does not derive identity from GITHUB_SHA or run number (132.514586ms)
✔ rejects packaging a checkout different from the supplied PR HEAD (132.068586ms)
✔ rejects malformed or unavailable SHA inputs without emitting a version (175.281256ms)
✔ rejects invalid branch-point versions and disconnected history (244.053172ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (3.963001ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (11.584822ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (15.412437ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (0.902891ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (2.439036ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (8.970308ms)
✔ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (1.521128ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.383549ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (2.232334ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (0.865476ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (0.595204ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (0.850566ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.364477ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (4.853878ms)
✔ Issue #137 correlates a safe PR Progress lifecycle without serializing private input values (3.317679ms)
✔ production modules use responsibility names, not task-number filenames (10.314145ms)
✔ runtime composition and reusable policies are placed in their owning folders (1.153656ms)
✔ the extension entry point targets the renamed production composition (4.375479ms)
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1523.954744
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### Fresh implementation worker final-architecture

- UTC: 2026-10-06T18:28:32.872044+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; baseline HEAD=9d434c3b8a396d4cf5c1cd568caa0118904a28e8; dirty input source.
- Command: `npm run validate:architecture`
- Exit: 0; counts={}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/final-architecture.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre validate:architecture
> node tools/validate-architecture.mjs

Architecture validation passed.
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


## Fresh implementation worker final handoff preparation

- Mode: review follow-up, accepted remaining NR-001 (P1) / NR-006 (P2); retain previously closed NR-003 (P2) and its safe branch behavior. No self-review verdict or finding closure is issued.
- Workflow: local work-context-manager → implementation-executor → implementation-worker; report-output-manager/report-writer normal verification persistence; narrow progress-sync-manager edits explicitly delegated by parent because the user's parent filesystem-write restriction remains in force. No development-orchestrator re-entry or additional agent was used.
- Repository: ssaattww/RevMem, branch `issue-136-137-refresh-and-safe-diagnostics`, base main, baseline/technical pre-commit HEAD and review-target first parent `9d434c3b8a396d4cf5c1cd568caa0118904a28e8`. Initial dirty implementation/test/report/task changes were retained. No reset, checkout, revert, stash, clean, backward HEAD movement, or reflog recovery occurred.
- Environment: runtime-local Linux machine `15272cf2b322`, bash, absolute cwd `/workspace/RevMem`; `local_execution_available`. Node v24.19.0, npm 11.9.0, git, local TypeScript and ESLint are available and exercised. Existing dependencies only; no dependency/auth/permission/config/environment changes.
- Authoritative requirements: tasks Issue #136/#137 subsection; canonical `doc/design/vscode-review-range-tracker-design.md` §16.2 and its common acquisition / accepted identity / publication contract; H2 R1 findings in the normal review report; parent-supplied R2 lifecycle recovery appended there. Scope stays within PR refresh ownership, safe branch fallback and diagnostic correspondence.
- Commit state at report preparation: `commit_pending` for one normal local review-target commit containing all retained accepted-scope changes plus this follow-up. No administrative attestation commit. Resulting commit SHA is returned in the external handoff after it exists; this report does not require its own future SHA. Push/CI/PR publication/merge/deployment: not requested or performed.

### Finding-by-finding implementation disposition

| Finding | Disposition and actual evidence | Next owner |
| --- | --- | --- |
| NR-001 P1 | Implemented and production-composed Green. Owner cancellation reaches the actual list provider and actual running PR calculation. Both Current Context and Review Contexts owners abort old work when explicit selection starts; obsolete continuation/final publication and same-snapshot wrapper cleanup preserve the newer accepted context/BASE/HEAD tree. A registration with changed BASE after acceptance is rejected before PR activation. Prior delayed failure/cancellation/suppressed-list races remain passing. | Same reviewer verifies the committed target; not closed by this worker |
| NR-003 P2 | Already closed at parent-supplied prior R2 after the reviewer's actual 12-case matrix. Existing dirty branch preservation is retained; actual public Current Context/Review Contexts runtime regression shows the verified branch stays selected/displayed, obsolete real PR progress clears once, and failure remains safe. The exported background boundary now respects the same typed preserved-branch error. No duplicate branch-failure matrix was recreated. | Retain prior closure; same reviewer checks compatibility of new target |
| NR-006 P2 | Implemented and production-composed Green. Actual T405 resolver → explicit accepted selection retains candidate count two. Production extension callback is extracted into `current-context-pull-request-views.ts` and directly exercised, so tests observe its real records. Recompute and explicit identity/current-context stages start/complete with durations; selection/list/registration/progress/publication records carry safe counts and operation-local context/snapshot ordinals from accepted results. Actual accepted file nodes provide final treeItems rather than snapshot-file inference. Twelve T405 cells (unique/ambiguous/no-match/empty/unregistered/failed × both refresh triggers) and supersession records pass without synthetic diagnostic emission. | Same reviewer verifies the committed target; not closed by this worker |

### Changes and retained areas

- `projection-refresh.ts`: stop stale dependent continuations and late selected-progress redraw; preserve independent dependent-view failure isolation.
- `current-context-runtime-coordinator.ts`: one abort controller per owner, accepted immutable identity and accepted publication counts; explicit provenance and recompute/identity/publication stages; safe verified-branch preservation through both entries.
- `vscode-review-contexts-runtime.ts`: link owner cancellation into provider acquisition and fence publication/clear; expose additive optional signal on internal list refresh.
- PR runtime/base: link caller signal through actual progress calculation and fence wrapper cleanup/acceptance by its activation generation. Standalone same-key/same-owner single-flight behavior remains covered by existing suites.
- `extension.ts` + new production composition helper: capture accepted selection rather than reread mutable global selection after awaits, pass owner cancellation through list/PR work, compare context/BASE/HEAD and accepted file-node identity, emit real safe lifecycle/count records.
- Actual production regressions in tooling/T405 test; Issue #116 preparation tests now use the internal `refreshListOnly` production port. Its fixture injects a no-op public shared callback, so the prior use of public `refresh()` did not perform the acquisition being asserted. All acquisition-count assertions remain intact; I116 passes 29/29.
- Prior T405 implementation, review history and command evidence remain preserved. No unrelated task/design/dependency/configuration/file cleanup was performed.

### Final exact-content validation

All checks below returned exit 0 on executable-input fingerprint `f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c`; each command preserved an identical before/after manifest. Full stdout/stderr/exit status are above. Suite overlap exists, so their counts are not summed as independent tests.

| Command | Exit | Result |
| --- | --- | --- |
| npm run compile:test | 0 | test compilation passed |
| node --test test/tooling/issue-136-refresh-coordinator.test.mjs test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/issue-116-current-context-refresh.test.js | 0 | 25/25 |
| npm run lint | 0 | passed |
| npm run build | 0 | passed |
| npm run test:t305 | 0 | 71/71 |
| npm run test:t405 | 0 | 90/90 |
| npm run test:t406 | 0 | 32/32 |
| npm run test:t606 | 0 | 238/238 |
| npm run test:t609 | 0 | 92/92 |
| npm run test:i116 | 0 | 29/29 |
| npm run test:tooling | 0 | 31/31 |
| npm run validate:architecture | 0 | passed |
| git diff --check -- src test tasks reports/issue-136-137-normal-review-20261006.md | 0 | passed |

- Evidence-only whitespace audit: `git diff --no-index --check /dev/null reports/issue-136-137-r2-regressions-20261006.md` returned 3 because verbatim Node assertion output contains whitespace-only formatting lines. The audit output is retained above as well. These report log bytes are intentionally preserved per the full-output requirement; no product/test/tracking whitespace failure is claimed or hidden.
- Extension Host, physical-device UI, npm test/full local equivalence gate, and matching CI were not run. They remain separate held/next-phase work; this local normal review-target commit does not claim final-publication readiness or remote CI success.
- Remaining technical implementation blockers: none. Independent closure/verdict belongs to `/root/issue_136_137_review`; parent will reuse it read-only after this commit. No reviewer was invoked by this implementation worker.

### Final changed source/test content hashes

| Path | SHA-256 |
| --- | --- |
| src/application/review-context/projection-refresh.ts | 1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97 |
| src/composition/current-context/current-context-pull-request-views.ts | 5c7996ee1134de231608360ca59402db9d58840d7e66a281a9eb6c9ef3de7213 |
| src/composition/extension.ts | 94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89 |
| src/composition/pull-request/pull-request-review-runtime-base.ts | 8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f |
| src/composition/pull-request/pull-request-review-runtime.ts | 3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629 |
| src/ui/current-context/current-context-runtime-coordinator.ts | 487a5f55f5f1e2dcfddabf832a28118577f426f0e2cfc5bd616296c496b176df |
| src/ui/review-contexts/vscode-review-contexts-runtime.ts | 2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9 |
| test/tooling/issue-136-refresh-coordinator.test.mjs | 32a97ccff689ea0f393be8a26a263fe4f550adfea9deaace65b8fa20ea655a34 |
| test/unit/issue-116-current-context-refresh.test.ts | 64f8678b1409a2ac224cfa454be627a6f0b97ebbe90d31137fd0188e1745288d |
| test/unit/t405-composition-regression.test.ts | 363240abfbfec02f521869c2ec9948440704058ae8de3a4d4e040c5507e7dfaf |

The I116-only fixture-port correction changed the full input fingerprint from `19df324da2242323128111991d78aa52822387870d8bdf02f05bb875c863e221` to the final fingerprint above. All named checks were rerun on the final content. This is source-bound local evidence; after commit the worker checks each committed input against this manifest and returns the exact commit/parent/worktree state externally.

### Review-target commit preparation audit

- Applied `git-commit-manager` with purpose `review_target` and the parent/user's explicit delegation of this local commit. Its default parent-owned execution rule does not require a second approval of the already delegated action.
- Intentionally staged 14 accepted-scope files. All 423 executable inputs in the Git index match the final validated manifest. Source/test/task/normal-report diff-check passes. Verbatim failure-log whitespace in this regression report remains the disclosed archival exception.
- Narrow canonical tracking changes: `tasks/tasks-status.md` Issues #136/#137 subsection only (current lifecycle/scope and its finding rows); `tasks/phases-status.md` Issue #136/#137 P4 maintenance line only. The unrelated Issue #116 historical phase line is unchanged. Final SHA and post-commit cleanliness are returned externally after the commit exists.


## NR-006 remaining three paths — explicit continuation

- Mode: delegated review follow-up / implementation, no review verdict. Accepted scope: early optional PR acquisition failure/recovery provenance, acquisition-exception identity terminal, explicit-selection publication failure terminal. Current Context and Review Contexts triggers, cancellation/supersession and exactly one safe stage terminal are included.
- Starting HEAD: `5d0320aa037624022494fe877b08e317651b2541`, clean worktree confirmed; branch `issue-136-137-refresh-and-safe-diagnostics`. Preserve all previous commits/evidence; no reset/revert/environment reinitialization. User explicitly authorizes tests, implementation, tracking/report updates and one local review-target commit.
- Requirements: original NR-006 and Issue #137 allowlisted content-free correlated lifecycle diagnostics; retain closed NR-001/002/003/004/005 behaviors. Skills work-context-manager, implementation-worker, implementation-executor, tdd-executor, report-output-manager/report-writer, progress-sync-manager and git-commit-manager apply under narrow parent-delegated write ownership.
- Execution: runtime-local Linux/bash `/workspace/RevMem`; existing Node/npm/TypeScript/ESLint/Git, local_execution_available. Each command below records exact HEAD, committed Git tree, source-only fingerprint and whole executable-input fingerprint before/after, stdout/stderr/exit. Full manifests include file hashes; no secrets/environment dump.
- No new Issue/PR, push, dependency/config/permission/auth changes, merge, external publication, deployment or reviewer invocation. Extension Host/device/CI/full local equivalence gate remain separate held/unrun checks.


### NR-006 remaining-path implementation r3-baseline

- UTC: 2026-10-06T18:44:37.558095+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=aec4f28a44d0fd3876024ff154320f8118d9e16d4e00adc0460a69ff4b6737ca; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test/tooling/issue-137-pr-progress-diagnostics.test.mjs`
- Exit: 0; counts={"tests": "15", "pass": "15", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c; after=f0e022dc2e061c5b4314cfff558b6dd354198a5441b83defd26f06267cdbc35c.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-baseline.manifest.json.

stdout (full):

```text
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (3.990052ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (14.378261ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (12.687292ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (1.494281ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (5.610591ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (10.516487ms)
✔ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (1.515718ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.342558ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (2.067381ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.02077ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (0.572979ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (0.800356ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.416373ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (5.334268ms)
✔ Issue #137 correlates a safe PR Progress lifecycle without serializing private input values (3.601382ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 250.272364
```

stderr (full):

```text
```


### NR-006 remaining-path implementation r3-red-compile

- UTC: 2026-10-06T18:45:33.296595+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=aec4f28a44d0fd3876024ff154320f8118d9e16d4e00adc0460a69ff4b6737ca; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run compile:test`
- Exit: 2; counts={}; source before=00909518441f7a12c51188cb345e5168c3d726332dfd9a695f530b7d51ad8cf1; after=00909518441f7a12c51188cb345e5168c3d726332dfd9a695f530b7d51ad8cf1.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-red-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

test/unit/t405-composition-regression.test.ts(754,121): error TS18048: 'entry.pullRequestRefresh' is possibly 'undefined'.
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

- `r3-red-compile` is a test-authoring compile failure (TS18048), not behavioral Red. Optional diagnostic narrowing corrected before execution; no production source change.


### NR-006 remaining-path implementation r3-red-compile-corrected

- UTC: 2026-10-06T18:45:58.476811+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=aec4f28a44d0fd3876024ff154320f8118d9e16d4e00adc0460a69ff4b6737ca; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=22951bb9faf4b8214a67434d2e6a4a519c93d86c10a489d0612394a3014f2249; after=22951bb9faf4b8214a67434d2e6a4a519c93d86c10a489d0612394a3014f2249.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-red-compile-corrected.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-focused-red

- UTC: 2026-10-06T18:46:20.744337+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=aec4f28a44d0fd3876024ff154320f8118d9e16d4e00adc0460a69ff4b6737ca; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `node --test '--test-name-pattern=T406 executes' test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 1; counts={"tests": "7", "pass": "3", "fail": "4", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=22951bb9faf4b8214a67434d2e6a4a519c93d86c10a489d0612394a3014f2249; after=22951bb9faf4b8214a67434d2e6a4a519c93d86c10a489d0612394a3014f2249.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-focused-red.manifest.json.

stdout (full):

```text
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✖ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (94.304731ms)
  ✖ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (70.193347ms)
  ✖ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (92.458328ms)
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (35.375943ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (159.878514ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1874.048544ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (6019.608659ms)
ℹ tests 7
ℹ suites 0
ℹ pass 3
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6203.361276

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:644:17
✖ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (94.304731ms)
  AssertionError [ERR_ASSERTION]: current-context-refresh: retain the initial failure and recovery cause
  + actual - expected

  + undefined
  - 'verified-branch-preserved'

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:675:34)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:644:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: 'verified-branch-preserved',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test-dist/test/unit/t405-composition-regression.test.js:680:17
✖ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (70.193347ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:695:17)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:680:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: undefined,
    operator: 'rejects',
    diff: 'simple'
  }

test at test-dist/test/unit/t405-composition-regression.test.js:702:17
✖ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (92.458328ms)
  AssertionError [ERR_ASSERTION]: explicit publication failure must close its started stage

  0 !== 1

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:739:30)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:702:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
```

- `r3-focused-red`: early-failure provenance and explicit-publication missing terminal are valid behavioral Red. Acquisition-exception test initially allowed bounded retry to recover after one network failure, so its missing-rejection assertion is a fixture failure, not the intended identity Red. Corrected to exhaust the production 3-attempt retry before asserting identity closure (explicit selection has one acquisition attempt). No production source edits yet.


### NR-006 remaining-path implementation r3-red-retry-compile

- UTC: 2026-10-06T18:46:34.783442+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=aec4f28a44d0fd3876024ff154320f8118d9e16d4e00adc0460a69ff4b6737ca; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=d92a7ebbf129ab714d704f932f4d20802a14391066005b6e0cf3fc76d2ba9c31; after=d92a7ebbf129ab714d704f932f4d20802a14391066005b6e0cf3fc76d2ba9c31.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-red-retry-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-focused-red-corrected

- UTC: 2026-10-06T18:47:01.458290+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=aec4f28a44d0fd3876024ff154320f8118d9e16d4e00adc0460a69ff4b6737ca; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `node --test '--test-name-pattern=T406 executes' test-dist/test/unit/t405-composition-regression.test.js`
- Exit: 1; counts={"tests": "7", "pass": "3", "fail": "4", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=d92a7ebbf129ab714d704f932f4d20802a14391066005b6e0cf3fc76d2ba9c31; after=d92a7ebbf129ab714d704f932f4d20802a14391066005b6e0cf3fc76d2ba9c31.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-focused-red-corrected.manifest.json.

stdout (full):

```text
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✖ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (55.532639ms)
  ✖ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (91.865195ms)
  ✖ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (109.073111ms)
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (52.875774ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (175.493533ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (980.944148ms)
✖ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (4919.692924ms)
ℹ tests 7
ℹ suites 0
ℹ pass 3
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5097.967125

✖ failing tests:

test at test-dist/test/unit/t405-composition-regression.test.js:644:17
✖ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (55.532639ms)
  AssertionError [ERR_ASSERTION]: current-context-refresh: retain the initial failure and recovery cause
  + actual - expected

  + undefined
  - 'verified-branch-preserved'

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:675:34)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:644:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: 'verified-branch-preserved',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test-dist/test/unit/t405-composition-regression.test.js:680:17
✖ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (91.865195ms)
  AssertionError [ERR_ASSERTION]: current-context-refresh: rejected acquisition must close started identity

  0 !== 1

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:698:34)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:680:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test-dist/test/unit/t405-composition-regression.test.js:702:17
✖ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (109.073111ms)
  AssertionError [ERR_ASSERTION]: explicit publication failure must close its started stage

  0 !== 1

      at TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:739:30)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async TestContext.<anonymous> (/workspace/RevMem/test-dist/test/unit/t405-composition-regression.test.js:702:9)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
```


### NR-006 remaining-path implementation r3-green-compile

- UTC: 2026-10-06T18:47:51.907827+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=4d5a61644a3e351fbba6debd210db5ac7b0947c4e5196c4f097cc2e84bab6fe8; after=4d5a61644a3e351fbba6debd210db5ac7b0947c4e5196c4f097cc2e84bab6fe8.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-green-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-focused-green-attempt

- UTC: 2026-10-06T18:48:16.115338+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test/tooling/issue-137-pr-progress-diagnostics.test.mjs test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/issue-116-current-context-refresh.test.js`
- Exit: 1; counts={"tests": "29", "pass": "28", "fail": "1", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=4d5a61644a3e351fbba6debd210db5ac7b0947c4e5196c4f097cc2e84bab6fe8; after=4d5a61644a3e351fbba6debd210db5ac7b0947c4e5196c4f097cc2e84bab6fe8.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-focused-green-attempt.manifest.json.

stdout (full):

```text
✔ Issue #116 shares duplicate start paths and a returned canonical root within one Current Context generation (4.214111ms)
✔ Issue #116 does not infer an unexamined descendant from another returned root (0.410486ms)
✔ Issue #116 shares active, opened, visible and workspace fallback inspections in one production session (0.687223ms)
✔ Issue #116 reuses accepted Current Context PR preparation for only the immediately dependent Review Contexts refresh (376.614408ms)
✔ Issue #116 discards a failed Current Context preparation and a later generation acquires fresh state (172.103893ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (5.17483ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (176.399999ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (109.50126ms)
  ✔ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (167.202854ms)
  ✔ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (96.837546ms)
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (28.763188ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (146.319669ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1045.918103ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (4794.404049ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (4.176324ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (19.836583ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (11.517487ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (1.768052ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (9.098866ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (11.332872ms)
✔ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (2.725578ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.627846ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (3.389252ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.483908ms)
✖ early T405 augmentation failure keeps the verified branch and clears dependent PR state (2.430877ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (1.534518ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.731879ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (10.226756ms)
✔ Issue #137 correlates a safe PR Progress lifecycle without serializing private input values (4.541102ms)
ℹ tests 29
ℹ suites 0
ℹ pass 28
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5184.096538

✖ failing tests:

test at test/tooling/issue-136-refresh-coordinator.test.mjs:376:1
✖ early T405 augmentation failure keeps the verified branch and clears dependent PR state (2.430877ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    [
      {
        context: {
          headRevision: 'verified-head',
          kind: 'branch',
          label: 'checked-out',
  +       pullRequestAcquisition: 'failed-branch-preserved',
          selection: {
            branchRef: 'refs/heads/checked-out',
            kind: 'branch',
            repositoryId: 'opaque-repo',
            repositoryRoot: '/fixture'

      at TestContext.<anonymous> (file:///workspace/RevMem/test/tooling/issue-136-refresh-coordinator.test.mjs:388:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ { context: [Object], progress: undefined } ],
    expected: [ { context: [Object], progress: undefined } ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

stderr (full):

```text
```

- `r3-focused-green-attempt`: new 3 production paths passed; 28/29 overall failed only because old fallback fixture expected no additive safe provenance. Exact expected snapshot updated to include the fixed marker and assert the original branch is not mutated. Additional actual acquisition cancellation/supersession (both entries + explicit selection) and actual PR publication interruption coverage added; this is supplemental Green coverage, not claimed as new Red.


### NR-006 remaining-path implementation r3-final-compile

- UTC: 2026-10-06T18:49:40.459631+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=5a9124b1aedd1689180a6d6fe7110af6acf1a133310dc934ace2c2651c064f66; after=5a9124b1aedd1689180a6d6fe7110af6acf1a133310dc934ace2c2651c064f66.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-final-compile.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-focused-green

- UTC: 2026-10-06T18:50:03.099954+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test/tooling/issue-137-pr-progress-diagnostics.test.mjs test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/issue-116-current-context-refresh.test.js test-dist/test/unit/issue-90-diagnostics-and-cancellation.test.js`
- Exit: 0; counts={"tests": "40", "pass": "40", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=5a9124b1aedd1689180a6d6fe7110af6acf1a133310dc934ace2c2651c064f66; after=5a9124b1aedd1689180a6d6fe7110af6acf1a133310dc934ace2c2651c064f66.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-focused-green.manifest.json.

stdout (full):

```text
✔ Issue #116 shares duplicate start paths and a returned canonical root within one Current Context generation (3.647407ms)
✔ Issue #116 does not infer an unexamined descendant from another returned root (0.523715ms)
✔ Issue #116 shares active, opened, visible and workspace fallback inspections in one production session (0.465575ms)
✔ Issue #116 reuses accepted Current Context PR preparation for only the immediately dependent Review Contexts refresh (611.942101ms)
✔ Issue #116 discards a failed Current Context preparation and a later generation acquires fresh state (217.785449ms)
✔ Issue #90 manifest exposes opt-in detailed diagnostics with a privacy-safe default (37.974232ms)
✔ Issue #90 active status enumerates every operation and detailed mode correlates reason, target, and operation id (6.873047ms)
✔ Issue #90 default diagnostics never emit a supplied file target (1.437447ms)
✔ Issue #137 production formatter preserves refresh payloads and hides queued PR file paths (6.287378ms)
✔ Issue #137 default lifecycle correlates concurrent same-label refreshes by owner operation id (1.661596ms)
✔ Issue #90 superseded work has a cancellation terminal and does not reveal Output as an error (1.001279ms)
✔ Issue #90 cancellation remains a non-error terminal while detailed diagnostics are OFF (0.625615ms)
✔ Issue #90 coalescer cancels the pending stale refresh and flushes exactly one latest reason and file (0.792123ms)
✔ Issue #90 coalescer shares three running requests with the same effective input and supersedes different input (0.492168ms)
✔ Issue #90 PR Progress diagnostics explain a zero denominator per file and in aggregate (0.977906ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (6.089642ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (264.7649ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (122.409205ms)
  ✔ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (169.72329ms)
  ✔ R3 NR-006 interrupted actual T405 acquisition closes every started owner stage once (91.951801ms)
  ✔ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (303.211218ms)
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (24.089704ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (141.886446ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (930.958119ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (5229.390778ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (3.308442ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (12.259306ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (13.096294ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (4.561701ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (4.744405ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (9.259651ms)
✔ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (1.26954ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.611703ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (2.372548ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (0.572534ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (0.72317ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (0.78865ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.797987ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (6.349229ms)
✔ Issue #137 correlates a safe PR Progress lifecycle without serializing private input values (4.331601ms)
ℹ tests 40
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5741.722612
```

stderr (full):

```text
```


### NR-006 remaining-path implementation r3-lint

- UTC: 2026-10-06T18:50:43.415645+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run lint`
- Exit: 1; counts={}; source before=5a9124b1aedd1689180a6d6fe7110af6acf1a133310dc934ace2c2651c064f66; after=5a9124b1aedd1689180a6d6fe7110af6acf1a133310dc934ace2c2651c064f66.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-lint.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre lint
> eslint src test --max-warnings=0


/workspace/RevMem/test/unit/t405-composition-regression.test.ts
  830:13  error  'coordinator' is never reassigned. Use 'const' instead  prefer-const

✖ 1 problem (1 error, 0 warnings)

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

- `r3-lint` exit 1: supplemental test forward declaration violated prefer-const. Replaced it with a const coordinator captured lazily by the actual repository load callback; no product change. Compile and focused Green are rerun on the changed test input before broader checks.
- Parent supplied the read-only same-reviewer chat outcome at reviewed base `5d0320aa037624022494fe877b08e317651b2541`: NR-001 closed, NR-003 closure retained; NR-002/004/005 retain prior R1 closure. There is no persisted report for that review. This implementation report records parent-supplied lifecycle facts without inventing a review report path or issuing a verdict. NR-006 still requires same-reviewer verification of the three addressed paths.


### NR-006 remaining-path implementation r3-final-compile-lint-corrected

- UTC: 2026-10-06T18:51:30.214707+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run compile:test`
- Exit: 0; counts={}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-final-compile-lint-corrected.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-final-focused-green

- UTC: 2026-10-06T18:51:59.958031+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test/tooling/issue-137-pr-progress-diagnostics.test.mjs test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/issue-116-current-context-refresh.test.js test-dist/test/unit/issue-90-diagnostics-and-cancellation.test.js`
- Exit: 0; counts={"tests": "40", "pass": "40", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-final-focused-green.manifest.json.

stdout (full):

```text
✔ Issue #116 shares duplicate start paths and a returned canonical root within one Current Context generation (2.549228ms)
✔ Issue #116 does not infer an unexamined descendant from another returned root (0.983694ms)
✔ Issue #116 shares active, opened, visible and workspace fallback inspections in one production session (0.522903ms)
✔ Issue #116 reuses accepted Current Context PR preparation for only the immediately dependent Review Contexts refresh (378.818575ms)
✔ Issue #116 discards a failed Current Context preparation and a later generation acquires fresh state (180.194657ms)
✔ Issue #90 manifest exposes opt-in detailed diagnostics with a privacy-safe default (14.054459ms)
✔ Issue #90 active status enumerates every operation and detailed mode correlates reason, target, and operation id (7.752547ms)
✔ Issue #90 default diagnostics never emit a supplied file target (1.979772ms)
✔ Issue #137 production formatter preserves refresh payloads and hides queued PR file paths (3.781232ms)
✔ Issue #137 default lifecycle correlates concurrent same-label refreshes by owner operation id (1.304446ms)
✔ Issue #90 superseded work has a cancellation terminal and does not reveal Output as an error (1.000014ms)
✔ Issue #90 cancellation remains a non-error terminal while detailed diagnostics are OFF (0.860642ms)
✔ Issue #90 coalescer cancels the pending stale refresh and flushes exactly one latest reason and file (0.540428ms)
✔ Issue #90 coalescer shares three running requests with the same effective input and supersedes different input (0.770014ms)
✔ Issue #90 PR Progress diagnostics explain a zero denominator per file and in aggregate (0.64844ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (4.577798ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (158.243514ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (121.098463ms)
  ✔ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (175.676506ms)
  ✔ R3 NR-006 interrupted actual T405 acquisition closes every started owner stage once (125.096459ms)
  ✔ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (417.29459ms)
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (25.996193ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (180.673253ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1026.241918ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (5419.869271ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (6.579435ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (19.188366ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (12.389378ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (1.886531ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (6.096017ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (12.079711ms)
✔ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (2.577714ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.522712ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (2.427926ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (0.798151ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (1.030683ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (1.207772ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (1.116485ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (8.583303ms)
✔ Issue #137 correlates a safe PR Progress lifecycle without serializing private input values (4.126473ms)
ℹ tests 40
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5772.898277
```

stderr (full):

```text
```


### NR-006 remaining-path implementation r3-lint

- UTC: 2026-10-06T18:52:08.978141+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run lint`
- Exit: 0; counts={}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-lint.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre lint
> eslint src test --max-warnings=0

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-build

- UTC: 2026-10-06T18:52:19.919688+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run build`
- Exit: 0; counts={}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-build.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre build
> npm run compile


> review-range-tracker@0.0.1-pre compile
> tsc -p tsconfig.json

```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-t305

- UTC: 2026-10-06T18:52:27.519056+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run test:t305`
- Exit: 0; counts={"tests": "71", "pass": "71", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-t305.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t305
> npm run compile:test && node --test test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/t305-validation-wiring.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (5.195916ms)
✔ pull request, branch, and workspace labels are projected consistently (0.339731ms)
✔ branch selection identity remains stable when HEAD advances (0.256996ms)
✔ select applies the authoritative selected snapshot (0.586357ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.630587ms)
✔ selected context identity is applied to the review runtime before decorations refresh (0.477321ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (1.193012ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (3.99151ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (0.907348ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (0.479634ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.134176ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.224947ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.436561ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.648872ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (0.889116ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (177.494923ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (0.680558ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.782927ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.435673ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (1.159867ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (0.96006ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.505819ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (0.716231ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.752345ms)
✔ refresh ignores stale asynchronous snapshots (0.222749ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.369117ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (4.305433ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.591914ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.347821ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (0.872642ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (0.849652ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (0.275176ms)
✔ Global layer toggle does not refresh dependents when persistence fails (0.877016ms)
✔ Global refresh clears stale presentation when the current recalculation fails (0.890979ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (0.825028ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (2.113649ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.426043ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (16.482958ms)
✔ T505-R001 retains immutable open-document evidence after save and close (65.377184ms)
✔ T505-R001 wires change, save, and close events to Global evidence refresh (1.381672ms)
✔ T505-R002 keeps individually valid snapshots when only their combined size exceeds the per-snapshot limit (7.768208ms)
✔ T505-R002 rejects aggregate limits below the per-snapshot limit and never publishes a removed latest snapshot (3.817312ms)
✔ T505-R003 reuses the shared last-valid exclusion policy after an invalid setting (12.594994ms)
✔ T505-R004 invalid snapshot settings fall back without throwing and the manifest caps safe integers (1.178161ms)
✔ T505-R006 focused validation executes the review-finding suite exactly once (1.624584ms)
✔ T505-R007 follow-up handoff uses the required schema v3 top-level packet and preserves the original payload (1.80492ms)
✔ T505-R005 requesting a debounced refresh immediately invalidates the in-flight generation (0.746919ms)
✔ PR69-R001 Global snapshot pins a working-tree open target to the producing owner (10.812952ms)
✔ PR69-R001 PR Global snapshot pins immutable HEAD identity even when the file is absent locally (10.512641ms)
✔ PR69-R001 stale Global nodes reject directly while the registered command owns generic error reporting (23.40257ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (37.431621ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (1.985057ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.371109ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (3.949018ms)
✔ reports start and success while keeping the busy status visible until completion (1.744007ms)
✔ restores the previous operation status after a nested operation finishes (1.066444ms)
✔ logs and reveals failures before rethrowing them (0.887562ms)
✔ records a swallowed diagnostic failure without changing active status (0.258815ms)
✔ formats one-line Output entries without exposing a stack trace (0.595952ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.304228ms)
✔ T405 contributes Review Contexts activation, commands, and menus (6.218832ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (1.259654ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (1.624841ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (2.923754ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (1.86731ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (1.985622ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (4.071927ms)
✔ T305 preserves every pre-existing unit suite exactly once while adding its focused suites (2.684766ms)
✔ Issue #84 registers the selected PR runtime before PR Progress refresh (0.52887ms)
✔ T305 contributes the Review Range activity container, views, and commands (14.406183ms)
✔ T305 default and focused commands execute the same behavior suites (7.064838ms)
ℹ tests 71
ℹ suites 0
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 400.540446
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-t405

- UTC: 2026-10-06T18:52:40.671055+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run test:t405`
- Exit: 0; counts={"tests": "94", "pass": "94", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-t405.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t405
> npm run compile:test && node --test test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-storage.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-pull-request-review-runtime.test.js test-dist/test/unit/t405-review-followup.test.js test-dist/test/unit/t405-revision-evidence.test.js test-dist/test/unit/t405-selected-pr-session.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T405 contributes Review Contexts activation, commands, and menus (10.574015ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (7.135874ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (2.418964ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (6.826156ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (4.829684ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (3.756295ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (1.398927ms)
✔ repository manifest can enumerate every persisted context after restart without deleting or rewriting them (128.976877ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (2.996017ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.246996ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.69958ms)
✔ reports start and success while keeping the busy status visible until completion (2.259347ms)
✔ restores the previous operation status after a nested operation finishes (0.611064ms)
✔ logs and reveals failures before rethrowing them (1.623674ms)
✔ records a swallowed diagnostic failure without changing active status (0.636779ms)
✔ formats one-line Output entries without exposing a stack trace (0.567917ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.743336ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (37.552352ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (2.177576ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (2.812636ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (4.517774ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (0.695401ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (18.187715ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (2.023275ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (0.732542ms)
✔ PR runtime command snapshot survives immutable PR A-to-B-to-A store restoration with hashes (50.225631ms)
✔ R405-3 saved/closed PR opens through the canonical T302 review-range-diff identity (1.178026ms)
✔ R405-3 Review Contexts canonical original/modified commands persist mark and unmark (22.473931ms)
✔ PR runtime command fails closed before commit when persisted hashes do not match authoritative HEAD content (2.232246ms)
✔ PR mutation no-op, cancellation, and failed commit publish neither snapshots nor history (2.993852ms)
✔ R405-5 PR runtime exposes T304 progress for Review Contexts (4.74389ms)
✔ Issue #137 actual T405 PR activation never emits acquired file paths in detailed Output (22.932823ms)
✔ Issue #136 keeps the newest PR Progress refresh when an older read finishes later (4.581048ms)
✔ R405-3 binary PR changes are not opened as text review diffs (1.35321ms)
✔ Issue #59 PR full scan reads complete current-side files once and reuses immutable revision caches (1.817324ms)
✔ PR69-R001 Global PR open uses the exact immutable HEAD document and rejects a superseded head (1.581005ms)
✔ PR Progress original-side selection projects unchanged lines and retains original-only lines atomically (3.236012ms)
✔ PR Progress command rejects an old diff URI pair after BASE or HEAD changes (1.596063ms)
✔ production command routing validates the active immutable diff URI pair before mutation (8.342839ms)
✔ PR runtime persists mark and unmark for added content without a terminal newline (7.678019ms)
✔ PR runtime persists mark and unmark for added LF-terminated content (5.149082ms)
✔ PR runtime persists mark and unmark for deleted content without a terminal newline (3.2976ms)
✔ PR runtime persists mark and unmark for deleted LF-terminated content (2.409641ms)
✔ PR runtime persists mark and unmark for replacement with terminal newlines (3.752316ms)
✔ PR runtime persists mark and unmark for replacement that adds a terminal newline (5.648585ms)
✔ PR runtime persists mark and unmark for replacement that removes a terminal newline (4.286595ms)
✔ PR runtime preserves empty existing files and CRLF content through body-derived line contracts (7.690875ms)
✔ PR runtime treats a terminal display line as outside Git content (1.804809ms)
✔ PR runtime leaves bare CR display fragments outside one-line Git replacements (4.247675ms)
✔ PR runtime rejects truncated, mismatched, and inconsistent local Git hunk evidence before mutation (4.689315ms)
✔ PR runtime hydrates complete legacy-redacted cache hunks and rejects tampered or incomplete evidence (5.337051ms)
✔ PR runtime block mode links both sides while a later side-mode operation stays on the operated side (5.808127ms)
✔ PR runtime block mode expands an original replacement selection to modified Context and Global (2.913962ms)
✔ PR runtime does not read selection mode or open state for an empty selection (0.802081ms)
✔ PR runtime block mark from original commits when only the target revision Global snapshot changes (3.866784ms)
✔ PR runtime block unmark from original commits when only the target revision Global snapshot changes (4.747983ms)
✔ PR runtime block mark from modified commits when only the target revision Global snapshot changes (3.736824ms)
✔ PR runtime block unmark from modified commits when only the target revision Global snapshot changes (5.904211ms)
✔ PR runtime rejects a re-registered comparison while a pending state load is resumed (1.586563ms)
✔ PR runtime rejects old rename URIs and keeps an active command scoped to its PR (2.967164ms)
✔ PR runtime keeps actual repository state atomic through write and CAS failures, restart, and a history failure (298.96531ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (7.587678ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (199.847364ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (115.663981ms)
  ✔ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (168.684318ms)
  ✔ R3 NR-006 interrupted actual T405 acquisition closes every started owner stage once (94.180702ms)
  ✔ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (345.173588ms)
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (35.218044ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (163.319179ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (974.937185ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (5045.825017ms)
✔ R60-001 immutable PR HEAD remains authoritative when the working-tree candidate set omits the file (1.385417ms)
✔ R60-001 Global promotes immutable PR HEAD evidence even when the working tree no longer contains that path (33.549658ms)
✔ R60-003 superseded owner revisions evict retained Global evidence instead of reviving it later (14.363825ms)
✔ R60-002 breaking-change policy supersedes rev4 Global semantics with opened-only and immutable-PR rules (0.773668ms)
✔ PR85-IFR-004 production Review Contexts completion counts stay monotonic across two PRs, retry, and repositories (268.976205ms)
✔ PR85-NR-003 selected PR Progress reports file counts through the production Tree path on immutable-cache hits (2.374164ms)
✔ R405-4 presentation hide applies to current PR, branch, and workspace without deleting state (0.37176ms)
✔ R405-5 Review Contexts projects T304-compatible PR progress (0.225373ms)
✔ R405-5 progress formatter covers zero, partial, and complete PR states (0.121524ms)
✔ T405-IFR-2 keeps cache origin, freshness, and last successful update in the View projection (0.153468ms)
✔ R405-5 Review Contexts Tree renders projected progress to users (2.832552ms)
✔ R405-7 pull-request Current Context identity is stable across rediscovery and not label-derived (0.282075ms)
✔ R405-7/R405-8 current PR is inferred only from persisted open state at the local HEAD (0.436161ms)
✔ R405-7 multiple current-head PRs retain the PR explicitly chosen by redetection (0.215942ms)
✔ Issue #137 selection provenance distinguishes explicit, unique, ambiguous, and missing matches (0.21437ms)
✔ T406-R001 explicit branch selection suppresses one saved open PR at the same immutable HEAD (0.091809ms)
✔ R405-7 redetection persists and reloads explicit current PR identity (5.165738ms)
✔ R405-6/R405-9 remove the dead closed-layer setting and document connected Review Contexts (1.397462ms)
✔ R405-1 revision evidence supplies exact diff and old/new text for tracked files (4.649141ms)
✔ base-only PR transition does not invent a head diff (0.629904ms)
✔ PR evidence loader supplies unchanged Global-only target evidence to the immutable mapper (7.264283ms)
✔ R405-7 selected PR owns normal-editor command and decoration sessions without branch initialization (4.927892ms)
✔ selected PR rejects a foreign repository or stale head without creating state (1.679157ms)
ℹ tests 94
ℹ suites 0
ℹ pass 94
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6103.652291
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-t406

- UTC: 2026-10-06T18:53:01.382991+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run test:t406`
- Exit: 0; counts={"tests": "36", "pass": "36", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-t406.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t406
> npm run compile:test && node --test test-dist/test/integration/mock-github.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-composition-regression.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (96.205666ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (2.506383ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (18.902977ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (4.786818ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (1.098589ms)
✔ GitHub adapter attempts a public API request without authentication (7.897078ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (48.899842ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (12.671597ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (6.771212ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (1.415649ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (2.426957ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.592198ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.313924ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.289171ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (47.021797ms)
✔ local Git diff is the first successful acquisition source (2.30394ms)
✔ GitHub PR files patch is used after local Git is unavailable (0.921151ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (1.202026ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (0.694477ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.26686ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.430671ms)
✔ remote metadata from a different comparison is rejected before content reads (0.238472ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (1.993723ms)
✔ invalid revision input is rejected before invoking local Git (1.019591ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (2.799142ms)
✔ malformed remote file identity fails closed without reading repository contents (1.094228ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (6.330876ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (142.386614ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (126.24549ms)
  ✔ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (176.553044ms)
  ✔ R3 NR-006 interrupted actual T405 acquisition closes every started owner stage once (125.810538ms)
  ✔ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (365.298876ms)
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (31.362394ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (164.992107ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (949.003975ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (5184.34258ms)
ℹ tests 36
ℹ suites 0
ℹ pass 36
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5575.226463
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-t606

- UTC: 2026-10-06T18:53:26.062043+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run test:t606`
- Exit: 0; counts={"tests": "242", "pass": "242", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-t606.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t606
> npm run compile:test && node --test test-dist/test/unit/t606-failure-policy-retry-diagnostics.test.js test-dist/test/unit/t606-production-failure-matrix.test.js test-dist/test/unit/t606-r6-production-matrix.test.js test-dist/test/unit/t606-r6-real-composition.test.js test-dist/test/unit/t606-r5-production-activation.test.js test-dist/test/unit/local-git-adapter.test.js test-dist/test/integration/t302-review-followup.integration.test.js test-dist/test/integration/t402-pr-diff-acquisition.test.js test-dist/test/unit/t405-github-lifecycle.test.js test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/state-repository.test.js test-dist/test/unit/debounced-review-state-repository.test.js test-dist/test/unit/normal-editor-review-command-registration.test.js test-dist/test/unit/current-context-ui.test.js test-dist/test/unit/vscode-current-context-runtime.test.js test-dist/test/unit/review-contexts-runtime-wiring.test.js test-dist/test/unit/review-contexts-ui.test.js test-dist/test/unit/global-understanding-ui.test.js test-dist/test/unit/t505-global-understanding-source.test.js test-dist/test/unit/github-pull-request-cache.test.js test-dist/test/integration/mock-github.test.js test-dist/test/unit/t604-storage-lock-cleanup.test.js test-dist/test/unit/t605-multi-root-remote-boundaries.test.js test-dist/test/unit/ci-workflow-contract.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ mock GitHub server returns fixtures, records requests, and closes (103.043348ms)
✔ GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing (1.965751ms)
✔ GitHub adapter searches open pull requests for the exact HEAD and normalizes the branch point with the same token (31.858193ms)
✔ GitHub adapter follows pagination until an exact HEAD candidate is found (4.915765ms)
✔ GitHub adapter rejects cross-origin pagination before forwarding authentication (2.104953ms)
✔ GitHub adapter attempts a public API request without authentication (6.095662ms)
✔ T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures (25.646939ms)
✔ GitHub adapter classifies rate-limit and API failures as unavailable (3.513761ms)
✔ GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable (4.305177ms)
✔ VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting (1.391203ms)
✔ an Enterprise token is never forwarded to an unconfigured remote authority (0.747518ms)
✔ authentication-provider failures fall back to an unauthenticated request (0.522657ms)
✔ PR resolver auto-selects one candidate and falls back to branch for zero candidates (0.299571ms)
✔ PR resolver asks for multiple candidates and returns branch when selection is cancelled (0.213908ms)
✔ review diff URI round-trip preserves filesystem path semantics (51.41985ms)
✔ review diff URI rejects moving refs and non-canonical repository paths (9.18157ms)
✔ POSIX review diff URI preserves tab, newline, and backslash filename characters (3.376868ms)
✔ Windows review diff URI rejects backslash and control characters (0.425007ms)
✔ fatal revision lookup exit 128 is preserved instead of reported as missing (0.73045ms)
✔ fatal file lookup exit 128 is preserved instead of reported as missing (6.864921ms)
✔ moving refs are rejected before immutable Git content lookup (163.37874ms)
✔ POSIX Git content lookup supports tab, newline, and backslash filenames (119.36706ms)
✔ POSIX Git content lookup supports a filename made only of a newline (159.741394ms)
✔ Git content lookup reads UTF-8 text immediately below and above 4 MiB (374.875469ms)
✔ non-UTF-8 Git blob is rejected deterministically without replacement characters (172.032325ms)
✔ GitHub diff adapter fetches exact PR metadata and paginated file records (52.850143ms)
✔ local Git diff is the first successful acquisition source (3.228884ms)
✔ GitHub PR files patch is used after local Git is unavailable (1.830005ms)
✔ T406 missing GitHub patch falls back to exact base and head file contents (2.327281ms)
✔ an incomplete GitHub patch is rejected and rebuilt from base/head contents (1.131711ms)
✔ all failed routes return no snapshot and never infer reviewed changes (0.507347ms)
✔ GitHub patch parser accepts ordinary context lines while preserving changed coordinates (0.438848ms)
✔ remote metadata from a different comparison is rejected before content reads (0.357564ms)
✔ local Git adapter passes immutable revisions as separate arguments and classifies missing objects (2.152298ms)
✔ invalid revision input is rejected before invoking local Git (1.948493ms)
✔ GitHub raw-content reads bind the exact immutable ref and classify missing files (2.643819ms)
✔ malformed remote file identity fails closed without reading repository contents (0.638623ms)
✔ unit and focused suites execute the integrated design contract (104.15856ms)
✔ document line contract coverage is runnable directly and through the required unit suite (4.818968ms)
✔ unit, npm test, focused CI execute the complete T304 tree contract (4.159163ms)
✔ temporary Git suite executes the T207 history integration scenario (0.994687ms)
✔ T502 focused coverage is runnable locally and included in the default unit suite (2.413265ms)
✔ CI executes positive and negative architecture gates with diagnostic logs (4.926ms)
✔ CI executes the canonical T502 focused command (2.072083ms)
✔ T505 focused coverage executes each dedicated suite once and is required by CI (4.993071ms)
✔ CI diagnostics preserve stdout, stderr, combined logs, and result metadata (1.731063ms)
✔ T506 integration and Extension Host acceptance are exposed as one required focused CI command (5.538708ms)
✔ T406 GitHub failure and recovery integration is exposed by package and CI (2.043416ms)
✔ T605 multi-root and remote workspace boundary coverage is exposed by package and CI (4.192219ms)
✔ T606 focused failure-policy coverage is exposed by package and CI (1.608803ms)
✔ T607 performance workloads remain local-only and never gate CI (3.63212ms)
✔ CI publishes a branch-version-and-HEAD-named VSIX and tracked source archive only after pull-request success (2.79514ms)
✔ required unit gate runs the Issue #90 runtime routing suite before success artifacts (3.92442ms)
✔ required unit gate reaches the Issue #92 PR Progress context-menu contract before success artifacts (1.069819ms)
✔ required CI gates exclude timing-sensitive suites and use deadline-free Extension Host waits (4.743997ms)
✔ required gates keep the T606 wall-clock timeout fixture local-only (1.993744ms)
✔ Issue #136 keeps a verified branch and clears old PR Progress when the refreshed PR list fails (5.814458ms)
✔ pull request, branch, and workspace labels are projected consistently (0.440554ms)
✔ branch selection identity remains stable when HEAD advances (0.475257ms)
✔ select applies the authoritative selected snapshot (0.374234ms)
✔ runtime coordinator refreshes dependents after selected UI is applied (0.539244ms)
✔ selected context identity is applied to the review runtime before decorations refresh (0.388984ms)
✔ refresh replaces a disappeared selected branch identity with the authoritative fallback before dependent refresh (0.790313ms)
✔ production candidate selection resolves accepted Quick Pick, branch replacement, disappearance, and detached identities (0.821555ms)
✔ T609 background recompute never opens a multi-root Quick Pick while an explicit refresh does (1.051619ms)
✔ explicit Current Context selection prepares PR candidates before its Quick Pick without changing background refresh (0.634315ms)
✔ a stale candidate resolution cannot clear a newer explicit selection (0.244224ms)
✔ Current Context does not select an outer candidate when the active document owner is unresolved (0.791189ms)
✔ repository fallback prefers the active non-Git workspace over a retained unrelated Git root (0.407292ms)
✔ deleted owner fallback selects one independent survivor but keeps a nested outer owner unresolved (0.478092ms)
✔ a deleted nested pull-request owner cannot be replaced by its enclosing Git repository (1.644114ms)
✔ production Git candidate and fallback composition keep a normal file on branch or detached runtime ownership (339.299288ms)
✔ Current Context document and workspace inspection skip only their own stat ENOENT (0.816933ms)
✔ Git-unavailable workspace fallback keeps the production candidate Tree Status and runtime selection aligned (0.432044ms)
✔ unexpected workspace Git inspection failures propagate instead of becoming a fallback candidate (0.255624ms)
✔ a Quick Pick choice is not committed when its candidate inventory changes without another controller generation (0.562591ms)
✔ a stale Quick Pick completion cannot replace the accepted explicit selection (0.96994ms)
✔ an accepted zero-candidate refresh clears Tree Status runtime and explicit selection before recovery (0.566411ms)
✔ production composition keeps successful Quick Pick Tree Status command and decoration runtime identity aligned (1.217448ms)
✔ Git refresh failures are reported instead of escaping fire-and-forget activation and editor events (0.718599ms)
✔ refresh ignores stale asynchronous snapshots (0.290725ms)
✔ T606 never retries a Current Context Quick Pick selection after a retryable failure (0.236797ms)
✔ multiple background saves are coalesced and persist only the newest complete snapshot (3.921923ms)
✔ storage kinds remain isolated even when repository and context IDs are identical (0.582493ms)
✔ a confirmation transaction flushes pending background state and commits without waiting for the debounce timer (0.518676ms)
✔ external-file confirmation flushes the external pending state before commit (0.671065ms)
✔ dispose flushes a pending save immediately for Extension Host deactivation (1.13953ms)
✔ dispose waits for an immediate commit queued behind an in-flight load (2.163908ms)
✔ dispose waits for an in-flight owner-wide Global load (8.796288ms)
✔ owner-wide Global load serializes a different context commit (1.141986ms)
✔ Git Global load serializes a pull-request save for the same repository (1.889008ms)
✔ all callers observe a debounced persistence failure instead of receiving a false success (0.980915ms)
✔ live GitHub acquisition stores metadata and a source-redacted diff with explicit timestamps (6.102072ms)
✔ rate-limit failure uses an exact cached PR and marks expired data stale (1.473517ms)
✔ network failure uses an unexpired exact cache and marks it fresh (0.583227ms)
✔ patch fallback followed by network failure still uses an exact cache (1.627209ms)
✔ non-offline API failures do not substitute cached data (0.742922ms)
✔ mixed offline-eligible and API failures do not substitute cached data (0.956181ms)
✔ cache entries are bound to the exact context, repository, PR, base, and head identity (1.318715ms)
✔ filesystem cache publishes metadata and redacted diff through one generation pointer (105.608639ms)
✔ Global Understanding model keeps repository, file, file-count, and exclusion diagnostics separate (3.128835ms)
✔ Global Understanding model retains discovered files without content evidence as uncollected (0.367902ms)
✔ Issue #128 Global Understanding accepts collected line progress for unopened files (0.339487ms)
✔ Global Understanding model accepts sparse open targets for non-openable path-only rows (0.447959ms)
✔ Status Bar co-displays Global progress, opened counts, and exclusion diagnostics (2.652885ms)
✔ Global layer toggle persists the setting before refreshing decoration and Global UI (1.022027ms)
✔ Global layer toggle does not refresh dependents when persistence fails (1.150318ms)
✔ Global refresh clears stale presentation when the current recalculation fails (0.989584ms)
✔ T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published (0.687342ms)
✔ T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh (0.634133ms)
✔ snapshot file-size setting is converted to an independent per-snapshot limit (0.359688ms)
✔ manifest contributes T505 commands and the designed snapshot limit setting (13.165344ms)
✔ Node local Git path normalization propagates stat permission errors unchanged (8.593715ms)
✔ Node local Git path normalization retains only an exact candidate stat ENOENT (9.770843ms)
✔ Node local Git path identity is unavailable when either realpath lookup fails (11.803769ms)
✔ repository inspection uses argument arrays and returns normalized Git identity (66.176626ms)
✔ remote normalization unifies common GitHub URL forms without credentials (5.559776ms)
✔ fork remotes remain distinct repository identities (4.439764ms)
✔ a repository without remotes receives a stable root-derived identity (7.952374ms)
✔ Issue #57 keeps local Git context usable when a listed remote URL cannot be resolved (0.478357ms)
✔ detached HEAD is distinguished while retaining the exact HEAD object (0.440246ms)
✔ Git executable absence and non-repositories are separate outcomes (13.637199ms)
✔ merge-base and object existence use bounded argument-array commands (7.013601ms)
✔ revision arguments that could be parsed as options are rejected (1.97819ms)
✔ registerNormalEditorReviewCommands registers the four designed command IDs (3.348944ms)
✔ registered commands delegate only when an active normal editor exists (1.252639ms)
✔ registered commands reject missing and diff editors without invoking state commands (0.495632ms)
✔ registered commands report a privacy-safe handler failure through the UI host (0.604481ms)
✔ handler failure is recorded as failed operation before the UI host reports it (2.331063ms)
✔ Test-mode command failure is captured by operation and rejects with the original error without waiting for UI (1.265939ms)
✔ applied production handlers await one automatic decoration refresh (0.703233ms)
✔ Test-mode public command settles after state application without an automatic decoration refresh (0.36664ms)
✔ T405 contributes Review Contexts activation, commands, and menus (37.724657ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (20.179158ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (5.716489ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (6.872338ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (5.535095ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (7.754501ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (1.872463ms)
✔ current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR (3.144487ms)
✔ hidden presentation identity filters current and saved contexts without deleting state (0.281711ms)
✔ controller hides only the presentation identity and delegates T405 operations without deleting review state (0.588277ms)
✔ reports start and success while keeping the busy status visible until completion (1.531731ms)
✔ restores the previous operation status after a nested operation finishes (0.684811ms)
✔ logs and reveals failures before rethrowing them (0.997803ms)
✔ records a swallowed diagnostic failure without changing active status (0.33277ms)
✔ formats one-line Output entries without exposing a stack trace (0.420026ms)
✔ does not duplicate the same Error when a UI error boundary reports it again (0.366836ms)
✔ routing separates Git and PR state from non-Git workspace state (15.551965ms)
✔ workspace routing requires ExtensionContext.storageUri (1.422015ms)
✔ repository save commits manifest last and reloads the same context and Global state (143.461707ms)
✔ repository manifest preserves other contexts while atomically advancing one context (195.528087ms)
✔ non-Git state uses workspace-state.json and never writes under globalStorageUri (69.029811ms)
✔ a failed repository manifest replacement preserves disk and memory state (82.37098ms)
✔ a failed workspace replacement preserves disk and memory state (34.42724ms)
✔ schema mismatch is rejected and reported during load (18.180359ms)
✔ save validates manifest, context, Global, target identity before any write (13.826926ms)
✔ concurrent saves retain both context references in the repository manifest (111.232014ms)
✔ save accepts the exact target and context kind mapping (39.576089ms)
✔ save rejects non-matching target and context kinds (12.498203ms)
✔ NodeAtomicTextFileStore replaces a file without leaving temporary files (4.510322ms)
✔ storage-root containment follows the host path semantics without weakening escape rejection (0.65919ms)
✔ NodeAtomicTextFileStore rejects an outside sibling and a symbolic link or junction (4.531135ms)
✔ T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection (3.742427ms)
✔ T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history (216.925205ms)
▶ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation
  ✔ R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance (149.607332ms)
  ✔ R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection (176.766236ms)
  ✔ R3 NR-006 interrupted actual T405 acquisition closes every started owner stage once (147.387366ms)
  ✔ R3 NR-006 actual explicit-selection PR publication failure closes its started stage once (513.111068ms)
  ✔ R2 NR-006 actual T405 recompute closes Current Context and repository identity stages (54.102323ms)
  ✔ R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages (392.898339ms)
  ✔ R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots (1239.733797ms)
✔ T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation (6208.958428ms)
✔ R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity (47.857781ms)
✔ Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip (2.435382ms)
✔ Issue #107 remote PR diff keeps the branch point when the base branch advances (3.924334ms)
✔ Issue #107 private refresh keeps read-only PR progress available across legacy persisted base metadata (6.49656ms)
✔ R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping (0.999134ms)
✔ R405-1 T405 revision update maps B to C, permits layer operation, and survives restart (29.053677ms)
✔ R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF (2.042076ms)
✔ lifecycle adapter classifies rate-limit and network failures without substituting another revision (1.04362ms)
✔ T505 source keeps unopened file contents out of the line denominator while preserving path diagnostics (259.035422ms)
✔ Issue #59 uses only previously opened files for Global line progress and reports unopened files separately (109.809833ms)
✔ Issue #59 PR full HEAD scan is promoted to opened Global evidence (81.029061ms)
✔ T604 refuses a live root lock without exposing owner or path diagnostics (61.219907ms)
✔ T604 immediately recovers an unexpired lease only when its owner is confirmed dead (40.831006ms)
✔ T604 never steals an expired descriptor from a live cooperative owner (37.089946ms)
✔ T604 recovers a bounded stale malformed lock without taking a live valid lease (34.247786ms)
✔ T604 bounds fresh zero, truncated, malformed, and future-invalid partial recovery before aging (74.794901ms)
✔ T604 deduplicates pending privacy-safe diagnostics by operation scope (1.60499ms)
✔ T604 fences a detached owner before it can publish after a successor recovery (61.732952ms)
✔ T604 rejects a dead owner's real state publication after a successor publishes newer Context, Global, and manifest (39.131777ms)
✔ T604 cleans an owned partial lease after write, sync, or close acquisition failure (15.157714ms)
✔ T604 uses an owned OS child-process lease and releases it for a successor (799.901627ms)
✔ T604 immediately recovers a killed child lease before its bounded expiry (283.816666ms)
✔ T604 rejects a root-confined snapshot mutation through a symlink or Windows junction (21.579261ms)
✔ T604 retains independent-window Contexts and Global publication under concurrent writes (92.985892ms)
✔ T604 atomically appends independent-window history events (11.773808ms)
✔ T604 cache cleanup retains the published generation and removes superseded immutable files (40.055863ms)
✔ T604 serializes state, history, cache, snapshot cleanup, and startup migration through one explicit custom-store coordinator (40.633142ms)
✔ T604 snapshot cleanup retains a referenced generation and removes expired unreferenced entries (21.03114ms)
✔ T604 snapshot cleanup preserves every active pointer while bounding an unreferenced generation (45.527303ms)
✔ T604 runs production startup recovery against real child writers and restarts from the newer coherent state (410.958853ms)
✔ T604 keeps active snapshots above count and byte limits, publishes through cleanup failure, and converges after restart (87.796759ms)
✔ T604 flushes a terminal startup lock failure through the production feedback composition exactly once (1.370023ms)
✔ T605 chooses exactly the longest matching multi-root URI and preserves remote authority (5.882638ms)
✔ T605 fails closed for URI boundaries and separates workspace storage roots (1.638165ms)
✔ T605 root registry retains typed snapshot and Git-rewrite capabilities (0.366491ms)
✔ T605 IFR001 rejects delayed open, load, and commit from a removed and re-added root generation (1.851479ms)
✔ T605 IFR002 applies one URI eligibility boundary before descriptor routing (2.006779ms)
✔ T605 keeps same-repository roots distinct for Current Context and PR acquisition (0.305085ms)
✔ T605 concrete root composition commits snapshots through reconciliation and survives root-scoped restart (621.601835ms)
✔ T606 classifies retryable, permanent, stale, authentication, and validation failures without raw messages (1.743275ms)
✔ T606 retries only retryable faults with a bounded cancellable sequence (2.642683ms)
✔ T606 never retries authentication, validation, stale, or partial-side-effect failures (0.735931ms)
✔ T606 emits one bounded single-line redacted ERROR and always clears activity (3.365965ms)
✔ T606 makes a handled inner failure terminal exactly once for its shared operation (1.556212ms)
✔ T606 keeps independent concurrent production operations as separate lifecycles (0.707245ms)
✔ T606 joins an actual storage diagnostic to its explicit owner context without a duplicate terminal (1.123383ms)
✔ T606 Review Contexts runtime fences a superseded source publication (27.217963ms)
✔ T606 Review Contexts provider aborts an old root load and never publishes its distinct stale item (1.492373ms)
✔ T606 retries only an actual Review Contexts pure-read runtime operation (27.272459ms)
✔ T606 runs Review Contexts commands through the production registration: read retries, mutations do not (28.005127ms)
✔ T606 passes one explicit feedback context through the production Review Contexts read boundary (3.371373ms)
✔ T606 runs Git executable-missing, nonzero, corruption, and safe.directory outcomes through the LocalGitAdapter boundary (6.290034ms)
✔ T606 preserves the last published repository state when the production persistence adapter sees ENOSPC or EACCES during flush/replace (30.470976ms)
✔ T606 R5 invokes the registered Current Context command through its production composition and records supersede as a typed terminal (11.747317ms)
✔ T606 R5 invokes the registered Global open command with one generic UI error and one redacted terminal (10.371199ms)
✔ T606 R6 Current Context production runtime cross-supersedes refresh/select with one signal owner and one typed terminal (19.625916ms)
✔ T606 R7 absorbs a failed old-root load and preserves the fresh-root stale/unknown transition (8.267182ms)
✔ T606 R7 cache publish mutation records a terminal failure, rethrows to its boundary, and starts no post-mutation refresh (8.707512ms)
✔ T606 R6 cache retries acquisition only, publishes once, and never retries a publish failure (2.363521ms)
✔ T606 IFR001 propagates an actual cache write failure instead of projecting live not-cached success (0.452788ms)
✔ T606 IFR002 fences a pending Node cache write after abort and returns a typed cancellation (3.779846ms)
✔ T606 IFR003 runs the production Global layer toggle through one redacted terminal lifecycle (5.414793ms)
✔ T606 IFR001 republishes the post-cache-publish tree snapshot and fails closed when publication reports failure (0.731773ms)
✔ T606 IFR003 Global open throws once to the shared redacted UI boundary without a raw-error callback (2.853361ms)
✔ T606 IFR003 PR Progress carries its owner and abort signal to pending content I/O, then emits one terminal per cancelled, failed, and successful refresh (11.130506ms)
✔ T606 IFR002 retries only transient result unions through Current Context's cache read port and keeps permanent causes single-attempt (86.717571ms)
✔ T606 IFR002 real T305-to-T405 composition retries only transient acquisition, aborts deep cache I/O, and fences stale publication (360.978811ms)
✔ T305 contributes the Review Range activity container, views, and commands (10.247978ms)
✔ T305 default and focused commands execute the same behavior suites (2.346141ms)
ℹ tests 242
ℹ suites 0
ℹ pass 242
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8156.663567
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-t609

- UTC: 2026-10-06T18:53:48.095527+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run test:t609`
- Exit: 0; counts={"tests": "92", "pass": "92", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-t609.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:t609
> npm run compile:test && node --test test-dist/test/unit/t609-repository-resolution.test.js test-dist/test/unit/t609-review-contexts-repository.test.js test-dist/test/unit/t609-revision-mapping-encoding.test.js test-dist/test/unit/t609-normal-review-followup.test.js test-dist/test/unit/t609-review-contexts-cancellation-boundary.test.js test-dist/test/unit/t609-t405-encoding-composition.test.js test-dist/test/unit/t609-test-review-state-dependent-queue.test.js test-dist/test/unit/t609-gate-wiring.test.js test-dist/test/unit/t609-host-rename-decoration-composition.test.js test-dist/test/unit/review-diff-content-provider.test.js test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/history-rewrite-git-context-integration.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ T609 read-only document provider recovers when the actual Git inspection cwd was deleted (100.829465ms)
✔ T609 document decoration recovery propagates noncandidate stat failures (4.322085ms)
✔ Git provider restores each mixed target snapshot layer in one CAS (27.0023ms)
✔ Git provider rejects an invalid present target snapshot without fallback CAS or history (3.914034ms)
✔ Git provider rejects an unreadable present target snapshot without fallback CAS or history (3.502981ms)
✔ Git provider does not publish mixed snapshot state or history after a CAS conflict (12.507274ms)
✔ Git provider records an unresolved mapping event after a conservative missing-object clear (2.94864ms)
✔ Git provider records binary mapping as unresolved instead of a successful remap (4.888241ms)
✔ document sessions map branch commits and isolate branch and detached contexts (4.546289ms)
✔ T609-NR-005 records a generic unresolved history reason for a failed current-revision text refresh (3.530785ms)
✔ document routing recalculates the current Git snapshot when an opened encoding hint changes (4.700291ms)
✔ T609 production Git document session clears a same-revision encoding transition without changing an unrelated BOM file (4.789883ms)
✔ T609-NR-002 aggregates all reopened document hints across mapping and an encoding change (16.23713ms)
✔ document routing follows the stable file ID after a rename (4.267672ms)
✔ new branch initialization maps owner-wide Global state through the debounced repository (235.391758ms)
✔ new branch initialization preserves a concurrent Global update while mapping (344.927871ms)
✔ a poll started at B preserves foreground revision C after its mapping completes (296.977125ms)
✔ document routing distinguishes a renamed file from a new file at its old path (9.588671ms)
✔ document routing excludes a binary rename while routing a new text file at its old path (5.452021ms)
✔ document routing maps an ambiguous rename and copy graph without reusing its source ID (4.406602ms)
✔ Git revision mapper preserves SHA-only reviewed ranges through saved snapshots when the old object is gone (32.981784ms)
✔ Git revision mapper follows one snapshot-backed rename and retains the stable file identity (17.86768ms)
✔ Git revision mapper fails closed when multiple current paths match one saved snapshot (12.006334ms)
✔ Git revision mapper clears a shared file when direct Context and recovered Global disagree (11.458282ms)
✔ T609-NR-003 keeps recoverable files when an opened encoded catalog file is unreadable (9.452051ms)
✔ review diff URI round-trips context, file, semantics, side, source, and revision (3.235026ms)
✔ review diff URIs from different contexts never collide (1.012925ms)
✔ review diff URI decoding rejects non-canonical or malformed inputs deterministically (1.675859ms)
✔ review diff URI encoding rejects invalid descriptor fields (0.496844ms)
✔ content provider restores original and modified revision content (1.170197ms)
✔ content provider reports unavailable and invalid-encoding outcomes with stable codes (1.163301ms)
✔ local Git adapter reads exact streamed text content at a commit (1.214729ms)
✔ local Git adapter accepts an opened Shift-JIS hint only through the VS Code decode boundary (1.063315ms)
✔ local Git adapter isolates unsupported opened encoding instead of accepting decoder fallback text (0.455716ms)
✔ local Git adapter distinguishes missing commits and missing files (1.516111ms)
✔ local Git adapter rejects moving revisions and unsafe repository paths (0.477014ms)
✔ local Git adapter preserves unexpected Git failures (0.678749ms)
✔ T609 gate wires every focused unit suite once and keeps the Extension Host phase separate (27.399491ms)
✔ T609 CI gate invokes the package-owned unit and Extension Host commands once (2.053563ms)
✔ T609 runner prepares both Git fixtures before the Host launches and the Host suite only consumes them (4.429179ms)
✔ T609 multi-root workspace fixture preserves the single-root whitespace and EOL mapping settings exactly once (4.044117ms)
✔ T609 Host fixture separates active-editor lifecycle, command persistence, visible refresh, and Global completion (3.33524ms)
✔ T609 runner owns a 300-second deadline for the single-root phase (1.716144ms)
✔ T609 phase ownership keeps mixed encoding in single-root and repository cancellation in multi-root (4.336721ms)
✔ T609 contract fixtures compile legacy mapping and Review Context runtime shapes once through the focused gate (1.907869ms)
✔ T609 single-root reuses its no-active Current Context selection without an active-editor refresh (1.699914ms)
✔ T609 Host waits for the single handled startup Current Context refresh before its public no-active-editor command (4.61059ms)
✔ T609 multi-root Current Context commands retain their public path without local settle-time wrappers (3.111599ms)
✔ T609 multi-root Review Contexts keeps its public commands and snapshots under the owned phase deadline (3.231263ms)
✔ T609 multi-root Current Context selection clears mapped editors before the public commands (2.003592ms)
✔ T609 Host reaches normal-editor review through its public command (1.467504ms)
✔ T609 runner seeds persisted mapping state before Host activation through production storage (1.916129ms)
✔ T609 mapped Git-transition fixture keeps only per-file-operation deadlines without an overall mapping deadline (2.550768ms)
✔ T609 production activation does not retain the obsolete Test-only mapping seed (5.194057ms)
✔ T609 single-root uses public mixed-encoding marks after startup settlement without making background Test fakes a command gate (3.414425ms)
✔ T609 production composition passes the shared validated mapping settings to Git revision mapping (5.475287ms)
✔ T609 restart reobserves only its active UTF-8 BOM hint without Current Context or Global refresh (4.916088ms)
✔ T609 Host observes actual VS Code URI safety and persisted encoding mapping without Test mutation seams (3.782493ms)
✔ T609 mixed-encoding composition observes persisted Shift-JIS state at every public boundary (7.215205ms)
✔ T609 persisted Git snapshot reads the Current Context owner without mutating state (9.869063ms)
✔ T609 virtual URI boundary commands use the owned single-root deadline (2.684882ms)
✔ T609 live encoding transition re-decodes the open document without waiting for model disposal (2.509958ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":64128,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791312844596.json"}}
✔ T609 deterministic Git fixture commits the raw EOL-only transition used by mapper regressions (230.91529ms)
{"extensionHostLaunch":{"phase":"vscode-fixture-cleanup","status":"succeeded","pid":64293,"exitCode":0,"signal":null,"termination":"not-needed","diagnosticPath":"test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1791312845388.json"}}
✔ T609 production rename decoration composition settles concurrent visible and explicit refreshes (789.87533ms)
✔ T609-NR-008 maps only boolean configuration values for Git and live-edit composition (2.232192ms)
✔ T609-NR-004 never selects the first repository when no-active-editor has multiple candidates (1.633456ms)
✔ T609-NR-004 keeps the accepted Current Context when the ambiguous-root Quick Pick is cancelled (0.763674ms)
✔ T609 resolves a Git workspace without an active Git editor in deterministic source order (3.32774ms)
✔ T609 deduplicates a repository and fails closed for unsafe candidates (2.149612ms)
✔ T609 does not accept a disjoint known-root inspection without canonical identity (0.265112ms)
✔ T609 accepts a disjoint known-root alias only when canonical identities match (0.779705ms)
✔ T609 keeps strict known-root matching for absolute and Windows case-varied paths (0.632985ms)
✔ T609 skips only a candidate-specific stat ENOENT and propagates other failures (1.663073ms)
✔ T609 propagates structured non-Error ENOENT rejection values unchanged (3.944505ms)
✔ T609 compares Windows candidate stat paths without case or separator sensitivity (0.672796ms)
✔ T609 rethrows non-Error rejection values unchanged (0.998053ms)
✔ T609 does not accept a stale known-root inspection that resolves to its parent (0.974362ms)
✔ T609 applies the deepest known boundary separately to each document (0.912006ms)
✔ T609 rejects query, fragment, and mismatched authority before T305 or T405 can use a URI filesystem path (0.470332ms)
✔ T609-NR-004 preserves the existing provider projection for multi-root Quick Pick cancel and stale cancellation (2.593573ms)
✔ T609-NR-004 cancel and stale typed outcomes run one command without terminal reporting, clear, or post-cancel refresh (27.545386ms)
✔ T609 Review Contexts resolves the sole opened Git workspace without an active editor (3.03119ms)
✔ T609 Review Contexts fails closed when multiple roots are cancelled (1.205127ms)
✔ T609 isolates one unsupported encoded file while Context and Global map the other file (19.115926ms)
✔ T609-NR-005 retains a privacy-safe unresolved reason when a current-revision text refresh fails (2.87254ms)
✔ T609 preserves a restart-unopened encoded identity only when the new immutable blob exists but cannot be decoded (6.019235ms)
✔ T609 clears only the changed same-revision encoding intervals while preserving unrelated Context and Global state (1.883139ms)
✔ T609 inherits an opened encoding hint only for a unique rename (6.109015ms)
✔ T609 does not carry an opened hint from a copy or a new file back to its source (3.864426ms)
✔ T609-NR-001 maps an opened Shift-JIS file through the actual T405 new-PR Global composition (245.942441ms)
✔ T609 Test dependent queue names every background dependent and does not make the public command wait (2.619968ms)
✔ T609 Test dependent queue aborts stale fakes and contains their rejection during disposal (0.792488ms)
ℹ tests 92
ℹ suites 0
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1477.657124
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-i116

- UTC: 2026-10-06T18:54:05.599823+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run test:i116`
- Exit: 0; counts={"tests": "29", "pass": "29", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-i116.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:i116
> npm run compile:test && node --test test-dist/test/unit/issue-116-current-context-refresh.test.js test-dist/test/unit/t609-repository-resolution.test.js test-dist/test/unit/t305-projection-refresh.test.js test-dist/test/unit/review-contexts-runtime-wiring.test.js


> review-range-tracker@0.0.1-pre compile:test
> tsc -p tsconfig.test.json

✔ Issue #116 shares duplicate start paths and a returned canonical root within one Current Context generation (3.591995ms)
✔ Issue #116 does not infer an unexamined descendant from another returned root (0.299824ms)
✔ Issue #116 shares active, opened, visible and workspace fallback inspections in one production session (0.390446ms)
✔ Issue #116 reuses accepted Current Context PR preparation for only the immediately dependent Review Contexts refresh (345.7395ms)
✔ Issue #116 discards a failed Current Context preparation and a later generation acquires fresh state (189.317073ms)
✔ T405 contributes Review Contexts activation, commands, and menus (24.710328ms)
✔ T405 production entry delegates Review Contexts composition to the T405 runtime boundary (6.319493ms)
✔ Issue #57 maps an existing owner-wide Global revision before publishing a new PR context (5.505246ms)
✔ Issue #63 wires streamed Git output, operation status, and Output diagnostics (17.316284ms)
✔ Issue #63 reports fail-closed PR progress acquisition failures to Output diagnostics (11.821673ms)
✔ R65-005 preserves safe PR progress acquisition attempts and final cause (5.21419ms)
✔ T606 clears stale Review Contexts items and reports a privacy-safe lifecycle failure (3.690485ms)
✔ PR68-R003 source switch never publishes the previous PR snapshot under the new PR source (7.86499ms)
✔ PR68-R004 PR Progress failure cannot block new-owner decoration Global or Review Contexts refresh (3.324925ms)
✔ PR68-R004 successful edit-state mutation keeps its success when only PR projection refresh fails (0.281063ms)
✔ T610-NR-006 decoration failure cannot block open-document Global reconciliation (1.903726ms)
✔ Issue #84 Review Contexts registers the selected PR before PR Progress starts (2.707708ms)
✔ T609 resolves a Git workspace without an active Git editor in deterministic source order (3.642194ms)
✔ T609 deduplicates a repository and fails closed for unsafe candidates (5.160758ms)
✔ T609 does not accept a disjoint known-root inspection without canonical identity (1.749438ms)
✔ T609 accepts a disjoint known-root alias only when canonical identities match (0.919267ms)
✔ T609 keeps strict known-root matching for absolute and Windows case-varied paths (1.521791ms)
✔ T609 skips only a candidate-specific stat ENOENT and propagates other failures (2.813677ms)
✔ T609 propagates structured non-Error ENOENT rejection values unchanged (0.447744ms)
✔ T609 compares Windows candidate stat paths without case or separator sensitivity (0.997546ms)
✔ T609 rethrows non-Error rejection values unchanged (1.88626ms)
✔ T609 does not accept a stale known-root inspection that resolves to its parent (0.905045ms)
✔ T609 applies the deepest known boundary separately to each document (1.740927ms)
✔ T609 rejects query, fragment, and mismatched authority before T305 or T405 can use a URI filesystem path (2.101949ms)
ℹ tests 29
ℹ suites 0
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 826.909875
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-tooling

- UTC: 2026-10-06T18:54:19.576766+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run test:tooling`
- Exit: 0; counts={"tests": "31", "pass": "31", "fail": "0", "cancelled": "0", "skipped": "0", "todo": "0"}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-tooling.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre test:tooling
> node --test test/tooling/*.test.mjs

✔ CI builds the PR HEAD and fetches history before resolving the main branch point (1.63762ms)
✔ CI uses the resolved version in the VSIX and filenames without modifying tracked manifests (0.360719ms)
✔ new regression tests and packaging diagnostics are wired into the required gate (0.39508ms)
✔ failure diagnostics distinguish the tested checkout from the workflow event identity (0.35285ms)
✔ uses the main release at the branch point and exactly seven PR HEAD digits (224.338044ms)
✔ later main releases and unrelated tags do not change the fork version (220.886589ms)
✔ ignores unversioned tags and supports annotated release tags (164.771946ms)
✔ without a reachable release tag reads the branch-point manifest, not PR or current main (160.247689ms)
✔ preserves leading zeroes in a numeric seven-digit hash (2.731489ms)
✔ does not derive identity from GITHUB_SHA or run number (142.693895ms)
✔ rejects packaging a checkout different from the supplied PR HEAD (119.146005ms)
✔ rejects malformed or unavailable SHA inputs without emitting a version (197.534787ms)
✔ rejects invalid branch-point versions and disconnected history (243.803864ms)
✔ Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress (4.031776ms)
✔ R2 NR-001 owning cancellation reaches the actual list provider before publication (25.06309ms)
✔ R2 NR-001 selected progress helper fences its finally publication after supersession (16.069572ms)
✔ R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted (2.04674ms)
✔ R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree (17.74718ms)
✔ R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree (22.300497ms)
✔ R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement (2.26847ms)
✔ a superseded branch-list failure cannot clear a newer successful PR tree (0.895093ms)
✔ R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection (4.606949ms)
✔ a superseded cancelled branch refresh cannot clear a newer explicit PR selection (1.028432ms)
✔ early T405 augmentation failure keeps the verified branch and clears dependent PR state (1.388164ms)
✔ a failed shared PR projection records a failed publication and one failed owner terminal (1.513337ms)
✔ resolved selection provenance flows from the Current Context snapshot into refresh records (0.592409ms)
✔ R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure (8.77829ms)
✔ Issue #137 correlates a safe PR Progress lifecycle without serializing private input values (9.805587ms)
✔ production modules use responsibility names, not task-number filenames (25.000813ms)
✔ runtime composition and reusable policies are placed in their owning folders (1.35076ms)
✔ the extension entry point targets the renamed production composition (3.930074ms)
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1709.639892
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-architecture

- UTC: 2026-10-06T18:54:21.986713+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `npm run validate:architecture`
- Exit: 0; counts={}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-architecture.manifest.json.

stdout (full):

```text

> review-range-tracker@0.0.1-pre validate:architecture
> node tools/validate-architecture.mjs

Architecture validation passed.
```

stderr (full):

```text
npm notice
npm notice New major version of npm available! 11.9.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```


### NR-006 remaining-path implementation r3-code-whitespace

- UTC: 2026-10-06T18:54:23.370321+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `git diff --check -- src test tasks`
- Exit: 0; counts={}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-code-whitespace.manifest.json.

stdout (full):

```text
```

stderr (full):

```text
```


## NR-006 remaining paths — final implementation handoff

- Relevant accepted design: `doc/design/vscode-review-range-tracker-design.md` §16.2 / lines 881–883 (selection, fail-closed identity and safe lifecycle correlation), §17 / line 1067 (acquisition attempts and cause must survive failure/recovery). This is an additive diagnostic fix within that contract, not a breaking behavior change.
- Baseline/prior reviewed HEAD `5d0320aa037624022494fe877b08e317651b2541`, Git tree `ce30a33a161f2b50ccd6e35f4c7b377750793e6d`. Final local review-target commit is `commit_pending`; its first parent will be that preserved HEAD and its resulting SHA will be returned externally. No history restoration or T405 environment initialization.
- All final validation commands ran at that exact HEAD with the recorded implementation/test diff. Source-only fingerprint `ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441`; executable input fingerprint `b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af`; 423 inputs (all tracked/nonignored src/test files plus package/TypeScript config). Every final run recorded equal before/after fingerprints; no source/test edits after final compile/focused or broader checks. Reports/tracking and generated dist/test-dist are excluded deliberately.

### Implementation and actual production coverage

| Remaining NR-006 path | Actual composition | Evidence/disposition |
| --- | --- | --- |
| Early acquisition error lost after branch fallback and subsequent successful list acquisition | Real T405 GitHub lifecycle adapter receives one failing transport; production branch-fallback helper and real Current Context composition/controller accept the verified branch; real list/provider and production dependent-view diagnostic helper then recover under the same owner | Both entry triggers. Timed `pr-acquisition:failed`, fixed `verified-branch-preserved` reason, followed by actual successful list/publication and one successful owner terminal. Initial failure survives recovery. |
| Rejected acquisition leaves repository-identity started | Actual T405 lifecycle/network failures exhaust real bounded retry (3 refresh attempts, 1 explicit selection acquisition), real composition/controller/coordinator reject without dependents | Both refresh entries and explicit selection. All started stages terminate once, with duration, generic failure reason and no raw exception/identity. |
| Explicit selection publication failure leaves tree-publication started | Real resolver supplies 2 candidates and selected accepted immutable snapshot; actual PR runtime uses real registration and a failing repository read, through the same helper used by extension | Timed failed publication with accepted counts and one failed owner terminal. No synthetic metadata or emitted diagnostics. |
| Interrupted acquisition/publication must terminate once | Deferred actual T405 lifecycle fetch and actual PR runtime repository read, external AbortSignal and new explicit/refresh owner | Six acquisition trigger × cancellation/supersession cells; three explicit-publication failure/cancellation/supersession cells. Old stages end once; newer explicit branch and empty tree retained. Privacy assertions inspect actual emitted entries. |

- Source fix: fallback adds only a fixed acquisition marker to a copy of the verified branch; coordinator owns a new allowlisted acquisition span, records recovery provenance, completes pending stages on exceptions/interruption, and suppresses duplicate start/terminal records per generation. Existing immutable identity/cancellation/branch-retention guards remain in place.
- NR-001/002/003/004/005 remain closed per the parent-supplied read-only same-reviewer chat lifecycle at 5d0320 (NR-001 closed, NR-003 retained, 002/004/005 prior R1). Focused actual owner/list/PR-runtime races, both-entry branch retention, Issue #90/#137 privacy/formatter/correlation and failed publication regressions pass. This worker does not issue a review verdict. NR-006 implementation is Green; reviewer closure is pending.

### Red and Green

- Valid corrected Red command: `node --test '--test-name-pattern=T406 executes' test-dist/test/unit/t405-composition-regression.test.js`: exit 1, 3/7 pass, 4 failures including the parent aggregate; all 3 new child paths failed on unchanged production source fingerprint `aec4f28a44d0fd3876024ff154320f8118d9e16d4e00adc0460a69ff4b6737ca`, executable input `d92a7ebbf129ab714d704f932f4d20802a14391066005b6e0cf3fc76d2ba9c31`. This is actual behavioral Red, unlike the disclosed fixture/compile errors.
- Final compile: `npm run compile:test` exit 0. Final focused command `node --test test/tooling/issue-136-refresh-coordinator.test.mjs test/tooling/issue-137-pr-progress-diagnostics.test.mjs test-dist/test/unit/t405-composition-regression.test.js test-dist/test/unit/issue-116-current-context-refresh.test.js test-dist/test/unit/issue-90-diagnostics-and-cancellation.test.js`: 40/40, exit 0.
- Broader on the same final input: lint/build exit 0; T305 71/71, T405 94/94, T406 36/36, T606 242/242, T609 92/92, I116 29/29, tooling 31/31; architecture and source/test/tracking whitespace checks exit 0. Suites overlap; counts are not additive independent-case totals.
- Exact stdout/stderr/exit/HEAD/tree/source/input hashes for every Red/Green and unsuccessful authoring/lint attempt are retained above. First compile TS18048, initial acquisition fixture retry recovery, old fallback snapshot expectation, and prefer-const lint failure are disclosed as corrections, not valid intended Red or omitted results.
- Raw command transcripts preserve original assertion whitespace, as required; whole-report whitespace is an archival exception inherited from this report's previous evidence policy, not a passing formatting claim. Code/test/tracking whitespace checks pass.

### Persistence and next action

- Changed source/test paths: operation-feedback.ts allowlists; current-context-runtime-composition.ts safe fallback marker; current-context-ui-controller.ts additive descriptor; current-context-runtime-coordinator.ts acquisition/exception lifecycle; t405-composition-regression.test.ts real production cells; tooling coordinator fixture adds marker/immutability expectation. No unrelated source, config, dependency or task changes.
- Tracking updates confined to Issue #136/#137 task subsection and its P4 current-position line. Prior reports and all previous evidence are retained unchanged before the append.
- After commit, compare every committed executable input against this full manifest and rerun the focused command read-only on exact HEAD. Record that future commit SHA, committed tree, replay output and clean-worktree diff externally in the implementation handoff and `/tmp/i136-r2-evidence/r3-postcommit.md`; the repository report cannot name its own future commit. That post-commit record is not claimed as already completed here.
- No technical blocker. Next action: parent dispatches the existing same reviewer read-only for NR-006 bounded fix verification. No review verdict, new Issue/PR, push, CI, publication, merge, deployment or environment/config/auth/permission change. Extension Host, physical device/UI and full local equivalence gate remain held/unrun and are not represented by these focused/broader results.

### Per-state changed source/test hashes


r3-baseline

```text
5cf61ba54450a8f08656e29e07a95a2cf790820dd3b58c0b596857259f33532e  src/application/operation-feedback/operation-feedback.ts
a6a1cab31adc01c493307785b48862eae1d73acd9014a9e02376050a23378026  src/ui/current-context/current-context-runtime-composition.ts
487a5f55f5f1e2dcfddabf832a28118577f426f0e2cfc5bd616296c496b176df  src/ui/current-context/current-context-runtime-coordinator.ts
457076a9ed14dfa3665890134bb9474392ccf8d5f007728d7ec27a8c78d0b929  src/ui/current-context/current-context-ui-controller.ts
32a97ccff689ea0f393be8a26a263fe4f550adfea9deaace65b8fa20ea655a34  test/tooling/issue-136-refresh-coordinator.test.mjs
363240abfbfec02f521869c2ec9948440704058ae8de3a4d4e040c5507e7dfaf  test/unit/t405-composition-regression.test.ts
```

r3-red-compile

```text
5cf61ba54450a8f08656e29e07a95a2cf790820dd3b58c0b596857259f33532e  src/application/operation-feedback/operation-feedback.ts
a6a1cab31adc01c493307785b48862eae1d73acd9014a9e02376050a23378026  src/ui/current-context/current-context-runtime-composition.ts
487a5f55f5f1e2dcfddabf832a28118577f426f0e2cfc5bd616296c496b176df  src/ui/current-context/current-context-runtime-coordinator.ts
457076a9ed14dfa3665890134bb9474392ccf8d5f007728d7ec27a8c78d0b929  src/ui/current-context/current-context-ui-controller.ts
32a97ccff689ea0f393be8a26a263fe4f550adfea9deaace65b8fa20ea655a34  test/tooling/issue-136-refresh-coordinator.test.mjs
66b3b0afdcf81fd415295d8b8b29fa34e760a0dbabb9683bd6b8e67944bb5e4a  test/unit/t405-composition-regression.test.ts
```

r3-red-compile-corrected

```text
5cf61ba54450a8f08656e29e07a95a2cf790820dd3b58c0b596857259f33532e  src/application/operation-feedback/operation-feedback.ts
a6a1cab31adc01c493307785b48862eae1d73acd9014a9e02376050a23378026  src/ui/current-context/current-context-runtime-composition.ts
487a5f55f5f1e2dcfddabf832a28118577f426f0e2cfc5bd616296c496b176df  src/ui/current-context/current-context-runtime-coordinator.ts
457076a9ed14dfa3665890134bb9474392ccf8d5f007728d7ec27a8c78d0b929  src/ui/current-context/current-context-ui-controller.ts
32a97ccff689ea0f393be8a26a263fe4f550adfea9deaace65b8fa20ea655a34  test/tooling/issue-136-refresh-coordinator.test.mjs
20a88b355193c036783a24fe9d4faa6b6fddc76d4f03cdf215645a0b06b446f1  test/unit/t405-composition-regression.test.ts
```

r3-red-retry-compile

```text
5cf61ba54450a8f08656e29e07a95a2cf790820dd3b58c0b596857259f33532e  src/application/operation-feedback/operation-feedback.ts
a6a1cab31adc01c493307785b48862eae1d73acd9014a9e02376050a23378026  src/ui/current-context/current-context-runtime-composition.ts
487a5f55f5f1e2dcfddabf832a28118577f426f0e2cfc5bd616296c496b176df  src/ui/current-context/current-context-runtime-coordinator.ts
457076a9ed14dfa3665890134bb9474392ccf8d5f007728d7ec27a8c78d0b929  src/ui/current-context/current-context-ui-controller.ts
32a97ccff689ea0f393be8a26a263fe4f550adfea9deaace65b8fa20ea655a34  test/tooling/issue-136-refresh-coordinator.test.mjs
8e70c9d7493c3f8c0592909871bd254e0e584277883e9254ad06581f11776d52  test/unit/t405-composition-regression.test.ts
```

r3-green-compile

```text
87049c843b6c9b06773ef2f84f2cf521902b6ff638d7d6b0e6c93fc7c591452c  src/application/operation-feedback/operation-feedback.ts
c38ac2be88b3238b06013d3209fd503c9507ea012881ac4605be652ef968e1b7  src/ui/current-context/current-context-runtime-composition.ts
a58fe8331199679aac131806038588380c3c5f6e2b7bfbb99579d14b5c52063c  src/ui/current-context/current-context-runtime-coordinator.ts
f8083000e5f24358dcf0bf216bbdd7d80805e5368a5e9c459e9500393b560f51  src/ui/current-context/current-context-ui-controller.ts
32a97ccff689ea0f393be8a26a263fe4f550adfea9deaace65b8fa20ea655a34  test/tooling/issue-136-refresh-coordinator.test.mjs
8e70c9d7493c3f8c0592909871bd254e0e584277883e9254ad06581f11776d52  test/unit/t405-composition-regression.test.ts
```

r3-final-compile

```text
87049c843b6c9b06773ef2f84f2cf521902b6ff638d7d6b0e6c93fc7c591452c  src/application/operation-feedback/operation-feedback.ts
c38ac2be88b3238b06013d3209fd503c9507ea012881ac4605be652ef968e1b7  src/ui/current-context/current-context-runtime-composition.ts
a58fe8331199679aac131806038588380c3c5f6e2b7bfbb99579d14b5c52063c  src/ui/current-context/current-context-runtime-coordinator.ts
f8083000e5f24358dcf0bf216bbdd7d80805e5368a5e9c459e9500393b560f51  src/ui/current-context/current-context-ui-controller.ts
725da217d92991864126e06619492240df04a265370a5a78b23553d149e88294  test/tooling/issue-136-refresh-coordinator.test.mjs
5bb05f1f40eae8f96e534c436702f6075881a2578ed6fa6968214fdab7ccb371  test/unit/t405-composition-regression.test.ts
```

r3-final-focused-green

```text
87049c843b6c9b06773ef2f84f2cf521902b6ff638d7d6b0e6c93fc7c591452c  src/application/operation-feedback/operation-feedback.ts
c38ac2be88b3238b06013d3209fd503c9507ea012881ac4605be652ef968e1b7  src/ui/current-context/current-context-runtime-composition.ts
a58fe8331199679aac131806038588380c3c5f6e2b7bfbb99579d14b5c52063c  src/ui/current-context/current-context-runtime-coordinator.ts
f8083000e5f24358dcf0bf216bbdd7d80805e5368a5e9c459e9500393b560f51  src/ui/current-context/current-context-ui-controller.ts
725da217d92991864126e06619492240df04a265370a5a78b23553d149e88294  test/tooling/issue-136-refresh-coordinator.test.mjs
d528b8dc5b05eadfa7e57ee594d489bb525156bf65154be20b3403ffb766d02c  test/unit/t405-composition-regression.test.ts
```

### Full final executable input manifest

```json
{
  "package-lock.json": "3e7611244b1729f3d701b60a726b69dcc630f8e0fb1fd945018ca9e74845a3b4",
  "package.json": "e4297bfb1912aaa40d2cc283de4caf0a9d1e30c747e0b662920261c390dbfe34",
  "src/adapters/crypto/index.ts": "b041e3d549d8a6510b9ff6b8f4d6390c126c598e58fb2fe4ea20b511dfde7511",
  "src/adapters/crypto/node-sha256-stable-hash.ts": "1ea48307b2d1abc5dd8761a7630fa7bce6e3ea0657e763f7fe6b79a3c22f3437",
  "src/adapters/diff-document/index.ts": "427a1f71a75e2db4d5501f07f2684704d6b9c6e17d92b40b00bf38a8c4cd6680",
  "src/adapters/diff-document/local-git-revision-text-content-source.ts": "f7522bf2b9c65caa815d4186586b31258416e846f70c3519d51ff18c1cbbd338",
  "src/adapters/document-review-state/document-review-state-session-provider.ts": "ed8fc6a77df43487f5c4495d17d7239f1095832483e40c833eef42d648529904",
  "src/adapters/document-review-state/git-context-document-review-state-session-provider.ts": "d00ae98e3b1c53cf9b27159a2de1644654d0cc7944601961faa60a7ca6dcd285",
  "src/adapters/document-review-state/index.ts": "024b133ee6681c926ae0e95ea228fd28ae8fcfc337379689ece3586552734339",
  "src/adapters/document-review-state/persisted-document-review-state-session-provider.ts": "769f0c585f223865f5c9819749dfeaf86b65cf3a37545543d2090d99bc380873",
  "src/adapters/document-review-state/reconciled-document-review-state-session-provider.ts": "d6d85672c5608887067618ecbdb5816fb6bf1d20680d44c68ae109f667449439",
  "src/adapters/file-exclusion/index.ts": "7d1460ef47ba14d9523948c2abb0629daaf89d752686dc423b8a798d3eeac7a9",
  "src/adapters/file-exclusion/review-file-exclusion-configuration-controller.ts": "a34c8e8dbcf3e06426414a556c0ddb8d6a095ddbd42facb5ea4fff9897a232c6",
  "src/adapters/github/fetch-github-pull-request-adapter.ts": "d7818e593f3ceb8acffe39b77d0fea88c692c70275b6023379e023e866a7971c",
  "src/adapters/github/fetch-github-pull-request-diff-adapter.ts": "822cb378241f1bc2d8eb3aad482af7a6089a78489dbcf5ac8dfb48d08d5d5472",
  "src/adapters/github/fetch-github-pull-request-lifecycle-adapter.ts": "a3331abe7e157fecdce3b024c8c20d38fd6cd015d996e432717c9515a7fbb9fb",
  "src/adapters/github/fetch-github-pull-request-merge-base.ts": "03176a3711ad4b428efb77703937de5cd3f0872d86923a04870be1e8a4fa9d63",
  "src/adapters/github/git-remote.ts": "52eac79b57ad47c4b4b54771da315256e7c22d92af447a0ba744bc244bb8f998",
  "src/adapters/github/index.ts": "dfecbb1cc9bfed207a7261ee6fccff54857c2d3933ae89bcfa035c7a2ab2e53b",
  "src/adapters/github/node-github-pull-request-cache-storage.ts": "37912bf3f41762e9e3301852ddcc809fffacf7b6673883717c7fc70b2c372b1d",
  "src/adapters/github/node-github-pull-request-context-layer-store.ts": "4044be672fdda368036b8a9bd9820fd7e0996390e755478cef5dcf8f274bbe90",
  "src/adapters/github/vscode-github-authentication-provider.ts": "ba73122eb784d39079fd41ea7085a336da0b811ddca3298cf62cd86c66fb839c",
  "src/adapters/index.ts": "c4190e615f4cb1bb38e3960e8865e07260e1e668b817fb8125f513e9af47169e",
  "src/adapters/local-git/contracts.ts": "49402098caddff1124905fc6cc0fa55520fd09ef17709df6adfd1a318889205f",
  "src/adapters/local-git/git-blob-reader.ts": "7abce1a471c421cf00dc3d137e67e40b029b3f272ed5b64160278b3441edd5d2",
  "src/adapters/local-git/git-inspection-start-path.ts": "ebb5a794cb7a9c09a474d8956fb08c28f09b46e1046ed6b2e1ee0895500a229c",
  "src/adapters/local-git/git-remote-normalization.ts": "1a150559c8b7ab1d9fdb28d94dcd817a5dd28b83d36ebd18b74ba5bbb8160ff1",
  "src/adapters/local-git/history-rewrite-local-git-adapter.ts": "cda77618870568c4fbdd1dd162fc53d98dcbc609b91c03698c985ebe4881d402",
  "src/adapters/local-git/index.ts": "e589d71b94f005c232dc73b391fdb4f1184ce4852454c0fb539c20401af5fe30",
  "src/adapters/local-git/local-git-adapter.ts": "5cadec25484fbd5e217b09e8086c5b8d892dec0acc528fcdd94fdbb70d44822a",
  "src/adapters/local-git/local-git-pull-request-diff-adapter.ts": "57ff3a12e0971edf96909cf5f6d3faf9702c633db7f193b69fda2a27ede669c5",
  "src/adapters/local-git/node-git-blob-reader.ts": "c0518bfda1c671907a9aaba57840a93a523059c0139082487840764ef7572f72",
  "src/adapters/local-git/node-git-command-executor.ts": "4d7f5b0f03d538c2588e642da311f56d8bcce93100b1c6e12b09b84a8b5985ec",
  "src/adapters/local-git/node-local-git-adapter.ts": "f8f899135909ba6d7e353aa1022c1825849e43cd8eaf841d54d6bb3ea98cf7c1",
  "src/adapters/local-git/revision-text-content.ts": "89c8d1ac38659eba7c363e6950e5f00fa8f6c9be4c5a1ee7141f12232e528c2f",
  "src/adapters/non-git-snapshots/index.ts": "4c3720a7b28c0682f78f4dbb7c9cd8653ae593afc7f7987b29d6e9a0cba3e2ca",
  "src/adapters/non-git-snapshots/node-non-git-snapshot-adapters.ts": "ef1d6a6119d6779ea7864584b1f679597459598f8bb4d0cce8be7e85ea0a9892",
  "src/adapters/persistence-startup-migration.ts": "7c1af729bbde44a52ba052ac7f1e850fcfe6afabb5e43c7398aa1195193a3952",
  "src/adapters/repository-files/node-global-understanding-file-source.ts": "5dbc37897c43957b057d0efd7c474bc2531d552dd5ef187cbdb0ade50f3f0df6",
  "src/adapters/repository-files/node-repository-file-enumerator.ts": "29a88700bb9c8d9f6f1b66ccd7dee40ef29786ee5309d38b093cbe13491cf0d5",
  "src/adapters/repository-files/node-repository-file-path-enumerator.ts": "90c50aea31f631086f177253cd496615fac97818b94f014627a591ab5d545898",
  "src/adapters/state-repository/atomic-text-file-store.ts": "c62701350ac3fdee0b591798ee4088c3a51e3486782baf2f2fb58a8b7c341419",
  "src/adapters/state-repository/coherent-file-system-review-state-repository.ts": "5a3b637367ab058c909a9d188b6eff50cdfc97960408e0c49910b3993c878116",
  "src/adapters/state-repository/contracts.ts": "003f87f33972e4f8ed55237091b9c009174b4eb48e0a047a6e6061c4f1aee5ae",
  "src/adapters/state-repository/debounced-review-state-repository.ts": "4a79c2bca2efcdfa237d4d8c232945d2890ee33151a37844304002b214490e28",
  "src/adapters/state-repository/file-system-review-state-repository.ts": "97fdee4ae79a54c97b3ce33207a897bb015b59e87256f8d8f435fa8662714286",
  "src/adapters/state-repository/index.ts": "689069ef4b133e8673fbccfd9c92ce0a7c1c2fa5febec9110996e4e627dba335",
  "src/adapters/state-repository/jsonl-review-history-store.ts": "bac756a67d6ea22ea4ff880976836ef97dce1634a9831204a7a73aa579bbf1b6",
  "src/adapters/state-repository/node-folder-understanding-stopped-store.ts": "61a67b84f4bfce363dad37dcd95c7e14db520b03768a08cf18930cedf55d8f4d",
  "src/adapters/state-repository/owner-atomic-review-state-repository.ts": "4fa64540836c4b47528fe558a8a6eba7af8095102bf089417b57d21f7c2eb325",
  "src/adapters/state-repository/owner-aware-debounced-review-state-repository.ts": "90fd9bf854fa8fce5588d9db536043f53a16bce7e6df350410f84fd68973d0a3",
  "src/adapters/state-repository/owner-global-state-loader.ts": "5cad59c66690442b2f2cacaa52982b43121f535443d55f85a343a1c5253a1f88",
  "src/adapters/state-repository/owner-reconciliation-validation.ts": "747ce06572030fc6c1d8ae3d0ced1fc517d113f349aa8e4afc208f783a573f0a",
  "src/adapters/state-repository/persistence-schema-recovery.ts": "d8f9f75f5aa42052e50f11d6d574fb224be8bea742cbc4e5284425c7b584bec0",
  "src/adapters/state-repository/repository-context-catalog.ts": "c00b6f718efc00ba55ccfe38f9ffbc8646baa930f05d7e30100a9f62aa259efb",
  "src/adapters/state-repository/storage-root-lock.ts": "96be85427c685308b6376cee15e2144c29396ed7b06c7198d750634c04afe6f6",
  "src/adapters/state-repository/storage-router.ts": "a47666aea51540201e068a332b6b1f427f182ddc0aadda31111df2f61c263385",
  "src/adapters/state-repository/validated-file-system-review-state-repository.ts": "997bb8f63343c322e68b66dcd017b5b11ee1e60431c57500b3b6276f0a4eb6e1",
  "src/adapters/workspace-review-state/index.ts": "81c458c638ce8ec2371055d538522f13fee30ac9043ff0c5e63aaac8bd328ce5",
  "src/adapters/workspace-review-state/snapshot-tracking-workspace-review-state-session-provider.ts": "fdc5676793da674aabee6c070f9010ae851d9b7f89101d991bd165f3f88ef0ff",
  "src/adapters/workspace-review-state/workspace-review-state-session-provider.ts": "19367648569592082113dbd303cf7fe183004e4fd0074d96d8ed236601d0acab",
  "src/adapters/workspace-review-state/workspace-root-runtime-registry.ts": "60d98916afa918037764bb86ff8dd9af1179c62802338760b07149e3390b5580",
  "src/application/configuration/index.ts": "18d7872940310c4a812de5df038c05172716790473ba8e6b78fa5ea56f303305",
  "src/application/configuration/review-range-configuration.ts": "1091413a125654cdc2d2eabcd2c4ba17fb4bdb6a9f85dd1443f9f5d3f8172b24",
  "src/application/configuration/review-range-mapping-options.ts": "3065cb84dbaa09cfc8224482780818eedfe8b57c3835a276df86596aae314f99",
  "src/application/diff-document/contracts.ts": "8d37434909e2a83b6111d5d6246688a2b7914336706e90c369ca7eb4c6374b5c",
  "src/application/diff-document/index.ts": "417e34fedbb57ea26800230f305cda20a7966005f6ab721410c58f2bd28ec8a3",
  "src/application/diff-document/review-diff-uri-codec.ts": "8ce3667b86e4a0807acb569a145e6d2e9f64441d464bab9cc120ef812f614c2b",
  "src/application/diff-document/revision-text-content-provider.ts": "ba21c4a2523cf5bb1ea607a761f4c085b3be856b2619e6b5c2f41682ce719dc0",
  "src/application/editor-decoration/index.ts": "28c16eb76b250c855364447289466b1904993e5d379fc448ebdd2407e769ec75",
  "src/application/editor-decoration/normal-editor-decoration-model.ts": "d0602420f2b343176e3ea07fdf2675828f5bf8d1840c30f583d7867df1d473f6",
  "src/application/file-exclusion/index.ts": "c0cd5c2fc3fbc719765443b901485fa6a8b6fce1cb9bdd77531c47fbb092ef98",
  "src/application/file-exclusion/review-file-exclusion-policy-service.ts": "c149077c6a798b1d56af2a7cbdf4d412db3e0d31de9b71d0a4968eccb6af4cc0",
  "src/application/github-pr-cache/cache-entry.ts": "94d2120648f0b5c68d8be203ee366fd37030af252b78ad7afb95dcf8e106e6f9",
  "src/application/github-pr-cache/contracts.ts": "130d571759f0cf623fe6384da112f29689f204e0672aed70979289a88dd8f3e7",
  "src/application/github-pr-cache/github-pull-request-cache-service.ts": "8a04b69fdb0e819759ed8a6c28078fef42678139f026c09fc7006bf05fb60c89",
  "src/application/github-pr-cache/in-memory-github-pull-request-cache-storage.ts": "3d16097b8d7c526e0985a2726379a347c0e2b12f782b5e1f69881cb11a2fa8c5",
  "src/application/github-pr-cache/index.ts": "7ac859458c3231dac237bdc5a31ad8a2e149fa387486ec50e3033378165f011c",
  "src/application/github-pr-context/contracts.ts": "efdf99c7344ab370f7812deae422f3ed414720682091ba419e4b793389e732d1",
  "src/application/github-pr-context/github-pull-request-context-layer-store.ts": "79e3344cc3fae2d4eb32e1c6a95278f24abe93afe415d4658842c3033175ecb0",
  "src/application/github-pr-context/github-pull-request-context-resolver.ts": "b55456a8e7abcde4430d4c98d17b180b80743328f81d0dde92cf35a4db816623",
  "src/application/github-pr-context/immutable-pull-request-revision-mapper.ts": "a156c588048d0fdf19b5f54fae519cffb23c0890ebf104a3b14e3502790f4164",
  "src/application/github-pr-context/index.ts": "2689c19f4cdc5f18707c0ba99b35f83c5c6b4bc40c923a166c71e1f95912eafd",
  "src/application/github-pr-diff/content-diff-builder.ts": "2cf44e5ba6b5d6508ffc8cc990625a927b564212a5f9ff2071d6b0946e232c60",
  "src/application/github-pr-diff/contracts.ts": "115a7efc36b903ce2bd68a53a96336c8720d247a88befe38690a4f92cf4d49bb",
  "src/application/github-pr-diff/github-patch-diff-builder.ts": "d08b0f9e1fa47854d4d0e6d82bf7f77baeddb38b59e323867bec0265482e44a1",
  "src/application/github-pr-diff/index.ts": "d86d699507cca86cd1d27bddc5d521e3563562b57555bb321a5ffbe19752962c",
  "src/application/github-pr-diff/local-git-diff-builder.ts": "0fbcf10fad7695bc58ef09f6ded1b2298409031274403d0c5225b79865524a6e",
  "src/application/github-pr-diff/pull-request-diff-acquisition-service.ts": "32e6b84ec9757a04de71dfc79e519196c5f4611bfc0c54dc8bdf17332f2d10e7",
  "src/application/github-pr-diff/pull-request-diff-builders.ts": "32194887f64e972a848e1d3f106c324a59a3e7486e1bc5b80820fce413ec5ed4",
  "src/application/github-pr-diff/request-validation.ts": "61464c8ea5bf9b5c0022545c3e09fb3c4c9f6dfe5ae879436adf49233d2cc3e7",
  "src/application/github-pr-diff/snapshot-builder-shared.ts": "48844ee85dd0ffcb0bd463ef45fecd75a2885db2db6b92f8eb062e5727514ce6",
  "src/application/global-review-mapping/global-review-mapping.ts": "950bd6ff61b235ed9b2dde3f5697adf8b0c119f51ad1540d11d322d5b8d8bca9",
  "src/application/global-review-mapping/index.ts": "ca8efc38ff237c412acc36ca22b4e0d738ff98168b460c1a06ecdb3bd9683216",
  "src/application/global-understanding/cooperative-global-understanding-calculation.ts": "dad6c1e8767fcbee8bd0bc55904ada6603d66a2d3b64782b0d9c88212ea05e66",
  "src/application/global-understanding/document-open-lifecycle.ts": "0d061b2749262f19ed4c8557e3394a9a4bbf0908523e6b351d13df27eebe6d29",
  "src/application/global-understanding/folder-understanding-scope-controller.ts": "5264300291648362ff4cfdf035d214fa6936f38b7390b3bc12452a3c088e892e",
  "src/application/global-understanding/global-understanding-background-recalculator.ts": "f40b7e3bddd31bb86827bc8995976707c39889abede23bfa387ba959611c89ab",
  "src/application/global-understanding/index.ts": "70858ed8ba232451e76760023f37235f37dbcb983852d5b212f92616a6491166",
  "src/application/global-understanding/pull-request-global-head-file-registry.ts": "2c29ae7efe359302121375a5c9280008f2e5f36912aa81b3118c76bfc606bd27",
  "src/application/global-understanding/startup-document-observation.ts": "6e07353dea8db9e8937923ff720744c4965bb503634c4c4e10f92ffef5751e62",
  "src/application/history-rewrite-recovery/adapters.ts": "3ac17ae8b5f677d9facd4bb859941a1c41d783d7888aa9329ddc78a2b65c0093",
  "src/application/history-rewrite-recovery/git-context-recovery.ts": "e8f386715016f69265ffd1d04b8c74c26ddf538286c3622da04bce53f2966216",
  "src/application/history-rewrite-recovery/index.ts": "793d2abe0ba56bc4f3851c98908ee91e323bc76b6b84e5f3b6b1edf2025885c0",
  "src/application/non-git-snapshots/index.ts": "0729b0d20d09efa56731e2378e341bd5337114a4163c344ed23f254501549adc",
  "src/application/non-git-snapshots/non-git-snapshot-settings.ts": "d5376bd48089ab32774aab4b9f928ff5a443d12b578e9a75d0f6036db2adf4cc",
  "src/application/operation-feedback/index.ts": "7808f63fd8ee6e410c8f8d384e6a7752049b73a964b6fa9c96b73e5370ecad99",
  "src/application/operation-feedback/issue-90-detailed-operation-feedback.ts": "3183f1512ba112459c89b13bf29cb2631a9df0a946d70693c25d5935e2106f9e",
  "src/application/operation-feedback/operation-feedback.ts": "87049c843b6c9b06773ef2f84f2cf521902b6ff638d7d6b0e6c93fc7c591452c",
  "src/application/operation-feedback/pr-progress-diagnostics.ts": "31e39b8beca6396884655db8849df8c885d2204a79b879ad60a30e10e4d7e6bd",
  "src/application/operation-feedback/startup-feedback-composition.ts": "3fde3230c39f2386866da8f1e34424240f9d39515265d85a4dfba1cbb37d60bc",
  "src/application/repository-global-state/index.ts": "676d9652b870d23e044a4bb2aaa2b38b772f58eb8b7559ca0d5fc9899059af9e",
  "src/application/repository-global-state/repository-global-state-repository.ts": "d8a2a939cc8bdb56db48a24cbe0a31f546219864f20178e1ee2b02c62c002e70",
  "src/application/repository-path/index.ts": "ced19a21a3be557ffeec8dccf5e7ed53796737333eef1a3686a0c3588ffdb464",
  "src/application/repository-path/repository-relative-path.ts": "fa2f629ca5e781dbd26f9303fce056fcf99b17630ca7473a4a391002c7956f8f",
  "src/application/repository-path/repository-root-uri.ts": "46eb3da47281ceee21f4f1189804c96af1f1676a9b5d41d63a8c0b03f8d5878f",
  "src/application/review-commands/change-blocks.ts": "28e2b175529373ca866fc42d7bce257352f607239198795e6cc7fd93856ec712",
  "src/application/review-commands/diff-editor-review-command-service.ts": "8181b0c8212211da66355de8bab33abf8e4cd570596e33e10e358fc4de2055da",
  "src/application/review-commands/diff-selection-target-plan.ts": "7f57f450cd55993f83c32297db3af6f6b4bf7122692d68aaf19207c13ee7fab6",
  "src/application/review-commands/index.ts": "d57ce7bd3971f58c93fa1b894961498e88995f8963b2740e442ae68b550c4d88",
  "src/application/review-commands/normal-editor-review-command-service.ts": "c1461493335bd33b9771c45b90d101aa58c23f34758afe8613806bdbfb6b4951",
  "src/application/review-commands/original-selection-review-plan.ts": "1677cbed36d4d543b43f5a4f6115f16ecb0cd2cd185598e659ed3afb32809224",
  "src/application/review-context/contracts.ts": "20a4ab0c1ca4d8b75bfd8410869b2ad14d91b1c96c952cf5c5bbed45cbdf9fd7",
  "src/application/review-context/git-context-revision-mapper.ts": "6d1f6df700c19afd708f89b6059afd04bae11c0e36651f0e7bfa34faaaa7aff1",
  "src/application/review-context/git-review-context-resolver.ts": "2410dac356b7e003227b3d6d1a0ef73cdb3d2beb68d077cb5b6550e7313bf982",
  "src/application/review-context/history-rewrite-git-context-revision-mapper.ts": "f67c346138c1dac1df7c9e766bddedb8295494cd3a79cbc63002b27d6afbdacf",
  "src/application/review-context/index.ts": "4cfe2959c016cdb8fda6c2aabb75b536e2d144306f102ce48333e2e712416acd",
  "src/application/review-context/polling-git-state-monitor.ts": "22d634a500881fc7b6ca672b638fddbaf17bb699b1a3550a3a04d0d749ad30af",
  "src/application/review-context/projection-refresh.ts": "1ef0a4fb0964bebd86b74e624a95a0541274a6d6178666c4f96ca35fd5fc3d97",
  "src/application/review-context/repository-resolution.ts": "1610410c359d1f9080f234f90f6a60b759432172d8a5b7f91e212ed49e822872",
  "src/application/review-context/selected-review-context.ts": "073c5e45763d8591ebc1c9529c7893dac3543fb225f7fa62587be101a05f5b65",
  "src/application/review-contexts/current-pull-request-context.ts": "52017ea511fd4273a9426cf27953bad242b344f5f0133ab4e03089f9b4d7e40f",
  "src/application/review-contexts/index.ts": "4bd07582e55c9cd20bb0654fc7db6310ce6098be2a2f1ac0e7a218a94a7d98d3",
  "src/application/review-contexts/pull-request-review-projection-notifier.ts": "b5353f6258cedcea8529bb047fc1306d79435af80c9bec70c1937e4e491e6e3a",
  "src/application/review-contexts/pull-request-review-projection-sync.ts": "de854152e8673e06f5019f701ad72effc6128d65ce0ddd00152693c0117e161c",
  "src/application/review-contexts/pull-request-revision-evidence-loader.ts": "30c3128ca719009711aa4bbb260915ed285c92c9ebb32f2c8bbda8320ee1940c",
  "src/application/review-contexts/repository-selection-cancellation.ts": "48ce382f3da17770f38674548bc7b050a8d6e75d6c0489d2b9f0849a2e23af5c",
  "src/application/review-contexts/repository-selection.ts": "7b0734208d78f6cfd1ce1292e7c1608240e2b6ee07cb16f8040fe7c30184129f",
  "src/application/review-contexts/review-contexts-controller.ts": "8171367419f16d276a4d842454fbb0973806fb0ef914a0918e510af572e5c989",
  "src/application/review-history/index.ts": "bed2e5d03ef9f733e0083f69e0d5602d6cc2ce3ffaeb546e04e5d49ee9449ba5",
  "src/application/review-history/review-history-recorder.ts": "d7276885e1158647ccec7e16a9dc2a882cb630af7fadddda0a00048d2207fdaf",
  "src/application/workspace-identity/index.ts": "e652f3a5bf58f83cd6f91d0002619ae1c277d58fda20d9a3f50a82f0755e82ec",
  "src/application/workspace-identity/workspace-identity-service.ts": "f0f13882dcac9385be1a29887b60eae970556c4a6c59352da4dec43f2ca86b95",
  "src/composition/current-context/current-context-inspection-session.ts": "54f44ab16430b523ea445ba2861a22f037381db288e39fa5b25d64b531b9a63c",
  "src/composition/current-context/current-context-pull-request-views.ts": "5c7996ee1134de231608360ca59402db9d58840d7e66a281a9eb6c9ef3de7213",
  "src/composition/current-context/git-context-inspection.ts": "3a220979976cd50502b61659b9ef7bb8fdfa295eb3f51a826bb5b6805e025f81",
  "src/composition/extension.ts": "94c489cd9ab2400f8f3851071b6fa6534c6d9556f066803bdedefd07dd6a8e89",
  "src/composition/global-understanding/global-understanding-composition.ts": "5e9671d8fb02560323db070e6a6e6ed915145e8e96dac9d06ef05ee8670ac8d8",
  "src/composition/global-understanding/global-understanding-open-document-reader.ts": "22a5f5b34c001f57259aa06f58096baea0e655546018eb13418b936e98bf04ff",
  "src/composition/global-understanding/global-understanding-source.ts": "2a6d889bedb036a293a1e3bab46f1952314527adfa288419cc2d21b648a3afae",
  "src/composition/local-git/local-base-head-runtime.ts": "9d61023a34ed4816653597ed03fd1bb00fe043f21859b77c02e86c97ecc0e4a9",
  "src/composition/pull-request/new-pull-request-global-composition.ts": "6469119080f6e69d617f8e4cb05d998e973e7d61e19e246d2a0067045f52e97e",
  "src/composition/pull-request/owner-pull-request-synchronization.ts": "714ba4df0ba4cf1c07c353b8dea58bb6f23292575d72a5971b538a474efca9ba",
  "src/composition/pull-request/pull-request-review-history.ts": "8f5640bd77985b9b57580c83254c2116236302873c74e6177a2de5133deacef9",
  "src/composition/pull-request/pull-request-review-runtime-base.ts": "8545541d45d0117fa7ca4ea0777658d5632d7839e7f423b7a7caa4b28f61752f",
  "src/composition/pull-request/pull-request-review-runtime.ts": "3198f00c09921af5fc7137cb40e3d6465b57c10abeece32c47dbba2108533629",
  "src/composition/review-contexts/review-contexts-runtime.ts": "23a8537a3c3be30fa50b53012ff9f5b6f44be08d534f4c1223aa77209b02fa17",
  "src/core/contracts/index.ts": "da0601b0d0a341406df4595b446089fa9bd269ac66af7e972524a3fec92ef622",
  "src/core/contracts/review-history.ts": "8adbcc0062020fbc643e8f3c6bd3bb1729f3550a1633107432f65b49563c8f6c",
  "src/core/contracts/review-state.ts": "e92dccc8ae998a1ffb367fa52f9705861a235f4e980cccbcc6f7762803cff870",
  "src/core/contracts/schema-version.ts": "19b07c2a5af50ae8e39d6ccaac052f3f15ed1d6841215a1a6fcd5cf2d96e3ce0",
  "src/core/file-exclusion/index.ts": "35dee97af6cf18fa128b4bb08863e87d7d0ddeb04524886e9466b1a8d9ebac37",
  "src/core/file-exclusion/review-file-exclusion-policy.ts": "789ba1f0938e81c7918a8d46c0ce52262eda1f654ca794e3be261d20abe2c9b7",
  "src/core/git-diff/git-diff-interval-mapping.ts": "b3321acadfa78d5eaafb669d015e90cd42d09256ce129fbc172c10e2f85106de",
  "src/core/git-diff/git-file-state-transition.ts": "30360be2c721ce3941c8b811b138c7b79f80c90eb5deaf3aae2e11ae2d6ba9fd",
  "src/core/git-diff/index.ts": "816791a526396527b5e7346151f1864648c3f05d8265df4855587a2d405ee322",
  "src/core/git-diff/revision-interval-mapper.ts": "148c060ba55993251594ab2c7ee2334f24b46a20024d93e88ac90f09d503c039",
  "src/core/git-diff/validated-git-file-state-transition.ts": "954891f78cdd5dca5d79a55c28cdd4bf315116984e2def7e5e4a15c537547392",
  "src/core/global-understanding/global-understanding-progress.ts": "06cc15e8ec6cc8c9a53bf0e0febe5cbb842c4fe21807dcfdb68da48dbf173961",
  "src/core/global-understanding/index.ts": "2652183d8d73edc89aa5e5d327239e0dceaa4c43224b584bcd76c96b37ff26df",
  "src/core/intervals/document-line-contract.ts": "d2d0c4f0ab26941dcb251cc1913fb67047a762d4e6cf35a3abb13aab5442b83d",
  "src/core/intervals/index.ts": "d60ee425fee1259d7023946c0b60c841beb7f60bbca541044745df7a0dc823fb",
  "src/core/intervals/line-intervals.ts": "fdd5363e4bf953f022bf8aa190f7fbabce6efcbdc939af37b4f728f8c44e58b3",
  "src/core/intervals/selections.ts": "ae01ec8997e04b70d6af0b28a91d5b9f08becd1978006f1f35e1f2c74265590a",
  "src/core/line-intervals/index.ts": "30f9fd3841f8bc907dc3520ec14fd2bbce564eccaaa45556f01318d05f2a568c",
  "src/core/pr-progress/index.ts": "7fa75398c33198bd227c687e3fbe7db53714576115642415fb7acd8a749ba1df",
  "src/core/pr-progress/pr-diff-progress.ts": "cd0b340c596607ff817d5056631a4ed15d026d4ad42ae519d5f05afc15a4bf70",
  "src/core/range-mapping/index.ts": "32cddc1cf7ac975ea72a4693863cfa8ba903bf0d9dfac8e0f17b7f9fbea185bb",
  "src/core/range-mapping/range-mapping-engine.ts": "976a07bfb89e15d932e504a4015ac2365db1ae0a08aa72ade9008449abf55c7d",
  "src/core/repository-identity/hosted-git-repository-identity.ts": "732abbc455838cdb46afb82d43c7faf6abd21fe5baec56c957ddd45cb570e48d",
  "src/core/repository-identity/index.ts": "f59eaf125881becb2130239158ef3c2ada23847d2cf7ccb3d708f87d14d3da01",
  "src/core/review-history/index.ts": "e9233ff5430a988b091f72fcf1bc5042ef1208490d7488e190eaa3c3b60b54f8",
  "src/core/review-history/review-history-event-codec.ts": "91debcfceefd786ebd538d4493f5f66555288b1d6b256258321c9af0a8fc8d24",
  "src/core/review-state/index.ts": "0f4493690d0582fb3c3b81d6b31f2137f0c0cb2f1c1fb8e48e4276bbe5aa8b39",
  "src/core/review-state/pull-request-review-state-service.ts": "af34fd44a4ca1bed307009d1e0c804d70aec34aad2860cbf169666fd6e6c98e7",
  "src/core/review-state/pull-request-revision-snapshot-service.ts": "974da549eea07bb39d05c2d8d1f0f8792c72948844bf871bfb2d7466bc2e18df",
  "src/core/review-state/review-state-service.ts": "136be972ca27e0fba8b5ab605cf3a3ddd4f88ee373d3babec12f37d62d9b9a08",
  "src/core/review-state/revision-snapshot-service.ts": "92d05e1b4270b7b0c680b34e97826f77dfeb80ad332901f3ac18b2e5642a8e54",
  "src/document-review-edit-runtime.ts": "7038af3f2ccb100036aad4ddac4e424b5738190feff96b9b5f109396bf97a7df",
  "src/extension.ts": "300942a9112aafb282e5f7f2801c7d16f90d7e24d635e08557d77d5453777f55",
  "src/test-only-review-state-dependent-queue.ts": "e9a652c2524af33048e8ba00bddb0d1230002828b922278dc867d6ecc6b8b549",
  "src/ui/current-context/current-context-candidate-selection.ts": "37a688470a4b425dc401530a9dcfc97329b03a145c9d12f83d169dc7f99788f8",
  "src/ui/current-context/current-context-runtime-composition.ts": "c38ac2be88b3238b06013d3209fd503c9507ea012881ac4605be652ef968e1b7",
  "src/ui/current-context/current-context-runtime-coordinator.ts": "a58fe8331199679aac131806038588380c3c5f6e2b7bfbb99579d14b5c52063c",
  "src/ui/current-context/current-context-ui-controller.ts": "f8083000e5f24358dcf0bf216bbdd7d80805e5368a5e9c459e9500393b560f51",
  "src/ui/current-context/index.ts": "c0810e8e91513e2d2c32a93f8aec5403dcbbe3a382b2d7e5fb2f9b785ad8d18d",
  "src/ui/current-context/root-scoped-candidate-identity.ts": "cefd7b9dd00b6a4fd85fa169175821898226dd77102ba294b8cc77a749de2235",
  "src/ui/current-context/vscode-current-context-runtime.ts": "0397872c7135de531e3a8ad0f1de4a46ff49d7e42345f90e1161cfc982088383",
  "src/ui/diff-editor/index.ts": "6a8821ee238110b082f4471b41d32a7928344bcec6f9e14a14712a079aa0ca1e",
  "src/ui/diff-editor/review-diff-editor-controller.ts": "a0b1d38db3df260a73055c76f12ad4ed4d45718f34df830e1b4151054e213c65",
  "src/ui/diff-editor/review-diff-text-document-content-provider.ts": "e5389624476ed888f036a0c846705006d96012178486a5a6ae2ad3d3bb4f7523",
  "src/ui/global-understanding/global-understanding-ui-model.ts": "566299a877b0821568aff1f162238d0a2f73978a1889182b03b9b84afdfc3f97",
  "src/ui/global-understanding/index.ts": "43109c1715309a8a4b8f4fb861ce676b4eb9e2e184765b8835f0b257e4348a91",
  "src/ui/global-understanding/issue-90-global-refresh.ts": "9b96eed2e5a66f62e3c643319ea4d2c7817a54ff1f68d2a8d6816bb5d1528271",
  "src/ui/global-understanding/vscode-global-understanding-runtime.ts": "06298b30d849258cf8156767d5e40f27c9db982e921203069bbfcbdde89cda71",
  "src/ui/index.ts": "68e067f334b1dcb46d3e048e3a8bddb680212ab075d05db60d5ce8fce9f940e9",
  "src/ui/normal-editor/index.ts": "e429f2465694b2efd113416d6968f905ef6428cde5ef818d7736c2cc5badd1af",
  "src/ui/normal-editor/normal-editor-decoration-controller.ts": "4af79996bc2badb502af5ff93963f84fd371d54483dd2d1a7fa38e4ebc75c9db",
  "src/ui/normal-editor/review-command-registration.ts": "a1b73b207290aa3d5301703b3e820180e1588d64029f87d3b20905aba5c12168",
  "src/ui/operation-feedback/index.ts": "23b166105e0a3db08215be31bbf56700188802a37f1e3f4be618e8197e125170",
  "src/ui/operation-feedback/vscode-operation-feedback.ts": "fe00916c8653f4b09e2f1552258bc4f060315a646c5bac141d609a5eb17eabd4",
  "src/ui/pr-progress/index.ts": "bae6cd97e0715a48dbb92809c23375a6deeb8e1d9107a31ae476738e31b320d1",
  "src/ui/pr-progress/pr-progress-diff-review-context.ts": "ad37ac67c118f7f363bb86cd94c064098829b19793a56fe5b4d1bb3161e5a4d3",
  "src/ui/pr-progress/pull-request-progress-tree-data-provider.ts": "5f4af07d8060cf2ae440c3f2988bac7ba6ca0da4059635eb0e592fe2983d4323",
  "src/ui/pr-progress/vscode-pull-request-progress-tree.ts": "4415db5ded97203a49c5e5e7f0562c600296f4e3d723fdd579d5a84c9c0148e2",
  "src/ui/pr-progress/working-tree-file-path.ts": "d1c8d0c54d59aa870a98551910cdbe9a955e7f4ce6e5d77acf7b97a62d214465",
  "src/ui/pr-progress/working-tree-file-target.ts": "109124aa5170f50911b77e8260f98dfec2297f46ebb0fb0730271ed9b8cfa3d9",
  "src/ui/review-contexts/index.ts": "2681e91ea2791364c30309839a170701328c61ae36e8ca69c55b8c437ec2f749",
  "src/ui/review-contexts/vscode-review-contexts-runtime.ts": "2be7e01629caea1c485cfd4e0f9bc00aa1110cdf5bd6a89ac7e9132b4be00cc9",
  "test/helpers/pr108-production-fixture.ts": "d25c00d17071fc3ca6cf309fa221190916b448939463461c417a8112d25d4435",
  "test/integration/git-context-revision-source.integration.test.ts": "98a5a43c9f31945489ef9619bca447318daf8513a33ac5b83507c702a41e7856",
  "test/integration/local-git-adapter.integration.test.ts": "808646ab14543635033fe2679e38f1088b78185da988c859b44070b27fa72e69",
  "test/integration/mock-github.test.ts": "ecbd5e392cdce36858aec7ca3210f1a89d717d9c8a0103f3638f913e14da8928",
  "test/integration/node-local-git-runtime.integration.test.ts": "b62d875ca862bc8fe8f794c7325912bfb0f1125d40adc166c8d8171ff302a704",
  "test/integration/t207-git-history.integration.test.ts": "5bddff552ea9b45ee18d85df890e38c4792ae32445925d9d0d8dac40c58e0f2f",
  "test/integration/t302-review-followup.integration.test.ts": "abf8ce144b4a2b5e86f8d05761c4f2374a00029a99b10355210689f8028563ff",
  "test/integration/t402-pr-diff-acquisition.test.ts": "70a27f6dfa8e28b758ccad849264b2e0147656dabe53cdbdf9bfae7c022b3d76",
  "test/integration/t402-pr-diff-boundary.test.ts": "d213c647d1241b95dc353a1975b8dda3fcdcd25b0f218df46d4dff0121f5adfc",
  "test/integration/t402-review-followup.test.ts": "04fa56303ec64ff5b6d89ccaacdce9e0ac6dddc4c431e5dbffdb4a9fbf4e79a2",
  "test/integration/t506-global-multi-context.integration.test.ts": "2522ce78de9ff720c788ca1377ece7234b25934203d8462cd7332f0bfba94e9e",
  "test/integration/t506-live-edit-concurrency.integration.test.ts": "a2a7bb89d22c6be89201177bc28dbf682bd58c3c80b758b6208cb5db04fb0aaa",
  "test/integration/t506-real-multi-instance-concurrency.integration.test.ts": "ae118a199d102884c08a3b1e64c8593c91eaf93c620c5e9d5144661094cb5aa1",
  "test/integration/t506-selected-pr-live-edit.integration.test.ts": "fa2b155a7598745828249f274fd9ae8333b5678c8a7501a83ca63c117c5c8106",
  "test/integration/temporary-git.test.ts": "8515da82b75725f043a5b5104c711d5b9093cee4224efba7464a7d2875b433a2",
  "test/support/mock-github-server.ts": "cd22f9125fa0e75ef1bd2499c6374ac4c8321bd94083010e4d0045e945cf8010",
  "test/support/t405-owner-product-fixture.ts": "8364b9eb4098012a9bc8a593e7755365f065f6c18a60c4c1bca04179a8623583",
  "test/support/temporary-directory.ts": "aa2b1c83743885e34b1593c3aaa545f9e66c764200f3867de024f4e1dfa0bcb4",
  "test/support/temporary-git-repository.ts": "10e66783509e024490c2ba6cf1ebf765247ddc0669806c9692bc7a6112eb606d",
  "test/support/unreachable-git-blob-reader.ts": "04f86c714e29cf3c849c45e74d0191466aed0914a7f58fdfd9c1c43ade742e76",
  "test/tooling/ci-packaging-contract.test.mjs": "65d4eb560b4a196d490bbc4efd82018a65f4b8cc832c9d7a00947d79711e3008",
  "test/tooling/ci-vsix-version.test.mjs": "ca0478099d3eeaa56c3c5371596e5a3d8367717b05ad7361f40d2fb832045cba",
  "test/tooling/issue-136-refresh-coordinator.test.mjs": "725da217d92991864126e06619492240df04a265370a5a78b23553d149e88294",
  "test/tooling/issue-137-pr-progress-diagnostics.test.mjs": "03ce3189e6e3e672b48b9c78fe2389a902178f7c81ae8de038af7beb804388b6",
  "test/tooling/source-layout.test.mjs": "46991acf520a36ea1cbdfd44e53e199d1ae79d2962d902dca17e307151282d78",
  "test/unit/change-blocks.test.ts": "461e82871a8729af13ba5f0f075e4b103667422533c75d65d461dce86e022804",
  "test/unit/ci-workflow-contract.test.ts": "6ea0ed141d8cd0b2339c4854cf794a3018addcc8a322eaf203d1298a4fbe3bc9",
  "test/unit/core-contracts.test.ts": "c33e2327aa88b09e7cc996b9adfde820874062186cd2a1fccdf389e7185812eb",
  "test/unit/current-context-ui.test.ts": "c34597d42cbecc5a0ae5938e1d8d9d23e64c843f3fc7e08a6abe74e38be50a54",
  "test/unit/debounced-review-state-repository.test.ts": "351c87ab799b219f72824f6b6cba888fe1e4724bb1e89ec8a3c8405d89d46919",
  "test/unit/design-document-structure.test.ts": "ad2ddc9718ea2b994c4731a8fa6259788515806d00969c649404f8fcdcc90177",
  "test/unit/diff-block-review-state.test.ts": "4357748ceb2f12f17cd2e3b3ef6bbc35a66df64f3e4ffac2b0f6d3f45c5a978a",
  "test/unit/diff-editor-review-command-service.test.ts": "21f78d7e3bd3de8ef3767d9521e2a0aa06d1796a69ef30c6c87a1eb8755e1feb",
  "test/unit/diff-review-state-service.test.ts": "039b64bccd83b228e249f02ad52cb703b2d896385be5c0a6f16e37fa3c833175",
  "test/unit/document-git-context-lifecycle.test.ts": "eeffe498a3f77136610e6bf7004a1f42f41c7642b4cba0b71ae44cfcc76eb8ce",
  "test/unit/document-git-history-rewrite-runtime.test.ts": "51fb58ef758fe3e554e69cf277c612e8f20477f2663b2a1d8c7db525d3bd2717",
  "test/unit/document-line-contract.test.ts": "71b3e85b855b0e288bb2364887e0ef091717dceb9afd9e22d518ba048f7962a5",
  "test/unit/document-review-state-regressions.test.ts": "e839b634b7ecaea748964b838c69fa17528d627cb70467fd128a228cba3d9b3c",
  "test/unit/document-review-state-session-provider.test.ts": "e06e5af5615b2b11fa82a1a28596e00cbac243cff7d2e147406b31afb6ea8972",
  "test/unit/external-file-state-repository.test.ts": "290b600131f747476b3e4c1343635c6bd4c72a480448a36a942ef6c165408187",
  "test/unit/git-context-revision-mapper-binary.test.ts": "b81c91ca341a4c27bdbe2ae2a66573b8c6e050e3ee911f029b5b191e3f07211c",
  "test/unit/git-diff-interval-mapping.test.ts": "86267120163cf0dbb336c67c6ab6e09cf641ebad90d017083315a77440d31026",
  "test/unit/git-file-state-transition-r3.test.ts": "2e689334eee920c6d8a6d2b143197a3a9f6bfc7c92b29f5b035c777bffe465b1",
  "test/unit/git-file-state-transition.test.ts": "b6101c4f30de58669a4edbea807ca9250d884c980bfe83032edaf66dc8dadf02",
  "test/unit/git-remote-normalization.test.ts": "f8d3ab833a158d500f861b13bd94de6ce50a9045f254460ee4c6b5e25aa53986",
  "test/unit/git-review-context-lifecycle.test.ts": "1cfcb6ae14889f764537ffe6afd120403a97ab8313265d094e8cc0da4fc3353c",
  "test/unit/github-pr-context-layer-store.test.ts": "ce81697b39e2c1fd619d841e5479d1239857cf317f2225c4aec8cf1d3e4727c6",
  "test/unit/github-pull-request-cache.test.ts": "25f7c010b7e118b7eb31291113ef3fc6da809dfd9974acc0b27c111792370365",
  "test/unit/global-review-mapping-display-priority.test.ts": "7634edc617048d342b3810ad3c08e28625f4358e67465ee0efe370656eb851ff",
  "test/unit/global-understanding-progress.test.ts": "be4501045fc458a2121baf2e06c83e8451d2d9ae76eaca7e047460b8ad22a8c4",
  "test/unit/global-understanding-ui.test.ts": "fc0fe526274370be5bb7edb6ec4d4269324d12390afc9845db19bd7d694706a5",
  "test/unit/history-rewrite-git-context-integration.test.ts": "cf625cd7a2715b31a77fff88b2fedb58c5934a1e8295b9eb60d220d488d83a99",
  "test/unit/history-rewrite-recovery-conservative.test.ts": "34c914bfe2380b6225d483d0d29edf6dfcc774c9cb8b7168e7f55be0b5a9cbc9",
  "test/unit/history-rewrite-recovery.test.ts": "1f98d1a60532163aa5a6a49cb9fc7870ea5a30339a9982fa412fa18afe234722",
  "test/unit/history-rewrite-review-findings.test.ts": "0ca9e592aca90e4d3c8c7553398ac6c9ceb87d1738c91d37314132ec2c8a4fc7",
  "test/unit/history-rewrite-tree-enumeration.test.ts": "ee16dfd44cdfe15e96087085c5c0779104ebcb1252716fbcd3a6aba4fcdc5d4d",
  "test/unit/immutable-revision-review-snapshot.test.ts": "dcd88aab971b40bbe2e8b3f5c90dcdb861681c183c8c48878b48406f5d6761cf",
  "test/unit/issue-106-global-three-way-synchronization.test.ts": "1c27b004328ccf2e4a6780c485e310d55c5ba675566e4a0e64d7abc62ff4fd06",
  "test/unit/issue-106-product-composition.test.ts": "b317174f7d39249d7e593b7971eb8b56ab9f8a0ad7fb5dac1c4eda7eedd366e0",
  "test/unit/issue-106-t405-owner-synchronization.test.ts": "5cbac3f0025a4c44f238b026fd21adfff84cbce3e819b8d1d4247c4500f3bcb1",
  "test/unit/issue-112-pr-progress-runtime.test.ts": "1745ca8fcfff7a47d73aea02cc5bd8e94ba3f723975c1b0675cab3d8e902ab99",
  "test/unit/issue-112-pr-progress-working-tree.test.ts": "8be9f47533212a4a7753c0ab9b3987743fa60a86ce66d4ea17aeb26be766f11a",
  "test/unit/issue-112-pr-review-projection-notifier.test.ts": "c7ab997cc666b7f10cbc863155d038d86cec7cb13e57bb2be8a1ee8b5576daf0",
  "test/unit/issue-112-pr-review-projection-sync.test.ts": "495e4c8ab9934b578f053e4f10cb4206d09988e8ac986c5fb8926c587b6f1766",
  "test/unit/issue-112-working-tree-path.test.ts": "8690e1e9e54be282e6ec09989dadf3d285e53f294c6e772d6cb8cb691249bca7",
  "test/unit/issue-116-current-context-refresh.test.ts": "64f8678b1409a2ac224cfa454be627a6f0b97ebbe90d31137fd0188e1745288d",
  "test/unit/issue-13-atomic-reconciliation-review.test.ts": "086f82618428d34bda55763c2941d810315359aa045e0a374d5cda812c4c7f29",
  "test/unit/issue-13-baseline-metadata-review.test.ts": "35560e444d29a9deaefa19d610a22755acb144471546e69a72b9b1e3a09b24be",
  "test/unit/issue-13-owner-reconciliation-review.test.ts": "19e9295845d1aa4ebdc1539f1bed696bbc23aa750ab6bc6dd0f71262169ae1f4",
  "test/unit/issue-13-r5-review-followup.test.ts": "d8313faaa5e308b2e0694aad751b32d81454552f05f0edb4665db37764756a1c",
  "test/unit/issue-13-r6-review-followup.test.ts": "a95b88fa61fe68d591734dbdc7e5d62cc78b7766ce13176d9003db754e138c0f",
  "test/unit/issue-66-global-pr-progress.test.ts": "4ceaca8f6ce42a9dc7b67502f4c4ee94c20df46d2c854775000b61dd519dc994",
  "test/unit/issue-66-pr68-review-findings.test.ts": "39ff01484900db514ab62acbd426a859ae6336d05ba2d31f3d504b24d033727c",
  "test/unit/issue-84-pr85-review-closure-followup.test.ts": "dcecc40a69b0d9430333af3b8ac180e99ea7b99774da679ccfec82c525f1b9c4",
  "test/unit/issue-84-pr85-review-followup.test.ts": "ca242be04503986c3b7ed80ed64f8deeab5f70ecf07e200af6fc955cd7122d7f",
  "test/unit/issue-84-review-context-progress.test.ts": "e9695d7dddc47cc6a0b5a6893e10c903388cbf4bce42f64ddc4f181b5ceeb9e6",
  "test/unit/issue-90-diagnostics-and-cancellation.test.ts": "c0bf0f97e0f290e72eb8cb6872e549f908944e16494ac6631364b76d90609ec7",
  "test/unit/issue-90-runtime-routing.test.ts": "c6618e429e273ffc2946da3b56e95baa61cb65486a97ff4f4e3ac74473715c9c",
  "test/unit/issue-92-pr-progress-context-menu.test.ts": "71acf17512a778ea182c7d2566af8e0185ba62eccacadb02e679c00c375707f1",
  "test/unit/issue-92-pr-progress-selection-review.test.ts": "ad50a702115615e789b5efa01df51b7d1628941c28bef9f1e4a85e828bdc9c87",
  "test/unit/line-intervals.test.ts": "de09ebcd852155094c76d94dbfd6f51cc4943d00b79f9080d4a8807d0ba60d1a",
  "test/unit/local-git-adapter.test.ts": "e191c6964b0f4e71fbe07e2f6bc07d12af6f89b9d540c8e6fb0d8f0d0f1873bc",
  "test/unit/local-git-head-classification-review.test.ts": "9ad257dc4b125650467dcceef1fe759c1603db378c6ee7d1d64b27221059b293",
  "test/unit/local-git-ownership-classification.test.ts": "e1b835a0b7639617a62d240a789347396c4b6f806ba85ce5db4233216f1ac931",
  "test/unit/local-git-revision-text-content-source.test.ts": "6398a18c1206043cd7b0edf7182ef189a254ba44fa68466d782a5a538ddd83b0",
  "test/unit/local-git-tree-list.test.ts": "d8db0513ffd75469cd91d59b0222b96e0beaaabc70ec4a29d5378e3cf8179b79",
  "test/unit/node-git-blob-reader.test.ts": "bc9b76170eec19fa2488308746c8c3256ef2788847048e643203f1b773508d3f",
  "test/unit/node-git-command-executor.test.ts": "a3b60d8016b0cc9ad1769d5198eebc0f00189fb23d8a76df8cc02979e46dc8f5",
  "test/unit/node-non-git-snapshot-storage.test.ts": "dfa9593b1c6a8477259f7ff1d55781010834e3d557b5378da36ce893842c565e",
  "test/unit/non-git-snapshot-tracker.test.ts": "59f71e94e65aa71b7157d9c38f9a5f79a83f8d683af8a85ba1b1f95545ae1b9a",
  "test/unit/normal-editor-decoration-controller.test.ts": "db4241cae1a361867bbb0eb96d8a92b83c80337a86cd59c231578029ff819937",
  "test/unit/normal-editor-decoration-global-isolation.test.ts": "5b8966d9748bc5580d9c2960200c071cdcda790ba951447b755277362109393d",
  "test/unit/normal-editor-decoration-model.test.ts": "baf9d46c3f1a3fe4e41496ae9c572b2c757413ca2ee432297d2d0c3d484f3e98",
  "test/unit/normal-editor-decoration-overlap.test.ts": "35f825ab7418b1cd253e185097f23cee01723896657246bdcf8ac56e84c01374",
  "test/unit/normal-editor-review-command-registration.test.ts": "c5c0e5e64ead139a06dfcbceded1cc6cc105070198352c2b2dbe3646fe9491f0",
  "test/unit/normal-editor-review-command-service.test.ts": "ce72e11ab1a0d22a47e303d6359fb37f47d7fbd77cf904f19becee60b617a666",
  "test/unit/original-diff-selection-projection.test.ts": "7c2e9db245f89bf4426b22ddb3a5b8ca7e05feb1fed321444abbd1195285dd16",
  "test/unit/owned-extension-host-launch.test.ts": "dec2e9dc27d8f064f2cc3bd7a86a9a43d15ad281e2b72387bb941e11a292efe3",
  "test/unit/owned-temporary-directory-cleanup.test.ts": "aed69a4c220b78da09af2bf7a33b25cf489930ed7cdb91c1070dba15a5e813dc",
  "test/unit/polling-git-state-monitor-error.test.ts": "06b07b8b7502203a7f2727f7115c4eeac78954ad93bb59c9d7057c481b71c9e7",
  "test/unit/pr-diff-progress.test.ts": "b65493d54baf2c26e64a403376a719a0b5ad2d3b87dc1b6fd99f58c76a0a4e84",
  "test/unit/pr-diff-selection-acceptance.test.ts": "da7b9f2dabb4e0bea43c3f6368540a5a305b19cd1ab7df0fe6ef616095291ee5",
  "test/unit/pr-diff-selection-configuration.test.ts": "2edd3f640993b6553c8a83ed124c94fcdc1d784add8c46ef429be12fcaad73cd",
  "test/unit/pr-diff-selection-history.test.ts": "c488444bc49b95569b71b350ba40133a9edc8437b0e32d1b8d3df58b579f892c",
  "test/unit/pr-progress-remote-tracking-revision.test.ts": "daa4a3634878ee01ba03c70825ae609c9184f8c7d49d38efd771e711c5461d97",
  "test/unit/pr108-product-001-production.test.ts": "e8bcc47d12d890bf5a50858f3e9812b9f57526aff7b5244b0cc03895462e5b74",
  "test/unit/pr108-product-002-new-pr-fail-closed.test.ts": "f891c18afe7880de75a98e85d07042920c0a06caba30d8494a86a6cec7975f94",
  "test/unit/pr108-product-002-production.test.ts": "1cf79ea9c05ed9eaab9cba2eb8d317b3b38a7287f2280d80c536aade951a4694",
  "test/unit/pr108-product-003-production.test.ts": "bb7fdfeaeb823a335a84277672cff66e9ac49ca561aec6945c9bfcddd93aa61b",
  "test/unit/pr108-product-004-isolation.test.ts": "f6e35d4d3fd61722be3111e97a62a2e34d3cb6973d8e5c24fb05319573e5dbd4",
  "test/unit/pr108-product-004-production.test.ts": "066a5392b0ff605f0e124779ed22ff3d96c655c3b119c4fe0be3045904eb0894",
  "test/unit/pr60-review-fixes.test.ts": "4f237102d30ba64a1f132ba9224d129b1426d2bfb124b7531a1aa63c15b32ac7",
  "test/unit/pull-request-progress-tree.test.ts": "6c7cc0056c66fa6c86876da972c3694276fae67e42a50557965906ffa09e22c9",
  "test/unit/range-mapping-engine-review.test.ts": "2ed02744125b6941ee1247ed4b443ffa04398b8d6daed45819c067dbc5bf8861",
  "test/unit/range-mapping-engine.test.ts": "5c4b8e4a684b9a2a6ad300d5ad56e9f4c93e6865452ac37c400e2b7c8526c9cb",
  "test/unit/release-vsix-contract.test.ts": "e9fee5170a2c253c6214f8518cdf4ce641a6aff92406ed7fee19ab1a1085f727",
  "test/unit/repository-file-enumerator.test.ts": "beb3a57ad5614d36bdc5f0e87eb405148a3d085e7382d04dabe1c44235f1aad0",
  "test/unit/repository-global-state-repository.test.ts": "dbf89d822fa49f4f7d11caf6f8546b12e83b3cb82d62431aec81decaff90121f",
  "test/unit/repository-relative-path.test.ts": "d7ef39d98d97039cd2c251185df079a30413f80a528ab036f8d98ddc9f95ba5d",
  "test/unit/review-contexts-runtime-wiring.test.ts": "02f50add198a95798d151681b75d49169d9e7986fb33ad2eb3ba21ed8f5d3ad8",
  "test/unit/review-contexts-storage.test.ts": "9ff3dfc330d53ae2f161d6670b6f17053cf85ccf3993a2d8b45c5064056ffbc5",
  "test/unit/review-contexts-ui.test.ts": "b822111e268e0ad0c48bb6a49999178fb4d6734601e809f8730829bac4ae75c6",
  "test/unit/review-diff-content-provider.test.ts": "200c941e2d96ef6628775933a117c5edf97ae34ff304f32d468e9678b6a47f4d",
  "test/unit/review-diff-editor-controller.test.ts": "d67dd4948d897cbcee11fd4cbd9bb29865877c526572e4ff5cb082b7850aa465",
  "test/unit/review-diff-text-document-content-provider.test.ts": "41625db2b449387ee3284c4cafe72602d7cd9ed07a24174887d23ea1e227987b",
  "test/unit/review-diff-uri-boundaries.test.ts": "964ba9b7a5dd3d7a8ec5236fbc37b9e4de41b47cbee57e9f5bcd427ca26d6313",
  "test/unit/review-diff-uri-unicode.test.ts": "376c9ca1dccdbfbbf1f41e0985fd319f826557aae6cc6eb123a2dc310d314971",
  "test/unit/review-file-exclusion-configuration-controller.test.ts": "22f1c509479b6d04dbf6488c82aab43c78287567fcca2e99dfbb98acb13a3f8f",
  "test/unit/review-file-exclusion-policy.test.ts": "8e449298640da9da656f2b30a32dc9f247770ca4f3df2f0890f7060dfcf1e162",
  "test/unit/review-history-jsonl-store.test.ts": "9e6f6140d25b7b2c8490043a673fa51ac328928e56b05bc360a11a9801296551",
  "test/unit/review-history-original-side.test.ts": "2ce70dff1104860f5a5d08d94bad548cd893c62e59ba5c4d8c9ec304f6317683",
  "test/unit/review-history-recorder.test.ts": "afa9c7dd451ef262d45b4ed3f57a08ce04d8aea78c53dc6ea50eb401f50b64d7",
  "test/unit/review-state-service.test.ts": "508758a7586e10a8cfe31ee99496a9a8c9b8b79f17c7c167a0b88e652bea98d2",
  "test/unit/selection-targets.test.ts": "3410fe30c626ac809acf29c6df5d69c04decc3d9d1282176e84939d0250e6d5b",
  "test/unit/state-repository-memory.test.ts": "8f8218c8921d694010232e1c4a968b2853388bf93d5e89c620ce1c55ab285ac3",
  "test/unit/state-repository.test.ts": "be5124119d3901bbb97c74642f689e7e9941233a8daf5cab741bb308698e33bd",
  "test/unit/t303-review-followup.test.ts": "4517b657a432d59afe61e0b9acd5d8ee504bfd6d3dbdf7f872824119ca226129",
  "test/unit/t304-review-followup-r3.test.ts": "00ff1c46d6f19249314bff4759561cafef805887260d8244e09e7a5640a9b359",
  "test/unit/t305-projection-refresh.test.ts": "6f46a10b75d3d3f103ccd0f99eee47e765e04d806c4233540d573b36acfb808a",
  "test/unit/t305-repository-root-uri.test.ts": "e8de72bfc5b489fc4f5487661ef79072978d17eceaba68a7da1cdecc29048f62",
  "test/unit/t305-validation-wiring.test.ts": "7babb87fb0ab8880ca3430063293d6deecd79e7ef2abfea118770ec49b2d475d",
  "test/unit/t404-history-integration.test.ts": "fa10e540cdf8a33e6cfe2fe6291f8686444318347043d03f475be3e643f87dec",
  "test/unit/t404-review-followup-r3.test.ts": "ed3c16f4f4d58ce28cad5fb730d992ee90eab34a5aed7218c83fd4f5e2bd6e9d",
  "test/unit/t405-composition-regression.test.ts": "d528b8dc5b05eadfa7e57ee594d489bb525156bf65154be20b3403ffb766d02c",
  "test/unit/t405-github-lifecycle.test.ts": "15ae113789068912527082ac5d1996d200f22488552fb27db6deb9d6dcf36f64",
  "test/unit/t405-pull-request-review-runtime.test.ts": "72f3acbd5080e87181d2c1083b9a947d2465f7acd5366429f7689b74598f4a1d",
  "test/unit/t405-review-followup.test.ts": "021e614681cdc772531709a488cbb22ae4e5cded59969a9e5a89d9ab2f27bbb0",
  "test/unit/t405-revision-evidence.test.ts": "84ad4a9ef6a77e790a355abf94e6b07120e266b63c10b4a2803a846cdb05366d",
  "test/unit/t405-selected-pr-session.test.ts": "710d5dd4899658e7609670fa8eaf6d57145d7169acdb73baeae9d4b60f0cf6cd",
  "test/unit/t407-private-pr-context.test.ts": "f5075d8bc90d1b7375f72c09f200b528fe62d2d66a23da0df34cab1f6e6419f0",
  "test/unit/t504-review-followup-r2.test.ts": "d2f2c929d8c9e9f7419a5236518c41ea2c3b4fb9340b8512291b2634707e2cbc",
  "test/unit/t504-review-followup.test.ts": "79e6bc96843a2bd4236d5d86a26ddeb21d8fdb2adff0d6ae6103bf65198e0865",
  "test/unit/t505-global-understanding-source.test.ts": "53518a587c0bf247f31c4da8cf465d651e573bae396b6384fc4866f4b478b0dd",
  "test/unit/t505-refresh-invalidation.test.ts": "4e0708ce78cca1a200609bf6a91fc0a05c7d4d1136fdba2b2c6a4992e7a30414",
  "test/unit/t505-review-findings.test.ts": "f519e0107d55e8ed6003c6c72622a5a218d7f054d2643b29df38c0463a6c1f70",
  "test/unit/t506-live-edit-configuration.test.ts": "6af573e5156c0246c704d78148f7053507f7949ace51d3d80e0f7f2c5379792b",
  "test/unit/t603-fix-verification-r3.test.ts": "ca7a258e6f8c2e7e716dcb40799c4ab8bde9975478bb5cca57c291b996d4b9ad",
  "test/unit/t603-fix-verification-r5.test.ts": "533b8eba1ae922e6e7f214ca3648e397cd51c119504681f8a7ac98c88daf65a5",
  "test/unit/t603-handoff-r016.test.ts": "7b9c40981153c1d349dd39a7f83a326e8be8843e39dc61ed07159041a9f8ddc9",
  "test/unit/t603-history-multi-context-regression.test.ts": "ee6691cd62d2e4723fa22e59e1eb3b9a46f09b87e7e18e70c7dc241228ab3a05",
  "test/unit/t603-history-reset-decision.test.ts": "00ea12a715a0a0fb6c1782297f176b01fa9ce2969fde4dd33839429c2afae2be",
  "test/unit/t603-r013-startup-owner-regression.test.ts": "08c79bf05445a0bce6bbf26af3e14622bc94261b8ed22e9abacd13dfab1e45d9",
  "test/unit/t603-review-findings.test.ts": "4bb599224e21bb5e8a6eb285c68c460ca1bd31ee2cbb1080043059e0119c9885",
  "test/unit/t603-schema-migration-recovery.test.ts": "a0fd352ebdf4653002d19b286b4676bae5bc42aa0a98cba42fc583c586384b42",
  "test/unit/t604-storage-lock-cleanup.test.ts": "12115976a5f74adbc57f7a80e9e4e27f55a2eac44391add752fc783e0a77debb",
  "test/unit/t605-multi-root-remote-boundaries.test.ts": "0830537f2faa01443e92070144df2077a5fac0ae4da34d91bbde96e9aa649373",
  "test/unit/t606-failure-policy-retry-diagnostics.test.ts": "40ed739d7c658b77fb527b23ef4231e06f208abe3a006861378f33610a5a4f41",
  "test/unit/t606-production-failure-matrix.test.ts": "4b2b911e69ac0525ee1fedfc7d81d28e762d6c7005bd09b5339f7518fa22c543",
  "test/unit/t606-production-timeout.timing.test.ts": "47790986b389a1702f5d521f8d373855188764277363236a98ca5ced812fb3e8",
  "test/unit/t606-r5-production-activation.test.ts": "a9c86d5640c89f25525b9be5cbf6973519aa39ac72918487998d65766c0f3332",
  "test/unit/t606-r6-production-matrix.test.ts": "01fd96ab3a909efbc63f40c7ea8e848f54b77be52595fe878897dba59c569ac2",
  "test/unit/t606-r6-real-composition.test.ts": "d050daf3e6241fcbb28d371534e954a62b26538de2e4a2315a08e2f1ef2eaf58",
  "test/unit/t607-performance-incremental-ui.test.ts": "60257d6a0ac38fdd0e28362db814665ddb06a151db68661ce355d6045c0d4136",
  "test/unit/t609-gate-wiring.test.ts": "7d608d9a3505ec6fb58fef5931b735094033e4c43fd369a517c3d65cbf70a3b6",
  "test/unit/t609-host-rename-decoration-composition.test.ts": "04ffe228650222e37fe11d1e59f9567c51a94a9c506a2602bc6e9d5e43678e4a",
  "test/unit/t609-normal-review-followup.test.ts": "745758597cd3ee1c99c082e23283f45af3e1904cc7b5640ed9fecf866809afcf",
  "test/unit/t609-repository-resolution.test.ts": "d7277640dfd3533c62b3fc5999458a958a74017bef0bae1cd76012733fc07f67",
  "test/unit/t609-review-contexts-cancellation-boundary.test.ts": "d2285666e9eae59a120c555e54c3ba033503f5f2d62cd77f7204e1674194c080",
  "test/unit/t609-review-contexts-repository.test.ts": "283b451896eb3aecc866fbd3dda49b8c1e24c96e143b0f5d0b3aa6370145f197",
  "test/unit/t609-revision-mapping-encoding.test.ts": "08142fba1486f0c5de007f8ce85978016c540a4398f5de2d6c5238a994f4c321",
  "test/unit/t609-t405-encoding-composition.test.ts": "8434efd5f73962c2bdebf4a722773a71066844220963db1ad52455b9d471aaaf",
  "test/unit/t609-test-review-state-dependent-queue.test.ts": "9fbbde7b6a73d8ee21d0d1d8a8206d3b4baf6c50fe3ea7f8cbfe62460c6b99f1",
  "test/unit/t610-folder-understanding.test.ts": "1b6ad257ef7638cec53da55d2ed4981fa4ef33ba06d292858fe40d58b7b00414",
  "test/unit/t610-public-api-documentation.test.ts": "73a93224f8db90315054644b51d7219706ba9a95a770f51f82292419db4cefcf",
  "test/unit/vscode-current-context-runtime.test.ts": "05afad5883218b2e09a66e27b79e4f2e6e828652c230ef21a34f674026c59ced",
  "test/unit/workspace-identity.test.ts": "b1f33773343a185b2a004c7fd4513a84a1ee711a03beb02de24e3f8924add999",
  "test/unit/workspace-non-git-snapshot-tracking.test.ts": "c0098c19208a4df4066a3b835568bb64d4487d711c7832e5a0d65a56327c370c",
  "test/unit/workspace-review-state-session-provider.test.ts": "c235305b6cfc27ed9686daf7e575f5181e387d756ff23fd2c2410ee2efd125ea",
  "test/vscode/owned-extension-host-launch.ts": "02992b007c70cd4ece3a30e2ca3687747431132c742b70d7ac92cba97601a775",
  "test/vscode/owned-temporary-directory-cleanup.ts": "4c0961b8e1dcdbd31f6469ad9a3fee688af5023db19db4ab14327b532d55b9e6",
  "test/vscode/owned-temporary-directory-root.ts": "123b28ed9f21745022c4d6f2d78cb0225fced596ed1dbf8fc41f769066ada1a5",
  "test/vscode/pr-diff-selection-mode-suite/index.ts": "0b519712f5398406d4aa7406ae98d07b47fd7aaf9e44f3b010c2b9216fe850b2",
  "test/vscode/run-extension-host-cleanup-worker.ts": "649bc1f31881b134e73330624b80e5823f5429ad2fde10edc261cc915a0df50e",
  "test/vscode/run-extension-host-launch-worker.ts": "d93b6245e3772ced12562ca3e2dec56d355ab394177245ff7d11f3eef39e2798",
  "test/vscode/run-extension-host.ts": "06054be542ec51910be9f9c23676e1d54856cfc4c30f74839f0a6450f391039b",
  "test/vscode/suite/index.ts": "24ba0ae1b6435af387bb62aac2f7cf9c29722fc0a2e18380eb44bdf6b0caa932",
  "test/vscode/t302-suite/index.ts": "a25178ee774d1abf94c324b89f397da9f64e0b1bd9871c133f91824cc3efc72b",
  "test/vscode/t306-suite/index.ts": "062e2479e8259fa9411410cb3a37d7e1d4dd501384898914bcde8625a0ad5701",
  "test/vscode/t506-suite/index.ts": "d7beff7aee07cd90f044c4ca83bc96bce1cc963e98226e271919f1640cfe7397",
  "test/vscode/t506-workspace-suite/index.ts": "b0fe61f59eb1cd7aa623a008168886b61db1b5c2cb51aab12ad4f3fdd5a34c5e",
  "test/vscode/t609-suite/index.ts": "baaab40ef29588369d691e77678720a5083fe4ee3dc51eebe8e6bf1c0bdeb65e",
  "test/vscode/t610-suite/index.ts": "9068dd11714085fa16e6e939120b5ae0db23dff7bfd8d25b411c4b16402cc082",
  "tsconfig.json": "38a475bb4a4d426af3ea93c99a8a349bf348ac169f34365b83b5a8ee3504430d",
  "tsconfig.test.json": "6b5e2136af3446d87373130eeed512703857b856aee7464919097649408b0604"
}
```


### NR-006 remaining-path implementation r3-final-tracking-whitespace

- UTC: 2026-10-06T18:56:13.541317+00:00; cwd=/workspace/RevMem; shell=bash; local_execution_available; validation HEAD=5d0320aa037624022494fe877b08e317651b2541; committed tree=ce30a33a161f2b50ccd6e35f4c7b377750793e6d; source fingerprint=ff48df1838f3f0eb867de7b0a2a00895c76e2c7776ac8ab0ca2727862d67b441; executable input state fingerprint below (HEAD plus any recorded diff).
- Command: `git diff --check -- src test tasks`
- Exit: 0; counts={}; source before=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af; after=b387a25790daf381d7692543b3fc6fa25fe49a5b19f5c0895dd8bca8c6aad3af.
- Fingerprint covers every tracked/untracked src/test file and package/TypeScript config above; excludes reports/task Markdown and generated test-dist/dist. Machine-local full manifest: /tmp/i136-r2-evidence/r3-final-tracking-whitespace.manifest.json.

stdout (full):

```text
```

stderr (full):

```text
```


AUDIT-001 representation correction: the 12 whitespace-only blank lines added after base `5d0320aa037624022494fe877b08e317651b2541` were normalized to empty lines. All existing non-whitespace characters and evidence content are preserved. For exact captured whitespace bytes, use the immutable prior report at commit `08bb2b6cd0eec22c79f64e8e55f684400dbd5e8d` (Git blob `558ba2838721374520bf2f4c6e0bddb5fba1be1a`); a runtime-local byte copy is also retained at `/tmp/i136-r2-evidence/audit-001/report-before.md`. Transcript verbatim-whitespace claims above are subject to this representation correction; no implementation or validation result was changed.

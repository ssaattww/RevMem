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

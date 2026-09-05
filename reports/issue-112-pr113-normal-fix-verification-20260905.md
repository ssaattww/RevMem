# Sub-agent実行レポート

## タスク

- 目的: PR #113の通常レビュー指摘に対する修正を同一candidate HEADで検証する
- タスク種別: normal fix verification review

## sub-agentを使う理由

- 理由: review-enforcerにより実装担当とは独立したSol/high reviewerで通常レビューを行うため

## 対象範囲

- 対象: HEAD 5090ca127a5879084ac0d48487962ae7ceb30d23、PR113-NR-002〜005、最小NR-007、関連diff・dependencies・tests・validation evidence

## 対象外

- 対象外: 実装修正、後続scope NR-001/006/008/009/010のblocker化、full gate、commit、push、merge

## 実行コマンド

- 実行コマンド: `Get-Content -Raw`で指定4 Skill、`AGENTS.md`、pre-created report、context intake、更新済み通常レビュー、実装、TDD Red R2、Green/R2、test authoring reportを全文確認した。`git status --short --branch`、`git rev-parse HEAD`、`git branch --show-current`、`git log`、`git show`、`git diff 4940ab4c45744b344b4369c675753564dbabcff6..5090ca127a5879084ac0d48487962ae7ceb30d23`、`git diff --check`でimmutable target、変更全体、空白errorを確認した。`rg -n`と行番号付き`Get-Content`でproduction routing、actual composition、tests、package/CI wiring、直接依存を追跡した。`markdown-word-checker`に従ってrepository-local設定とpackage wiringを確認したが、`tools/lint/`、`lint:md`、cspell設定がないためfocused/fullともunsupportedであり、passとは扱っていない。backtick/quoteによる通常文のlint回避は検出しなかった。テストは再実行していない。

## 対象ファイル

- 変更または確認したファイル: diff対象の`package.json`、`src/extension.ts`、`src/t305-extension.ts`、`src/t405-pr-review-projection-sync.ts`、`src/t405-pull-request-review-runtime.ts`、`src/ui/pr-progress/vscode-pull-request-progress-tree.ts`、`test/unit/issue-112-pr-progress-runtime.test.ts`、`test/unit/issue-112-pr-review-projection-sync.test.ts`、`test/vscode/t302-suite/index.ts`、`tasks/tasks-status.md`、`tasks/phases-status.md`、関連reportsを確認した。直接依存として`src/t405-pull-request-review-runtime-base.ts`、`src/t405-pr-review-projection-notifier.ts`、`src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`、`src/application/diff-document/review-diff-uri-codec.ts`、`.github/workflows/ci.yml`、`test/vscode/run-extension-host.ts`を確認した。本report以外は変更していない。

## 指摘事項

- 指摘要約または「指摘なし」:

  - `PR113-NR-004` — **High / blocking / 未解消**
    - 場所: `src/ui/pr-progress/vscode-pull-request-progress-tree.ts:107-111`、`src/t405-pull-request-review-runtime.ts:107-117,330-359`、`test/unit/issue-112-pr-progress-runtime.test.ts:325-333`
    - 説明: 修正は`runtime.progress.openWorkingTreeFile()`へcurrent-node membership検証を追加したが、actual VS Code compositionの`VscodePullRequestProgressTreeDataProvider.openWorkingTreeFile()`は`workingTreeFileTarget`が存在するとその分岐を先に選ぶ。runtimeは同propertyを`resolveWorkingTreeOpenTarget()`へ結線しており、この経路にはactive tree membership検証がない。登録mapはPR A/B双方を保持するため、A→B切替後のA nodeもA registrationとの整合だけでtarget化される。
    - 影響: 利用者が現在表示中のPR Bから操作したつもりでも、保持済みPR A nodeのworking-tree fileを開ける。誤ファイル編集のrelease blockerが残る。
    - 根拠: 新規testは`runtime.progress.openWorkingTreeFile(pullRequestANode)`を直接呼ぶため追加checkを通ってGreenになる一方、productionの`source.openWorkingTreeFile(node)`はVS Code wrapperを経て`workingTreeFileTarget(node)`へ到達し、追加checkを迂回する。初回findingで要求したactual production composition fixtureが欠けている。
    - 必須対応: membership検証済みのprovider経路だけからfreeze済みtargetを渡すか、`workingTreeFileTarget()`自体でもactive source/current nodeを検証する。`VscodePullRequestProgressTreeDataProvider`と実runtime progressを組み合わせたA→B fixtureで、旧A node拒否とhost未呼出しを確認する。

  - `PR113-NR-002` — **High / capability gap / closure evidence不完全**
    - 場所: `src/ui/pr-progress/vscode-pull-request-progress-tree.ts:137-173`、`tasks/tasks-status.md:23`
    - 説明: await後のsource再確認とfire-and-forget rejection接続はproduction code上で確認できた。ただしpending A→Bのstale publish拒否、rejectのerror boundary到達を実行するfixtureがなく、trackingの終了条件に書かれたfocused testも存在しない。
    - 必須対応: actual tree compositionでsource切替競合とrejection接続を検証するfocused testを追加し、同一reviewed HEADの成功証跡を提示する。

  - `PR113-NR-003` — **High / capability gap / composition evidence不完全**
    - 場所: `src/t405-pr-review-projection-sync.ts:4-18`、`src/t405-pull-request-review-runtime.ts:138-158`、`src/t305-extension.ts:589-618`、`test/unit/issue-112-pr-review-projection-sync.test.ts:29-48`
    - 説明: helperはprogress failureをreportしてowned projectionをattemptし、`applied`を維持する。production runtimeとT305 error boundaryの静的結線も確認した。一方、focused testはhelper単体であり、actual runtime command→repository mutation→refresh→production reporterのcompositionを実行していない。
    - 必須対応: actual runtime composition fixtureでdurable result、後続projection attempt、production reporter到達を同時に証明する。

  - `PR113-NR-005` — **High / capability gap / boundary evidence不完全**
    - 場所: `src/extension.ts:778-779,917,932-933,947-962,999-1003`、`src/t305-extension.ts:637-680`、`test/unit/issue-112-pr-progress-runtime.test.ts:340-384`、`test/vscode/t302-suite/index.ts:41-55`
    - 説明: review identity境界の`Uri.toString()`統一はproduction code上で確認した。しかしspace/日本語/literal `%`のunit fixtureは`Uri`でなくcanonical stringを直接渡すため、元defectのVS Code display/canonical差を再現しない。Extension Host fixtureはspace/日本語URIのprovider ownershipとlanguageだけを扱い、production PR command/pair/session経路やliteral `%`を通さない。またこのHost testのcurrent-HEAD成功証跡もない。
    - 必須対応: VS Code URIを使うactual command compositionで代表special pathを検証するか、少なくとも元defectをRedにできるadapter-level fixtureと同一HEADのfocused成功証跡を提示する。

  - `PR113-NR-007` — **Medium / capability gap / acceptance未実行**
    - 場所: `test/vscode/t302-suite/index.ts:41-55`、`reports/issue-112-pr113-green-verification-20260905.md`、`reports/issue-112-pr113-green-verification-r2-20260905.md`
    - 説明: actual Extension Hostでprovider経由documentを開き`languageId === "typescript"`をassertするtestと`test:vscode`配線は存在するが、reviewed HEADに対する実行結果がない。更新済み通常レビューのrelease判定基準をまだ満たした証拠にはならない。
    - 必須対応: 修正candidateのactual Extension Host gate、最終的にはexact-head required pull_request CIで成功を確認する。

  - 後続/held: `PR113-NR-001`、`PR113-NR-006`、`PR113-NR-008`、`PR113-NR-009`、`PR113-NR-010`は更新済み通常レビューどおりnon-blockingで保持した。今回差分による明確なregressionは検出しておらず、blockerへ戻していない。

## 結果

- 結果: **verdict: fail**。reviewed implementation HEADは`5090ca127a5879084ac0d48487962ae7ceb30d23`、fix diffは`4940ab4c45744b344b4369c675753564dbabcff6..5090ca127a5879084ac0d48487962ae7ceb30d23`、PR baseは`main`である。レビュー開始・終了時ともHEADは同一で、target変更はない。`PR113-NR-004`のrequired production pathがactual compositionで未修正のためfailとした。加えて`PR113-NR-002`、`003`、`005`、最小`007`はclosureに必要なactual composition fixtureまたはfocused evidenceが不完全である。

  必須観点の判定:

  | 観点 | 判定 | 根拠 |
  | --- | --- | --- |
  | 要求・設計適合 | `checked_finding` | NR-004のcurrent snapshot membership契約がactual compositionで未達 |
  | correctness / edge cases | `checked_finding` | A→B stale nodeがproduction分岐で受理される |
  | scope discipline / unrelated changes | `checked_no_finding` | 後続NR-001/006/008/009/010を実装blockerへ混在させていない |
  | changed files / direct dependency impact | `checked_finding` | runtimeとVS Code wrapper間の分岐不整合を検出 |
  | API・data・configuration・workflow・compatibility | `checked_no_finding` | 公開schema/formatの破壊的変更なし。canonical URI変更の直接依存を確認 |
  | error handling / failure diagnostics | `checked_no_finding` | NR-002/003のcatch/report経路は静的に成立。ただしcomposition evidenceは下表のgap |
  | security / secret handling | `not_applicable` | credential・外部入力権限の変更なし |
  | tests / validation adequacy | `checked_finding` | NR-004 fixtureがproduction経路を通らず、NR-002/003/005/007のclosure evidenceも不完全 |
  | CI exact-head evidence | `unexplored` | reviewed HEADのCIは未発生/未提示。今回のnormal fix verificationでは再実行しない |
  | report / tracking accuracy | `checked_finding` | `tasks/tasks-status.md`の「ブロッカーなし」とNR-004実装済み主張はactual composition検査結果と不一致 |
  | regression / maintainability risk | `checked_finding` | parallel API（`workingTreeFileTarget`と`openWorkingTreeFile`）の一方だけへvalidationを追加したため迂回が残った |

  finding別の完全性matrix:

  | Finding | 必須対応 | Production path | Actual composition fixture | Focused evidence | 判定 |
  | --- | --- | --- | --- | --- | --- |
  | PR113-NR-002 | await後current source確認 | `vscode-pull-request-progress-tree.ts:160-174`に実装 | なし | build/lintのみ。競合testなし | Incomplete / capability gap |
  | PR113-NR-002 | fire-and-forget rejectionをerror boundaryへ接続 | `vscode-pull-request-progress-tree.ts:137-152`に実装 | なし | rejection/report testなし | Incomplete / capability gap |
  | PR113-NR-003 | `applied`維持、後続projection attempt、failure個別報告 | synchronizer、runtime wrapper、T305 reporterに実装 | helper単体fixtureのみ。actual command compositionなし | focused suiteではhelper caseがpass | Incomplete / capability gap |
  | PR113-NR-004 | current node/snapshot membershipをworking-tree openへ適用 | runtime直下には実装したがVS Code wrapperが迂回 | 新規fixtureはruntime直下だけでproduction wrapperなし | focused case passはproduction defectを捕捉しない | **Incomplete / blocking** |
  | PR113-NR-005 | routing/command/pair/side/sessionをcanonical URIへ統一 | `extension.ts`と`t305-extension.ts`で実装 | string-only runtime fixture。Host fixtureはprovider ownershipのみ | special-path unit case pass、Host未実行 | Incomplete / capability gap |
  | PR113-NR-007-MIN | actual provider経由`.ts`のlanguageId確認 | Extension Host testに実装、`test:vscode`経由でCI配線済み | actual Extension Host fixtureあり | reviewed HEADの実行証跡なし | Incomplete / capability gap |

## リスク

- 未解決のリスクまたは後続対応: 最優先は`PR113-NR-004`のactual composition bypass修正と、同経路のA→B回帰fixture追加である。その後、全findingのcompleteness matrixをCompleteにし、同一reviewerによるfix verificationを行う必要がある。`npm run test:unit`はR2でexit code 1のため全体Greenではないが、観測されたIssue #13 path/owned Extension Host launch failuresは今回変更pathとの因果が示されていないためheldとし、今回変更によるregressionとしては扱わない。actual Extension Host、full gate、exact-head CIは未確認であり、successを主張しない。`PR113-NR-001`、`006`、`008`、`009`、`010`はnon-blocking heldのままである。実装、commit、push、mergeは行っていない。

# T505 fix verification レポート

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T505`
- Pull Request: `#43`
- Review mode: `fix verification`
- Reviewer: ChatGPT normal review worker（本チャット）
- Reviewer continuity: 初回review submission `4873955130` と同じreview chat
- Base branch: `main`
- Base SHA: `112198c33823a5fc6681399a19e0c5361614143f`
- 初回reviewed implementation HEAD: `253123e51c5b30a5697392f7540743bd46bdf8d1`
- 初回review evidence HEAD: `b066d89d1886b253a14a18462440d870ff2572c6`
- Fix technical HEAD: `fdf324864a4227b3319cb50337fa880cdfe23267`
- 今回reviewed current HEAD: `571831f7ef687a0c4ecb9d65eb829fee50e590e2`
- Fix比較範囲: `b066d89d1886b253a14a18462440d870ff2572c6..571831f7ef687a0c4ecb9d65eb829fee50e590e2`
- Fix変更: 13 files、+844 / -56相当（report/handoffを含む）、7 commits
- Review verdict: **fail / changes required**
- Merge: 未実施

本レポートとfix-verification handoffは、上記reviewed current HEAD後のreview証跡であり、product修正ではない。

## 2. 適用したSkillとreview方針

アップロードされた`chatgpt-worker-skills.zip`から次を確認し、同じnormal reviewerによる`fix verification`として実施した。

1. `work-context-manager`
2. `review-worker`
3. `report-writer`
4. `chat-handoff-manager`

前回findingのIDとseverityを維持し、各findingの修正差分、直接依存、同一欠陥クラスのsibling case、新規変更領域を確認した。実装修正とmergeは行っていない。

## 3. 対象範囲

### 3.1 Fix変更file

- `package.json`
- `src/adapters/repository-files/node-repository-file-enumerator.ts`
- `src/application/file-exclusion/review-file-exclusion-policy-service.ts`
- `src/application/non-git-snapshots/index.ts`
- `src/application/non-git-snapshots/non-git-snapshot-settings.ts`
- `src/t305-extension.ts`
- `src/t505-global-understanding-source.ts`
- `test/unit/global-understanding-ui.test.ts`
- `test/unit/t305-validation-wiring.test.ts`
- `test/unit/t505-global-understanding-source.test.ts`
- `test/unit/t505-review-findings.test.ts`
- `reports/issue-1-t505-review-followup-20260806210039.md`
- `handoffs/issue-1-t505-review-followup-20260806210039.yaml`

### 3.2 直接確認した依存

- `src/ui/global-understanding/global-understanding-ui-model.ts`
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`
- `src/application/global-understanding/global-understanding-background-recalculator.ts`
- `src/application/non-git-snapshots/index.ts`の既存storage cleanup・latest pointer contract
- `src/core/file-exclusion/review-file-exclusion-policy.ts`
- `.github/workflows/ci.yml`
- `tasks/tasks-status.md` T505/T506/T601
- 設計書rev4のGlobal理解率、共通除外policy、Status Bar、設定、certainty-first error policy

## 4. 診断artifact workflow確認

`.github/workflows/ci.yml`はreview開始時点で、失敗時に次をartifactへ保存する。

- build、typecheck、architecture、lint、unit、focused、integration、Extension Hostの標準出力・標準エラー
- test結果と生成物
- `src/`、`test/`、`tools/`、`type-fixtures/`
- package、TypeScript、ESLint、workflow定義
- Node/npm/runner/SHA/ref、Git status、生成file一覧

追加workflow変更は不要である。

## 5. 前回findingのfix verification

| Finding | Source severity | Disposition | 結論 |
| --- | --- | --- | --- |
| `T505-R001` | High | addressed | live open-document evidenceとchange/save/close refreshは接続された |
| `T505-R002` | Medium | **open / not fully addressed** | 単体上限とaggregate fieldは分離したが、上限間の不変条件がなく、保存成功後に新snapshot自体を削除できる |
| `T505-R003` | Medium | addressed | Globalはbase runtimeが受理した同一last-valid exclusion serviceを使用する |
| `T505-R004` | Medium | addressed | 不正・unsafe設定はdefaultへfallbackし、manifest maximumも追加された |

### 5.1 `T505-R001` High — addressed

#### 確認内容

- `src/t305-extension.ts`はopen `TextDocument`からpath、owner revision、line count、非空行index、content hash、document versionを一つのsnapshotとして取得する。
- `src/t505-global-understanding-source.ts`はopen fileについて、T503 denominatorとT504 content evidenceを同じsnapshotから置換する。
- `openFilePaths`をT504へ渡してopen file優先を維持する。
- `onDidChangeTextDocument`、`onDidSaveTextDocument`、`onDidCloseTextDocument`がGlobal refreshへ接続された。
- `validateCurrent`でversion/hash変化を検出し、不確実なsnapshotを公開しない。

前回のdisk-only計算は解消されている。ただし、この修正と既存refresh controllerの組合せに新規finding `T505-R005`がある。

### 5.2 `T505-R002` Medium — open / not fully addressed

#### 修正された点

- `maxSnapshotCompressedBytes`と`maxTotalCompressedBytes`が分離された。
- user-facing `maxSnapshotFileSizeBytes`はper-snapshot fieldへだけ設定される。
- aggregate defaultは`128 * 5 MiB`として独立した。

#### 残存問題

`NonGitSnapshotTracker`は次の順序で保存する。

1. `compressed.byteLength <= maxSnapshotCompressedBytes`だけを確認する。
2. snapshotをstorageへ`put`する。
3. aggregate cleanupで`totalBytes > maxTotalCompressedBytes`なら古い順に削除する。
4. `save()`は削除されたかを確認せず成功を返す。
5. `saveLatest()`はその後でlatest pointerを返却されたsnapshot IDへ設定する。

`maxTotalCompressedBytes >= maxSnapshotCompressedBytes`のconstructor invariantがなく、manifestはper-snapshot値を`Number.MAX_SAFE_INTEGER`まで受理する一方、resolverのaggregate budgetは約640 MiBで固定される。したがって、per-snapshot設定をaggregate budgetより大きくした場合、per-snapshot判定を通過した単一snapshotがcleanupで自分自身を削除され、`saveLatest()`が不存在snapshotをlatestとして公開できる。

また、公開`NonGitSnapshotLimits`は新旧3 fieldをすべてoptionalにしたため、TypeScript上はper-snapshot/aggregateの片方もlegacy fieldも持たない不完全設定を受理し、runtime constructorで初めて失敗する。

#### Impact

- 設定値以内のsnapshot保存が成功したように見えて直後から`missing`となる。
- Gitなしfileのreview evidenceが次回openでfail-closed消失する。
- per-snapshot設定の意味がaggregate defaultを超える範囲で成立しない。
- public contractが不完全limit objectをcompile時に拒否できない。

#### Required action

1. `maxTotalCompressedBytes < maxSnapshotCompressedBytes`の小さい決定的fixtureをRedとして追加し、保存したsnapshot自身が削除されないこととlatest pointerが存在することを検証する。
2. constructorで`maxTotalCompressedBytes >= maxSnapshotCompressedBytes`を要求するか、user resolverでaggregate budgetを少なくともper-snapshot上限以上へ引き上げる。
3. `NonGitSnapshotLimits`を、legacy fieldを必須とするvariant、または新しい2 fieldを両方必須とするunionへ変更し、不完全組合せを型で拒否する。
4. cleanup後に保存対象が存在することを保証してから`save()`/`saveLatest()`を成功させる。

Severityは前回の**Medium**を維持する。

### 5.3 `T505-R003` Medium — addressed

- base activationで作成された`ReviewFileExclusionPolicyService`をGlobal sourceとrepository enumeratorが共有する。
- invalid updateではserviceのcurrent policyとrevisionが更新されず、PR側とGlobal側が同じlast-valid policyを継続する。
- Global cache keyはshared serviceのrevisionを使用する。
- effective policy change eventがGlobal refreshへ接続された。

ambient active-service getterは将来のcomposition riskとして残るが、今回対象のproduction activation順序では前回findingを再現しないためrequired findingとはしない。

### 5.4 `T505-R004` Medium — addressed

- resolver入力を`unknown`としてpositive safe integerだけを受理する。
- 0以下、非整数、NaN、Infinity、safe integer外は5 MiB defaultへfallbackする。
- manifestに`maximum: Number.MAX_SAFE_INTEGER`が追加された。
- activation側はfallback済みlimitsを受け取るため、前回の同期throw経路は解消された。

invalid設定を注入したExtension Host fixture自体はないが、resolver境界とproduction activation callsiteを確認し、product findingはaddressedと判定する。

## 6. 新規finding

### `T505-R005` Medium — staleなlive-buffer再計算が通常入力中にerror notificationを発生させる

- Severity: **Medium**
- Origin: `introduced_by_fix`
- Location:
  - `src/t305-extension.ts` の`onDidChangeTextDocument` refresh
  - open-document `validateCurrent`
  - `src/ui/global-understanding/global-understanding-ui-model.ts` の`GlobalUnderstandingRefreshController.refresh()`
  - `src/ui/global-understanding/vscode-global-understanding-runtime.ts` の`refreshWithErrorBoundary()`
- Description:
  - document changeごとにrepository全体のGlobal recalculationを即時開始する。
  - 次の入力が先行計算の完了前に発生すると、先行snapshotの`validateCurrent`はversion/hash不一致で意図どおりthrowする。
  - refresh controllerはgenerationが古い場合に表示clearを抑止するが、error自体は常にrethrowする。
  - runtime error boundaryはrethrowされたstale errorを毎回`showErrorMessage`へ渡す。
- Evidence:
  - `GlobalUnderstandingRefreshController`のcatchは`currentGeneration !== generation`でも`throw error`する。
  - 既存test `an older failed recalculation cannot clear a newer Global snapshot`も、古い計算のrejectを期待している。
  - R001 fixは全text changeへrefreshとversion-bound `validateCurrent`を追加した。
- Impact:
  - 通常の連続入力だけで「Open document changed during Global recalculation」のerror notificationが繰り返され得る。
  - 大規模repositoryほど先行計算が重なり、通知頻度と不要なI/Oが増える。
- Required action:
  1. generationが古い計算の失敗をcancellationとして吸収し、`reportError`へ渡さないRed testを追加する。
  2. document-change refreshをdebounce/coalesceし、最新versionの計算だけを実行・通知対象にする。
  3. current generationの実障害だけは従来どおりclear・reportする回帰testを維持する。

### `T505-R006` Low — `test:t505`がreview finding regressionsを実行しない

- Severity: **Low**
- Origin: `coverage_miss`
- Location: `package.json`、`test/unit/t305-validation-wiring.test.ts`
- Description:
  - 新規`test/unit/t505-review-findings.test.ts`は`test:unit`内の`t305-validation-wiring.test.ts`からtransitive importされる。
  - 専用command `npm run test:t505`は`global-understanding-ui.test.js`だけを起動し、そのmoduleはreview finding testをimportしない。
- Impact:
  - T505だけをfocused検証する標準commandで`R001`〜`R004`回帰が実行されない。
  - follow-up修正時にfocused greenだけを根拠にするとcritical regressionを見落とせる。
- Required action:
  - `test:t505`へ`t505-review-findings.test.js`を直接追加するか、T505専用root suiteから明示的にimportし、focused commandで各finding testが一度だけ実行されるcontract testを追加する。

### `T505-R007` Low — follow-up handoffがZIP Skillのschema v3 contractを満たさない

- Severity: **Low**
- Origin: `introduced_by_fix`
- Location: `handoffs/issue-1-t505-review-followup-20260806210039.yaml`
- Description:
  - fileは`schema_version: 3`を名乗るが、`chat-handoff-manager`のrequired packetではなく、全情報を独自のtop-level `handoff:`配下へ格納している。
  - required top-level `producer`、`repository`、`issue_or_pr`、`target.current_head/reviewed_head`、`authorized_actions`、`write_boundary`、`commands`、`tests`、`ci`、`review`、`report`、`source_payloads`、`next_action`、`transport`が欠落する。
- Impact:
  - schema v3 readerがtyped projectionとして解釈できず、reviewer continuity、current/reviewed identity、権限、validation、raw source outputをlosslessに引き継げない。
- Required action:
  - ZIP内`chat-handoff-manager/SKILL.md`のschema v3 required packetで再生成し、元packetを`source_payloads`へ保存する。finding ID/severity、technical/current HEAD、exact-head CI、permissions、write boundary、next actionをtyped fieldへ投影する。

## 7. Coverage disposition

| 観点 | 判定 | 根拠 |
| --- | --- | --- |
| requirement / design conformance | checked_finding | R002の設定意味と保存contractが未完了 |
| correctness / edge cases | checked_finding | R002 self-eviction、R005 stale error reporting |
| scope discipline | checked_no_finding | fixはreview findingと証跡に限定 |
| changed files / direct dependencies | checked_finding | snapshot tracker、refresh controllerとのcross-component defect |
| API / data / configuration / workflow compatibility | checked_finding | R002 optional limits contract、R007 handoff schema |
| error handling / failure diagnostics | checked_finding | R005 stale cancellationをuser errorとして報告 |
| security / secret handling | checked_no_finding | secret追加・外部source送信なし |
| tests / validation adequacy | checked_finding | R006 focused suite gap、R002/R005 sibling regressionsなし |
| current-HEAD CI evidence | checked_no_finding | run `31099795538`がHEAD `571831...`と一致してsuccess |
| report / tracking / documentation | checked_finding | reportはfinding continuityを保持、handoff schemaは不適合、trackingはheld |
| regression / maintainability | checked_finding | split limits invariant、document-change concurrency、ambient policy getter risk |

## 8. TDD・CI evidence

### 8.1 Review follow-up RED

- RED HEAD: `b99c688a0aafa1927ac9a284c04e911d6e105208`
- Exact-head CI: run `31097985105`
- Conclusion: `failure`
- Diagnostic artifact: `8966248721` / `ci-failure-diagnostics-31097985105-1`
- Artifact head SHA: `b99c688a0aafa1927ac9a284c04e911d6e105208`

Tests were committed before production changes. REDはunit compileで、未実装のsplit-limit、shared policy、live evidence、fallback contractを検出した。

### 8.2 Technical fix GREEN

- Technical HEAD: `fdf324864a4227b3319cb50337fa880cdfe23267`
- Exact-head CI: run `31099364549`
- Job: `92608926179`
- Conclusion: `success`

### 8.3 Current reviewed HEAD GREEN

- Reviewed current HEAD: `571831f7ef687a0c4ecb9d65eb829fee50e590e2`
- Exact-head CI: run `31099795538`
- Job: `92610318267`
- Conclusion: `success`
- Success gates: build、contract typecheck、architecture positive/negative、lint、unit、T403、T304、T502、T503、T504、Git、GitHub、VS Code Extension Host
- Unit result recorded by follow-up: 462 passed / 0 failed

CI successは既存test範囲の成功を示すが、R002 self-eviction、R005 stale error suppression、R006 focused discoveryを検証していないためverdictを覆さない。

## 9. Held・unexplored

### Held

- `tasks/tasks-status.md`と`tasks/phases-status.md`同期
  - 専用`task-breakdown-planner`、`task-consistency-manager`、`progress-sync-manager`が必要で現在利用不可。
  - technical finding closure後にauthorized managerが更新する。

### Unexplored / 後続task所有

- T506: 複数context・再起動を通したAC-18〜AC-20統合
- T605: Remote SSH、Dev Containers、Codespaces、multi-root実host境界
- T607: 大規模repositoryでのdebounce値・段階表示・性能計測

R005の通常入力時stale error suppressionはT607の性能最適化ではなく、T505 fixで導入したerror-policy correctnessであるため今回のrequired findingとする。

## 10. 最終判定

**fail / changes required**

- `T505-R001`: addressed
- `T505-R002`: open / not fully addressed（Medium維持）
- `T505-R003`: addressed
- `T505-R004`: addressed
- 新規required finding: `T505-R005` Medium、`T505-R006` Low、`T505-R007` Low

実装chatでTDD修正、詳細follow-up report、正規schema v3 handoff、new implementation HEADに完全一致するCIを揃えた後、同じnormal reviewerで再度fix verificationを行う。

PRはdraftのまま維持し、mergeしない。

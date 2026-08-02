# T502 独立最終広域レビュー

## 1. Metadata / target identity

- Repository: `ssaattww/RevMem`
- Issue / task: Issue #1 / T502
- Pull Request: #37 `T502: Global mappingと表示優先順位を実装`
- Review mode: `independent_final_review`
- Branch: `task/t502-global-mapping-display-priority`
- Base ref: `origin/main`
- Base SHA: `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Reviewed implementation HEAD: `a18475ef05e6db7979c2247e4189e57caf9649a4`
- Commit range: `origin/main...a18475ef05e6db7979c2247e4189e57caf9649a4`
- Reserved report path: `reports/issue-1-t502-independent-final-review-20260803062000.md`
- Reviewer: fresh independent reviewer sub-agent `/root/pr37_independent`
- Independence evidence: T502の実装、review fix、通常review、fix verificationのいずれにも関与していない。review中にproduct、test、workflow、tracking、commit、push、PR、mergeを変更していない。
- Technical verdict: `fail`

このtechnical verdictは上記のreviewed implementation HEADだけに適用する。review開始後もGit HEADは同一SHAであり、予約済みreport以外のtracked/untracked pathを変更していない。

## 2. Purpose, scope, and non-goals

T502の要件・設計、PR diff全体、全changed files、直接依存、正確性とedge case、API/data/config/workflow compatibility、error/security、tests/CI、reports/tracking、regressionを独立に再評価した。

主な要件は次のとおりである。

- `tasks/tasks-status.md` T502: edit、Git diff、renameによるGlobal mapping
- `tasks/tasks-status.md` T502: 現在PR未確認変更を最優先する6段階の表示優先順位
- `tasks/tasks-status.md` T502: 現在PR変更行はGlobalだけでグレーにならず、曖昧・変更済みは通常背景になる
- `doc/design/vscode-review-range-tracker-design.md` 11.4: current PR unreviewed、untrackable/changed、current context、other context、Global、unreviewedの順序
- `tasks/phases-status.md`: 一意に証明できない範囲を確認済みにしない

非対象としてGlobal理解率calculator/cache、Global Understanding View、Status Bar、設定UI、mergeを維持した。ただし`review-enforcer`のpre-freeze gateが要求するtracking同期は独立最終reviewの対象であり、実装reportでnon-goalとしたことだけでは省略できない。

## 3. Inspected changed files

`origin/main...a18475ef05e6db7979c2247e4189e57caf9649a4`の16 changed pathsを全て確認した。

| Path | Disposition |
| --- | --- |
| `.github/workflows/ci.yml` | focused testのCI実行とfailure logを確認。exact-head CIは成功。ただしrepository scriptとの不整合は`T502-IFR-005` |
| `src/application/global-review-mapping/global-review-mapping.ts` | 全230行とT203/T204直接依存を確認。`T502-IFR-002`、`T502-IFR-003` |
| `src/application/global-review-mapping/index.ts` | additive public exportを確認 |
| `src/application/editor-decoration/normal-editor-decoration-model.ts` | 全340行とT301 validator、interval、extension consumerを確認。`T502-IFR-001` |
| `test/unit/global-review-mapping-display-priority.test.ts` | 7 testを確認・実行。finding再現caseが不足。`T502-IFR-001`〜`003`、`T502-IFR-005` |
| `reports/issue-1-t502-implementation-20260802210500.md` | scope、TDD、CI、remaining riskを確認 |
| `reports/issue-1-t502-handoff-20260802210500.yaml` | YAML parse成功、implementation identityを確認 |
| `reports/issue-1-t502-review-20260802213000.md` | source finding `T502-REV-001`〜`004`とseverityを確認 |
| `reports/issue-1-t502-review-followup-20260802220000.md` | 4 finding対応主張とTDD証跡を確認 |
| `reports/issue-1-t502-review-followup-handoff-20260802220000.yaml` | YAML parse成功、finding continuityを確認 |
| `reports/issue-1-t502-fix-verification-20260802221000.md` | `T502-REV-003 high` openの根拠を確認 |
| `reports/issue-1-t502-fix-verification-handoff-20260802221000.yaml` | YAML parse成功、source severity維持を確認 |
| `reports/issue-1-t502-review-followup-r2-20260802223000.md` | complete diff validation fixとRed/Green証跡を確認 |
| `reports/issue-1-t502-review-followup-r2-handoff-20260802223000.yaml` | YAML parse成功、addressed-awaiting-verificationを確認 |
| `reports/issue-1-t502-fix-verification-r2-20260802223000.md` | 通常review全finding closedの根拠を確認 |
| `reports/issue-1-t502-fix-verification-r2-handoff-20260802223000.yaml` | YAML parse成功。current reviewed identityとvalidation planを確認。`T502-IFR-004`、`T502-IFR-005` |

## 4. Direct dependencies and consumers

次を直接確認した。

- `src/core/range-mapping/range-mapping-engine.ts`
- `src/core/git-diff/git-diff-interval-mapping.ts`
- `src/core/git-diff/revision-interval-mapper.ts`
- `src/core/git-diff/git-file-state-transition.ts`
- `src/core/git-diff/validated-git-file-state-transition.ts`
- `src/core/pr-progress/pr-diff-progress.ts`
- `src/core/file-exclusion/review-file-exclusion-policy.ts`
- `src/core/intervals/*`
- `src/core/contracts/review-state.ts`
- `src/core/review-state/*`
- `src/application/editor-decoration/index.ts`
- `src/ui/normal-editor/normal-editor-decoration-controller.ts`
- `src/extension.ts`
- `package.json`、`tsconfig*.json`、`eslint.config.mjs`
- `tasks/tasks-status.md`、`tasks/phases-status.md`
- PR #37 body、comments、reviews、status checks

既存T201/T203/T204/T301 contractの再利用方針自体はarchitectureに適合する。additive barrel export、optional input fields、workflow permissionには直接の破壊的変更を確認しなかった。

## 5. Findings

### T502-IFR-001 — high — diff file ID不一致を「対象fileに変更なし」と扱いlower layerをfail-openする

- Origin: independent final review
- Location: `src/application/editor-decoration/normal-editor-decoration-model.ts:188`
- Description: validated diff内にtargetと同じ`newPath`の変更が存在しても、そのentryの`fileId`がtargetと異なると`find`が失敗し、`{ certain: true, intervals: [] }`を返す。context側にtarget fileが存在することとdiff側の同一path・別file IDが矛盾しているにもかかわらず、「変更なし」と確定している。
- Impact: 現在PRで変更された行をother-contextまたはGlobalだけでグレー表示できる。T502の終了条件とAC-24のfail-closed原則に直接違反する。
- Evidence: exact reviewed HEADをcompile後、current contextの`fileId: f1`と同じ`src/a.ts`をdiffが`fileId: different-id`で変更するvalid-shape snapshotを入力した。modelは変更行を含む`[0,2)`を`source: other-context`、`globalActive: true`として返した。
- Required action: target file IDがdiffにない場合、同一canonical current pathを別IDが占有していないことを確認する。path/file identityが矛盾する場合は`certain: false`としてcurrent context以外をfail-closedにする。same-path/different-ID regressionを追加する。

### T502-IFR-002 — high — same-path Git metadataのfile identityを検証せず別fileのcontent proofを採用する

- Origin: independent final review
- Location: `src/application/global-review-mapping/global-review-mapping.ts:179`
- Description: ordinary modified fileのmanual T203 mappingで、`newFiles[diffFile.newPath]`の`fileId`がoriginal Global fileと一致するか確認せず、`contentHash`と`newText`を使用する。T204 wrapperはsame-path modified fileに対するこのidentity関係を検証しない。
- Impact: destination metadataが別file identityを示していても、旧Global reviewed rangeを維持したまま別content hashを付け、新revisionでcertainなGlobal状態として公開する。replacement、stale metadata、producer identity不整合時にfalse-reviewed stateを生成できる。
- Evidence: `f1 / src/a.ts`のGlobal stateへ、same-path modified diffと`newFiles['src/a.ts'] = { fileId: 'different-file', contentHash: 'different-content' }`を渡した。関数はrejectせず、`f1`のreviewed `[0,1)`を維持して`contentHash: different-content`を返した。
- Required action: same-path modified mappingでもdestination metadataのfile IDがoriginal stable IDと一致することを必須にする。不一致はtransaction全体をrejectして確認済みを推測しない。identity mismatch regressionを追加する。

### T502-IFR-003 — medium — optional old line-count fallbackがdiff evidenceを無視して有効なrenameを拒否する

- Origin: independent final review
- Location: `src/application/global-review-mapping/global-review-mapping.ts:111`
- Description: `oldLineCounts`省略時の`inferredLineCount`は`reviewed` interval最大端、またはnew revisionのline countをold line countとして使用する。diff hunkが証明するold extentを考慮しない。
- Impact: sparseなreviewed rangeを持つ長いfileの末尾付近を変更するrenameで、実際には有効なmappingでもsynthetic old line countが小さすぎてRangeErrorとなる。Global追従が不要に停止する。
- Evidence: 実際のold line countが100、reviewedが`[0,1)`、line 100を削除しながらrenameするdiffは、`oldLineCounts`省略時に`Mapped reviewed interval is outside the new lineCount.`でrejectされた。同じ入力へ`oldLineCounts: { f1: 100 }`を渡すと`[0,1)`を維持して正しくrenameした。
- Required action: complete inputにold line-count evidenceを必須化するか、reviewed boundsと全old hunk extentからsoundな下限を構築し、new metadataをold countとして使用しない。sparse interval・末尾hunk・rename regressionを追加する。

### T502-IFR-004 — medium — independent-final-review freeze前のtask/phase trackingが未同期

- Origin: independent final review lifecycle / report and tracking audit
- Location: `tasks/tasks-status.md:278`、`tasks/phases-status.md:33`
- Description: frozen HEADでもT502は`未着手`であり、P5は表示優先順位を未実施事項として記録している。implementation/fix/normal-review reportsはtask/phase同期をnon-goalとしているが、`review-enforcer`のpre-freeze gateはtrackingをrepository-stableかつactual resultと一致させることを要求する。
- Impact: trackingが実装・通常review完了という実態を表さず、pre-freeze gateが成立していない。独立最終review後にtracking commitを追加するとreviewed implementation HEADを失効させる。
- Evidence: reviewed HEADの上記2 pathは`origin/main`から変更されておらず、T502 `未着手`のままである。最新normal-review handoff自身もfreeze前にtrackingを完了するよう指示している。
- Required action: `progress-sync-manager`と必要なtask consistency Skillを通してtrackingを実態へ同期し、normal fix verification、current-head CI、再freeze、fresh independent final reviewを行う。

### T502-IFR-005 — low — report記載のfocused commandが存在せず既定testから新規suiteが漏れる

- Origin: tests / workflow / report accuracy audit
- Location: `package.json` scripts、`.github/workflows/ci.yml:48`、`reports/issue-1-t502-fix-verification-r2-handoff-20260802223000.yaml:76`
- Description: latest handoffのvalidation planは`npm run test:t502`を要求するが、`package.json`にそのscriptはない。また`test:unit`のhard-coded file listと既定`npm test`は新規T502 testを含まず、GitHub Actionsの専用inline stepだけが実行する。
- Impact: handoffどおりのlocal verificationは即時失敗し、通常のdeveloper test経路ではT502 regressionを実行しない。CIは成功しているが、validation contractとreport accuracyが一致しない。
- Evidence: reviewed HEADで`npm run test:t502`は`Missing script: "test:t502"`となった。`package.json`の`test:unit`と`test`を確認し、T502 fileがないことを確認した。
- Required action: repositoryのtask-focused script規約に合わせて`test:t502`を追加し、既定test経路へ含めるか、report/handoffのcommandを実在するcanonical commandへ訂正してdefault test coverage方針を明示する。

## 6. Coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirement and design conformance | `checked_finding` | `T502-IFR-001`、`T502-IFR-002`、`T502-IFR-004` |
| Correctness and edge cases | `checked_finding` | identity mismatch 2件とsparse rename rejectionを独立再現 |
| Scope discipline / unrelated changes | `checked_no_finding` | PR changed pathsはT502 source/test/workflow/reportに限定 |
| Every changed file | `checked_finding` | 16 pathsを確認。findingはsource、test、workflow/reportに所在 |
| Direct dependency impact | `checked_finding` | T204 validatorがsame-path metadata identityを検証しない境界、T301 target absence境界を確認 |
| API compatibility | `checked_finding` | public Global Git mapping optional evidenceとmetadata identity contractが不十分 |
| Data compatibility / integrity | `checked_finding` | 別file metadataをGlobal stateへ取り込める |
| Configuration compatibility | `not_applicable` | extension configuration、schema、storage formatの変更なし |
| Workflow compatibility | `checked_finding` | exact-head CI成功。ただしlocal/default scriptとの不整合は`T502-IFR-005` |
| Error handling and diagnostics | `checked_finding` | identity矛盾のfail-openとvalid renameの不要なthrow |
| Security and secret handling | `checked_no_finding` | secret/token/network処理変更なし、workflow permissionは`contents: read`。`npm ci`の既存dependency audit warningはPR diff外 |
| Test adequacy | `checked_finding` | focused 7/7は成功するが3 findingのregressionとdefault test wiringが不足 |
| Current-HEAD CI | `checked_no_finding` | push run `30750198411`、pull_request run `30750200113`はいずれもhead SHA完全一致でsuccess |
| Reports / handoffs | `checked_finding` | YAML 5件は全てparse成功、historical severity連続性は維持。focused command不整合は`T502-IFR-005` |
| Task / phase tracking | `checked_finding` | `T502-IFR-004` |
| Documentation / breaking changes | `checked_no_finding` | 設計11.4とtask要件を確認。schema/config/file formatの破壊的変更なし |
| Regression / maintainability | `checked_finding` | identity evidenceが複数境界で別々に解釈され、test discoveryも二重管理 |

## 7. Validation and CI assessment

### Current-HEAD CI

Reviewed HEADと完全一致する2 runを確認した。

- GitHub Actions run `30750198411`, event `push`, head SHA `a18475ef05e6db7979c2247e4189e57caf9649a4`, conclusion `success`
- GitHub Actions run `30750200113`, event `pull_request`, head SHA `a18475ef05e6db7979c2247e4189e57caf9649a4`, conclusion `success`

両runでinstall、build、contract typecheck、architecture positive/negative、lint、unit、T502 focused、T503 focused、Git integration、GitHub integration、VS Code Extension Hostが成功している。別SHAのrunは代用していない。

### Local validation

| Command / check | Result |
| --- | --- |
| initial `npm run compile:test` | dependency未導入のため`tsc`未検出。実装判定には使用せず、`npm ci`後に再実行 |
| `npm ci` | success。392 packages installed |
| `npm run build` | success |
| `npm run typecheck:contracts` | success |
| `npm run validate:architecture` | success |
| `npm run validate:architecture:negative` | success、expected 11 violations |
| `npm run lint` | success |
| `npm run compile:test` | success |
| `node --test test-dist/test/unit/global-review-mapping-display-priority.test.js` | success、7 / 7 |
| identity mismatch diagnostic | `T502-IFR-001`、`T502-IFR-002`を再現 |
| sparse rename diagnostic | `T502-IFR-003`を再現 |
| `npm run test:t502` | failure、missing script。`T502-IFR-005` |
| `git diff --check origin/main...reviewed HEAD` | success |
| T502 handoff YAML parse | 5 / 5 success |

`markdown-word-checker`について、repositoryには`tools/lint/`、`lint:md`、`cspell.config.jsonc`がない。focused/full Markdown terminology gateは`unsupported`でありpassへ変換していない。repo-specific whitelistや`prh`変更は行っていない。本reportは通常の目視校正と`git diff --check`を行う。

## 8. Held, unexplored, unknown, and intentionally untouched

### Held

1. `src/extension.ts`のruntime compositionは`createNormalEditorDecorationModel`へ`otherContextStates`と`currentPullRequestDiff`を供給せず、Global mapping APIにもproduction consumerがない。implementation reportはT504/T505 consumer integration、T506 integration testへ明示的に後送しているため、本reviewではそのownershipをheldとして維持する。ただし後続taskは実際のedit/Git lifecycleと6段階表示をExtension Hostで証明する必要がある。
2. `npm ci`は既存dependency graphに1件のhigh audit warningを報告した。`package.json`と`package-lock.json`はPR diff外であり、T502のsecret/security changeではないためdependency maintenance ownerへheldとする。

### Unexplored

なし。required coverage、全changed files、直接依存、current-head CI、reports/trackingを全てdisposition済みである。

### Unknown

なし。reviewed identity、PR head、base、CI head SHA、finding再現結果は確定している。

### Intentionally untouched

- product code、test、workflow、package scripts、design、tracking
- historical review reportsとfinding severity
- Git commit、push、PR body/comment/review、merge
- `node_modules`、`dist`、`test-dist`はvalidation生成物でありGit対象外

## 9. Severity continuity and previous findings

通常reviewの`T502-REV-001 high`、`T502-REV-002 high`、`T502-REV-003 high`、`T502-REV-004 medium`はhistorical evidenceどおりclosedのまま保持する。severity reclassification、erratumはない。本reportの`T502-IFR-001`〜`005`は独立passで新たに発見したfindingであり、過去findingをsilent reopenまたはrenumberしていない。

## 10. Verdict and next action

Verdict: `fail`

Required findingsが5件あり、verdict-blocking unexplored areaはない。exact-head CI successとfocused 7/7は有効な証拠だが、未試験のidentity mismatchでfalse-reviewed表示・state生成が可能なためpassにはできない。

次のactionは次の順序とする。

1. `T502-IFR-001`〜`005`をfinding identityとseverityを保持してTDDで修正する。
2. `progress-sync-manager`等を通してtask/phase trackingを実態へ同期する。
3. report、handoff、workflow、package、trackingを含む全変更をcommit/pushする。
4. 通常reviewerがfix verificationし、current implementation HEAD一致のfull CIを確認する。
5. non-final repository writeを全て完了後に新しいimplementation HEADをfreezeする。
6. fresh independent reviewerで独立最終reviewを最初から実施する。

mergeは実施しない。

## 11. Persistence and attestation conditions

- Report type: `independent_final_review_report`
- Persistence mode: failure evidenceとしての`repository_file`
- Reserved path: `reports/issue-1-t502-independent-final-review-20260803062000.md`
- `report_attestation_allowed`: `false`
- `report_attestation_head`: `null`

Verdictが`fail`であるため、このreportをterminal administrative attestation commitとして扱ってはならない。reportをcommitする場合は通常review evidenceとして次のfix lifecycleへ含め、そのcommit後のHEADは今回のtechnical verdict対象ではない。

将来passing independent final reviewをattestするには、少なくとも次を全て満たす必要がある。

- 新しいreviewed implementation HEADのfirst parentとしてattestation commitを1件だけ作成する
- 事前予約した独立最終review report path以外を変更しない
- reportが新しいreviewed implementation HEADを明記する
- executable、Skill、design、workflow、configuration、tracking、feedback、handoff、product pathを変更しない
- attestation後にlater Git commitを作成しない
- attestation SHAをPR metadata、comment、またはbranch外handoffへ外部記録する

今回のfinding修正、tracking同期、normal fix verificationが必要なため、上記attestation条件は現時点で成立しない。

# Issue #110 / PR #111 初回通常レビュー報告

- 日付: 2026-09-02
- Repository: `ssaattww/RevMem`
- Issue: #110 `T609 Extension Hostテストの実行時間を短縮して開発待ち時間を削減する`
- Pull Request: #111 `Issue #110: T609 Extension Hostのencoding切替待ちを解消する`
- Review mode: initial normal review
- Reviewer: GPT-5.6 Pro / このレビュー用ChatGPTチャット
- Reviewer continuity: このチャットはPR #111の実装・修正を行っていない。独立final reviewではなく、初回通常レビューとして実施した。
- Verification capability: `remote_ci_only`
- Merge boundary: mergeは実施しない

## 1. 固定したレビュー対象

- Base branch: `main`
- Base SHA: `d2ebe6d3cdb878dfbf46a4b9e46bd86de7162299`
- Implementation branch: `issue-110-t609-test-speed`
- Reviewed implementation HEAD: `b4b4ab875bee2e3a10f4b79300ac5ab37cfc358b`
- Commit range: `d2ebe6d3cdb878dfbf46a4b9e46bd86de7162299..b4b4ab875bee2e3a10f4b79300ac5ab37cfc358b`
- Compare status: ahead 9 / behind 0
- Changed files: 4
- Diff summary: +221 / -18

変更ファイル全件:

1. `reports/2026-09-02-issue-110-t609-extension-host-speed-report.md`
2. `test/unit/t404-review-followup-r3.test.ts`
3. `test/unit/t609-gate-wiring.test.ts`
4. `test/vscode/t609-suite/index.ts`

レビュー中の最終HEAD再確認時もPR #111のHEADは上記SHAから変化していなかった。

## 2. 要求・非対象

Issue #110の主要要求を次のように固定した。

- T609 Extension Host `single-root` phaseの長時間待機箇所を特定する。
- 既存T609 unit/Extension Host契約と、repository解決、multi-root cancel、Shift-JIS、UTF-8 BOM、unsupported encoding隔離、rename/restart復元を維持する。
- 不要な待機・直列化・重複処理を削減する。
- 修正前約3分31秒より明確に短縮したことをCIで確認する。
- CI失敗時の診断artifact契約を維持する。
- final verificationにはPR current HEADと一致するworkflow runだけを使う。
- 詳細reportをrepositoryへ保存し、PRへ簡易reportを投稿する。

非対象はT609機能仕様変更、T610等の性能最適化、coverage削減である。

このIssueでは利用者の明示指示によりRed-first TDDは要求されていない。

## 3. 確認したファイル・直接依存・外部契約

変更4ファイルの全差分に加え、次を確認した。

- Issue #110本文とPR #111本文、commit range、既存コメント・レビュー状態
- `doc/design/vscode-review-range-tracker-design.md`のencoding hint、encoding変更時の再計算、mixed encoding、Extension Host受け入れ条件
- `src/t305-extension.ts`の`onDidChangeTextDocument`、`DocumentReviewEditRuntime.apply()`、`drainDocumentReviewEdits()`、visible decoration refresh、document close時のforget経路
- `package.json`のVS Code engine `^1.125.0`、T609 focused/unit/Extension Host wiring
- `.github/workflows/ci.yml`のT609 required gate、failure collection、artifact upload
- `tools/run-ci-command.mjs`のstdout、stderr、combined log、result metadata保存
- `tasks/tasks-status.md`のT609状態
- VS Code 1.125.0公式`vscode.d.ts`の`workspace.openTextDocument(uri, { encoding })`契約
- baseline run `32565706538`
- diagnostic run `33580679112`
- instrumented fix run `33581601811`
- clean code run `33582422518`
- current exact-head run `33582954332`

## 4. 実装・テスト変更の評価

### 4.1 T609 live encoding transition

`test/vscode/t609-suite/index.ts`は、Shift-JIS documentのtabを閉じて`onDidCloseTextDocument`を待つ経路を廃止し、既に開いている同一URIを次でUTF-8へ再decodeする。

```ts
vscode.workspace.openTextDocument(shiftedUri, { encoding: "utf8" })
```

その後に次を直接待機する。

- `api.drainDocumentReviewEdits()`
- `api.refreshVisibleEditorDecorations()`
- `api.drainVisibleEditorDecorations()`

さらに、同一revisionでShift-JIS fileのContext/Global reviewed rangeが空になること、無関係なUTF-8 BOM fileのContext/Global状態が変化しないこと、UTF-8 BOM documentがopenのままであることを検証している。

VS Code 1.125.0の公式API契約は、既に開かれたdocumentを異なるencodingでopenするとtext contentsが変わり得ること、dirty documentではerrorになることを明記している。今回のfixtureはdocument本文をdirtyにせずreview stateだけを変更しており、API利用は契約範囲内である。

Production側の`onDidChangeTextDocument`から`DocumentReviewEditRuntime.apply()`へ到達し、追加されたdrain後にpersisted stateを観測するため、test-only mutationへ置き換えたcoverage低下は確認していない。

### 4.2 T609 gate contract

`test/unit/t609-gate-wiring.test.ts`は次を固定している。

- explicit UTF-8 re-decode APIを使用する。
- re-decoded documentのencodingが`utf8`である。
- `assertLiveEncodingTransition()`内に`closeDocument(shifted)`、`onDidCloseTextDocument`、`tabGroups.close`を再導入しない。
- 無関係なUTF-8 BOM documentを閉じない。

静的契約だけでなくcurrent exact-head Extension Host testも成功しているため、待機削除だけでbehavior assertionを失った証拠はない。

### 4.3 T404 month rollover修正

実際の変更先は`test/unit/t404-review-followup-r3.test.ts`である。

固定された`events-2026-08.jsonl` 1ファイルの読取を、`events-YYYY-MM.jsonl`の列挙・sort・連結へ変更している。`YYYY-MM`は固定幅なのでcode-unit sortで時系列順となり、`Promise.all`は入力順で結果を返す。temporary history directory内の対象monthly filesだけを読むため、月跨ぎに対するtest fixture修正として妥当である。

この変更はIssue #110の主機能とは別だが、2026-09 UTCへの月跨ぎで既存required unit testが失敗したことへの限定的なtest-only修正であり、PR本文に明示されている。production history persistenceは変更していない。

## 5. 必須coverage disposition

| 観点 | 判定 | 根拠 |
| --- | --- | --- |
| 要求・設計適合 | Pass | 長時間待機原因の特定、coverage維持、短縮、exact-head CI、診断artifact維持を確認。T609機能仕様変更なし |
| correctness / edge cases | Pass | explicit encoding re-decode後にproduction edit/decorationsをdrainし、対象file clearとUTF-8 BOM非干渉をassert。公式VS Code API契約とも整合 |
| scope discipline | Pass | 主変更はT609 test lifecycle。T404変更は月跨ぎで露出したrequired testのtest-only修正として限定・開示済み |
| changed files / direct dependencies | Pass | 4/4 changed filesとT305 production event path、design、manifest、workflow、runnerを確認 |
| API / data / config / workflow / compatibility | Pass | VS Code 1.125 API、`files.encoding`変更、existing T609 wiring、schema/data model非変更を確認 |
| error handling / failure diagnostics | Pass | 全CI commandがstdout/stderr/combined/result metadataを保存し、failure時に`test-output`等をartifact化するworkflowが存在 |
| security / privacy | Pass | production/network/credential/path logging変更なし。test fixture内の既存workspace fileだけを対象 |
| tests / regression | Pass | T609 gateとExtension Hostのcurrent exact-head success、full required CI success。既存multi-root/restart等を削除した差分なし |
| exact-head CI | Pass | run `33582954332`の`head_sha`がreviewed HEADと完全一致し、conclusion `success` |
| report / tracking / docs | Fail | 詳細implementation reportが実際のT404変更ファイル名を2箇所で誤記している |
| maintainability | Pass with one required documentation correction | model-disposal待ちの再導入を静的gateで防止。production codeへの不要なtest seam追加なし |

`tasks/tasks-status.md`ではT609が既に完了済みであり、Issue #110は完了済み機能のtest performance maintenanceである。Issue本文にtask state変更要求はなく、今回のdiffでtask statusを変更しないこと自体はfindingとしない。

## 6. CI・性能証拠

### 6.1 Baseline

Workflow run `32565706538`:

- `head_sha`: `6f555c5db87fa0b84cd54a640b6dbf306ced45f5`
- T609 step: `2026-08-22T09:46:35Z`から`09:50:14Z`
- GitHub job metadata上の経過: 約219秒
- conclusion: success

このrunはbaselineとしてのみ使用し、current HEADの合否には使用していない。

### 6.2 Current exact-head

Workflow run `33582954332`:

- Event: `pull_request`
- `head_sha`: `b4b4ab875bee2e3a10f4b79300ac5ab37cfc358b`
- Run attempt: 1
- Job: `build-and-lint`
- Job conclusion: success
- T609 step: `2026-09-02T02:25:43Z`から`02:26:29Z`
- GitHub job metadata上の経過: 約46秒
- Baselineとの差: 約173秒短縮、約79%短縮

成功を確認した主なcurrent-head stages:

- build
- contract typecheck
- architecture positive/negative validation
- lint
- default unit tests
- T403/T404/T405/T406
- T304/T502/T503/T504/T505/T506
- T604/T605/T606
- T609 repository and encoding tests
- T610 folder Global Understanding tests
- temporary Git integration
- mock GitHub integration
- general VS Code Extension Host tests
- package and user-validation artifact upload

Issue #110要求どおり、別SHAのrunをfinal CIの代用にはしていない。

### 6.3 Failure diagnostic artifact contract

`.github/workflows/ci.yml`はfailure時にenvironment、git status、generated file listを収集し、`test-output/`、`dist/`、`test-dist/`、source、test、tools、type fixtures、manifest、lockfile、tsconfig、workflow等を`ci-failure-diagnostics-*` artifactとしてuploadする。

`tools/run-ci-command.mjs`は各commandについて次を`test-output/ci`へ保存する。

- `<label>.stdout.log`
- `<label>.stderr.log`
- `<label>.log`
- `<label>.result.json`

current runは成功したためfailure artifact stepsがskipされた。これはworkflow条件どおりであり、診断契約が欠落したことを意味しない。

## 7. Findings

### PR111-NR-001 — Low — required

- Origin: initial normal review
- Location:
  - `reports/2026-09-02-issue-110-t609-extension-host-speed-report.md:110`
  - `reports/2026-09-02-issue-110-t609-extension-host-speed-report.md:189`
- Description: implementation reportの§4.3と§7が、T404 month rollover修正の変更先を`test/unit/github-pr-context-layer-store.test.ts`と記載している。しかしPRの実際のchanged fileは`test/unit/t404-review-followup-r3.test.ts`であり、前者はこのPRで変更されていない。
- Impact: 必須の詳細reportが変更範囲を誤って示し、後続review、監査、fix verificationで誤ったtest fileを参照させる。製品挙動やcurrent CI成功自体には影響しない。
- Evidence:
  - PR compareのchanged file setは`test/unit/t404-review-followup-r3.test.ts`を含み、`test/unit/github-pr-context-layer-store.test.ts`を含まない。
  - 実際のmonth rollover修正は`readdir()`でmonthly history filesを列挙する`test/unit/t404-review-followup-r3.test.ts`に存在する。
  - implementation report内で誤ったpathが2回記載されている。
- Required action: §4.3の`File:`と§7のfinal diff scopeを、どちらも`test/unit/t404-review-followup-r3.test.ts`へ訂正する。訂正commit後の新しいPR current HEADに一致するrequired CI runを取得する。

Finding completeness matrix:

| Finding | Required action | Production path | Actual composition fixture | Focused evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| PR111-NR-001 | report内の誤ったpath 2箇所を訂正 | N/A; documentation-only | N/A; documentation-only | PR changed-file compareとreport該当行 | Open |

Severity reclassification: なし。

## 8. Held・未探索・残存リスク

### Held

なし。

### 未探索

- このレビューchatではrepositoryをcheckoutしてlocal commandを再実行していない。検証能力は`remote_ci_only`である。
- intermediate instrumentationの各checkpoint値そのものはimplementation reportに記録された値として確認した。最終短縮の独立確認にはGitHub job metadataのbaseline約219秒とcurrent約46秒を使用した。

### 残存リスク

- Required report path correction後はPR HEADが変わるため、run `33582954332`は新HEADのfinal CI証拠として再利用できない。
- それ以外に、レビューした範囲で未解決の技術的・機能的リスクは確認していない。

## 9. Verdict

`fail`

理由: required finding `PR111-NR-001`が1件openである。severityはLowだが、必須の詳細reportの正確性を満たすため訂正が必要である。

このverdictはreviewed implementation HEAD `b4b4ab875bee2e3a10f4b79300ac5ab37cfc358b`にのみ適用する。

## 10. 次のaction / handoff

1. 実装chatで`PR111-NR-001`の2箇所だけを訂正する。
2. 訂正をcommit/pushする。
3. 更新後PR current HEADと`head_sha`が一致するrequired `pull_request` CIを確認する。別SHAのrunは代用しない。
4. 同じ通常レビューchatで、finding delta、report整合、新HEADのCIだけをbounded fix verificationする。
5. mergeは利用者が実施する。

Handoff identity:

```yaml
review_mode: initial_review
reviewed_implementation_head: b4b4ab875bee2e3a10f4b79300ac5ab37cfc358b
base_sha: d2ebe6d3cdb878dfbf46a4b9e46bd86de7162299
finding_ids:
  - PR111-NR-001
verdict: fail
next_review_mode: fix_verification
reviewer_continuity: reuse_this_normal_review_chat
merge_performed: false
```

## 11. Report persistence

このreportはPR implementation branchを変更しないため、専用review branchへ保存する。

- Branch: `review/issue-110-pr111-initial-review-20260902`
- Path: `reports/2026-09-02-issue-110-pr111-initial-review.md`
- Persistence mode: repository file on separate review branch
- PR #111 reviewed implementation HEADへのcommit追加: なし

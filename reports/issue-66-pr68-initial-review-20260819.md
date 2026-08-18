# PR #68 初回レビュー報告

## メタデータ

- Repository: `ssaattww/RevMem`
- PR: #68 `Fix #66 Global and PR progress projections`
- Review mode: initial review
- Base: `main`
- Base SHA: `7d4df08e6a55b40ecb1d0faf515005912274258d`
- Reviewed implementation HEAD: `20b04efbdf3cc0dfb6a9a9f58e3cf979552cc592`
- Commit range: `7d4df08e6a55b40ecb1d0faf515005912274258d..20b04efbdf3cc0dfb6a9a9f58e3cf979552cc592`
- Reviewer role: normal reviewer
- Reviewer continuity: initial review in this chat; this reviewer did not implement PR #68 and did not implement review fixes.
- Verdict: **fail**
- Required findings: **4 High**
- Merge: not performed

この技術判定は上記 `Reviewed implementation HEAD` に対するものであり、レビュー報告・handoffの保存など後続の管理commitへ自動的には移らない。

## 目的・受入範囲

Issue #66 と PR 本文から、今回の受入範囲を次の3点として確認した。

1. Windows/case-insensitive filesystemで、通常エディタの確認済みstateとGlobal Understanding evidenceが同一fileとして照合され、`missing`のまま残らないこと。
2. 選択中GitHub PRの通常エディタで保存した確認済み範囲が、同じlogical fileのPR Progress分子へ反映され、PR diff editorとも同一persisted identityを共有すること。
3. contributed `PR Progress` Viewが選択中GitHub PRの分母・分子を表示し、review-state・live edit・exclude変更・Current Context変更に追従すること。

非目標として、PR diffに存在しないpure working-tree untracked fileをPR Progress分母へ追加しない既存設計は維持する。

## authoritative design / failure contract

`doc/design/vscode-review-range-tracker-design.md` rev5 の以下を確認した。

- PR ProgressとGlobal Understandingは別集計である。
- 確認済み表示は確実に同一stateと判断できる場合だけ適用し、不確実・取得失敗時はfail closedとする。
- Windows path semanticsは対象workspace filesystemに従う。
- PR Progress取得失敗時は不確実な進捗を表示しない。
- binary / invalid encoding / unsupported encodingはline-review unavailableとして扱い、不確実なtext diffへ送らない。

## 診断artifact workflow

`.github/workflows/ci.yml` と既存CI contractを確認した。失敗時artifactは少なくとも各commandの標準出力、標準エラー、combined log、result metadata、environment / git status、および調査対象のsource/test/tools/configurationを保存する構成であり、今回のレビューのためにworkflow修正は不要。

## 変更ファイルと主要direct dependency

変更8ファイルを全件確認した。

- `src/t505-global-understanding-source.ts`
- `src/t405-pull-request-review-runtime.ts`
- `src/t305-extension.ts`
- `src/ui/pr-progress/vscode-pull-request-progress-tree.ts`
- `test/unit/issue-66-global-pr-progress.test.ts`
- `test/unit/core-contracts.test.ts`
- `reports/issue-66-global-pr-progress-fix-20260819.md`
- `handoffs/issue-66-global-pr-progress-fix-20260819.yaml`

主要direct dependencyとして少なくとも以下を追跡した。

- `src/application/github-pr-diff/snapshot-builder-shared.ts`
- `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`
- `src/core/review-state/review-state-service.ts`
- `src/core/pr-progress/pr-diff-progress.ts`
- `src/core/global-understanding/global-understanding-progress.ts`
- `src/ui/current-context/current-context-runtime-coordinator.ts`
- `src/ui/current-context/current-context-ui-controller.ts`
- `src/extension.ts`
- `doc/design/vscode-review-range-tracker-design.md`

## Findings

### PR68-R001 — High — WindowsのPR diff初回確認で、自身が保存したstateをPR Progressが拒否する

- Origin: `introduced_by_change`
- Location: `src/t405-pull-request-review-runtime.ts` (`openSession`, `projectContextFileIdentities`) / `src/core/pr-progress/pr-diff-progress.ts` (`validateFileState`)

#### Description

WindowsでPR diff pathが大文字・小文字を含む場合、persisted stateがまだ存在しないfileをPR diff editor側から先に確認すると、今回のidentity統合が内部で不整合になる。

`PullRequestDiffSnapshot.fileId` はGit/GitHub pathそのものなので、例えば `Src/Example.ts` のcaseを保持する。一方 `openSession()` はpersisted matchがないと `resolvedFileId = diffFile.fileId` としつつ、`target.currentPath` は `canonicalRepositoryPath()` によりWindowsでは `src/example.ts` へ小文字化する。

review-state mutationはその組合せをそのまま保存するため、context/globalには次のstateが作られる。

- key / `fileId`: `Src/Example.ts`
- `currentPath`: `src/example.ts`

次回progress計算では `projectContextFileIdentities()` が `projected.files[diffFile.fileId]` の存在を見て早期`continue`するため、calculation-only aliasで`currentPath`をraw diff pathへ戻さない。core calculatorは同じraw `fileId`でstateを取得した後、`state.currentPath`とdiffの`statePath`をcase-sensitiveに比較するため `File review currentPath mismatch` で失敗する。

#### Impact

Issue #66の対象であるWindows PRで、normal-editor-firstではなくPR-diff-firstに確認すると、確認操作自体がpersistしても、その直後以降のPR Progress更新が失敗する。大文字を含むrepository pathで再現し、dedicated view/statusの更新失敗へ直結する。

#### Evidence

- PR diff file IDは`newPath ?? oldPath`を使いcaseを保持する。
- current `openSession()` はpersisted IDがない場合raw diff IDを使い、fallback `targetPath`だけWindows case-foldする。
- review-state mutationは`target.fileId`と`target.currentPath`をそのまま保存する。
- `projectContextFileIdentities()` はraw keyが既にある場合alias処理をskipする。
- core progress validationはstateをraw fileIdで取得した後、pathをcase-foldせず完全一致要求する。
- 追加回帰testはnormal-editor由来の既存`LEGACY_FILE_ID`を持つfixtureしか検証しておらず、このempty-state / PR-diff-first経路を通していない。

#### Required action

Windowsでraw PR diff identityとpersisted identityのpath表現が一貫するよう修正する。少なくとも「persisted stateなし → mixed-case PR diffを開く → changed lineを確認済みにする → `getProgress()` / `activateProgress()`」をTDD回帰として追加し、確認済み分子が反映され、path mismatch例外が出ないことを固定すること。

---

### PR68-R002 — High — pre-fixのWindows persisted PR stateを移行・互換照合できず、Global `missing`とfile identity分裂が残る

- Origin: `introduced_by_change`
- Location: `src/t505-global-understanding-source.ts`, `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`, `src/t405-pull-request-review-runtime.ts`

#### Description

このPR以前のPR diff sessionは、Windowsでもraw Git path casingを`fileId`と`currentPath`へ保存していた。例えば既存persisted stateが次のようになり得る。

- `fileId`: `Src/Example.ts`
- `currentPath`: `Src/Example.ts`

PR #68後、T505側のcurrent evidenceはWindowsで`src/example.ts`へcase-foldするが、core Global calculatorはpersisted `GlobalFileReviewState.currentPath`をそのままexact-key Mapへ入れてsnapshot pathと照合する。このためupgrade前stateは同一fileでも見つからず、Issue #66の`missing`が残る。

さらにselected PRのnormal-editor session providerもWindows current pathを小文字化した後、persisted filesを `file.currentPath === currentPath` でexact比較するため、legacy mixed-case entryを再利用できない。次に通常エディタで確認すると新しい`repository-file:<hash>` identityを作成し得る。

その結果、同じWindows logical fileにlegacy raw IDと新hashed IDの2つが存在し得る。current PR runtimeのcanonical lookupは同一canonical pathに複数IDがあるとconflictとしてfail closedするため、その後PR diff sessionを開けなくなる。progress projectionもraw diff keyが既にあればそちらを優先するため、新しいnormal-editor側stateが分子へ反映されない経路が残る。

#### Impact

PR #68導入前からRevMemを使用していたWindowsユーザーでは、既存確認済みstateが今回の修正後もGlobal Understandingに反映されない、または次回の通常エディタ確認でidentityが分裂し、PR Progress/PR diff reviewが失敗する可能性がある。永続化互換性の問題なので再起動・upgradeを跨いで残る。

#### Evidence

- base実装のPR diff sessionは`logicalPath`をcase-foldせず`target.currentPath`へ保存していた。
- current T505はevidenceのみWindows lower-caseへ寄せるが、persisted Global state自体は変換しない。
- core Global calculatorはpersisted `currentPath`をexact keyとして使う。
- normal-editor selected PR providerはcomputed lowercase pathに対してpersisted pathをexact比較し、見つからなければ新hashed IDを作る。
- current PR runtimeはcanonical path一致IDが複数存在すると明示的にconflict errorとする。
- Issue #66 regression fixtureは最初からlowercase persisted stateを用意しており、pre-fix persisted representationを再現していない。

#### Required action

Windows persisted stateのupgrade互換を定義し、legacy casingをcase-insensitive canonical identityとして再利用できるread/migration境界を追加すること。既にraw IDとhashed IDの双方が存在する場合も、確実性を失わない統合/拒否方針を明示すること。TDDではpre-fix state fixtureを用意し、少なくともGlobal `current`判定、normal editorの同一ID再利用、PR Progress反映、PR diff openの継続を検証すること。

---

### PR68-R003 — High — PR Progress activationに世代管理がなく、context切替競合で別PRのsnapshotを表示できる

- Origin: `introduced_by_change`
- Location: `src/t405-pull-request-review-runtime.ts` (`activateProgress`) / `src/t305-extension.ts` (`refreshPullRequestProgressForSelection`) / `src/ui/pr-progress/vscode-pull-request-progress-tree.ts` (`setPullRequestProgressSource`)

#### Description

GitHub PR AからPR BへCurrent Contextを切り替える際、PR Progressの非同期activationにgeneration/tokenがない。

`refreshPullRequestProgressForSelection()` は同一`pullRequestReviewRuntime.progress` objectをsourceへ設定し、`setPullRequestProgressSource()`はその場でTree refreshを発火する。その時点ではまだ`activateProgress(B)`がold A snapshotをclearしていないため、A snapshotをBへの切替直後に再描画できる。

さらに`activateProgress()`は次の順で非同期処理する。

1. `activeProgressContextId = contextId`
2. shared progressをclear
3. persisted state / progress計算
4. 各fileのline reviewability contentを順次await
5. shared progressへsnapshotをreplace

Current Context controllerのgenerationはcandidate recompute/select完了までであり、その後の`refreshDependents()`全体はgenerationで保護されない。そのためA activationが遅い間にB activationが開始できる。Bが先に完了した後、古いAが後から`replaceSnapshot()`すればTreeはAへ戻る。古いAが失敗した場合もcatchが無条件`progress.clear()`するため、Bの成功snapshotを消せる。

#### Impact

Current ContextがPR Bを示しているのにdedicated PR ProgressだけPR Aのfile/分子/分母を表示する、またはBの成功後に空になるraceが成立する。stale A nodeを選択すればAのidentity-bound diffを開く可能性もあり、レビュー対象identityを誤認させる。

#### Evidence

- `PullRequestReviewRuntime.progress`は全PRで1つのshared provider。
- `activateProgress()`にrequest generation/current-context checkがない。
- successの`replaceSnapshot()`もfailureの`clear()`も、開始時contextが今もactiveか検証しない。
- source switchは同じshared objectを設定した直後にTree refreshする。
- Current Context coordinatorはcontrollerのstale判定後にdependent refreshをawaitするが、dependent refresh自体の競合をcancel/serializeしない。
- production wiring regression testはsource-switch関連文字列をregexで確認するだけで、複数PRの非同期競合を実行していない。

#### Required action

PR Progress activationをcontext/generationにbindし、stale requestのsuccess/errorが現在snapshotへ書き込めないようにすること。source切替もold snapshotを新contextとして一時表示しないatomicな順序へ変更すること。deferred Promise等で以下をdeterministicにTDDすること。

- A開始 → B開始 → B成功 → A成功でもBが維持される。
- A開始 → B開始 → B成功 → A失敗でもBがclearされない。
- A pending中にPR contextを離れた場合、A完了後もGitHub PR source/snapshotが復活しない。

---

### PR68-R004 — High — PR Progress取得失敗がCurrent Context全体を中断し、旧contextの確認済み装飾を残す

- Origin: `introduced_by_change`
- Location: `src/t305-extension.ts` Current Context `refreshDependents` / `src/ui/current-context/current-context-runtime-coordinator.ts`

#### Description

Current Context切替では、coordinatorが先に新しいselected identityを`setSelectedContext()`へ適用した後、dependentsをrefreshする。今回の変更ではdependent順序が次の通りになった。

1. `await refreshPullRequestProgressForSelection()`
2. `await runtimePort.refreshVisibleEditorDecorations()`
3. `await globalRuntime.refresh()`
4. `await reviewContextsRuntimeRef.current?.refresh()`

PR Progress取得はpersisted conflict、content unavailable、encoding/read failure、R001などでthrowし得る。しかしこの最初のawaitに個別error boundaryがないため、失敗すると2〜4は実行されない。外側Current Context boundaryはerror messageを出すだけで、selected identity自体は既に新contextへ切り替わっている。

したがって、UI/commandsが新PR Bをownerとしている一方、visible editorの灰色「確認済み」装飾は旧PR Aのまま残る経路が成立する。これは設計の「確認済みと確実に判断できる場合だけ表示」「取得失敗時はfail closed」に反する。

同様にlive edit成功後の経路でも、state update・decoration/global refresh後にPR Progress refreshが失敗するとcatchが `編集後のレビュー状態を更新できませんでした` と表示するため、実際に成功したstate mutationと下流projection失敗のerror boundaryが混ざっている。

#### Impact

レビュー対象contextと確認済み装飾のownerが食い違い、未確認の行を旧context由来の確認済みとして表示できる。Global/Review Contextsも同じ失敗でrefreshされずstaleになる。UIの確実性を直接損なうため受入不可。

#### Evidence

- coordinatorは新selectionをdependent refreshより先にruntimeへ適用する。
- current `refreshDependents`はPR Progressを最初にawaitし、後続を直列実行する。
- `refreshPullRequestProgressForSelection()`は`activateProgress()` errorをfinallyでTree refreshするだけで再throwする。
- Current Context用outer boundaryはmessage表示のみで、decorationsをnew contextへfail-closed rerenderしない。
- designはPR Progress failureで不確実な進捗を表示せず、fail-closed処理で不確実な結果を採用しないことを要求している。
- Issue #66 testにはPR Progress failureを注入したCurrent Context lifecycle testがない。

#### Required action

PR Progress projection failureを他dependent refreshから隔離し、少なくともPR treeをfail closedにしたうえでnew selected contextのdecoration / Global / Review Contexts refreshを継続すること。またはcontext切替全体をatomicにし、失敗時にも旧ownerの確認済み装飾が残らないことを保証すること。A→B切替で`activateProgress`をrejectさせ、B ownerのdecoration refreshと他dependentsが実行される回帰testを追加すること。live editについても「state mutation成功」と「PR projection失敗」の報告境界を分離すること。

## Required coverage dispositions

| Criterion | Disposition | Evidence |
|---|---|---|
| Requirement / design conformance | `checked_finding` | Issue #66とdesign rev5を実装経路へ照合。R001/R002/R003/R004。 |
| Correctness / edge cases | `checked_finding` | Windows mixed-case、empty persisted state、upgrade state、multi-PR async race、failure isolationを追跡。 |
| Scope discipline / unrelated changes | `checked_no_finding` | 変更8ファイルはいずれもIssue #66実装・test・report/handoffの範囲。無関係cleanupなし。 |
| Changed files / direct dependencies | `checked_finding` | 変更全件とidentity/progress/persistence/current-contextのdirect dependencyを追跡。4 finding。 |
| API / data / configuration / workflow / compatibility | `checked_finding` | public schema/config変更なし。persisted Windows compatibilityにR002。workflow diagnosticsは既存で充足。 |
| Error handling / failure diagnostics | `checked_finding` | CI artifactは十分。runtime failure isolation/fail-closedにR003/R004。 |
| Security / secret handling | `checked_no_finding` | token/credential保存・新規外部入力実行・秘密情報logの追加なし。 |
| Tests / validation adequacy | `checked_finding` | Issue #66 testは主経路を追加しているがR001〜R004の再現ケースを未カバー。production source-switch testの一部はregex wiring確認のみ。 |
| Current-HEAD CI evidence | `checked_no_finding` | Reviewed HEAD `20b04efb...` とrun head SHAが一致するCI run `32197163530` がcompleted/success。別SHA runは判定に使用していない。 |
| Report / tracking / documentation accuracy | `checked_no_finding` | 実装report・handoff・PR本文は意図した実装とtechnical green/final exact-head evidenceを記録。`tasks/tasks-status.md`は指定manager制約に従い未変更。 |
| Regression / maintainability risk | `checked_finding` | shared mutable progress providerとnon-generated async activationがR003、dependent直列failure couplingがR004。 |

## Validation assessment

- Exact reviewed-HEAD CI: **supported / success**
  - HEAD: `20b04efbdf3cc0dfb6a9a9f58e3cf979552cc592`
  - Run: `32197163530`
  - Status: completed
  - Conclusion: success
- Build / typecheck / architecture / lint / Unit / T304 / T405 / T505 / T506 / Git / Mock GitHub / Extension Host: implementation reportおよびmatching runでsuccess。
- Diagnostic artifact contract: **supported**。
- R001 mixed-case PR-diff-first: **unsupported by current tests**。
- R002 pre-fix persisted Windows upgrade: **unsupported by current tests**。
- R003 concurrent PR activation ordering: **unsupported by current tests**。
- R004 PR Progress failure isolation during context switch: **unsupported by current tests**。

CI greenは実行済みtestが成功した証拠であり、上記未カバー経路のcorrectness証拠にはならない。

## Held / unexplored / unknown

### Held

- GitHub outage / rate-limit / cache fallback全体のT406範囲は今回のIssue #66で変更された契約の直接確認を超えるため、既存task ownershipのまま保持する。ただし今回新設したPR Progress projectionのfailure isolation自体はR004としてreview済みであり、T406へ先送りしていない。

### Unexplored

- なし。今回の変更範囲とdirect dependencyについてrequired review coverageに未探索領域は残していない。

### Unknown

- なし。現時点で判定に必要なPR HEAD、Issue、design、diff、matching CI evidenceは取得できた。

## Intentionally untouched

- Product implementation / tests: reviewerは修正を実装しない。
- `.github/workflows/ci.yml`: 既存diagnostic artifact contractで要件充足。
- `tasks/tasks-status.md`: 指定task/progress managerのみ更新可能なためreviewerは変更しない。
- Merge: user-owned actionのため実施しない。

## Verdict

**fail**

High finding 4件（PR68-R001〜PR68-R004）がrequired actionとして残る。PR #68は現状のreviewed implementation HEADでは受入不可。

## Next action

implementation workerでPR68-R001〜PR68-R004をTDDで修正し、同じnormal-review chatでfinding identity/severityを保持したfix verificationを行う。修正後は新しいPR HEADと完全一致するCI runのみをverification evidenceとして使用する。normal reviewがpassした後、必要ならfresh independent-final-review chatへ進む。

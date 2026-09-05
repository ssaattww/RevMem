# PR #108 独立レビュー報告

## 1. 判定と対象

**判定: fail / 修正が必要。指摘6件（high 3、medium 1、low 2）。** 技術的な判定は以下の実装HEADだけに適用する。CI成功を、新たに再現した不具合が存在しない根拠にはしない。

| 項目 | 値 |
|---|---|
| Repository / Issue / PR | ssaattww/RevMem / #106 / #108 |
| review_mode | independent_final_review |
| reviewed_implementation_head | `0e15ac16809af71bba09694453e7a665c7c452a1` |
| initial_independent_reviewed_head | 同上 |
| closure_reviewed_heads | 空。今回は初回の網羅レビューであり、修正後closureではない |
| Branch | `codex/pr94-ci-006-global-three-way` |
| Base | `main` / `669805326849a9d749b2ddb8bc85cba717e4e629` |
| Scope | PR差分14ファイル、直接依存する保存・mapping・history・UI・テスト |
| Verification capability | local_execution_available。ただしローカル依存導入に制約あり |
| Reviewer | このPR108独立レビューチャット。中断後も同じHEAD・同じレビューチャットで再開 |
| Independence | このチャットでは実装、指摘修正、normal reviewを行っていない。独立したソース・実行検証後に既存PRコメントを確認したが、コメントは空だった |

## 2. 要求・設計・作業境界

基準は [Issue #106](https://github.com/ssaattww/RevMem/issues/106)、凍結HEADの `AGENTS.md`、`doc/design/issue-106-owner-atomic-global-synchronization.md`、`doc/design/immutable-revision-review-snapshots.md`、`doc/design/vscode-review-range-tracker-design.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`。アップロード済みworker skillsの work-context-manager → review-worker → report-writer → chat-handoff-manager を使用した。

重点は、全保存Contextと単一Globalの同一snapshot/CAS、異なるPR HEADの意味、失敗・stale・取消時の非公開、history順序、実T405 composition、private repository再接続・PR選択・single-context回帰である。新設計は異HEAD PRを保留し、そのHEADがowner revisionになった時に同期すると規定している。

作業開始時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。失敗時にテスト出力、標準出力、標準エラー、combined log、exit情報、環境・生成物・ソース等をartifactへ保存するworkflowが存在するため変更していない。performance suiteをrequired CIに追加していない。

今回はレビューのみ。実装・既存テスト・設計・追跡・Skill・workflowは変更していない。外部のreview probeで再現を検証し、修正は行っていない。TDDの過去Red実行やnormal review完了は未確認であり、現在のGreenだけから推定していない。

## 3. ソース同一性とCI

[CI run 33687437781](https://github.com/ssaattww/RevMem/actions/runs/33687437781) の `event=pull_request`、`head_sha=0e15ac16809af71bba09694453e7a665c7c452a1`、`conclusion=success` をGitHub connectorで確認した。attempt 1、job `100438140718`（build-and-lint）。2026-09-02 21:51:59–21:58:44 UTC。build、contract typecheck、architecture/negative、lint、required tests、VS Code Extension Host、user-validation artifact生成が成功している。失敗時専用の診断stepは成功runではskipされた。

同runのartifact `9868877063`、`review-range-user-validation-d9bc08b0d79f6c7f72d43ee2fd719d36335564e5` をconnectorで取得した。source.zipはPR merge checkout由来だが、全ファイルをGit indexへ登録して計算したtree SHAは `76fb4d88787aef4d621d3792cc3ffb7ec1ba49eb` で、対象HEADのtree SHAと完全一致した。この一致を確認してからローカル検証に使用した。archive名のmerge SHAや別SHAのrunを対象HEADの代用にしていない。

ローカル検証後も `git diff --exit-code` が0、`git write-tree` が同じtree SHAであることを確認した。生成物・probeはレビュー用の外部証拠であり、追跡対象の実装変更ではない。

## 4. 検証結果と限界

| 検証 | 結果 | 根拠・範囲 |
|---|---|---|
| 同一HEAD CI | success | 上記run/job。宣言された依存関係・CI Node24での正式な既存gate |
| 初期focused既存テスト | 16/16成功 | Issue106の2suiteとT405 composition。下記918に含まれるため加算しない |
| 広域既存テスト | 918成功、0失敗 | 112 test files。unit、Git、GitHub、T405/T406、保存・lock・private-context/選択/再接続等。一覧は証拠bundleの `broader-files.json` |
| owner/mapper/保存層の追加probe | 4失敗、1 control成功 | 保留後再同期、Global先行、取消、cacheの期待動作assertionが失敗。通常CASとowner CASの同時競合controlは一方だけ成功し、混在なし |
| 実T405 composition追加probe | 3失敗 | 初回保留のprojection、保留PR選択、manifest直前取消。実Git・実runtime・実保存層、UI/GitHub/authは既存fixture同様mock |
| ローカル依存導入 | blocked | `npm ci`が完了せず、最終試行は `Exit handler never called!` |
| ローカル宣言toolchainでのbuild/typecheck/lint | 未完了 | 成功とは記録しない |
| ローカルarchitecture/negative | blocked | local typescript package未導入による `ERR_MODULE_NOT_FOUND` |

ローカルはNode22.16.0、グローバルTypeScript5.8.3の `transpileModule` で385 TSファイルを構文変換して実行した。これは型検査ではなく、projectのTypeScript ^6.0.3 / CI Node24を使ったローカル再検証でもない。正式toolchainの既存gate成功は同一HEAD CIに限って主張する。

追加probeは合計8 checksで、期待する正しい動作に対するassertionが7失敗、競合controlが1成功。7件の失敗は重複する実行層を含み、技術的指摘は001–004の4件に整理した。文書・文言の005/006を合わせて指摘6件であり、7件の別不具合とは数えない。

実行コマンド・stdout・stderr・combined log・result JSONと再現scriptは `pr108-review-evidence.zip` に収録する。代表コマンドは次のとおり。実行時の112パスは `broader-files.json`、完全なcommand記録は `commands.json` を参照する。

```text
node tools/run-ci-command.mjs review108-broader node --test <112 test paths>
node tools/run-ci-command.mjs review108-regressions-final node --test <review-regressions.cjs>
REVIEW_CASE=deferred-projection node --test <runtime-composition-probe.cjs>
REVIEW_CASE=deferred-selection node --test <runtime-composition-probe.cjs>
REVIEW_CASE=cancel-before-publication node --test <runtime-composition-probe.cjs>
```

## 5. 指摘一覧

全指摘はopen。severityの再分類・引下げ・erratumはない。行番号は凍結HEADに対する番号。

### IFR108-001 [high] 別HEADとして保留したPRを、そのHEADへ切り替えても再同期できない。

- origin: `introduced_by_change`
- location: `src/t405-owner-pull-request-synchronization.ts:158-166; src/t405-review-contexts-runtime.ts:1181-1211`

**影響:** PR再検出／Current Context選択が失敗し、保存されたPRと確認範囲が古いrevisionのまま残る。

**再現・根拠:** 実mapper＋FS＋debounceで B/B/Global B → owner C に同期すると PR52=C, PR53=B, Global=C。その後 owner D で2回同期しても PR53=B、committed=false。実T405コマンドでも Selected pull-request revision was not published by repository-owner synchronization. を再現。Globalだけが先にCへ進んだ場合も両PRがBのまま。

**必要な対応・受け入れ条件:** Context sourceとowner Global sourceが異なる正常状態から、安全なimmutable evidence／snapshotに基づいて同期できるようにする。単なるeligibility条件削除や旧fallback復活ではなく、owner Globalを1回だけ確定する。C→D切替、再試行、Global先行、同一HEAD/base-onlyを実mapper・実保存層・実T405で検証する。

eligibilityは「remote target=owner HEAD」だけでなく「保存PRのsource HEAD=現在Global revision」も要求する。先行PRがGlobalを進めると、保留PRがそのsource条件を満たせなくなる。再試行や順序変更では解消しない。

### IFR108-002 [high] 保留PRの永続HEADと最新HEADの表示用diff登録が食い違い、正常なPRを含むReview Contexts全体が空になる。

- origin: `coverage_miss`
- location: `src/t405-owner-pull-request-synchronization.ts:164-166; src/t405-review-contexts-runtime.ts:412-448,884-918,1052-1095; src/t405-pull-request-review-runtime-base.ts:785-797,1129-1141`

**影響:** 別HEADの保存PRが1つあるだけで、owner同期直後の一覧／進捗更新が例外になり、treeがclearされる。

**再現・根拠:** 実Git＋registerT405ReviewContextsRuntime＋PullRequestReviewRuntime＋FSを使うfixtureで、初回C同期自体は成功したが、その後のprojectionが Persisted pull-request context does not match the registered diff revision で失敗。treeItems=0。後続のDへの切替以前に発生するため001とは別の修正観点。

**必要な対応・受け入れ条件:** 採用する異HEAD方針に合わせて、永続Context、projection、diff registration、progressのrevisionを整合させる。保留を最新revisionとして扱わず、厳密なrevision guardを弱めない。初回保留時、通常refresh、再起動後の一覧と進捗、および保留PRの操作境界を実runtime compositionで検証する。

永続stateを保留したまま `readSynchronizedRepository` が最新remote HEADを投影し、そのdiffでprogressを計算する経路を確認した。001は後続の同期継続性、002は初回からの読取り・表示整合性であり、別々の受け入れ条件が必要。

### IFR108-003 [high] manifest公開前のキャンセルがowner commitへ伝わらず、キャンセル済みの操作がContext・Global・historyを更新する。

- origin: `introduced_by_change`
- location: `src/t405-owner-pull-request-synchronization.ts:227-237; src/adapters/state-repository/owner-atomic-review-state-repository.ts:210-229,333-339; src/adapters/state-repository/owner-aware-debounced-review-state-repository.ts:40-51`

**影響:** Current Context選択がAbortErrorで終了したにもかかわらず、古い操作のrevision更新と履歴が永続化される。

**再現・根拠:** beforeAtomicPublication(manifest.json)でabort。helperはcommitted=trueを返してmanifestを書き換え、2PR分のhistoryを記録。実preparePullRequestCandidateForExplicitContextSelection(signal)では AbortError: PR detection was superseded. とともに両PR／GlobalがB→C、remapped-by-diffが2件残った。

**必要な対応・受け入れ条件:** signal／generation fenceをdebounce待機・root lock待機からpublication境界まで伝え、manifest公開直前にも検証する。公開前の取消では可視状態・manifest・historyを不変にし、公開後の取消は既存のpost-commit audit完了方針を維持する。実Current Context経路で待機中／公開直前／公開後を検証する。

helperはcommit呼出前にsignalを検証するが、owner transactionにはsignalがなく、保存直前はleaseの所有確認だけである。今回の再現は「取消済み操作が丸ごと新generationを公開する」問題であり、JSONの途中書込みや半分のmanifestを観測したという意味ではない。

### IFR108-004 [medium] owner commit成功後も、同じrepository instanceのgetCurrent()が以前のキャッシュを返す。

- origin: `introduced_by_change`
- location: `src/adapters/state-repository/owner-atomic-review-state-repository.ts:210-229; src/adapters/state-repository/coherent-file-system-review-state-repository.ts:218-266`

**影響:** 新しいowner APIと既存の同期的read APIが異なる世代を返す。現行srcで外部getCurrent呼出は見つかっておらず、現在のUIへの直接影響は未確認。

**再現・根拠:** 両PR／GlobalをCへcommit後、getCurrent(52)はB/B、load(52)はC/C。続くgetCurrent(53)はB/C。直接実FS classで再現。

**必要な対応・受け入れ条件:** owner publication成功時に、全対象Contextとowner Globalのcacheを一括更新または失効させ、古い値をcurrentとして返さない。metadata-only、revision更新、失敗時のcache保持を実repository APIで検証する。

on-diskでは両PRともCに更新済みなので、B/Cは意図された異HEAD共存ではなく、旧Context cacheと更新後Global cacheの組合せである。ただし現行UIでこの同期read APIを直接使う箇所は確認できなかった。

### IFR108-005 [low] 実装・検証reportとtracking／PR説明が現在の実装状態へ同期されていない。

- origin: `coverage_miss`
- location: `tasks/tasks-status.md:7-18,28; tasks/phases-status.md:12; PR #108 body; reports/`

**影響:** 実装HEAD、Red/Green根拠、検証範囲、残件を成果物から追跡できない。PR説明はRedのみ、trackingはPR94と後続Issue登録済みのまま。

**再現・根拠:** 変更14ファイルにreport／tracking変更なし。凍結HEADのreports内でIssue106/PR108実装・検証reportを確認できず、関連するのはPR94のdefer report。レビュー前のPR commentsは空。PR bodyは現在はTDDのRed段階と明記。

**必要な対応・受け入れ条件:** 実装・検証reportを保存し、確認できたRed/Green、正確なHEAD／CI、残件を記録する。追跡用skillを通してtasks/phasesとPR本文を同期する。恒久設計はphasesの単一設計書方針に合わせ、新しいowner契約を参照できる形にする。未確認の実行結果は後付けで成功と記載しない。

### IFR108-006 [low] 同期変更と無関係なユーザー向けエラー文言が破損している。

- origin: `introduced_by_change`
- location: `src/t405-review-contexts-runtime.ts:741,1308`

**影響:** repository解決失敗とcache保存失敗時に誤った日本語が表示される。

**再現・根拠:** 差分で「対象PR」が「対豈PR」に、「cacheへ保存」が「cacheほ保存」に変わった。

**必要な対応・受け入れ条件:** 2か所を元の正しい文言に戻し、同じ差分内のユーザー向けmessageに意図しない変更がないことを確認する。

## 6. 全差分とcoverage

| 確認した変更ファイル | 主な結果 |
|---|---|
| `.github/workflows/ci.yml` | Issue106 gate追加、診断artifact維持、performance追加なし |
| `doc/design/issue-106-owner-atomic-global-synchronization.md` | owner semantics/保留/取消と実装の照合、001–003/005 |
| `eslint.config.mjs` | 対象fileのno-useless-assignment無効化を確認。styleだけの独立指摘は追加しない |
| `src/adapters/state-repository/debounced-review-state-repository.ts` | queue/flush/通常操作との直列化、003の伝播境界 |
| `src/adapters/state-repository/index.ts` | export置換/API影響、004 |
| `src/adapters/state-repository/owner-atomic-review-state-repository.ts` | manifest-last/CAS/schema/root lock、003/004、競合control |
| `src/adapters/state-repository/owner-aware-debounced-review-state-repository.ts` | owner呼出のqueue接続、003 |
| `src/application/github-pr-context/github-pull-request-context-layer-store.ts` | prepareの副作用・identity検証・commit後history |
| `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts` | unsafe fallback削除、snapshot/evidence、001 |
| `src/t405-owner-pull-request-synchronization.ts` | 全Context planning、lifecycle失敗、Global比較、取消、001–003 |
| `src/t405-review-contexts-runtime.ts` | PR検出・再接続・選択・projection/read、001–003/006 |
| `test/unit/issue-106-global-three-way-synchronization.test.ts` | CAS/stale/manifest failure等の既存テスト確認 |
| `test/unit/issue-106-t405-owner-synchronization.test.ts` | helperのstub coverageと実mapper/compositionとの差を確認 |
| `test/unit/t405-github-lifecycle.test.ts` | source構造assertionの変更と実runtimeの不足を確認 |

直接依存する validated/coherent/atomic FS repository、storage-root-lock、storage-router、schema recovery、snapshot capture/restore、Git evidence loader、history recorder/JSONL store、Review Contexts provider/commands、PullRequestReviewRuntime、Current Context preparation、GitContext/session、既存composition等も調査した。

| 必須観点 | disposition | 根拠 |
|---|---|---|
| requirement/design conformance | checked_finding | 001/002/003 |
| correctness/edge cases | checked_finding | 001–004、実mapper/FS/T405 probe |
| scope discipline | checked_finding | 006。無関係な文言変更 |
| changed files/direct dependencies | checked_finding | 14/14確認、上表 |
| API/data/config/workflow compatibility | checked_finding | 004。通常CASとのcontrol成功、artifact維持 |
| error handling/diagnostics | checked_finding | 002/003/006、stdout/stderr/result保存 |
| security/secret handling | checked_no_finding | owner routing/schema/lock/認証経路を確認。新しいsecret loggingは見つからなかった |
| tests/validation adequacy | checked_finding | 既存918成功と追加境界probeの差 |
| current-HEAD CI | checked_no_finding | runのhead SHA完全一致、success |
| report/tracking/documentation | checked_finding | 005 |
| regression/maintainability | checked_finding | 001–004、read API/projection整合性 |

## 7. 修正後closure用のcompleteness matrix

これは未修正の要求一覧であり、closure成功の証拠ではない。すべてopen。実装担当は各行に修正HEAD・実production path・actual fixture・focused結果を対応付け、normal fix verification後にこの同じ独立レビューチャットへ戻す。

| 指摘 | required action | production path | actual composition fixture | focused evidence / 追加受け入れ範囲 |
|---|---|---|---|---|
| IFR108-001 | 異なるContext/Global sourceから保留PRを安全に追随させる | synchronizePullRequestOwner → prepareUpdate → immutable mapper → owner CAS | review-regressions.cjs / runtime-composition-probe.cjs(deferred-selection); 元fixture: t405-composition-regression.test.ts | 現HEAD: owner C→D・再試行・Global先行・実コマンド選択が失敗。修正後はこれらと同一HEAD/base-onlyの成功・原子性を実証する。 |
| IFR108-002 | 保存revisionとprojection/diff/progressを整合させる | readSynchronizedRepository → progressFor → calculateProgress → requireMatchingContext | runtime-composition-probe.cjs(deferred-projection); 元fixture: t405-composition-regression.test.ts | 現HEAD: 初回C同期後treeItems=0。修正後は初回保留・通常refresh・再起動・保留PR操作の整合を実証する。 |
| IFR108-003 | 公開前の取消をqueue/lock/I/Oを越えて保証する | Current Context preparation → synchronizePullRequestOwner → Debounced → commitRepository → manifest publication | review-regressions.cjs / runtime-composition-probe.cjs(cancel-before-publication) | 現HEAD: manifest直前abortでもstate/history更新。修正後は待機中・直前の取消で旧状態維持、公開後はaudit方針どおりであることを実証する。 |
| IFR108-004 | owner commit後の同期read cacheを整合させる | FileSystemReviewStateRepository.commitRepository → inherited getCurrent/load | review-regressions.cjs（実FS instance） | 現HEAD: B/B→load後B/Cのstale cache。修正後はrevision・metadata-only・commit失敗の全cache境界を検証する。 |
| IFR108-005 | 実装report/検証report/追跡/設計参照/PR説明を同期する | reports/; tasks/; canonical design; PR #108 body | 文書・PR metadata検査（実行fixtureは非該当） | 現HEAD: 実装report未確認、PR本文Redのみ。修正後は各成果物と実測HEAD/CI/残件の対応を照合する。 |
| IFR108-006 | 意図しない日本語message変更を戻す | T405 repository resolution/cache error paths | 差分・message確認（実行fixtureは非該当） | 現HEAD: 対豈PR/cacheほ保存。修正後の文言と対象外message差分を確認する。 |

## 8. held・未確認・指摘から除外した事項

**held:** ローカルの宣言依存toolchain検証は未完了。担当はreview環境、残る差はCI Node24/TS6に対するローカルNode22/TS5.8構文変換である。同一HEAD CI成功と追加probeの実測結果は別証拠として扱った。Live VS Code UI、実private GitHub資格情報、Windows/macOS/Remote SSH/WSLはこのレビューでは実行していない。CI Ubuntu Extension Hostとmock-auth integrationの成功を、それらの手動確認済みとは扱わない。

**unknown:** 過去のTDD Red実行結果とnormal review完了の根拠は未確認。getCurrentの現行UIへの直接影響も未確認。005は本独立レポートの作成だけでは解消しない。

**unexplored:** 対象差分・直接依存の静的観点に残した未読領域はない。環境別の未実施範囲は上記heldへ明記した。あらゆる入力・環境で不具合が存在しないと主張するものではない。

**追加指摘にしなかった事項:** 通常CASとowner CASの競合はpositive controlで一方だけ成功した。post-commit history appendの失敗は既存の正規設計がstateをrollbackしないpartial-successを認めているため、公開前取消003とは分離して扱い、別の原子性不具合と断定していない。既存のpath/schema境界に関する仮説、全snapshot再書込みの性能懸念、lintのstyle-only論点は、本差分による再現可能な独立不具合として確定できず追加していない。

## 9. 保存・残件・次の作業

予約済みpath: `reports/2026-09-05-pr108-independent-review.md`。保存modeは `repository_file`。レビュー対象HEADから分岐した `review/pr108-independent-0e15ac1` にレポートだけを保存する。これはfail verdictの記録であり、passing report-attestationではない。`report_attestation_head=null`。保存commit SHAは作成後にPRコメントと外部handoffに記録する。

対象PRのbranch/HEADは変更しない。実装commit/pushは不要、レポート保存のみを別branchで行う。CI待機は不要（対象HEADの該当runは完了済み）。このレポートbranchに発生する別SHAのCIをPR108の検証に代用しない。PR108には6件をまとめた簡易reportを1回投稿し、詳細reportへリンクする。完全な構造化handoffとprobe/logsはPRbranch外の証拠bundleで渡す。

残件は001–006。normal implementation / fix verificationで対応した後、同じ独立レビュー担当がfinding/CI-deltaに限定したclosureを行う。新しいHEADの検証は新しいHEADと一致するCIだけを使い、今回の成功runを流用しない。全観点の独立レビューを別の新規担当へ繰り返す前提にはしない。

mergeは利用者の操作とし、workerはmergeしない。本報告はmerge承認ではない。

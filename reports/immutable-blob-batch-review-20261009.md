# immutable blob 一括読み取りの初回レビュー

## 判定と対象

**判定: fail。Medium 3件が未修正。** 技術判定は、下記のレビュー対象HEADに適用する。

| 項目 | 値 |
|---|---|
| 対象 | [RevMem PR #141](https://github.com/ssaattww/RevMem/pull/141) |
| モード | initial_review（通常レビュー） |
| ブランチ | `perf/immutable-blob-batch` |
| 基点 | `6ab5736d148fff0d403d250f2a262ab426dde714`（main） |
| reviewed_implementation_head | `a910aa2ecf5134ec900bfe3e980b5f5149169710` |
| 対象tree | `c31ac3edb7e7833ac0febc61cba6cd20a0218f33` |
| 差分 | 基点から対象HEADまで、18ファイル、3,162行追加・42行削除 |
| 担当 | このPRの実装・修正を行っていないChatGPT通常レビュー担当。取得層の補助担当2名は静的読取のみ |
| 保存形式 | 通常レビュー報告と引継ぎ。独立最終レビューのattestationではない |
| 報告保存後のHEAD | このファイル自身のコミットSHAは生成時点では存在しないため、公開後のPRコメントへ記録する |

公開PRと専用ワークツリーのHEADが一致することを、レビュー開始時と報告準備前に確認した。既存の作者ワークツリー、main、別PRのワークツリーは変更していない。今回、製品コード・製品テスト・設定・workflowの修正とmergeは行っていない。

## 範囲と根拠

対象は、PR本文と[実装報告](immutable-blob-batch-review-preparation-20261009.md)が定義するGit本文取得の高速化である。optionalな `readBlobs` / `readTextContents`、最大128 OID、引数予算、逐次デコード、同一OIDの重複除去、1 unique OIDの単件取得、パスごとのencoding、型付きサイズ超過だけのグループ再取得、キャンセル、子プロセス終了処理、Progressへの登録と同revisionのcache利用を確認した。

[Issue #136](https://github.com/ssaattww/RevMem/issues/136)・[Issue #137](https://github.com/ssaattww/RevMem/issues/137)全体の症状解消、新しいユーザー向けtimeout設定、詳細operation診断、state repository/debounce/store/lock、GitHub lifecycle memo、UI coordinatorは今回の範囲外である。PR本文にある過去の性能測定を、このHEADやWindows実機の測定値として扱っていない。

適用した主な根拠は、利用者のレビュー・診断成果物・時間依存CI除外・報告公開の指示、`AGENTS.md`、添付の `chatgpt-worker-skills 4.zip`、`chat-review-worker` → `work-context-manager` → `review-worker` → `report-writer` → `chat-handoff-manager` である。`development-orchestrator` の入口規約も確認し、今回の明示された通常レビュー範囲へ適用した。GitHub操作はプロジェクト指示に従い、接続先で `gh` を使用した。

既存契約として、[恒久設計 §9](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/doc/design/vscode-review-range-tracker-design.md#L350-L424)、同設計の個別I/Oに対するtimeout/retry契約、[PR再検出設計](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/Design/Issue139PullRequestRediscovery.md)、`Design/BreakingChanges.md` のimmutable cache契約、`tasks/tasks-status.md`・`tasks/phases-status.md` のT302/T606/T607を照合した。

## 必須指摘

### I141-BATCH-001 / Medium — 実測時間を合否条件にするテストが必須CIへ入っている

**起源:** introduced_by_change

**状態:** 未修正

**場所:** [transport test 883–889行](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/test/unit/node-git-blob-batch-transport.test.ts#L883-L889)、同ファイル45–55行、[package.json 154行](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/package.json#L154)。

追加された `transport test harness fails finitely when a wait condition never occurs` は、実時間の25ms timeoutを待った後、`Date.now() - startedAt < 1_000` を検証する。このファイル全体が `test:unit` に登録され、CIのUnit tests段階で実行される。

**実証:** 同じコンパイル済みテストを1件だけ指定すると成功（exit 0）。タイマーcallbackの直前に1度だけ1,100msの模擬的な実行停止を入れると、同じテストは次のassertで失敗した（exit 1、1件中1失敗）。

```text
AssertionError [ERR_ASSERTION]: a missing event must not leave a polling loop running
actual: false
expected: true
```

この追加検証は、実行遅延によって合否が変わることを示すための制御された実験であり、現在のhosted CIで自然発生した失敗の記録ではない。現在の対象HEADのCIは成功している。

**影響:** 実装が正しくても実行機の負荷・一時停止によってCIが失敗する条件が残る。利用者が指定した「処理時間の計測など確定的でないテストをCIから除外し、開発中のみ使用する」方針に反する。

**必要な対応:**

- 時計・タイマーを制御する検証へ変更し、実測時間の上限を通常CIの合否条件から外す。
- 実測する検証を残す場合は、既存の `test:timing-sensitive` 等、通常CIが呼ばない開発用経路へ分離する。
- parser/transportの決定的な機能テストは必須検証に残し、登録とworkflowから時間依存テストが混入しないことを確認する。

### I141-BATCH-002 / Medium — バッチのtimeoutが既存のエラー契約を失い、再試行されない

**起源:** introduced_by_change

**状態:** 未修正

**場所:** [transport 219–227行](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/src/adapters/local-git/node-git-blob-batch-transport.ts#L219-L227)、同ファイル323–362行、[既存の失敗分類](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/src/application/operation-feedback/operation-feedback.ts#L324-L371)、[Progressの呼出し](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/src/composition/pull-request/pull-request-review-runtime-base.ts#L701-L790)。

新しいtransportは要求・EOF・closeの期限切れを、`new Error(timeoutMessage)` で返す。既存の失敗分類がGit timeoutとして再試行可能とするのは、`GitCommandFailedError` の `result.exitCode === -1` 等であり、今回の通常Errorは `permanent` になる。LocalGitと構成層は、この例外を再分類せず上位へ返す。

恒久設計§9.5は、metadata/blobのtimeoutでinvocation・取得済み出力・stderrを保持する `GitCommandFailedError` とsynthetic exit code `-1` を要求する。基点の単件readerはこの形式を返す。

**実証:** 実際の `NodeGitBlobBatchTransport` にfake childと手動タイマーを注入し、2 OIDの要求timeoutを発火させた。取得した実Errorを、実際の `classifyOperationFailure` / `runWithBoundedRetry(maxAttempts: 3)` へ渡した。比較側は既存単件timeout契約のErrorを構成した。

| 入力 | 分類 | 試行回数 | 2回目は成功する処理の結果 |
|---|---|---:|---|
| 実transportが返したbatch timeout | permanent | 1 | rejected |
| 既存単件timeout契約のGitCommandFailedError / exitCode -1 | retryable | 2 | recovered |

batch側のmessageは `Git cat-file batch request timed out after 30000 ms`。callback 0回、SIGTERM 1回、残存する手動タイマー0件も確認した。実時間で30秒待つ検証ではない。

**影響:** バッチに入る複数OIDの取得で一時的なtimeoutが発生すると、最大3回の再試行が設定されていても1回でPR Progressが失敗する。単件取得との動作差が生じる。

**必要な対応:**

- バッチのtimeoutでも、既存設計§9.5に沿ったGit failure形式・exit code・診断情報を保持し、既存の分類で `retryable` となるようにする。
- キャンセル・壊れたプロトコル・通常の非0終了などの異なる失敗を一律に再試行可能へ変更しない。
- 実transportの要求/EOF/close期限と構成層の再試行を結ぶ、手動タイマーによる回帰検証を追加する。1回目timeout・2回目成功で回復し、キャンセルと恒久失敗が再試行されないことも確認する。

### I141-BATCH-003 / Medium — 親ディレクトリと子ファイルの同時指定が単件APIと一致しない

**起源:** introduced_by_change

**状態:** 未修正。静的候補 `PR141-LG-C01` を実Gitで確認した上で、このfinding IDを付与した。

**場所:** [LocalGit 93–105行](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/src/adapters/local-git/local-git-adapter.ts#L93-L105)、[276–291行](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/src/adapters/local-git/local-git-adapter.ts#L276-L291)、[追加された実Git比較テスト](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/test/integration/local-git-adapter.integration.test.ts#L580-L639)。

追加テストは親 `nested` と子 `nested/tracked.txt` を同時に取得し、各パスを単件取得したMapと一致することを要求している。ただし、親の中にはこの子ファイルしか作っていない。

**実証:** 接続先のGit `2.46.0.windows.1` で、`nested/tracked.txt` と `nested/other.txt` を持つ合成リポジトリを作成した。親と子を同じ `ls-tree` に指定すると、Gitは次の両方を返した。

```text
nested/other.txt
nested/tracked.txt
```

新しいparserは未要求の `nested/other.txt` に対して `git ls-tree output does not match a requested exact path` を投げ、一括要求全体が失敗した。

| 呼出し | 実際の結果 |
|---|---|
| 単件 `nested` | missing-file |
| 単件 `nested/tracked.txt` | found、本文 `tracked\n` |
| 一括 `[nested, nested/tracked.txt]` | Errorで拒否 |

**影響:** 公開されている追加のLocalGitメソッドで、単件取得との互換性を失う。正常な子ファイルも取得できない。通常のPR Progressから親ディレクトリdescriptorが混入する経路は、このレビューでは確認しておらず、通常UIでの発生を断定しない。

**必要な対応:**

- 親・子の同時指定でも、各要求パスを単件取得したときと同じ結果を返すように、metadata取得と検査を調整する。
- 未要求の兄弟ファイル・さらに深い子を含む実Git fixtureで、親はmissing-file、要求した子はfoundとなることを検証する。
- literal path、特殊文字、壊れたmetadata、パスごとのencodingに対する既存の検証境界を維持する。

## 検証結果と環境

検証場所はRDMCPの接続先Windows（node_id `local`）。プロセスのshellは `C:\WINDOWS\system32\cmd.exe`。レビュー対象は `C:/Users/donabe/RemoteDesktopWorkspace/revmem-pr141-review-20261009` のdetached HEADである。

レビュー対象からtracked file 1,577件を作業用領域へコピーし、製品ソースに出力を書き込まず検証した。コピー時のsource manifest SHA-256は `a41be6724e6ba4ecb87ed955bb501c666dae97689498ee0b0a86623689bb517e`。既存の依存は `revmem-enoent-design/node_modules` の実体を参照し、新規依存の追加・global install・認証や機械設定の変更はしていない。作者側と対象側のlockfile SHA-256が `77112e133928664383d0ddaf18dccf076bec5f55d7afe7720d55a1946f7c085f` で一致することを確認した。

| 検証 | 結果 |
|---|---|
| Node / TypeScript / Git | v24.20.0 / 6.0.3 / 2.46.0.windows.1 |
| `tsc -p validation-source/tsconfig.test.json --outDir compiled` | exit 0 |
| 変更関連7ファイルの `node --test` | 130件、125成功、0失敗、5 skip、exit 0 |
| timeout再試行probe | バッチ1回失敗・既存単件契約2回で回復を確認 |
| 親子パスprobe | 単件成功/欠落に対してbatch全体の例外を確認 |
| 時間依存テスト1件、模擬停止なし | exit 0 |
| 同テスト1件、1度だけ1,100msの模擬停止あり | assert失敗、exit 1 |
| probe全体の実行 | exit 0（各観測を保存する検証scriptの終了値。模擬停止時テストのexit 1は別に保持） |

変更関連7ファイルは、parser、batch transport、LocalGit、single reader、T405 runtime、T606実composition、LocalGit実Git統合である。5 skipはWindowsで実行しないPOSIX signal fixture。今回のWindows検証でPOSIX signalの成功を主張しない。

生の標準出力・標準エラー・結果JSON・source manifest・再現scriptは、接続先の `C:/Users/donabe/RemoteDesktopWorkspace/review-artifacts/pr141-review-20261009/` に保存した。

- `validation-identity.json`、`source-manifest.json`
- `compile-test.stdout.log`、`compile-test.stderr.log`、`compile-test.result.json`
- `focused-review.stdout.log`、`focused-review.stderr.log`、`focused-review.result.json`
- `review-probes.cjs`、`review-probes.stdout.log`、`review-probes.stderr.log`、`review-probes.result.json`
- `timing-control.*`、`timing-scheduler-pause.*`

準備時、PowerShellが `npm.ps1` を拒否し、別の読取コマンドでは `Get-FileHash` が利用できなかった。これは製品テスト失敗ではない。標準の `npm.cmd`、Node、RDMCP転送のhash検証を使用し、実行ポリシーの変更は行っていない。ソース取得・検証開始前のTodo期限切れ拒否2回は、進捗更新後に未実行操作だけを実行した。

## CIと診断成果物

対象HEAD `a910aa2ecf5134ec900bfe3e980b5f5149169710` に一致する実行だけを確認した。

| イベント | run | 結果 |
|---|---|---|
| pull_request | [37938466844](https://github.com/ssaattww/RevMem/actions/runs/37938466844) | success |
| push | [37938461409](https://github.com/ssaattww/RevMem/actions/runs/37938461409) | success |

PR runのjob `113846440613` はbuild、型検査、architecture正負、lint、unit、各登録済み回帰、Git/GitHub統合、Extension Host、VSIX生成/manifest検証/成果物uploadまで成功している。

[ci.yml](https://github.com/ssaattww/RevMem/blob/a910aa2ecf5134ec900bfe3e980b5f5149169710/.github/workflows/ci.yml) は `tools/run-ci-command.mjs` でstdout・stderr・combined log・exitを持つresult JSONを保存し、失敗時に環境・生成物・source等を含む `ci-failure-diagnostics-${run_id}-${run_attempt}` をuploadする。必要な診断workflowは既存のため変更不要だった。成功したPR runでは失敗時成果物段階はskipし、user validation artifactのuploadは成功している。成果物IDや内容のダウンロードは今回未実施。

旧HEAD `fcd2b423...` の失敗runを、このHEADの結果として代用していない。報告追加後の別HEADのCI状態は公開後にPRコメントへ別記し、この表の成功を自動的に転用しない。

## 変更ファイルと確認範囲

| ファイル | 主な確認 |
|---|---|
| `package.json` | test:unit追加登録、timing-sensitiveとの分離 |
| `reports/immutable-blob-batch-review-preparation-20261009.md` | 範囲、検証件数の位置付け、過去測定と今回未実施の区別 |
| `src/adapters/local-git/cat-file-batch-parser.ts` | OID・型・サイズ・ヘッダー上限・LF・EOF・応答件数 |
| `src/adapters/local-git/git-blob-reader.ts` | optional API、型付きサイズ超過 |
| `src/adapters/local-git/index.ts` | exportと既存factory |
| `src/adapters/local-git/local-git-adapter.ts` | literal path、128件/引数制限、重複OID、encoding、fallback、abort |
| `src/adapters/local-git/node-git-blob-batch-transport.ts` | 逐次要求、backpressure、期限、TERM/KILL、遅延error、購読解除 |
| `src/adapters/local-git/node-git-blob-reader.ts` | 基点差分、既存single契約と中断時cleanup |
| `src/composition/pull-request/pull-request-review-runtime-base.ts` | revision別prefetch、cache、世代/登録一致、Tree公開 |
| `src/composition/pull-request/pull-request-review-runtime.ts` | batch取得の進捗報告と既存公開経路 |
| `src/composition/review-contexts/review-contexts-runtime.ts` | production登録、local/remote順序、逐次remote fallback、例外伝播 |
| `test/integration/local-git-adapter.integration.test.ts` | 実Git、単件比較、特殊path、link・gitlink・tree |
| `test/unit/cat-file-batch-parser.test.ts` | 任意chunk境界、欠落/過剰/破損フレーム |
| `test/unit/local-git-adapter.test.ts` | 引数予算、129 OID、encoding、oversize、遅延decode、abort |
| `test/unit/node-git-blob-batch-transport.test.ts` | 手動clock、終了競合、backpressure、購読、時間依存assert |
| `test/unit/node-git-blob-reader.test.ts` | 既存readerのtimeout・部分出力保持・中断と終了処理・spawn失敗競合 |
| `test/unit/t405-pull-request-review-runtime.test.ts` | batch呼出しとcache利用、既存PR状態/登録競合 |
| `test/unit/t606-r6-real-composition.test.ts` | 実compositionのbatch登録、local/remote結果順、remote同時数1 |

直接依存として、LocalGitのcontracts/runtime factory/executor、repository path validator、revision text source、operation-feedbackの分類/再試行、PR登録・revision cache・line reviewability・公開世代管理を追跡した。PR再検出のGitHub adapterと選択identityの実装は今回の差分に含まれず、関連するsourceと設計の継続性および対象HEADのCIを確認した。

## Coverage dispositionsと限界

| 必須観点 | disposition | 根拠 |
|---|---|---|
| 要求・設計適合 | checked_finding | I141-BATCH-001/002/003 |
| 正しさ・境界条件 | checked_finding | I141-BATCH-002/003、実probe |
| 範囲逸脱 | checked_no_finding | 高速化と関連テスト・報告に限定 |
| 変更ファイルと直接依存 | checked_finding | 18ファイルと呼出し先、上記指摘 |
| API・互換性・設定 | checked_finding | optional互換は確認、timeout/親子pathに指摘。依存/設定追加なし |
| エラー・診断 | checked_finding | I141-BATCH-002。failure artifactは既存 |
| セキュリティ・秘密情報 | checked_no_finding | immutable OID、canonical/literal path、shell:false、上位の既存秘匿境界 |
| テスト・検証の妥当性 | checked_finding | I141-BATCH-001、正常検証と追加probeを分離 |
| current HEADのCI | checked_no_finding | 両runのhead SHA一致とsuccess |
| 報告・文書・追跡 | checked_no_finding | 旧性能測定/今回未測定を区別。PR専用task IDは未確認、対象はPRで確定 |
| 回帰・保守性 | checked_finding | I141-BATCH-002/003。共通validator等の再利用は確認 |

保留事項は、現在main対この候補の性能再測定、物理VS Code UIでの受入、Windowsから実行できないPOSIX signal fixtureである。性能・実機UIの確認は実装担当/利用者の後続確認事項とし、この高速化限定レビューで完了したとは扱わない。対象HEADのhosted Extension Host成功と、物理実機UI確認は別の証拠である。

初期実装の「自然な仕様red→green」の実施順序は、今回読んだ公開報告・コミットから確認できない。今回の追加検証を作者のTDD red証拠へ読み替えない。未確認事項を成功へ転換せず、通常レビューの判定は必須指摘3件に基づくfailとする。

## 修正後に必要な引継ぎ

実装担当へI141-BATCH-001/002/003を一括で返す。修正・適切な回帰検証・詳細報告・対象コミットの公開後、この通常レビュー担当へfix verificationを依頼する。各findingについて、要求した対応、production path、実composition/実Git fixture、該当HEADのfocused evidenceを示すこと。現在の指摘IDとMediumの重大度を保持する。

完全な構造化引継ぎは [handoffs/immutable-blob-batch-review-20261009.json](../handoffs/immutable-blob-batch-review-20261009.json) に保存する。独立最終レビューとmergeは今回実施していない。

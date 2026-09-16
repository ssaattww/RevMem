# PR120 PDS-06 通常レビュー

## 判定と対象

判定: **fail / 要修正**。P2の指摘2件。製品コード・製品テスト・設定・設計・タスク状態は変更していない。

- 対象: `ssaattww/RevMem` PR #120、PDS-06「設定とPR限定のコマンド経路接続」。
- ブランチ: `investigation/issue-119-linked-diff-blocks`。
- reviewed implementation HEAD: `d256b2506247c302ad1edd5b2af247368fe2fdba`。
- PDS-06差分: `9fbee35335bf735564f1f1388367e3f7fe371079..d256b2506247c302ad1edd5b2af247368fe2fdba`。
- 製品実装コミット: `00d42300d838d510b2101d03d7969ba7ce0a4a31`。
- PR base: `main` / `989317e00893e3b45a9e77ecb550e99274ac7e69`。
- レビュー種別: initial review。現在のチャットはこの実装・修正を行っていない通常レビュワー。PR全体の独立最終レビューではない。
- 本レポートは通常レビュー記録。後続の記録用コミットを製品レビュー済みHEADとは扱わない。マージしない。

## 確認方法

RDC接続先 `ibis-ThinkBook-14-G7-IML`、device `75840a70-dea0-4d8c-9bb4-fe97c78bc11e` に固定して確認した。コマンド前に実行中セッションを確認し、他作業の待機プロセスと作業ツリーを変更していない。
レビュー作業ツリーは `/home/ibis/RevMem-pr120-pds06-review-20260916`。検証は同一HEADをgit archiveした別領域 `/home/ibis/RevMem-pr120-pds06-review-evidence-20260916/source` で実施した。
HEADのtreeは `77f1f3415a22ffad11746085b0d741d38fad2a1b`。検証後、追跡1470ファイルの内容を作業ツリーと比較し、不一致0件だった。
依存関係は同一package-lockを確認した既存node_modulesを参照。Node.js v22.13.1 / npm 11.4.2。CIはNode.js 24。

## 指摘

### PDS06-NR1-001 / P2: 別改訂のPRでGlobalだけの更新が捨てられる

origin: introduced_by_change。既存のno-op判定へ今回block transactionを接続したことで、blockの受入条件を満たさない。旧side経路にも同種の比較不足があるが、本指摘は新設block経路で再現した。
位置: `src/application/review-commands/diff-editor-review-command-service.ts:234-237`、比較元 `:88-94`、commit判定 `:300-303`。

再現条件は `globalState.currentRevisionId !== PR.headSha` で、originalとmodified Contextは操作後の状態と一致し、PR head側のGlobalだけが一致していない場合。
`pull-request-review-state-service.ts:76-129` は現在のGlobalを保護し、PR側の変更を `globalState.revisionSnapshots[headSha].files` へ格納する。しかしコマンド側はContext.filesとGlobal.filesしか比較せず、snapshot内だけの変更を `no-op` として破棄する。

| 操作元 | 操作 | 期待 | 実測 |
| --- | --- | --- | --- |
| original | 確認 | PR側Globalを確認済みにし、commitと履歴を追加 | no-op、Globalは未確認のまま、追加なし |
| modified | 確認 | 同上 | 同上 |
| original | 解除 | PR側Globalを未確認にし、commitと履歴を追加 | no-op、Globalは確認済みのまま、追加なし |
| modified | 解除 | 同上 | 同上 |

既存の実PR runtime fixtureで4ケースを実行し、すべて期待値 `applied` に対して `no-op` となった。確認時のcommit/history件数は1→1、解除時は2→2。設定や差分本文を模擬的に差し替えたコマンド実装ではなく、製品のcreateCommandServiceとcore更新処理を通している。
影響: 設計の「Globalだけが変化する場合も保存・履歴へ反映」を満たさず、確認状態の不一致が操作後も残る。
必要対応: 改訂別snapshotも含めてsemantic changeを判断する。既存の `hasReviewStateSemanticChange` はContext/Global全体を比較するため、共通判定の利用を検討する。現在のGlobalを書き換えて解決してはならない。
修正後の確認: 上記左右×確認/解除の4ケースを実PR runtime経路で常設化し、PR snapshotの更新、現在のGlobalの不変、commit1回、modified履歴1回を確認する。現在改訂とPR headが一致する場合、および全成分no-opの回帰も残す。

### PDS06-NR1-002 / P2: 保存履歴でsideとblockを区別できない

origin: introduced_by_change。位置: `src/composition/extension.ts:615-623`。関連: `src/application/review-history/review-history-recorder.ts:51-60,97-120`。
今回の接続ではblock操作のreasonもside操作と同じ `user-selection` になり、recorderは両者を同じ `marked-reviewed` / `unmarked-reviewed` に変換する。transactionのoperationやselectionModeは保存イベントへ残らない。
1行追加のmodified側をsideとblockそれぞれで確認し、実際のcompositionに記述された履歴callbackと製品ReviewHistoryRecorderへ渡した。発生時刻を除いた保存イベントは完全に一致し、どちらもtype=marked-reviewed、reason=user-selection、同じContext/Globalのbefore/afterとなった。
影響: `Design/pr-diff-selection-mode.md:267` の「履歴上でも区別可能」を満たさない。追加のみ、または元側に変化がない操作では、イベント件数や範囲からもモードを復元できない。
必要対応: reasonまたは専用フィールドに、保存後も区別可能な操作情報を残す。履歴件数を増やして区別するのではなく、既定の状態差分に基づくイベント生成規則を維持する。
修正後の確認: composition callbackから実recorderまで通し、確認と解除、追加のみ、置換で片側だけ変化する場合にも識別情報が残ることを常設テストで確認する。

## 検証結果

全コマンドは `tools/run-ci-command.mjs` 経由で結果JSON・stdout・stderr・結合ログを保存した。以下はレビュー対象HEADの検証結果であり、記録用コミットのCIではない。

| 検証 | 結果 |
| --- | --- |
| npm run test:pr-diff-selection | 59/59成功 |
| npm run test:unit | tooling 16/16、unit 790/790成功。skipなし |
| npm run build | 成功 |
| npm run typecheck:contracts | 成功 |
| npm run validate:architecture | 成功 |
| npm run validate:architecture:negative | 期待した違反11件を検出し成功 |
| npm run lint | 成功 |
| git diff --check | 成功 |
| 外部領域のruntime-probes.cjs | 7件中2件成功、5件失敗。Global更新4件と履歴識別1件が上記指摘を再現 |

追加試験で成功した2件は、repository.load待機中の設定変更がその操作へ影響せず次の操作から反映されること、設定readerが例外を投げてもファイル全体操作には影響せず選択操作だけが拒否されること。
再現試験は既存のコンパイル済みt405 fixtureの登録処理だけを抑えて再利用し、製品のPR runtime・差分計画・状態更新を呼び出した。履歴試験はcompositionソースのcallbackをそのまま読み出し製品recorderへ接続した。実Extension Host起動の代替と主張するものではない。
再現スクリプト: `/home/ibis/RevMem-pr120-pds06-review-evidence-20260916/runtime-probes.cjs`。
診断保存先: 同領域の `source/test-output/ci/review-pds06-*.{result.json,stdout.log,stderr.log,log}`。再現結果は `runtime-probes.console.log` にも保存した。これらはRDC先のファイルであり、アップロード済み成果物ではない。
実行済み再現コマンド: 検証用sourceから `node tools/run-ci-command.mjs review-pds06-runtime-probes node --test ../runtime-probes.cjs`。
同一改訂の追加対照試験を後から追加するコマンドはツールの安全確認で拒否され、実行していない。拒否された処理を別経路で再実行していない。上記7件の実行済み証拠とは区別する。

## CIと履歴証拠

GitHub connectorでrun `35034039691` を確認した。event=pull_request、head_sha=`d256b2506247c302ad1edd5b2af247368fe2fdba`、attempt=2、conclusion=success。attempt 1の失敗診断artifactも残っており、無再試行で成功したとは扱わない。
artifact `10423250803` は `review-range-user-validation-0.1.53-pre+d256b25`、`10423085920` は `ci-failure-diagnostics-35034039691-1`。一覧とHEAD対応のみ確認し、バイナリ内容はダウンロードしていない。
実装時のRed結果JSONは2026-09-15 22:46:21Z開始・exit1、Greenは22:52:05Z開始・exit0を確認した。履歴ログから当時の未commitソース内容までは独立証明できない。本レビューの現在HEAD検証と混同しない。
PDS05-NR1-001は既存再レビューの解決済み扱いを維持する。今回のsnapshot比較不足は別の指摘であり、その重大度や解決記録を書き換えない。

## 確認範囲と判断

| 観点 | disposition | 根拠 |
| --- | --- | --- |
| 差分の範囲と依存関係 | checked_no_finding | PDS-06の全13変更ファイルと呼出先・呼出元を確認 |
| 設定の既定値・許可値・不正値 | checked_no_finding | config reader、manifest、type fixture、設定単体試験 |
| 操作中の設定固定と次回反映 | checked_no_finding | 実runtimeの設定切替試験とload待機を用いた追加試験 |
| 通常エディタ・任意diff・local base/headとの分離 | checked_no_finding | src/extension.ts:776-795、local-base-head-runtime.ts:226-240、composition/extension.ts:692-715、既存回帰 |
| 空選択・ファイル全体操作 | checked_no_finding | session前の空選択return、scope分離、例外を投げる設定readerを用いた試験 |
| block計画と左右の更新 | checked_no_finding | deriveChangeBlocks、createDiffSelectionTargetPlan、focused試験 |
| Globalのみの差分・no-op判定 | checked_finding | PDS06-NR1-001、実runtimeの4ケース失敗 |
| 履歴識別と生成順序 | checked_finding | PDS06-NR1-002。状態差分によるmodified/original生成順序自体は維持 |
| stale・保存・表示の接続 | checked_no_finding | descriptor/file検証、commit時registration照合、原子的commit後の再計算経路を確認。全受入試験は後続タスク |
| ビルド・型・lint・CI接続 | checked_no_finding | 上記実行結果、package.jsonの既定試験接続、CIの同一HEAD確認 |
| 報告・追跡の整合 | checked_finding | 記録された成功結果は再現できたが、上記2件によりPDS-06は合格扱いにできない |

対象外・未完了の境界: PDS-07の全設計表の統合受入、PDS-08の網羅的stale/CAS/reload、PDS-09の実VS Code操作、PDS-10の最終判定は実施していない。これらが未着手であること自体は本レビューの新規不具合には数えない。
通常/任意diffとの分離はソース経路と既存試験による確認であり、block設定を入れた実Extension Hostでの新規UI試験は含まない。

## 次の対応と公開境界

実装担当が上記2件を修正し、指摘ごとの「必要対応・製品経路・実際のcomposition fixture・focused evidence」を揃えて、この通常レビューの指摘確認へ戻す。PDS-07以降やマージは自動開始しない。
今回の保存対象は本詳細レポートと通常レビューhandoffのみ。製品修正・既存テスト修正・タスク状態変更は行わない。
記録用コミットはこのレビュー対象HEADを親に作成する予定で、作成時点のSHAは本レポートに自己参照で書かない。pushとPRコメントの実際の成否・記録用HEADは最終回答およびPRコメントに記載する。

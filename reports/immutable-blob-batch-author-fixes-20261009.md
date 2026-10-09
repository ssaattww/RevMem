# PR #141 作者修正報告

対象は [PR #141](https://github.com/ssaattww/RevMem/pull/141)、基点 main `6ab5736d148fff0d403d250f2a262ab426dde714`。通常レビューの報告追加HEAD `c1a0bb7c7e97060f353b59297f871b9772ac1713` から修正する。指摘IDと重大度を保持し、作者の検証を独立レビューの合格判定とは扱わない。

## I141-BATCH-003 / Medium

親と子を同じ `ls-tree` に渡すと、Gitが未要求の兄弟を返し、exact-path検査で要求全体が失敗する。祖先・子孫が重なる場合だけmetadata要求を別呼出しへ分割した。parserの未要求path・重複・NUL・metadata形式の検査は変更していない。非重複129pathは引き続き128/1の2呼出しとなる。

実Gitの既存fixtureに兄弟、深いディレクトリ、その子と兄弟、blobの下の存在しない子を追加した。通常のfile、tree、gitlink、link、特殊文字、missingについて単件Mapとの一致を検証する。旧a910aa2の検証済みcompiled adapterを読取参照した同fixtureは `git ls-tree output does not match a requested exact path` で失敗し、修正後は成功した。通常UIからの親descriptor混入は未確認のまま保持する。

## IR141-001 / P2

本番compositionが登録する `readTextContents` は単件wrapperを迂回していたため、既存 `pull-request-file` / `read-content` / filePath の詳細通知がなくなっていた。一括wrapperにも既存detailを読取前に通知する処理を追加した。新しいreason、phase、診断設定は追加していない。詳細OFFの秘匿は既存feedback hostに従い、active snapshotとabortの条件を保持する。

実T405登録を実PullRequestReviewRuntimeへ接続し、冷cacheの一括I/Oをgateで停止した回帰を追加した。旧実装は詳細ONで期待1件に対して0件となり失敗。修正後はpending中に既存detail1件、OFFで0件、単件fallbackなしで成功した。既存compositionのsupersession/abort/stale publication検証も同時に成功した。

## I141-BATCH-001 / Medium

polling harnessの未発生event検証が、25msの実timeoutと実測1秒上限に依存していた。時計とwaitを注入し、仮想25ms、5回の5ms waitで停止することを検証するよう修正した。必須CIからparser/transportの機能検証を除外していない。旧テストはreviewerの1回1100ms停止preloadで失敗し、新テストは同preload指定でも1件成功した（仮想時計のため実時間timerを使用しない）。

## I141-BATCH-002 / Medium

request/EOF/close期限切れを通常Errorから `GitCommandFailedError`、synthetic exitCode `-1` へ修正した。invocationは `cat-file --batch`、cwdは要求root。終了処理完了後に診断を構成するため、期限前とTERM中に取得したstdout/stderrを含む。timeout値、実際の終了signal、TERM/KILLの送信失敗やgrace超過を記録する。取消・protocol異常・通常非0終了の分類は変更していない。

初回修正 `b55d068e5e7137c6f0d3063c991ca3ed8e2c0bc8` はstdout診断をグループ共有64 KiB prefixとしたため、先行blobで容量が埋まると失敗中のpartial stdoutと終了中chunkが消える契約不足が残った。独立fix verificationはI141-BATCH-002 / Mediumを部分未修正としてfailとした。この判定を成功へ読み替えない。

残件修正では、新しいOID要求の直前にstdout診断をリセットし、完了済みの先行blobを保持しない。現在要求の64 KiB prefixと、timeout後の終了処理用の独立64 KiB prefixを時系列順に同じError.stdoutへ結合する。EOF/close期限では最後の要求診断を残す。片側の容量を使い切っても、他phaseの出力を消さない。各phaseの切捨てをstderrへ明示し、stdout保持は最大128 KiBでOID数・先行本文サイズに比例しない。stdoutのcopyは保持するsliceだけに限定した。stderrは既存64 KiBの収集境界を維持する。診断はError内に保持し、新しいユーザー向けpath/body出力は追加しない。単件readerの無制限stdout保持と同一だとは主張しない。

手動timerで3期限を発火させる回帰は、型・invocation・exitCode・partial stdout・終了中出力・timeout値・SIGTERM・retryable分類・残存timer0を確認する。実transportのtimeout Errorを実 `runWithBoundedRetry` へ渡し、2回目成功で回復する。さらに実PullRequestReviewRuntimeの本番 `activateProgress` 再試行経路へtransportを接続し、timeoutだけ2回で回復・tree公開、abort/protocol/non0は1回で終了・tree未公開を確認した。

追加した実transport/手動timer回帰は、先行70,000 bytesのblob成功→次OIDの `ACTIVE-PARTIAL`→request timeout→TERM中 `TERMINATION-TAIL` とstderrを再現する。旧b55d068でstdout欠落の失敗を確認し、修正後はstdoutが現在要求header＋partial＋終了tailと完全一致、callback1回、SIGTERM1回、timer0となる。現在要求自体が70,000 bytesを返したrequest/EOF timeoutでも、終了chunk用の容量が独立し、保持量上限とphaseごとの切捨て表示を確認する。3件とも旧実装で失敗、修正後成功。ログは作者workspaceの `blob-batch-prefix-red.log`、`blob-batch-prefix-green.log`。

独立レビューでI141-BATCH-001 / Medium、I141-BATCH-003 / Medium、IR141-001 / P2はb55d068についてclosed。今回の残件修正でこの3件の製品経路を変更していない。

## 検証と残件

FA780 Windows、Node v24.20.0、既存依存を使用。依存・認証・環境・workflowを変更していない。

- `npm.cmd run compile:test`: exit 0。
- transport、LocalGit unit、実composition、LocalGit実Git統合の4ファイル: 78件成功、失敗0、skip0。
- `npm.cmd run build`: exit 0。
- 生ログは作者workspaceの `blob-batch-fix-green2.log`、`blob-batch-fix-003-red.log`、`blob-batch-fix-build.log` に保存。

追加検証: transport36件成功・失敗0、注入clockのharness1件成功、`compile:test`成功。ログは `blob-batch-fix-001-002-green.log`、`blob-batch-fix-001-scheduler-green.log` に保存。初回回帰fixtureの終了後stderr writeは終了前hookへ訂正し、初回greenで失敗した旧messageのregexは型とresult.stderrを確認する形へ変更して再実行した。これら途中の失敗を成功へ読み替えない。

最終HEADの広範囲検証・CI・通常fix verification・独立最終レビューは、この公開時点では未完了。旧HEADのCI成功を新HEADへ転用しない。現在mainとの性能再測定、物理VS Code UIの受入は未実施。

b55d068の後続確認はunit972成功、Git61成功/3skip、Issue139/composition41成功、PR CI37948493626/push CI37948483438ともsuccess、Extension Host成功、PR artifact11625230865保存成功だった。これらはstdout残件修正後のHEADの成功証拠ではない。

002残件修正後の作者検証は `compile:test`、build、lint、architectureがexit0。parser/LocalGit/transport/PR runtime/実composition/診断routing/LocalGit実Gitの7ファイル137件成功、失敗0、skip0。transport単独は39件成功。ログは `blob-batch-prefix-focused.log`、`blob-batch-prefix-build.log`、`blob-batch-prefix-lint.log`、`blob-batch-prefix-architecture.log`。この残件の独立fix verificationと新HEADのCIは公開後の確認事項として保持する。

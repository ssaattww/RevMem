# PR #141 作者修正報告

対象は [PR #141](https://github.com/ssaattww/RevMem/pull/141)、基点 main `6ab5736d148fff0d403d250f2a262ab426dde714`。通常レビューの報告追加HEAD `c1a0bb7c7e97060f353b59297f871b9772ac1713` から修正する。指摘IDと重大度を保持し、作者の検証を独立レビューの合格判定とは扱わない。

## I141-BATCH-003 / Medium

親と子を同じ `ls-tree` に渡すと、Gitが未要求の兄弟を返し、exact-path検査で要求全体が失敗する。祖先・子孫が重なる場合だけmetadata要求を別呼出しへ分割した。parserの未要求path・重複・NUL・metadata形式の検査は変更していない。非重複129pathは引き続き128/1の2呼出しとなる。

実Gitの既存fixtureに兄弟、深いディレクトリ、その子と兄弟、blobの下の存在しない子を追加した。通常のfile、tree、gitlink、link、特殊文字、missingについて単件Mapとの一致を検証する。旧a910aa2の検証済みcompiled adapterを読取参照した同fixtureは `git ls-tree output does not match a requested exact path` で失敗し、修正後は成功した。通常UIからの親descriptor混入は未確認のまま保持する。

## IR141-001 / P2

本番compositionが登録する `readTextContents` は単件wrapperを迂回していたため、既存 `pull-request-file` / `read-content` / filePath の詳細通知がなくなっていた。一括wrapperにも既存detailを読取前に通知する処理を追加した。新しいreason、phase、診断設定は追加していない。詳細OFFの秘匿は既存feedback hostに従い、active snapshotとabortの条件を保持する。

実T405登録を実PullRequestReviewRuntimeへ接続し、冷cacheの一括I/Oをgateで停止した回帰を追加した。旧実装は詳細ONで期待1件に対して0件となり失敗。修正後はpending中に既存detail1件、OFFで0件、単件fallbackなしで成功した。既存compositionのsupersession/abort/stale publication検証も同時に成功した。

## 検証と残件

FA780 Windows、Node v24.20.0、既存依存を使用。依存・認証・環境・workflowを変更していない。

- `npm.cmd run compile:test`: exit 0。
- transport、LocalGit unit、実composition、LocalGit実Git統合の4ファイル: 78件成功、失敗0、skip0。
- `npm.cmd run build`: exit 0。
- 生ログは作者workspaceの `blob-batch-fix-green2.log`、`blob-batch-fix-003-red.log`、`blob-batch-fix-build.log` に保存。

I141-BATCH-001 / MediumとI141-BATCH-002 / Mediumは別の作者修正単位で検証・公開する。最終HEADの広範囲検証・CI・通常fix verification・独立最終レビューは、この初回公開時点では未完了。旧HEADのCI成功を新HEADへ転用しない。現在mainとの性能再測定、物理VS Code UIの受入は未実施。

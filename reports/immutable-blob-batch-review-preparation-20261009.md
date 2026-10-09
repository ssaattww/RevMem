# immutable blob一括読み取りのレビュー準備

## 対象と出典

最新main `6ab5736d148fff0d403d250f2a262ab426dde714` を基点とする高速化限定の再構成。
公開コピー元はPR #138の `cd3b4b3926744daaf7ea68743f17c3d8701d4e6b`。
旧cloud候補 `eac1e9c5b8a5bfaffe0792e1fe3e860120cd0aa3` の完全patch・再構成scriptは未回収であり、同一commit/treeの復元ではない。
親から回収した17ファイル一覧・保持契約と公開sourceを照合して、必要箇所を最新mainへ組み込んだ。

## 変更

- optional `readBlobs` / `readTextContents` と、複数pathのimmutable text読み取りを追加。既存reader/登録はsingle-readを維持する。
- metadataのliteral pathspecを128件・Windows argv予算以下へ分割し、OID重複を取り除く。1 unique OIDは既存single-readを使う。
- pathごとのencodingで逐次decodeし、raw blobをまとめて保持しない。batch parserは128 OIDとblob上限を検査する。
- typed oversizeのみgroup全体をsingle-readへ戻す。abort/transport失敗後に遅延decoderが結果を公開できないようにする。
- 子プロセスの内部EOF/close期限、TERM→KILL、late error処理、購読解除を保持する。
- Progressの既存generation/cancellation確認とimmutable cacheを利用し、同revisionの内容を一括取得する。remote fallbackは逐次実行する。
- 実Git、parser/transport、単体reader、Progress、実production compositionの回帰を追加する。

## 除外とmain互換

新しいユーザー向けtimeout設定、Issue #137の詳細診断、single-readのcommit検証cache、state repository/debounce/store/lock、GitHub lifecycle memo、UI coordinatorは含まない。
PR #140で統合されたclosed/mergedの新規検出、同HEADの別PR隔離、旧v1選択の移行を保持する。Issue #139を閉じ直さない。
依存・認証・環境設定の変更はない。専用checkoutから既存のインストール済みnode_modulesを参照した。
本PRはIssue #136/#137の部分対応であり、症状全体の解消や実機受入完了を主張しない。

## 今回のFA780検証

- TypeScript production/testコンパイル、build、lint: 成功。
- parser/transport/single-reader/LocalGit/Progress/Issue139/T606/実Gitのfocused: 140成功、0失敗、5 skip（POSIX signal fixture）。
- 初回focusedは139成功・1失敗・5 skip。Windowsで改行/タブ入りファイル名を作成できないfixtureを修正して再実行した。
- 実Git比較はWindowsでspace/日本語pathを使い、symlink blobをGit indexへ直接登録する。POSIXではcolon/tab/newlineとsymlinkを確認する。
- 新しいT606回帰では実compositionのbatch登録、local+remote結果順、remote最大同時数1を確認する。
- 広域unit/Git/CI、Extension Host、実機UI、新mainと新候補の性能比較は公開時点のPR本文で進捗を追記する。
- 過去のtiming-sensitive Extension Host 2件の失敗はbaseline/current双方で再現した既存記録があるが、今回の成功件数には含めない。今回の再実行は未実施。

## 既存の性能証拠（今回の再測定ではない）

[既存切り出し比較](https://github.com/ssaattww/RevMem/pull/138#issuecomment-6072653263) は旧main `a479bf5` 対 `700549f`。
Linux 6.18.44 / Node 24.19 / Git 2.52、実Git合成1000 files×1000 lines、34,893,000 bytes。
GitHubは各request 5msのmock、各3回AB/BA/AB、OS cacheを維持しstateを毎回新しくした条件。

| cold Progress対象 | baseline | 旧切り出し | 差 |
|---|---:|---:|---:|
| 10 files | 163.41 ms | 44.25 ms | 119.16 ms短縮（72.9%） |
| 1000 files | 17,544.52 ms | 829.83 ms | 16,714.69 ms短縮（95.3%） |
| 1 file | 37.63 ms | 45.10 ms | 7.47 ms悪化（19.9%） |

1000 filesのGit subprocessは3000→24。再検出のspawn 15は不変。
後の1 file・30 run比較では差中央値+0.622 ms、遅い5/速い5で、原因未確定・再現不安定。1 fileの改善根拠にはしない。
公開PR #138内部の別比較89.6%と混同・加算しない。現在main/本候補/Windows実機の改善率を示す値ではない。

[購読保持量96→1、終了後双方0](https://github.com/ssaattww/RevMem/pull/138#issuecomment-6073885419) は購読数の証拠でありRSSや速度の改善量ではない。

## 受渡し境界

本人がレビューを入れるためDraft PRを公開する。追加の親独立レビューは公開前提にしない。
通常pushのみ。新Issue作成、force push、merge、deployは行わない。
この報告は実装・検証の記録であり、独立レビューの合格判定ではない。

Refs #136
Refs #137

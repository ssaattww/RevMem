# T204 R4再レビュー対応レポート

## 対象

- Pull Request: #24
- タスク: T204 rename・directory move・deleteのfile state適用
- 指摘レポート: `reports/issue-1-t204-review-r4-20260725150000.md`
- 指摘commit: `382b78cee12caa260110df5503c41873fa8aea89`

## 指摘

`+++ b/path<TAB>timestamp`をauthoritative parserは`path`へ正規化する一方、cross-section destination validatorはTAB以降をpathの一部として保持していた。この差により、copyとadditionが実際には同じdestinationを指す不正diffでも重複検証を回避できた。

## TDD対応

### Red

commit: `274965bb474a6588c1e64c6c4e356cad64d6687a`

- copy destination: `dest.ts`
- addition header: `+++ b/dest.ts<TAB>2026-07-25 13:50:00.000000000 +0900`
- 上記をduplicate destinationとして拒否する回帰testを追加

### Green

commit: `f6c9ef638dc3d29ccee082bb00d109eb40542a8d`

- `+++` / `---`形式のfile header path専用decoderを追加
- 最初のTAB以降をtimestamp metadataとして除外してからGit pathをdecode
- `copy to`、`rename to` metadata pathにはTAB除去を適用せず、既存contractを維持

## main同期

- base main: `31218556a31afa8f7f2532a302a593c3df8fc62f`
- compare: ahead、behind 0

## CI

このレポートcommit後のbranch HEAD SHAに紐づくworkflow runのみを最終判定に使用する。

## 結論

R4のblocking指摘1件へTDDで対応した。最終CI成功後にPRコメントへ結果を記録する。マージは行わない。

# T204 初回レビュー対応レポート

## 対象

- Pull Request: #24
- ブランチ: `task/t204-file-state-transitions`
- 初回レビュー: `reports/issue-1-t204-review-20260725085000.md`
- 判定: fail・follow-up必須

## TDD

### Red

- commit: `9dae7da83a39438e0845b316b7eeda075f0a7a50`
- rename chain、swap、delete+rename、copy destination、plain addition、stale content hash、whitespace設定、曖昧mapping、metadata不正、state validationの回帰testを実装より先に追加した

### Green候補1

- implementation commit: `312d8ac8e83a232ae32d7a4109a94d1649024fbb`
- public export commit: `abe24931744ba5873ae46cd9323bb45f7babcb73`
- workflow run: `30139675659`
- Build: success
- Lint: failure
- 原因: `contentHash`除去用destructuringの未使用変数2件
- failure diagnostics artifact: `ci-failure-diagnostics-30139675659-1`
- artifact ID: `8614034999`

### Green

- lint修正commit: `4d140409a91f5abf321442ff529f6012108e3f4f`
- workflow run: `30139784716`
- conclusion: success
- Build、Lint、Unit、Temporary Git integration、Mock GitHub integration、VS Code Extension Hostの全工程が成功した

## 対応内容

### transition graphとstable file ID

- 全source file IDを変更前snapshotから解決する
- rename、delete、copy、additionを先に計画し、検証後に一括適用する
- rename chain、swap、delete+renameをdiff section順に依存せず処理する
- destinationが同一diff内でrenameまたはdeleteされる場合だけ既存path占有を許可する

### conservative state

- 曖昧または追跡不能なsourceは`modifiedReviewed`と`originalReviewedByDiff`を空にする
- 旧`contentHash`を除去し、旧確認済みstateを新revisionへ誤継承しない
- unresolved理由を`ambiguous-file-mapping`、`missing-source-state`、`missing-new-file-metadata`として返す

### copy・split・merge・addition

- `newFiles` metadata contractを追加した
- copy、曖昧rename、plain additionのdestinationを新規未確認`FileReviewState`として生成できる
- stable file ID、line count、content hash、new textをcallerが明示する
- destination metadataが不足する場合は推測せずunresolvedへ記録する

### content hashと設定伝播

- 100% rename-onlyでは既存hashを保持する
- 内容変更renameでは旧hashを除去し、提供された新hashだけを保持する
- `oldTexts`と`newFiles[path].newText`を使い、whitespace/EOL設定を完全textで証明して適用する

### performance

- complete diffのparseを1回だけ実行する
- 各renameは対応するparsed file sectionを直接mappingする
- directory moveで完全diffをfile数分再parseする二次構造を廃止した

### validationとmetadata parser

- state keyとfileId一致、path一意性、line count、reviewed interval境界を検証する
- new file ID重複、destination path衝突、rename metadataのfileId不一致を拒否する
- quoted copy pathの閉じquote後余剰文字を拒否する
- duplicate copy/status/similarity metadataとconflicting statusを拒否する

### public contract

- 公開type、property、関数へJSDocを追加した
- resultは完全snapshotであり、未変更fileは旧file-level revisionを保持し得ることを明記した
- input mutationなし、例外時partial resultなし、新規file metadata責務を明記した

## 追加test

- 100% rename hash維持
- 内容変更rename hash更新とinterval invalidation
- rename chain
- rename swap
- delete+rename destination再利用
- copy destinations未確認化
- plain addition未確認state生成
- whitespace-only rename設定
- duplicate rename candidateのsource/destination未確認化
- duplicate/trailing copy metadata拒否
- invalid line count・interval拒否

## 残作業

- 修正差分の専用再レビュー
- 再レビュー指摘がある場合の追加TDD対応
- 再レビュー通過後の`tasks/tasks-status.md`、`tasks/phases-status.md`同期
- PR本文の最終検証・証跡更新

マージは行わない。

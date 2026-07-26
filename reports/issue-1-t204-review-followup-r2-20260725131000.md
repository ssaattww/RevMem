# T204 再レビュー対応レポート R2

## 対象

- Pull Request: #24
- ブランチ: `task/t204-file-state-transitions`
- 再レビュー: `reports/issue-1-t204-review-r2-20260725113000.md`
- 再レビュー判定: fail・追加follow-up必須

## TDD

### Red

- commit: `6a5c2f8893786d6418ab15bdc4f8538a5916d086`
- copy元state維持、CRLF/LF、末尾改行追加、曖昧rename元除去、destination metadata不足時のatomic failureを実装より先にtestへ追加した

### Green

- commit: `a51c579fdaef715103ce66072d8f2e578ec73e16`
- workflow run: `30143717014`
- Build、Lint、Unit、Temporary Git integration、Mock GitHub integration、VS Code Extension Hostが成功した

## 対応内容

### copy元state

- copyはsource fileを残す操作として扱う
- copy sourceの`modifiedReviewed`、`originalReviewedByDiff`、`contentHash`、file-level revisionを変更しない
- copy destinationだけを`newFiles` metadataから新規未確認stateとして生成する

### EOL contract

- T203と同じ`differsByOneTerminalLineBreak`境界をT204へ反映した
- CRLF/LFの全文差と、末尾改行1個だけの追加・削除を`ignoreEolChanges`で維持できる
- 完全textがない場合は従来どおり保守的に変更扱いとする

### 曖昧rename・split

- rename sourceが複数destinationへ対応し追跡不能な場合、旧source stateをpost-transition snapshotから除去する
- destinationはstable IDを継承せず、新規未確認stateとして残す
- 元fileが残るcopyとは別経路に分離した

### complete snapshot contract

- plain addition、copy destination、曖昧rename destinationで`newFiles` metadataが不足した場合は`RangeError`でatomicに拒否する
- incomplete snapshotを正常returnしない
- inputを変更せず、例外時にpartial resultを返さない
- `missing-new-file-metadata`をunresolved reasonから除去し、metadata不足を明示的なvalidation failureへ統一した

## 回帰test

- copy source review/hash保持
- copy destination未確認化
- CRLFからLFへのEOL-only rename
- 末尾改行1個の追加
- 曖昧rename sourceのsnapshot除去
- addition/copy destination metadata不足のatomic failure

## 検証

HEAD `a51c579fdaef715103ce66072d8f2e578ec73e16`に紐づくCI run `30143717014`で全工程成功を確認した。

## 残作業

- 修正差分の再々レビュー
- 通過後の`tasks/tasks-status.md`、`tasks/phases-status.md`同期
- PR本文の最終更新

マージは行わない。

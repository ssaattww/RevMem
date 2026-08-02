# T601 レビュー指摘対応レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: #33
- Task: T601
- Mode: review follow-up
- Source finding: `T601-R001` (High)
- Reviewed implementation HEAD: `0e3440fa0a4e015463adb56d338488c53291a4c1`
- Fix implementation HEAD: `8ea9c993e871d1268377c10e5441e2a76e34ea66`
- Base: `main`
- Branch: `task/t601-non-git-snapshots`

## 指摘内容

`uniqueLcsMapping`が一致セルで対角遷移だけを採用していたため、同じ長さの別LCSが存在しても一意と誤判定し、曖昧な重複行を確認済みとして継承する可能性がありました。

## 対応

### テスト

以下の回帰テストを追加しました。

- レビュー指摘例: old=`A / X / A`, new=`A / A / X`
- 一致セルの対角遷移が別の最長mappingを隠す実反例: old=`A / A / B / B`, new=`A / B / B / A`

どちらも曖昧として空の確認済み範囲を返す契約を固定しました。

### 実装

`uniqueLcsMapping`を以下の方式へ変更しました。

1. suffix LCS長を計算する。
2. prefix LCS長を計算する。
3. 最長LCSに参加可能な一致ペアを全て列挙する。
4. 候補ペア数がLCS長と一致し、かつ全候補が単調増加する場合だけ一意なmappingとして採用する。
5. それ以外は曖昧として未確認化する。

これにより、一致セルで対角遷移を選べる場合でも、skip経路に同長の別mappingが存在すれば曖昧として扱われます。

## 変更ファイル

- `test/unit/non-git-snapshot-tracker.test.ts`
  - 重複行の並べ替えと隠れた代替LCSの回帰テストを追加。
- `src/application/non-git-snapshots/index.ts`
  - LCS mappingの一意性判定をprefix/suffix候補判定へ変更。

## TDD証跡

- Red commit: `a32dbe30ac5d9ddb72df1daad265487f30a35d63`
- Green implementation commit: `8ea9c993e871d1268377c10e5441e2a76e34ea66`
- Red HEADに一致するworkflow runは確認できず、CI未実施として扱います。別SHAのrunは代用していません。

## CI

Fix implementation HEAD `8ea9c993e871d1268377c10e5441e2a76e34ea66`に一致するworkflow runは、確認時点で存在しません。

- Current conclusion: CI未実施
- 別SHAのrunによる代用: なし
- 既存の失敗診断artifact workflow: 変更なし。失敗時にログ、標準出力/標準エラー、テスト結果、生成物、ソース一式を保存する構成を維持。

## Finding disposition

- `T601-R001` (High): addressed
  - Evidence: 上記2件の回帰テストと、一致ペア候補を全列挙する一意性判定。

## 意図的に変更していない範囲

- snapshot圧縮・整合性検証
- 保存期限・容量制限
- workspace provider連携
- Git所有権routing
- CI workflow

今回の指摘に直接関係しないため変更していません。

## 残存事項

- current HEAD一致CI runの生成と成功確認。
- 同じnormal reviewerによるfix verification。

## Merge境界

mergeは実施していません。mergeは利用者が行います。

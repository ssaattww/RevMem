# Issue #119 設計: PR差分の確認単位切替

## 目的

PR差分で選択範囲を確認済み/未確認にする際の単位を、設定で切り替えられるようにする。
従来の片側単位の動作は維持し、必要な利用者だけ変更ブロック単位の左右連動を有効化できるようにする。

## 設定

新しい設定キーを `reviewRange.prDiffSelectionMode` とする。
型は文字列enumとし、許可値は次の2つとする。

- `side`: 現在の動作。操作したdiff側の選択範囲だけを対象にする。
- `block`: 選択範囲が属する変更ブロックを単位として、original/modified両側を対象にする。

デフォルトは `side` とする。既存利用者の挙動を変更しないためである。
この設定はPR Progressから開いたRevMem管理下のPR差分にだけ適用する。
通常エディタ、任意のVS Code diff、ファイル全体の確認/解除には適用しない。

## 設定境界

`ReviewRangeConfiguration` にPR差分の選択モードを追加し、VS Code設定APIからapplication層へ文字列enumとして渡す。
製品ロジックがVS Code APIを直接参照して分岐する構造にはしない。
不正値は設定読込境界で拒否し、暗黙に別モードへフォールバックしない。

## `side` モード

現在のselection処理をそのまま維持する。
modified側の選択はmodified/Globalだけを更新する。
original側の選択は、既存の安全なunchanged-line mappingとoriginal-only deletionの処理を維持する。
変更ブロック境界の抽出は行わない。

## `block` モード

選択範囲と現在のdiff sideから、選択が接触する変更ブロックを特定する。
変更ブロックは「context行またはhunk境界で区切られた連続する追加・削除行」と定義する。
同一hunk全体をブロックとはしない。context行を挟む別変更を巻き込まないためである。

選択が一つ以上の変更ブロックへ接触した場合、そのブロックのoriginal側削除行とmodified側追加行を一つのtransactionで更新する。
追加のみのブロックではmodified側だけ、削除のみのブロックではoriginal側だけを更新する。
反対側に存在しない行を推測・生成しない。

context行だけを選択した場合は、既存のunchanged-line mappingに従う。
変更行とcontext行を同時選択した場合は、変更ブロック分とunchanged-line mapping分を正規化して一つのtransactionへ統合する。
複数selectionが同じブロックへ触れても重複更新しない。

## 確認済み/解除の意味

`block` では、確認済み化と解除の双方を同じブロック単位で対称に扱う。
つまり変更ブロックに対する操作は、左右の対象範囲を同一transactionでmark/unmarkする。
片側だけ成功する状態は作らない。

既存のファイル全体確認/解除は現状の全差分側対象の動作を維持し、本設定では変更しない。

## 履歴・進捗・Global

履歴は実際に変更されたoriginal/modified両側を既存形式で記録する。
同じ状態への再操作はsemantic no-opとして追加commit/履歴を発生させない。
PR Progressは既存のoriginal削除行 + modified追加行の集計を利用し、新しい進捗schemaは追加しない。
Globalへ反映するのは引き続きmodified側の実在行だけとし、original削除行をGlobalへ混ぜない。

## stale safety

ブロック抽出は現在のruntimeが保持するexact base/headのhunkだけから行う。
古いdiff URI、別context、別base/head、別file identityは既存の検証境界で拒否する。
設定変更時に既存の保存状態を書き換えない。次回の操作単位だけが変わる。

## 実装順序（TDD）

1. 設定enum・default・manifest契約のRedを追加する。
2. `side` が既存挙動を完全に維持するRedを追加する。
3. `block` の左右mark/unmark、複数ブロック、addition-only/deletion-only、context混在のRedを追加する。
4. ブロック抽出とtransaction組立てを実装する。
5. 履歴・PR Progress・Global・stale diff・no-opの回帰試験を追加する。
6. Extension Hostで設定切替と装飾/PR Progress同期を確認する。

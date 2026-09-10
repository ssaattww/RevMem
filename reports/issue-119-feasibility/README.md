# Issue #119: 差分ブロック両側の確認済み連動の実現可能性

## 対象と結論

2026-09-10 / Issue #119 / 調査PR #120。
基準main: `989317e00893e3b45a9e77ecb550e99274ac7e69`。
調査コードcommit: `92f702ecfe70dcafe88e5117975c34a75f6f4d67`。
branch: `investigation/issue-119-linked-diff-blocks`、base: `main`。

**実現可能と判断する。** RevMemが既に取得している不変の差分データから変更ブロックを取り出し、左右の範囲を一括更新する方式が有力である。行数が異なる置換でも、一対一の行対応を推測する必要はない。
これはソース調査と隔離した実験に基づく判断であり、製品への組み込み完了や実画面での動作保証ではない。今回は `src/`、既定のテスト、設定、workflow、保存形式を変更していない。Issueを完了扱いにしない。

## 要求と調査範囲

要求は「差分の片方確認したらブロックの両方確認済みにして欲しい。難しかったら後回しでいい」。利用者は実現可能性からの調査と、RDCによるホーム配下のCodexProjectsへのクローンを指示した。
RDCのWindows端末で `~/CodexProjects/RevMem` に新規クローンし、Node v24.21.0 / npm 11.19.0で検証した。依存導入は成功した。npmは既存依存にmoderate 1件・high 4件を報告したが、依存更新やinstall-script承認の変更は行っていない。
アップロードされたChat実装用Skill群とAGENTS.mdを参照した。独立レビュー・mergeは実施していない。

対象はRevMemが管理するPR差分での確認操作である。GitHub側のViewedとの同期（別Issue #93）、任意のVS Code差分への対応、通常エディタの操作変更、画面の全面作り直しは対象外。

## 現状の根拠

以下の参照は上記の基準mainに対するもの。関数名で追跡できる。

| 場所 | 確認した事実 | 今回の意味 |
| --- | --- | --- |
| `src/application/review-commands/diff-editor-review-command-service.ts` / `applySelectionOperation` | modified側はmodified/Globalだけを更新し、original側は削除範囲と未変更行の写像を扱う | 置換ブロックの左右連動は未実装 |
| `src/application/review-commands/original-selection-review-plan.ts` / `createOriginalToModifiedLineMappings` | 追加・削除を同一行と推測せず、未変更行だけを対応付ける | この安全な写像を連動のために変更してはいけない |
| `src/composition/pull-request/pull-request-review-runtime-base.ts` / `openSession` | exact base/head、ファイルidentity、差分hunks、左右の行数を保持し、古いdescriptorを拒否する | ブロック抽出に必要な入力は取得済み |
| `src/core/review-state/review-state-service.ts` / `markOriginalSelectionReviewed` | 左右の範囲とGlobalを含む単一transactionを構成できる | 状態を表現する基盤を再利用できる |
| `src/application/review-history/review-history-recorder.ts` / `recordTransaction` | 複合操作は変更されたmodified/originalを別イベントとして記録する | 通常のmodified操作に削除範囲だけ付け足す実装では履歴を落とす |
| `src/core/pr-progress/pr-diff-progress.ts` / `calculatePullRequestDiffProgress` | 追加行と削除行を合算し、未変更行とGlobalは分母に含めない | 左右を保存すれば現行の進捗計算で集計できる |

実験で既存の複合primitiveを呼んだのは状態表現の確認である。`side: original`を要求する現在の契約を、右側からの操作にそのまま流用することを承認したわけではない。履歴の`diffSide`は変更対象の側であり、操作元の側を表す専用フィールドではない。
実装時には左右を扱う操作として契約を整理し、transactionの判別と履歴の分岐を一緒に検証する。新しい永続化schemaが不要である見込みは高いが、最終的な互換性検証は実装時に必要。

## 再現実験と観測結果

調査専用の `probe.mjs` は拡張機能にも既定のテスト一覧にも読み込まれない。既存のコンパイル済みモジュールを呼び、候補となるブロック抽出だけをファイル内に隔離した。
最初に抽出処理を空のstubとしてテストを実行し、7件中3件の失敗を確認した。その後、文脈行とhunk境界で区切る抽出処理を追加し、7件すべて成功した。これは実験のTDDであり、製品実装のRed/Green完了ではない。

実験用の1つのhunkには、削除2行・追加3行のブロックと、未変更行を挟んだ削除1行・追加1行のブロックがある。変更行は合計7行。

| 実験 | 結果 |
| --- | --- |
| 現行コマンドで最初のブロックのoriginal側2行を確認 | 2/7。追加3行へは連動しない |
| 現行コマンドで同ブロックのmodified側3行を確認 | 3/7。削除2行へは連動しない |
| 左右の範囲を明示して既存の複合primitiveへ渡す | 5/7。別ブロックと未変更行は数えない |
| 上記の履歴記録 | modified、originalの順に2イベント。originalのdiff IDは正しいbase/head pair |
| 上記の解除 | 0/7へ戻る。呼出元の入力状態は変更されない |
| 同一hunk内の複数ブロック | 未変更行で2つに分離できる |
| 追加のみ・削除のみ | 反対側に存在しない行を作らない |
| 壊れたhunk行数 | 既存の検証で拒否する |

`--require-feature`を付けると現行コマンドにも5/7を要求する。7件中2件が意図どおり失敗し、actual 2 / 3に対してexpected 5となった。これは機能の未実装を示す再現方法であり、成功判定に読み替えていない。
候補抽出と製品コマンドはまだ接続していない。実ディスクへのatomic commit、実Extension Hostの表示更新、操作元の左右切替はこの実験では証明していない。

## 実装案（未承認）

ブロックは、確定した比較内の連続する追加・削除のまとまりとし、未変更行をまたがせない。hunk全体を確認済みにする方式は、同一hunk内の別の変更まで巻き込むため採らない。画面の見た目とGitの区切りが常に一致するとは保証しない。

部分選択には少なくとも次の2案がある。Aは1行でも操作すればブロック全体を確認する方式。Bは操作した側のブロック全行が確認済みになった時点で反対側も確認する方式。
**Bを推奨案とする。** 既存の行単位確認を残し、選んでいない行が突然確認済みになることを避けられる。ただし、この選択はIssue本文だけでは確定していない。Aを採る場合は「ブロックを確認」など操作名にも単位を明示したい。
解除についても、両側を対称に解除するか、選択した側だけ解除するかを決める必要がある。既存の行選択を維持するB案では、少なくとも未選択行まで無断で解除しない仕様が必要。ファイル全体の確認・解除は既存の一括動作を維持する。

製品への変更箇所は、ブロック抽出、sessionへの受渡し、両側を扱うtransaction/履歴、既存コマンドからの結線、表示・進捗の回帰試験が中心になる見込み。PR差分の入力は既にあるため、基本機能のために新しい差分取得APIを追加する必要はないと判断する。
`local-base-head-runtime.ts`も同じコマンドサービスを生成しているため、PR向け拡張がローカル比較へ無条件で広がらないようにする。通常エディタや状態のrevision間写像は変更対象から分離する。

### 実装時の具体的な受入条件

1. 削除2行・追加3行のブロックで、左右どちらを操作しても承認された条件に従って5行が確認済みになる。未変更行を挟む別ブロックは未確認のまま。
2. 1行だけの選択、複数カーソル、逆向き選択、末尾column 0を含む選択、繰返し確認・解除が承認仕様どおりになる。
3. 追加のみ・削除のみ、空ファイル、rename/copy、CRLF、末尾改行を扱い、binaryや不完全な差分に架空の対応行を作らない。
4. BASE/HEAD更新、古いdiffタブ、別context、別ファイル、保存競合で誤った比較の状態を更新しない。両側は同じ保存transactionで更新し、失敗時に片側だけ残さない。
5. 成功後に両側の装飾とPR Progressが更新され、Globalにはmodified側の実在行だけを反映する。削除行をGlobalへ混ぜない。
6. 履歴は実際に変更された両側を記録し、同じ操作の再実行は不要な保存・履歴を増やさない。製品の実結線とExtension Hostで確認する。

## 検証と制約

| 実行 | 結果 |
| --- | --- |
| npm ci | 成功。依存更新なし |
| npm run compile:test | 成功 |
| 関連6ファイルの既存テスト | 45成功、0失敗 |
| probe stub → 候補実装 | 4成功/3失敗 → 7成功/0失敗 |
| probe --require-feature | 5成功/2失敗。現行機能の不足を示す意図的な失敗 |
| npm run build / typecheck:contracts / validate:architecture / validate:architecture:negative / lint | 全て成功 |
| npm test | tooling 16成功。その後unit 732件中710成功、20失敗、2skip |

全体テストの失敗には `document path is outside the resolved Git working tree.` とsymbolic link/junctionの試験が含まれる。製品未変更の基準mainのコードで起きた失敗であり、本Issueに便乗して修正しない。全20件の原因を個別に確定したわけではない。`npm test`はunitで止まるため、後続Git/GitHub/Extension Hostはこのコマンドからは実行されていない。CI全step相当のローカル合格は主張しない。

### 再実行

リポジトリ直下で実行する。Windows PowerShellではnpmを`npm.cmd`に置き換える。

```sh
npm ci
npm run compile:test
node reports/issue-119-feasibility/probe.mjs
node reports/issue-119-feasibility/probe.mjs --require-feature
```

最後のコマンドのexit code 1は未実装の再現である。通常の調査結果検証は1つ前のコマンドを使う。
既存のfocused試験は次の6ファイルを`node --test`へ渡した。全て `test-dist/test/unit/` 配下。
`diff-editor-review-command-service.test.js`、`original-diff-selection-projection.test.js`、`review-history-original-side.test.js`、`pr-diff-progress.test.js`、`issue-92-pr-progress-selection-review.test.js`、`t303-review-followup.test.js`。

全実行は `tools/run-ci-command.mjs` を通した。Windowsでは実行対象を `node <npm-cli.jsの絶対パス> run <script>` としてshell依存を避けた。ログはRDC作業ツリーの `test-output/ci/issue119-*` に保存してある。
各labelについて `.stdout.log`、`.stderr.log`、`.log`、`.result.json` があり、開始・終了時刻、終了コード、signal、spawnErrorを記録する。Red時の実験ソースは `issue119-probe-red-source.mjs` に別保存した。これらのローカルログはGitHub Actionsのartifactではない。
代表labelは `issue119-baseline-focused`、`issue119-probe-red`、`issue119-probe-green`、`issue119-production-feature-gap`、`issue119-gate-test`。

## CI・公開状態・引継ぎ

着手時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。失敗時のテスト出力、標準出力、標準エラー、実行結果JSON、環境・checkout SHA・関連ソースを `ci-failure-diagnostics-*` に保存するworkflowが存在するため、追加変更していない。
この文書生成時の調査コードHEADは `92f702ecfe70dcafe88e5117975c34a75f6f4d67`。実験コードのRDC上のGit blob SHAとコネクタ作成blob SHAはともに `38f805e8135244c09c978147f7a06e063612704e` で一致した。
文書を含む公開commitは生成待ちであり、自分自身の将来のSHAはここへ記載しない。PR #120の最終HEADと一致するpull_request CIだけを確認し、その結果・run ID・artifactの有無を公開後のPRコメントへ記録する。この時点でCI成功とはしていない。

未検証は実Extension Hostへの結線、左右装飾の即時同期、上記の受入条件全体、実ディスクでの競合、性能、大きなdiff、Gitと画面のブロック境界一致である。今回の実験だけで出荷可能とは判断しない。
次の作業は部分選択・解除の仕様を決定した上で、製品側の失敗テストを先に追加し、必要な実装と通常レビュー・独立レビューへ進むこと。技術的に不可能で後回しにする根拠は今回見つからなかったが、優先順位は利用者が決める。
PRは調査用draftとして維持し、Issue #119をcloseせず、mergeしない。

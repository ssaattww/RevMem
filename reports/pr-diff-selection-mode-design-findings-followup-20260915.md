# PR差分確認単位 設計指摘対応レポート

## 対象

- Repository: `ssaattww/RevMem`
- PR: `#120`
- branch: `investigation/issue-119-linked-diff-blocks`
- 再レビュー報告HEAD: `732eaf1893df502ff0f123aec4157a715ff8a2d5`
- 設計修正commit: `0bfbba02ac284e335e2394648db502ae94c19482`
- 設計成果物: `Design/pr-diff-selection-mode.md`
- 対応対象: D1 / D2 / D3

今回も製品実装には進まず、再レビューで未解消とされた設計契約だけを修正した。
製品コード、テストコード、設定実装、永続化schema、workflowは変更していない。

## D1: Globalを含む変更なし・履歴判定

PRの元側・先側だけで状態変化を判断する記述を廃止した。
block操作の永続化状態を `original`、`modified Context`、`Global` の3成分として明示した。
各成分を `未確認` / `一部確認` / `全確認` とし、確認済み化と解除の遷移規則を成分単位で定義した。

commit/no-opはblock展開後のexpected/nextをContextとGlobalの双方で比較して決定する。
modified ContextまたはGlobalのどちらかに差分があればmodified履歴を記録する。
originalに差分があればoriginal履歴を記録する。
両方に差分があればmodified、originalの順で履歴を記録する。

再レビューで例示された次の4ケースを受入表に追加した。

| original | modified Context | Global | 操作 | 期待結果 |
| --- | --- | --- | --- | --- |
| 全確認 | 全確認 | 未確認 | 確認済み化 | Globalを更新しmodified履歴 |
| 未確認 | 未確認 | 全確認 | 解除 | Globalを更新しmodified履歴 |
| 未確認 | 全確認 | 未確認 | 確認済み化 | originalとGlobalを更新し両履歴 |
| 全確認 | 未確認 | 全確認 | 解除 | originalとGlobalを更新し両履歴 |

加えて、3状態×3成分の直積について、確認済み化・解除の期待状態を成分遷移表から一意に導出し、実装時に全組み合わせをテストする契約とした。

## D2: 選択境界

raw selectionをhunkへ直接当てず、既存 `selectionsToLineIntervals` で半開行区間へ正規化した後だけ変更ブロックとの重なりを判定すると固定した。

境界ケースを元側・先側の双方について表で固定した。

- カーソルのみはカーソル行1行として扱う。
- 逆向き選択は順方向と同じ区間へ正規化する。
- 次行の列0で終わる非空選択は終点行を含めない。
- 空selection配列はsessionを開く前にno-opとする。
- 複数selectionは正規化・結合後に変更ブロックとの積集合を判定する。
- 上記規則は確認済み化と解除で共通とする。

これにより、選択していない次ブロックを列0終端だけで巻き込む実装を禁止した。

## D3: ブロック入力・複合更新・履歴の接続契約

変更ブロック導出の責務を `application/review-commands` の純粋projectionとした。
exactな両側line countとimmutable hunksから、context行またはhunk境界で分割された `DiffChangeBlock` を生成する。
unchanged-line mappingとは別projectionとし、replacement行の1対1対応は推測しない。

PR runtimeはexact base/head、file、hunksを所有するため `openSession` でprojectionを生成する。
sessionへ `selectionMode` と `changeBlocks` を渡し、block modeのPR sessionだけchangeBlocksを必須とする。

local base/head runtimeは `selectionMode: side` を明示し、新機能をPR以外へ暗黙に展開しない。

既存 `OriginalSelectionReviewRangeMutationInput` はoriginal起点のunchanged-line mapping用なのでblock操作へ流用しない。
block専用input、`markDiffBlockReviewed` / `unmarkDiffBlockReviewed`、専用operation IDを追加する設計とした。
block transactionは既存Modified/Original transactionへ偽装せず、`ReviewStateTransaction` unionの新しいmemberとする。
`invokedFrom` は操作起点の証拠に限定し、更新対象・履歴対象はactual deltaから決定する。

Context modified、Global、originalを1つのexpected/next transactionで更新し、既存CAS境界を利用する。
保存schemaは変更しない。
History recorderはblock operationを明示分岐し、Context/Global差分でmodified event、original差分でoriginal eventを生成する。

## 命名規則

今回の設計成果物 `Design/pr-diff-selection-mode.md` のファイル名・本文にIssue番号またはタスク番号を入れていない。
設計中のAPI候補も責務ベースで命名した。
レポート・handoffは利用者指定どおり番号禁止の対象外である。
既存の他タスク由来ファイルは変更していない。

## 診断workflow

作業開始時に `.github/workflows/ci.yml` を再確認した。
主要commandは `tools/run-ci-command.mjs` 経由でstdout、stderr、combined log、result JSONを保存し、失敗時には `ci-failure-diagnostics-*` artifactをuploadする既存workflowがあるため変更していない。

## ローカル検証

RDCの `C:\Users\donabe\CodexProjects\RevMem` で実行した。

| 検証 | 結果 | 証拠 |
| --- | --- | --- |
| `git diff --check` | 成功 | whitespace errorなし。LF/CRLF警告のみ |
| 設計書の作業管理番号検査 | 成功 | `WORK_ITEM_NUMBER_HITS=0` |
| test source compile | 成功 | `pr-diff-design-findings-compile.result.json`, exit 0 |
| 関連7ファイル | 46成功 / 0失敗 / 0skip | `pr-diff-design-findings-focused*.result.json` |
| `npm test` | 途中失敗 | tooling 16/16成功、unit 732件中711成功・19失敗・2skip |

フルローカルゲートの19失敗はWindows上の既存Git作業ツリー解決を通るテストで、代表的なエラーは `document path is outside the resolved Git working tree.` だった。
今回の変更はMarkdown設計書だけであり、製品・テストコードは変更していない。
このためローカル全体成功とは主張せず、Linuxのexact-head CIを最終証拠として別に確認する。

ローカル診断ログは `test-output/ci/pr-diff-design-findings-*` にstdout、stderr、combined log、result JSONとして保存した。

## 変更していないもの

- `src/**`
- `test/**`
- `package.json` / 設定実装
- 永続化schema
- `.github/workflows/ci.yml`
- Issue close / PR merge

## publicationとCI

設計修正commit `0bfbba02ac284e335e2394648db502ae94c19482` はRDCのgitでpush済み。
このレポートとhandoffを別の管理commitとしてpushした後、その最終PR HEADと `head_sha` が一致する `pull_request` CIだけを最終判定に使う。
別SHAのrunは代用しない。一致runがなければCI未実施として扱う。

## 後続実装

製品実装が承認された場合は、今回追加した表と接続契約から先にRedテストを作成する。
特にGlobal-only差分、original+Global差分、selection境界、PR限定session結線、block専用transaction/historyを省略しない。
設計にない作業管理番号をソースコードや設計書へ持ち込まない。

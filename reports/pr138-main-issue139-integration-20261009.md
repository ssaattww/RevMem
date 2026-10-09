# PR138: Issue139 main 統合の実装・検証記録

## 対象と権限

- 対象: https://github.com/ssaattww/RevMem/pull/138 の既存 branch `issue-136-137-refresh-and-safe-diagnostics`。
- 第一親: `cc3c53cc2845afaaed84ad00af5ea7645fae5c67`。
- 取り込む固定 main / 第二親: `6ab5736d148fff0d403d250f2a262ab426dde714`。
- 実装者による review-target 記録。履歴を保持するローカル merge、通常 commit/push、結果コメントはユーザー承認済み。独立レビューの合格記録ではない。

## 統合内容

Issue139 の open/closed/merged PR 再検出、branch/remote による候補限定、branch ごとの明示選択を取り込んだ。PR138 の診断 OFF/ON、キャンセル、refresh、operation-local cache と安全な診断 reason を保持した。

競合は package.json、GitHub adapter/search contract、Current PR resolver、Review Contexts composition、T405 fixture の6ファイル・13箇所で解消した。search API は branch identity を第三引数、AbortSignal を第四引数とする。履歴 PR の選択では選択対象の HEAD を同期し、取得・認証契約を保ったまま未選択兄弟の保存状態を保持する。再認証では operation cache を消去する。

テスト修正は次の3点に限定した。

- T405 の明示選択 fixture に `refs/heads/main` を渡し、Issue139 の branch 境界を守る。
- timeout fixture を main の `findByHead` API に合わせる。
- colon/tab/newline、symlink、gitlink を含む immutable-path fixture を Git object plumbing で生成する。Windows ファイル名制限に依存させず、既存の期待値と blob-only 判定を保つ。colon/tab/newline の本文一致 assert も追加した。

`test:unit` は `test:tooling` が持つ compile を一度だけ実行する既存 PR138 契約を保持し、両側の regression 登録を残した。依存関係・package-lock と blob reader/transport の本体は変更していない。PR141 の実装は取り込んでいない。

## FA780 のローカル検証

既存 Node v24.20.0、TypeScript 6.0.3、Git for Windows 2.46、既存 node_modules を使用した。依存追加・認証・環境設定の変更なし。全検証プロセスは終了し、stdout/stderr、終了コード、時刻、SHA-256 を外部 evidence directory に保存した。

| 検証 | 最終結果 | 証拠ラベル |
| --- | --- | --- |
| compile:test | exit 0 | compile-test-3 |
| build | exit 0 | build-1 |
| lint | exit 0 | lint-2 |
| typecheck:contracts | exit 0 | contracts-1 |
| architecture / negative contract | 両方 exit 0 | architecture-1 / architecture-negative-1 |
| tooling | 31 成功、0 失敗、0 skip | tooling-2 |
| unit の既存登録ファイル一式 | 972 成功、0 失敗、0 skip | unit-1 |
| GitHub の既存登録ファイル一式 | 49 成功、0 失敗、0 skip | github-1 |
| T405 composition production seam | 10 成功、0 失敗、0 skip | t405-2 |
| Git の既存登録ファイル一式 | 65 成功、0 失敗、既存 skip 3 | git-2 |
| 特殊パス2件 | 2 成功、0 失敗、0 skip | paths-2 |

unit/GitHub/Git は compile 済みの登録ファイルを Node から実行した。npm script 全体の再実行とは区別する。最終 build 後の変更は test/package gate wiring と tracking/report に限定され、production source は変わっていない。

## 初回失敗と再確認

初回ログも保存した。focused-1 は T405 の branch 未指定 fixture で1 subtest と親が失敗し、fixture 修正後 t405-2 が全成功した。tooling-1 は `test:unit` の二重 compile に対する厳しい gate contract が1件失敗し、冗長な compile を除去して tooling-2 が全成功した。assertion の緩和はしていない。

git-1 は Windows の colon/tab 作業ツリー fixture 2件で失敗した。統合前 cc3 の tracked source snapshot を同じ FA780/Node/既存依存で compile し、同じ2件を実行した baseline-paths-1 でも2件とも同理由で失敗した。fixture を Git object 生成へ修正した後、paths-2 と Git 一式 git-2 が成功した。既存 skip 3件を新しい成功とは数えていない。

## 公開・残件

この記録は commit 作成前の通常実装 report であり、自己 SHA を要求しない。merge commit の完全 SHA、二親、remote 照合、PR コメント、CI の確認時点の状態は commit 後の外部 handoff に記録する。

独立レビュー、実 VS Code / Extension Host / 物理 UI、Linux supervisor/subreaper は未実施。以前の Windows timing / Linux audit 記録は今回の統合 HEAD 検証として扱わない。GitHub PR merge と main push は実施しない。

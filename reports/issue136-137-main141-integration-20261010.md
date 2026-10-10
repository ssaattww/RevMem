# PR138: merged PR141 main の統合と契約保持検証

既存 PR138 branch `issue-136-137-refresh-and-safe-diagnostics` の公開済みテスト commit `e4698f0ca694c75b57dcd3ed60b18d3e2a0243e8` に、固定 main `72082d336f8d00480f3e50908f929e88529bcaf8`（PR141 squash merge）を history-preserving local merge で取り込む通常実装・検証 report。ユーザーの継続指示が、以前の PR141 統合除外を明示的に更新した。main push、PR138 の GitHub merge、force push、新しい branch/PR/Issue、依存・環境設定変更は範囲外である。

この report は実装者の検証記録で、独立レビューの合格判定ではない。review-target commit は検証後に作成し、結果 SHA と公開・CI・独立レビュー引渡し状態は外部 handoff と PR138 コメントへ記録する。将来の自身の SHA を report に要求しない。

## 統合内容と衝突解消

9ファイル・41 conflict blocks を両親と照合した。追加の動作仕様は導入していない。PR141 からの既存 review report/handoff は main の履歴として取り込み、今回の統合 HEAD の独立レビュー証拠とは扱わない。

| 境界 | 保持した内容と確認 |
| --- | --- |
| batch transport/parser | main72082 の実装・テストと完全一致。request/EOF/close timeout を retryable GitCommandFailedError にし、active request stdout と termination stdout に別々の上限を保持。大きな完了済み blob が後続診断を隠さない |
| oversized 型 | git-blob-reader に共通 MAX と単一 GitBlobBatchObjectTooLargeError 定義を保持。adapter/transport の instanceof が同じ constructor を参照 |
| exact path | main の ancestor/child pathspec 分離を保持。Windows 上でも Git object を直接構築する既存 fixture により、colon/tab/newline/symlink/gitlink と一括/単一結果一致を検査 |
| commit cache | PR138 の single/batch immutable commit verification cache、LRU 上限、lookup failure 後の prune 再検査を保持 |
| PR Progress | PR138 の signal/feedback/activationGeneration と stale publication fence、main の pre-I/O aborted signal 診断 guard を保持 |
| bulk registration | main の optional bulk reader guard と PR138 の逐次 remote fallback helper を保持。前後の signal 検査と同一 immutable revision/path policy を維持 |
| Issue136/137/123 | checkout/list→accepted Current Context→immutable snapshot→actual Tree の追加 OFF/ON 6ケース、tracking ahead、旧 branch の取消・非公開、operation/generation 対応を既存 unit gate で再検査 |
| Issue139 | closed/merged discovery、branch/remote fence、選択 head と未選択 sibling の区別、明示選択と legacy branch 不明時の fail-closed、operation-local cache を保持 |
| unit gate | tooling が compile:test を一度所有する PR138 の契約を保持し、main の local-git-adapter unit 登録を追加 |

自動統合で同一 import が重複した integration/unit test は重複だけ除去した。PR141 の T606 実 composition テストは詳細診断の target=file path を期待していたため、PR138 の秘匿診断契約と1件衝突した。製品はファイル名を出力していなかった。製品を変更せず、exact safe detail、OFF/ON formatter に私的ファイル名が無いこと、実 Tree に正しい file path と immutable context/base/head があることを追加検査する形へ整合した。取消 signal、遅延 I/O、cache 非汚染、再取得の既存 assertion は保持した。

## 検証

FA780 の既存 Node24.20.0/TypeScript6.0.3/node_modules/Git を使用し、新規 install はしていない。検証 stdout/stderr、開始/終了時刻、終了コード、PID、SHA-256 は外部 `pr138-main141-integration-20261010` に保存。全 task-owned 検証プロセスは終了した。

| 検査 | 結果 | 証拠ラベル |
| --- | --- | --- |
| compile:test 最終 | exit0 | compile-4 |
| build | exit0 | build-1 |
| lint 最終 | exit0 | lint-2 |
| typecheck:contracts | exit0 | contracts-1 |
| architecture 正/負 | exit0 / exit0（期待11違反） | architecture-1 / architecture-negative-1 |
| tooling | 31成功、0失敗、0skip | unit-1 前半 |
| 全 unit | 1,011成功、0失敗、0skip | unit-1 後半 |
| Git/GitHub/T405/T406/T606 と reader の追加33ファイル | 初回255成功・1失敗・8skip。失敗1ファイルのみ修正後1成功・0失敗・0skip。最終カバレッジは256成功・0未解決失敗・8skip | supplemental-1、r6-fix-1 |
| 両親契約の差分照合 | 7項目すべて成立 | contract-preservation.json |

`test:unit` と追加33ファイルの重複を除いた対象リストは `supplemental-files.json` に保存した。成功済みの32ファイルは変更しておらず、再実行は修正した T606 実 composition 1ファイルに限定した。full supplemental の最終一括再実行を行ったという意味ではない。build/型契約/architecture 後の変更はそのテストと tracking/report のみで、製品 input は同一。compile と lint は最終テスト内容で再確認した。

8skip は既存の Windows 条件で、POSIX executable wrapper 1、POSIX ファイル名2、Node reader の POSIX SIGTERM/SIGKILL 5。skip を成功と数えない。main の timeout protocol fake test と real Git batch byte/path/cache tests は実行済みである。

初回失敗も保持した。compile-1 は自動統合の duplicate import/旧 oversized import、compile-3 は追加 Tree assertion の存在しない label property（path に訂正）で exit2。supplemental-1 の1件は前述の秘匿契約衝突。これらは製品挙動修正の TDD Red ではない。compile-2/4 と対象再検証の成功で閉じた。

## Host・実機と未検証

追加テスト commit e4698f0 の FA780 Host は既存 VS Code1.130.0 cache を利用したが、vscode-updating mutex で31秒待機後、Host 開始前に Code が終了した。ownedExtensionHostPids=[]、Host assertions 未実施。既知の環境阻害を避ける設定変更や updater/process 操作は行わず、今回の統合後に同じ起動を繰り返していない。詳細原本、外部 wrapper cleanup の初回不備と fixture cleanup 完了不明は前の checkout-progress report に保持している。

物理 UI、元のユーザー repository と実 GitHub API の再現、Linux supervisor/subreaper は未検証。CI Extension Host と FA780 環境阻害は区別し、公開後に同一 final HEAD の CI 状態を外部記録する。Node production seam の成功を実機成功と扱わない。

## 公開とレビュー引渡し

検証した executable input の source hashes と staged tree を外部 precommit record に保存し、review-target merge commit の二親を e4698f0 と main72082 に固定する。通常 push はユーザーの ssaattww/non-main 承認範囲で行う。remote branch/PR HEAD、main不変、clean を読戻し、PR138 に結果を記録する。統合後の固定 full HEAD を独立レビューへ渡す。独立レビューは親が所有し、ここでは合格や最終 PR merge を宣言しない。

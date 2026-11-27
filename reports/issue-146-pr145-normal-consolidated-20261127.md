# Issue #146 / PR #145 — 実装・検証・通常レビュー統合記録

## 対象と状態

- 親 Issue #142: 実利用報告の原因・解消は未確定、Open を維持。子 [#146](https://github.com/ssaattww/RevMem/issues/146) のみが対象。[Draft PR #145](https://github.com/ssaattww/RevMem/pull/145) の終了参照は #146 のみ。
- branch: `issue-142-pr-base-normalization`; base: `main` / `9afdeaac6c11f9f2a1fa80017e9c838db5003a63`。
- 初回実装 HEAD: `94d26d87093390cd1604e57b3b2bbc1088cb1270`。
- technical_head / 通常再レビュー対象: `250d667b8d0e830632d047dbdcdfe4968418b82c`。
- verification_capability: local_execution_available（クラウド隔離 checkout）。対象回帰の既存証跡を再利用。通常報告・tracking は記録HEAD `eda5220fd9e5151481e5f6c73e4a61063a3d1fce` として通常push済み。本追補のみ commit_pending、administrative_parent は同記録HEAD。追補SHAは作成後に外部引継ぎで示す。独立最終レビューの予約、freeze、担当選定、判定、attestation は未実施。

## 要件・差分

根拠: #146、Issue139設計 `Design/Issue139PullRequestRediscovery.md`、Issue107の比較元規則、#145 本文の初回実装・検証記録。open は merge-base、closed/merged は API base を維持し lifecycle/diff と一致させる。状態未指定の従来経路、revision検査、fail-closed、認証・依存・永続化は維持。

- `src/adapters/github/fetch-github-pull-request-adapter.ts`: 初回は closed/merged の比較元を統一。通常レビューfollow-upで候補生成時に既存 `requirePullRequestCommitObjectId` を base/head 双方に適用し、malformed → API unavailable とする。追加 API 呼び出しなし。
- `test/unit/issue-139-pr-rediscovery.test.ts`: 初回6件（3状態の検索/lifecycle一致、保存済み選択とProgress）、follow-up 6件（closed/merged の不正base/head拒否、正常SHA-256保持）。既存の正常SHA-1、open と他の回帰を維持。
- `Design/Issue139PullRequestRediscovery.md`: 比較元決定規則を明記。技術差分は計3ファイル、135追加/2削除。診断PR #143、package/lock、認証、実環境は変更なし。

## 検証証跡（実行済み、再実行なし）

| 技術対象 | Red | Green | 他の検査 |
|---|---|---|---|
| 初回 `94d26d8` | 6件、2 pass / 4 fail（closed/mergedの不一致） | 対象7ファイル95/95 pass | compile:test、build、lint、contract typecheck、architecture正負（負例11）、diff check 成功 |
| 修正 `250d667` | 6件、2 pass / 4 fail（不正base/headが返る） | 対象7ファイル101/101 pass、0 fail/skip | 同じ静的検査、diff check、package/lock不変 成功 |

対象7ファイル: issue-139-pr-rediscovery、mock-github、t405-github-lifecycle、pr108-operation-local-lifecycle-cache、t407-private-pr-context、t405-composition-regression、t402-pr-diff-acquisition（既存test-distのNodeテスト）。クラウド隔離checkoutの `test-output/ci/issue142-*.result.json` および `issue146-review-*.result.json` と対応stdoutログが実行証拠。レポート変更に伴う同一技術版の再実行なし。

正確な技術HEADの通常CI:
- 初回: [push 45960509816](https://github.com/ssaattww/RevMem/actions/runs/45960509816)、[PR 45960572310](https://github.com/ssaattww/RevMem/actions/runs/45960572310) 成功。
- 修正: [push 45962097811](https://github.com/ssaattww/RevMem/actions/runs/45962097811)、[PR 45962103916](https://github.com/ssaattww/RevMem/actions/runs/45962103916) 成功。2026-11-27 に run list の headSha と completed/success を実読確認。自動CIのみ、手動起動なし。記録のみの後続HEADのCIは別扱い。

### 所定検証の実行経路と証拠範囲

`package.json` の `npm test` は `test:unit`、`test:git`、`test:github`、`test:t502`、`test:vscode` の順次実行。`.github/workflows/ci.yml` は PR head SHA を明示checkoutし、Ubuntu runner / Node 24 / npm ci の上で、その5構成コマンド（vscodeはxvfb-run）と追加の静的・focused gateを実行する。技術HEAD `250d667b8d0e830632d047dbdcdfe4968418b82c` の [PR CI 45962103916 / build-and-lint job 140382110529](https://github.com/ssaattww/RevMem/actions/runs/45962103916/job/140382110529) のstep conclusionを確認: 5構成コマンドすべて成功、build/contract/architecture正負/lint、T602/T603/T403/T404/T405/T406、Issue106、T304/T503/T504/T505/T506/T604/T605/T606/T609/T610、VSIX version/package/manifest/uploadも成功。failure diagnosticsは成功時のためskip。T506/Extension Host はCI環境での実行であり実機ではない。

親担当の合意に従い、正式検証証拠は技術HEADのローカル対象101/101と静的検査、同HEADのexact-head自動CIによる所定コマンド全構成の成功の組合せ。所定コマンドの逐次実行範囲をCIで確認したのであり、ローカルで一括 `npm test` または全CI等価gateを再実行したという意味ではない。実機のWindows/WSL、本人の認証済みprivate repo、元の失敗原因・解消、実機ログは未確認、成功扱いしない。

通常記録HEAD `eda5220fd9e5151481e5f6c73e4a61063a3d1fce` は技術HEADとの差分が本報告とtasks/phasesの3文書のみ。[PR CI 45963752376](https://github.com/ssaattww/RevMem/actions/runs/45963752376) と [push CI 45963746587](https://github.com/ssaattww/RevMem/actions/runs/45963746587) のexact-head successを確認した。これらの証拠を再利用し、追補は文書のみ。追補HEAD固有のCIは別扱いとし、freeze担当への引継ぎ時に最新状態を示す。

## 通常レビューと閉鎖

親担当より提供された通常レビュー証跡（2026-11-27、初回HEAD `94d26d8`）: 必須1件。対象 `src/adapters/github/fetch-github-pull-request-adapter.ts` 309–312行付近。closed/merged の比較を省略する分岐で従来の完全なGit object ID検証が迂回され、不正なbase/headが候補に返る。既存形式検証を再利用し、API呼び出しを増やさず拒否すること。重大度は「必須」のまま保持（細分類・reviewer ID は提供されていない）。修正対象 `250d667b8d0e830632d047dbdcdfe4968418b82c` に対する親担当提供の通常再レビュー: 前回必須1件解消、新規必須0件、合格。独立判定ではない。本人の実機報告とは分離。

## 凍結前の親判断と通常引継ぎ

- Skill-gap判断（親担当、本追補依頼）: **no skill action needed**。既存の通常レビューで検証漏れを検出し、修正回帰と同一技術HEADの再レビューで解消できた。既存Skillの変更・新規Skillなし。
- フィードバック分類（記録起点: 親判断）: issue固有の実装回帰／既存通常工程で閉鎖済み。再利用可能な工程の欠落や反復問題として新規FP行・重複group・Skill変更Issueを作らない。将来のSkill変更課題なし。根拠は前回必須1件、fix verification 101/101、同HEAD通常再レビュー合格と自動CI success。本報告を閉鎖記録とし、別文書・active FP ledgerへの重複記録は不要。
- 通常引継ぎ: 初回・修正実装/検証、通常レビュー所見と閉鎖、PR #145 / 子 #146 の参照、技術HEAD、記録HEAD、検証経路、残件を本統合記録とtask/phase trackingに同期。親 #142 未解決、#143温存。これは通常工程の完了証拠であり、独立最終レビューの予約・凍結・判定・attestation は別担当。

## 残件・境界

PR #145 はDraft、#142/#146はOpen。実際の利用者のPR状態と比較元条件は不明であり、#142根因・解消は確定しない。本人実機の再試行・レビュー依頼なし。独立最終レビュー担当へ通常工程の証跡と記録commitの正確なHEADを引き渡す。独立最終レビューの予約・凍結・判定・公開は別担当の責務。本記録は独立最終レビュー報告でもattestationでもなく、マージを許可しない。

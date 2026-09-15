# Sub-agent実行レポート

## タスク

- 目的: PDS-01 本文の行数契約の実装・検証。
- タスク種別: implementation。対象PR #120、開始HEAD c2dfc3cb27efd79bdf41c4e0ad7b9534161b588b。

## sub-agentを使う理由

- 利用者が実装terra highを指定。親は管理とレビュー統合を並行して行う。

## 対象範囲

- tasks/pr-diff-selection-mode/tasks-status.md のPDS-01と担当テスト。

## 対象外

- PDS-02以降、設計改変、他案件、push、merge、自己レビュー。

## Dispatch profile

- selection inputs: implementation / bounded_technical / uncertainty medium / radius local / criticality ordinary / repetition single / context fresh。
- selection source: user_override。
- observed decomposability: sequential_dependencies。
- decomposition policy / disposition: single task; sequential implementation。
- proposed profile: none。
- approval status / evidence: 利用者「実装 terra high」。
- requested profile: gpt-5.6-terra / high / fork_turns none。
- agent role / default-role plan: runtime default; explicit model/effort via collaboration schema。
- role config evidence / profile effect: config.tomlにはagents role overrideなし。公開spawn schemaはfresh forkでoverride対応。planned effect unchanged。
- planned runtime profile: gpt-5.6-terra / high。
- applied profile: null。
- application status: spawn_succeeded_profile_unverified; identity /root/line_contract。
- runtime profile observability: final_profile_hidden。
- reviewer continuity: not applicable。
- fork policy: none。
- reasons / constraints: 全実装terra high、レビューsol highという利用者指定。Skillは清潔なorigin/main 106ea5dcf12c4805756351fb9381df220b94f044の専用worktreeから読む。旧Skill作業branchは変更しない。

## 実行コマンド

- Red（有効な実行）: `node tools/run-ci-command.mjs pds-01-document-line-contract-red C:\\Windows\\System32\\cmd.exe /d /s /c "npm run test:document-line-contract"`。
  `deriveDocumentLineContract` と `RevisionDocumentText` が未exportのため `TS2305` で失敗した。`test-output/ci/pds-01-document-line-contract-red.result.json`、標準出力・標準エラー・結合ログを保存した。
- Green: `node tools/run-ci-command.mjs pds-01-document-line-contract-green C:\\Windows\\System32\\cmd.exe /d /s /c "npm run test:document-line-contract"` — 3 passed、exit 0。`test-output/ci/pds-01-document-line-contract-green.result.json` と各ログを保存した。
- テスト検出: `node tools/run-ci-command.mjs pds-01-discovery-focused C:\\Windows\\System32\\cmd.exe /d /s /c "npm run compile:test && node --test test-dist/test/unit/ci-workflow-contract.test.js test-dist/test/unit/document-line-contract.test.js"` — 20 passed、exit 0。専用scriptと既定unit scriptの双方に新規testが登録されていることを確認した。
- 契約型検査: `node tools/run-ci-command.mjs pds-01-typecheck-contracts C:\\Windows\\System32\\cmd.exe /d /s /c "npm run typecheck:contracts"` — exit 0。
- 構造検査: `node tools/run-ci-command.mjs pds-01-architecture C:\\Windows\\System32\\cmd.exe /d /s /c "npm run validate:architecture"` — exit 0。
- lint: `node tools/run-ci-command.mjs pds-01-lint C:\\Windows\\System32\\cmd.exe /d /s /c "npm run lint"` — exit 0。
- 既定unit検出: `node tools/run-ci-command.mjs pds-01-unit-discovery C:\\Windows\\System32\\cmd.exe /d /s /c "npm run test:unit"` — 新規の契約testと検出契約testは通過したが、Git working-tree path環境の失敗により 736 tests 中 715 passed / 19 failed / 2 skipped、exit 1。診断は `test-output/ci/pds-01-unit-discovery.result.json` と各ログに保存した。

## 対象ファイル

- `src/core/intervals/document-line-contract.ts`: 同一revisionの明示的な存在証拠と本文から、存在有無、表示行数、差分内容行数、EOF改行種別を導出する純粋契約。
- `src/core/intervals/index.ts`: 契約の公開export。
- `test/unit/document-line-contract.test.ts`: 不存在、既存空ファイル、LF、CRLF、改行だけ、連続末尾改行、末尾改行なしを検証。
- `package.json`: 専用テストscriptと既定unit suiteへの登録。
- `test/unit/ci-workflow-contract.test.ts`: 専用scriptと既定unit suiteの両方での検出を固定。
- 確認のみ: `src/composition/pull-request/pull-request-review-runtime-base.ts` は既存の `split()` による表示行数だけの扱いを持つ。PDS-02の実PR入力経路で新しい契約を接続するまで変更しない。

## 指摘事項

- 自己レビューの判定は発行しない。
- 既定unit suiteの19失敗は、Git working tree外のdocument pathを報告する失敗群であり、このタスクの変更箇所・新規契約test・検出契約testではない。既存の記録と同じ系統であることからbaseline相当と推定したが、基準HEADを別途再実行して比較した証拠はない。PDS-01の全焦点検証、契約型検査、構造検査、lintは成功している。

## 結果

- `normal_persistence: repository_file`。
- 技術HEAD: `c2dfc3cb27efd79bdf41c4e0ad7b9534161b588b`（未commit）。branch: `investigation/issue-119-linked-diff-blocks`。push、CI待機、mergeはいずれも未実施。
- 不存在は空文字列から推測せず、`existence: "absent"` を明示入力にする。存在する空ファイルは editor 1 / diff content 0、存在しない側は 0 / 0。LFまたはCRLF終端時は表示用の末尾空行だけを差分内容行数から除く。連続末尾改行の実在空行は保持する。

## リスク

- PDS-02では `RevisionTextContentReadResult` の `found` を `existence: "present"`、`missing-file` を `existence: "absent"` として、同じbase/head revisionの本文取得結果から本契約を組み立てる必要がある。`missing-context`、`missing-revision`、`invalid-encoding` は不存在に変換せず拒否する。
- PDS-02は選択境界に `editorLineCount`、hunk・unchanged mapping・差分整合性に `diffContentLineCount` を使い分ける必要がある。新規のEOF契約だけで不完全なpatchや座標矛盾を許容してはならない。
